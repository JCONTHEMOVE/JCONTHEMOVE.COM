import crypto from "crypto";
import { pool } from "../db";
import { calculateRateCardLine, roundCurrency } from "@shared/canonicalPricing";
import type { CrewCloseoutSubmission } from "@shared/regionalAutomation";
import { ensureRegionalAutomationSchema } from "./regionalAutomationMigration";
import { getActivePricingSnapshot, getPricingSnapshotByCode } from "./pricingVersions";
import { emitCustomerLifecycleEvent } from "./customerLifecycle";
import { storage } from "../storage";
import { squareInvoiceService } from "./square-invoice";

type CloseoutLead = {
  id: string;
  service_type: string;
  crew_size: number;
  confirmed_hours: string | number | null;
  total_price: string | number | null;
  deposit_amount_gate: string | number | null;
  deposit_paid: boolean;
  on_site_at: Date | null;
  completed_at: Date | null;
  email: string;
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || process.env.APP_URL || "https://www.jconthemove.com").replace(/\/$/, "");
}

function serviceUsesHourlyPricing(serviceType: string) {
  return /move|moving|residential|commercial|labor|load|unload/i.test(serviceType);
}

async function notifyCloseoutOwners(leadId: string, closeoutId: string, title: string, message: string) {
  await pool.query(
    `INSERT INTO notifications (user_id,type,title,message,data)
     SELECT id,'closeout_exception',$1,$2,$3::jsonb
       FROM users
      WHERE role IN ('admin','business_owner') AND status IN ('approved','active')`,
    [title, message, JSON.stringify({ leadId, closeoutId, href: "/admin/regional-automation" })],
  ).catch((error) => console.warn("[job-closeout] owner notification failed:", error));
}

export async function submitJobCloseout(input: {
  leadId: string;
  submittedByUserId: string;
  data: CrewCloseoutSubmission;
}) {
  await ensureRegionalAutomationSchema();
  const leadResult = await pool.query<CloseoutLead>(
    `SELECT id, service_type, COALESCE(crew_size,2) AS crew_size, confirmed_hours,
            total_price, deposit_amount_gate, COALESCE(deposit_paid,false) AS deposit_paid,
            on_site_at, completed_at, email
       FROM leads WHERE id=$1`,
    [input.leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new Error("Job not found");
  const assignment = await pool.query(
    `SELECT 1 FROM job_assignments WHERE lead_id=$1 AND worker_id=$2
     UNION ALL SELECT 1 FROM leads WHERE id=$1 AND $2=ANY(COALESCE(crew_members,'{}')) LIMIT 1`,
    [input.leadId, input.submittedByUserId],
  );
  if (!assignment.rows.length) throw new Error("Only assigned crew can submit this closeout");
  const existingCloseout = await pool.query<{ status: string }>(`SELECT status FROM job_closeouts WHERE lead_id=$1`, [input.leadId]);
  if (["awaiting_customer", "approved", "balance_due", "paid", "refund_review"].includes(existingCloseout.rows[0]?.status || "")) {
    throw new Error("This closeout is already in customer, payment, or refund review and cannot be replaced by crew");
  }

  const actualStart = lead.on_site_at || (input.data.actualStartAt ? new Date(input.data.actualStartAt) : null);
  const actualEnd = new Date(input.data.actualEndAt);
  const elapsedHours = actualStart && Number.isFinite(actualEnd.getTime()) ? (actualEnd.getTime() - actualStart.getTime()) / 3_600_000 : 0;
  const invalidTimes = !actualStart || !Number.isFinite(actualEnd.getTime()) || elapsedHours <= 0 || input.data.breakMinutes / 60 >= elapsedHours;
  const rawHours = invalidTimes ? 0 : Math.max(0, elapsedHours - input.data.breakMinutes / 60);
  const actualHours = Math.round(rawHours * 100) / 100;

  const quoteResult = await pool.query<{
    id: string;
    pricing_version_code: string | null;
    customer_total: string;
    line_items: unknown;
    pricing_adjustments: unknown;
    travel_eligibility: unknown;
    route_evidence: unknown;
  }>(
    `SELECT id, pricing_version_code, customer_total, line_items, pricing_adjustments, travel_eligibility, route_evidence
       FROM quote_revisions
      WHERE lead_id=$1 AND status IN ('approved','sent')
      ORDER BY revision DESC LIMIT 1`,
    [input.leadId],
  );
  const quote = quoteResult.rows[0];
  if (!quote) throw new Error("An approved quote is required before closeout");
  const pricing = quote.pricing_version_code
    ? await getPricingSnapshotByCode(quote.pricing_version_code)
    : await getActivePricingSnapshot();
  if (!pricing) throw new Error("The quote pricing snapshot is unavailable");

  const quotedTotal = roundCurrency(Number(quote.customer_total || lead.total_price || 0));
  const scheduledHours = Math.max(0, Number(lead.confirmed_hours || 0));
  let laborDelta = 0;
  if (serviceUsesHourlyPricing(lead.service_type) && actualHours > 0 && scheduledHours > 0) {
    const scheduled = calculateRateCardLine({ serviceCode: "load_unload", crewSize: lead.crew_size, hours: scheduledHours, snapshot: pricing.snapshot });
    const actual = calculateRateCardLine({ serviceCode: "load_unload", crewSize: lead.crew_size, hours: actualHours, snapshot: pricing.snapshot });
    if (scheduled && actual) laborDelta = roundCurrency(actual.subtotal - scheduled.subtotal);
  }
  const changeOrderTotal = roundCurrency(input.data.changeOrders.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const calculatedFinalTotal = roundCurrency(Math.max(0, quotedTotal + laborDelta + changeOrderTotal));
  const depositApplied = lead.deposit_paid ? roundCurrency(Number(lead.deposit_amount_gate || 0)) : 0;
  const balanceDue = roundCurrency(Math.max(0, calculatedFinalTotal - depositApplied));
  const exceptionFlags = [
    ...(invalidTimes ? ["invalid_or_missing_time"] : []),
    ...(input.data.proofPhotos.length === 0 ? ["missing_proof"] : []),
    ...(input.data.damageReported ? ["damage_reported"] : []),
    ...(input.data.customerDisputed ? ["customer_disputed"] : []),
    ...(input.data.changeOrders.some((item) => !item.catalogBacked) ? ["noncatalog_change"] : []),
    ...(input.data.changeOrders.some((item) => !item.customerAcknowledged) ? ["unacknowledged_change"] : []),
    ...(calculatedFinalTotal < depositApplied ? ["refund_review"] : []),
  ];
  const status = exceptionFlags.length ? (exceptionFlags.includes("refund_review") ? "refund_review" : "owner_review") : "awaiting_customer";
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const tokenExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`job-closeout:${input.leadId}`]);
    await client.query('SELECT id FROM leads WHERE id=$1 FOR UPDATE', [input.leadId]);
    const lockedExisting = await client.query<{ status: string }>(`SELECT status FROM job_closeouts WHERE lead_id=$1`, [input.leadId]);
    if (["awaiting_customer", "approved", "balance_due", "paid", "refund_review"].includes(lockedExisting.rows[0]?.status || "")) {
      throw new Error("This closeout is already in customer, payment, or refund review and cannot be replaced by crew");
    }
    const closeoutResult = await client.query<{ id: string }>(
      `INSERT INTO job_closeouts
         (lead_id, status, submitted_by_user_id, actual_start_at, actual_end_at, break_minutes,
          actual_hours, proof_photos, exception_flags, crew_notes, pricing_snapshot, quoted_total,
          calculated_final_total, deposit_applied, balance_due, customer_token_hash, customer_token_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (lead_id) DO UPDATE SET
         status=EXCLUDED.status, submitted_by_user_id=EXCLUDED.submitted_by_user_id,
         actual_start_at=EXCLUDED.actual_start_at, actual_end_at=EXCLUDED.actual_end_at,
         break_minutes=EXCLUDED.break_minutes, actual_hours=EXCLUDED.actual_hours,
         proof_photos=EXCLUDED.proof_photos, exception_flags=EXCLUDED.exception_flags,
         crew_notes=EXCLUDED.crew_notes, pricing_snapshot=EXCLUDED.pricing_snapshot,
         quoted_total=EXCLUDED.quoted_total, calculated_final_total=EXCLUDED.calculated_final_total,
         deposit_applied=EXCLUDED.deposit_applied, balance_due=EXCLUDED.balance_due,
         customer_token_hash=EXCLUDED.customer_token_hash, customer_token_expires_at=EXCLUDED.customer_token_expires_at,
         customer_approved_at=NULL, customer_rejected_at=NULL, updated_at=NOW()
       RETURNING id`,
      [input.leadId, status, input.submittedByUserId, actualStart, actualEnd, input.data.breakMinutes,
        actualHours, JSON.stringify(input.data.proofPhotos), JSON.stringify(exceptionFlags), input.data.crewNotes,
        JSON.stringify({ version: pricing.snapshot.version, quoteRevisionId: quote.id, lineItems: quote.line_items, pricingAdjustments: quote.pricing_adjustments }),
        quotedTotal, calculatedFinalTotal, depositApplied, balanceDue, tokenHash, tokenExpires],
    );
    const closeoutId = closeoutResult.rows[0].id;
    await client.query(`DELETE FROM job_change_orders WHERE closeout_id=$1`, [closeoutId]);
    for (const change of input.data.changeOrders) {
      const total = roundCurrency(change.quantity * change.unitPrice);
      await client.query(
        `INSERT INTO job_change_orders
           (closeout_id, lead_id, code, description, quantity, unit_price, total, catalog_backed, customer_acknowledged_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [closeoutId, input.leadId, change.code, change.description, change.quantity, change.unitPrice, total, change.catalogBacked, change.customerAcknowledged ? new Date() : null],
      );
    }
    await client.query(
      `UPDATE leads SET status='completed', dispatch_state='completed', completed_at=COALESCE(completed_at,$2),
              closeout_status=$3, financial_status=$4, final_balance_amount=$5,
              total_price=CASE WHEN $7::boolean THEN total_price ELSE $6::numeric END
        WHERE id=$1`,
      [input.leadId, actualEnd, status, status === "awaiting_customer" ? "awaiting_customer_approval" : status, balanceDue, calculatedFinalTotal,
        process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true'],
    );
    await client.query(
      `UPDATE job_assignments SET hours_worked=$2, updated_at=NOW() WHERE lead_id=$1`,
      [input.leadId, actualHours],
    );
    await client.query("COMMIT");
    const actionUrl = status === "awaiting_customer" ? `${publicBaseUrl()}/job-closeout/${token}` : undefined;
    await emitCustomerLifecycleEvent({
      leadId: input.leadId,
      type: "closeout_ready",
      eventKey: `${input.leadId}:closeout_ready:${closeoutId}:${status}:${actualEnd.toISOString()}`,
      title: status === "awaiting_customer" ? "Review your completed job" : "Your job closeout is under review",
      message: status === "awaiting_customer"
        ? `The crew submitted ${actualHours.toFixed(2)} actual hours. Review the final total of $${calculatedFinalTotal.toFixed(2)} before the balance invoice is created.`
        : "The crew completed the job, and the closeout needs an owner review before final billing.",
      payload: { closeoutId, status, actualHours, calculatedFinalTotal, depositApplied, balanceDue },
      actionUrl,
    });
    if (status !== "awaiting_customer") {
      await notifyCloseoutOwners(input.leadId, closeoutId, "Job closeout needs review", `A ${status.replace(/_/g, " ")} closeout is waiting in the regional exception queue.`);
    }
    return { closeoutId, status, actualHours, calculatedFinalTotal, depositApplied, balanceDue, actionUrl };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadCloseoutByToken(token: string) {
  await ensureRegionalAutomationSchema();
  const { rows } = await pool.query(
    `SELECT c.*, l.first_name, l.last_name, l.service_type, l.confirmed_date, l.move_date,
            l.from_address, l.to_address
       FROM job_closeouts c
       JOIN leads l ON l.id=c.lead_id
      WHERE c.customer_token_hash=$1 AND c.customer_token_expires_at>NOW()
      LIMIT 1`,
    [hashToken(token)],
  );
  if (!rows[0]) throw new Error("This closeout link is invalid or expired");
  const changes = await pool.query(
    `SELECT id, code, description, quantity, unit_price, total, catalog_backed, customer_acknowledged_at
       FROM job_change_orders WHERE closeout_id=$1 ORDER BY created_at`,
    [rows[0].id],
  );
  return { ...rows[0], change_orders: changes.rows };
}

export async function getCustomerCloseout(token: string) {
  return loadCloseoutByToken(token);
}

async function issueAuthenticatedCloseoutToken(leadId: string, customerEmail: string) {
  const ownership = await pool.query<{ id: string }>(
    `SELECT c.id FROM job_closeouts c JOIN leads l ON l.id=c.lead_id
      WHERE c.lead_id=$1 AND lower(l.email)=lower($2) LIMIT 1`,
    [leadId, customerEmail],
  );
  if (!ownership.rows[0]) throw new Error("Closeout not found");
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `UPDATE job_closeouts SET customer_token_hash=$2, customer_token_expires_at=NOW()+INTERVAL '30 minutes', updated_at=NOW() WHERE id=$1`,
    [ownership.rows[0].id, hashToken(token)],
  );
  return token;
}

export async function getAuthenticatedCustomerCloseout(leadId: string, customerEmail: string) {
  return getCustomerCloseout(await issueAuthenticatedCloseoutToken(leadId, customerEmail));
}

export async function approveAuthenticatedCustomerCloseout(leadId: string, customerEmail: string) {
  return approveCustomerCloseout(await issueAuthenticatedCloseoutToken(leadId, customerEmail));
}

export async function rejectAuthenticatedCustomerCloseout(leadId: string, customerEmail: string, note: string) {
  return rejectCustomerCloseout(await issueAuthenticatedCloseoutToken(leadId, customerEmail), note);
}

export async function rejectCustomerCloseout(token: string, note: string) {
  const closeout = await loadCloseoutByToken(token);
  if (closeout.status !== "awaiting_customer") throw new Error("This closeout is no longer awaiting approval");
  await pool.query(
    `UPDATE job_closeouts SET status='customer_rejected', customer_rejected_at=NOW(),
            exception_flags=COALESCE(exception_flags,'[]'::jsonb) || $2::jsonb,
            crew_notes=CONCAT_WS(E'\n', crew_notes, $3), updated_at=NOW()
      WHERE id=$1`,
    [closeout.id, JSON.stringify(["customer_rejected"]), note ? `Customer rejection note: ${note}` : "Customer rejected closeout"],
  );
  await pool.query(`UPDATE leads SET closeout_status='customer_rejected', financial_status='customer_rejected' WHERE id=$1`, [closeout.lead_id]);
  await notifyCloseoutOwners(closeout.lead_id, closeout.id, "Customer requested a closeout correction", note);
  return { ok: true, status: "customer_rejected" };
}

export async function approveCustomerCloseout(token: string) {
  const closeout = await loadCloseoutByToken(token);
  if (closeout.status !== "awaiting_customer") {
    throw new Error("This closeout is not ready for customer approval");
  }
  const canonicalApproval = process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true'
    ? await (await import('./canonicalCloseoutApproval')).approveCanonicalCloseout(closeout.id) : null;
  const claimed = canonicalApproval ? { rows: [{ id: closeout.id }] } : await pool.query<{ id: string }>(
    `UPDATE job_closeouts SET status='approved', customer_approved_at=COALESCE(customer_approved_at,NOW()), updated_at=NOW()
      WHERE id=$1 AND status='awaiting_customer' RETURNING id`,
    [closeout.id],
  );
  if (!claimed.rows[0]) throw new Error("This closeout approval is already being processed");
  const balanceDue = canonicalApproval?.balanceDue ?? Number(closeout.balance_due || 0);
  if (balanceDue <= 0) {
    if (!canonicalApproval) {
      await pool.query(`UPDATE job_closeouts SET status='paid', customer_approved_at=COALESCE(customer_approved_at,NOW()), updated_at=NOW() WHERE id=$1`, [closeout.id]);
      await pool.query(`UPDATE leads SET closeout_status='paid', financial_status='paid', payment_paid_at=COALESCE(payment_paid_at,NOW()) WHERE id=$1`, [closeout.lead_id]);
    }
    try {
      const { disburseJobTokens } = await import("./disburse-job-tokens");
      await disburseJobTokens(closeout.lead_id);
    } catch (error) {
      console.error("[job-closeout] zero-balance reward disbursement failed:", error);
    }
    await emitCustomerLifecycleEvent({
      leadId: closeout.lead_id,
      type: "final_payment_received",
      eventKey: `${closeout.lead_id}:financially_complete:${closeout.id}`,
      title: "Your job is financially complete",
      message: "Your approved deposit and final amount fully cover the completed job. No additional payment is due.",
      payload: { closeoutId: closeout.id, balanceDue: 0 },
    });
    return { ok: true, status: "paid", balanceDue: 0, invoiceUrl: null };
  }
  const lead = await storage.getLead(closeout.lead_id);
  if (!lead) throw new Error("Job not found");
  let invoice: Awaited<ReturnType<typeof squareInvoiceService.createInvoiceForLead>>;
  try {
    invoice = await squareInvoiceService.createInvoiceForLead(
      lead,
      balanceDue,
      `Final balance after completion — actual hours and approved changes`,
      canonicalApproval?.invoiceDueDate,
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) ? "email" : "none",
      { purpose: "final_balance", closeoutId: closeout.id, quoteRevisionId: canonicalApproval?.quoteRevisionId,
        idempotencyKey: canonicalApproval?.invoiceRequestKey },
    );
  } catch (error) {
    await pool.query(
      `UPDATE job_closeouts SET status='awaiting_customer', customer_approved_at=NULL, updated_at=NOW()
        WHERE id=$1 AND status='approved' AND square_invoice_id IS NULL`,
      [closeout.id],
    );
    throw error;
  }
  await pool.query(
    `UPDATE job_closeouts SET status='balance_due', customer_approved_at=COALESCE(customer_approved_at,NOW()),
            square_invoice_id=$2, updated_at=NOW() WHERE id=$1`,
    [closeout.id, invoice.squareInvoiceId],
  );
  await pool.query(
    `UPDATE leads SET closeout_status='balance_due', financial_status='balance_due',
            final_invoice_url=$2, final_balance_amount=$3 WHERE id=$1`,
    [closeout.lead_id, invoice.invoiceUrl, balanceDue],
  );
  await emitCustomerLifecycleEvent({
    leadId: closeout.lead_id,
    type: "final_invoice_sent",
    eventKey: `${closeout.lead_id}:final_invoice_sent:${invoice.squareInvoiceId}`,
    title: "Your final balance is ready",
    message: `The approved final balance is $${balanceDue.toFixed(2)}. Pay securely through Square.`,
    payload: { closeoutId: closeout.id, squareInvoiceId: invoice.squareInvoiceId, balanceDue, invoiceUrl: invoice.invoiceUrl },
    actionUrl: invoice.invoiceUrl,
  });
  return { ok: true, status: "balance_due", balanceDue, invoiceUrl: invoice.invoiceUrl };
}

export async function ownerApproveCloseout(closeoutId: string, actorUserId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const { rows } = await pool.query<{ lead_id: string; status: string; calculated_final_total: string; balance_due: string }>(
    `UPDATE job_closeouts SET status='awaiting_customer', reviewed_by_user_id=$2, reviewed_at=NOW(),
            exception_flags='[]'::jsonb, customer_token_hash=$3,
            customer_token_expires_at=NOW()+INTERVAL '14 days', updated_at=NOW()
      WHERE id=$1 AND status IN ('owner_review','customer_rejected')
      RETURNING lead_id, status, calculated_final_total, balance_due`,
    [closeoutId, actorUserId, hashToken(token)],
  );
  if (!rows[0]) throw new Error("Closeout is not awaiting owner review");
  await pool.query(`UPDATE job_change_orders SET status='approved' WHERE closeout_id=$1`, [closeoutId]);
  await pool.query(`UPDATE leads SET closeout_status='awaiting_customer', financial_status='awaiting_customer_approval' WHERE id=$1`, [rows[0].lead_id]);
  const actionUrl = `${publicBaseUrl()}/job-closeout/${token}`;
  await emitCustomerLifecycleEvent({
    leadId: rows[0].lead_id,
    type: "closeout_ready",
    eventKey: `${rows[0].lead_id}:closeout_owner_approved:${closeoutId}:${Date.now()}`,
    title: "Your final job review is ready",
    message: `The owner reviewed the closeout. Please approve the final total of $${Number(rows[0].calculated_final_total).toFixed(2)} before the $${Number(rows[0].balance_due).toFixed(2)} balance invoice is created.`,
    payload: { closeoutId, status: "awaiting_customer" },
    actionUrl,
  });
  return { ok: true, status: "awaiting_customer", actionUrl };
}
