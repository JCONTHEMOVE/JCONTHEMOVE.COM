import crypto from "node:crypto";
import { pool } from "../db";
import { assertQuoteApprovalAllowed } from "@shared/canonicalPricing";
import { cents, customerAgreementSnapshot, dispatchBlockers, projectJobWorkflow, quoteTerms, workflowDetailsBlockers, type DeliveryOutcome, type JobWorkflow, type WorkflowBlocker, type WorkflowQuote } from "@shared/job-workflow";
import { ensureQuoteRevisionInfrastructure, rowToQuote, reviewSavedQuotePolicy } from "./quoteRevisions";
import { squareInvoiceService } from "./square-invoice";
import { getSquareEnvironment, getSquareLocationId } from "./squareConfig";
import { sendWorkflowEmail as sendEmail } from "./email";
import { smsService } from "./sms";
import { ensureRegionalAutomationSchema } from "./regionalAutomationMigration";

type Queryable = { query: (text: string, values?: any[]) => Promise<any> };
export type WorkflowActor = { userId: string; isOwner: boolean; canApproveStandard: boolean; manage: boolean; tier?: string };
export class WorkflowError extends Error {
  constructor(public status: number, message: string, public blockers: WorkflowBlocker[] = []) { super(message); }
}
export const workflowHash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const camel = (row: any): Record<string, any> => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
const smsConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && (process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_API_KEY && process.env.TWILIO_API_KEY_SECRET) && (process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID));
export const usableEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "") && !/@(?:jconthemove\.local|system\.internal)$|\.internal$/i.test(email);

export async function workflowActor(userId: string): Promise<WorkflowActor | null> {
  const { rows } = await pool.query(`SELECT u.id,u.role,u.email,u.status,u.is_approved,wp.authority_tier FROM users u LEFT JOIN worker_profiles wp ON wp.user_id=u.id WHERE u.id=$1`, [userId]);
  const user = rows[0];
  if (!user || !["admin", "business_owner", "employee"].includes(user.role) || !(["admin", "business_owner"].includes(user.role) || user.is_approved || ["active", "approved"].includes(user.status))) return null;
  const isOwner = user.role === "business_owner" || user.email === "upmichiganstatemovers@gmail.com";
  return { userId, isOwner, tier: user.authority_tier, manage: isOwner || user.role === "admin", canApproveStandard: isOwner || user.role === "admin" || ["gold", "platinum"].includes(user.authority_tier) };
}

/** Saved pricing stays authoritative. Only discounts recorded by the pricing
 * engine are shown; a unexplained difference is a repair, never an inferred discount. */
export function savedWorkflowQuote(lead: any, row: any): WorkflowQuote {
  const items = Array.isArray(lead.orderLineItems) ? lead.orderLineItems : [];
  const total = cents(lead.totalPrice ?? lead.basePrice) / 100;
  const auto = lead.quoteSnapshot?.rateCardAutoQuote;
  const recordedDiscount = Number(auto?.discountAmount ?? auto?.promotion?.discountAmount ?? lead.quoteSnapshot?.appliedJobPromotion?.discountAmount ?? lead.bundleDiscountAmount ?? 0);
  const rawLines = items.length ? items : [{ name: String(lead.serviceType || "Service"), total, quantity: 1, unitPrice: total }];
  let lines: WorkflowQuote["lines"] = rawLines.map((item: any) => ({ name: String(item.name || item.label || "Service"), quantity: Number(item.quantity ?? item.qty ?? 1) || 1, unitPrice: Number(item.unitPrice ?? item.total ?? 0), total: cents(item.total ?? item.amount ?? Number(item.unitPrice || 0) * Number(item.quantity ?? item.qty ?? 1)) / 100 }));
  let discount = Math.max(0, recordedDiscount);
  const stored = row ? rowToQuote(row) : null;
  const termsHash = workflowHash(quoteTerms(lead));
  const storedTermsHash = (stored?.routeEvidence as any)?.workflowTermsHash;
  const matches = Boolean(stored && cents(stored.customerTotal) === cents(total) && (!storedTermsHash || storedTermsHash === termsHash)
    && (storedTermsHash || JSON.stringify(stored.lineItems.map(i => [i.name, cents(i.total)])) === JSON.stringify(lines.map(i => [i.name, cents(i.total)]))));
  if (matches && stored) {
    lines = stored.lineItems.map(i => ({ ...i, quantity: i.quantity || (i as any).qty || 1 }));
    const adjustments = stored.pricingAdjustments as any;
    if (Number(adjustments.geographicAmount) > 0) lines.push({ name: "Extended service-area adjustment", quantity: 1, unitPrice: Number(adjustments.geographicAmount), total: Number(adjustments.geographicAmount) });
    if (Number(adjustments.weekendAmount) > 0) lines.push({ name: "Weekend adjustment", quantity: 1, unitPrice: Number(adjustments.weekendAmount), total: Number(adjustments.weekendAmount) });
    discount = stored.discountTotal || recordedDiscount;
  }
  const subtotal = cents(lines.reduce((sum, line) => sum + line.total, 0)) / 100;
  const reconciled = total > 0 && cents(subtotal - discount) === cents(total);
  return { id: stored?.id || null, revision: stored?.revision || 0, status: matches ? stored!.status : "draft", total, subtotal, discount,
    lines, matches: matches && reconciled, requiresOwner: Boolean(stored?.travelEligibility?.requiresOwner), reasons: reconciled ? [] : ["Saved line items and recorded discounts do not match the total. Review the price before approval."] };
}

export async function loadWorkflowState(leadId: string, client: Queryable = pool, lock = false) {
  const leadResult = await client.query(`SELECT * FROM leads WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [leadId]);
  if (!leadResult.rows[0]) throw new WorkflowError(404, "Job not found");
  const lead = camel(leadResult.rows[0]);
  // Use a database-produced revision marker: raw Drizzle transactions preserve
  // timestamp strings while pool reads decode Date objects.
  const result = await client.query("SELECT *, EXTRACT(EPOCH FROM updated_at)::text AS workflow_revision_stamp FROM quote_revisions WHERE lead_id=$1 ORDER BY revision DESC LIMIT 1", [leadId]);
  const row = result.rows[0] || null;
  const quote = savedWorkflowQuote(lead, row);
  const grants = await client.query("SELECT id,amount_usd,metadata FROM wallet_credit_grants WHERE source_type='lead' AND source_id=$1 AND status='pending' ORDER BY id", [leadId]);
  const pendingAddOns = grants.rows.map((g: any) => ({ id: g.id, name: String(g.metadata?.name || "JCMOVES Shop Card"), quantity: 1, unitPrice: cents(g.amount_usd) / 100, total: cents(g.amount_usd) / 100 }));
  quote.addOns = quote.matches && ["approved", "sent"].includes(quote.status) && Array.isArray(row?.route_evidence?.workflowBillingAddOns) ? row.route_evidence.workflowBillingAddOns : pendingAddOns;
  quote.invoiceTotal = (cents(quote.total) + quote.addOns!.reduce((sum, item) => sum + cents(item.total), 0)) / 100;
  const version = workflowHash({ terms: quoteTerms(lead), customer: [lead.firstName, lead.lastName, lead.email, lead.phone], quote: row ? [row.id, row.status, row.workflow_revision_stamp] : null, lineItems: lead.orderLineItems, addOns: quote.addOns, pendingAddOns, confirmation: lead.jobPlanDetails?.customerConfirmation, crew: lead.crewMembers, payment: [Boolean(lead.paymentPaidAt), lead.depositPaid, lead.paymentPlan], status: lead.status });
  const confirmationHash = workflowHash(customerAgreementSnapshot(lead, quote.id));
  return { lead, row, quote, version, confirmationHash };
}
const loadState = loadWorkflowState;

export async function getJobWorkflow(leadId: string, actor: WorkflowActor) {
  await ensureQuoteRevisionInfrastructure();
  const state = await loadState(leadId);
  let delivery = state.lead.jobPlanDetails?.quoteDelivery;
  if (delivery?.quoteId !== state.quote.id) delivery = undefined;
  if (delivery && actor.manage) {
    const outcomes = await pool.query("SELECT d.channel,d.status,d.error,d.provider_reference FROM customer_notification_deliveries d JOIN customer_job_events e ON e.id=d.event_id WHERE e.event_key=ANY($1::text[])", [[`workflow-delivery:${state.quote.id}`, `workflow-invoice:${state.quote.id}`]]);
    delivery = { ...delivery };
    for (const row of outcomes.rows) if (["email", "sms", "invoice"].includes(row.channel)) delivery[row.channel] = { status: row.status === "pending" ? "unknown" : row.status, message: row.error || undefined, reference: row.provider_reference || undefined };
  }
  const workflow = projectJobWorkflow({ ...state, capabilities: { approve: actor.canApproveStandard, manage: actor.manage, sms: smsConfigured() }, delivery });
  if (!actor.manage) { workflow.delivery = undefined; workflow.payment = { ready: false, label: "Managed by staff" }; }
  return workflow;
}

export async function reviewJobQuote(leadId: string, actor: WorkflowActor, deliveryMethod: string) {
  await ensureQuoteRevisionInfrastructure();
  const state = await loadState(leadId);
  const { lead, quote } = state;
  const blockers = workflowDetailsBlockers(lead);
  if (quote.reasons.length) blockers.push({ code: "quote_reconcile", message: quote.reasons[0], target: "quote", field: "setup-quote-review" });
  if (["email", "both"].includes(deliveryMethod) && !usableEmail(lead.email)) blockers.push({ code: "customer_email", message: "Enter a usable email address or choose Copy link.", target: "customer", field: "setup-email" });
  if (["sms", "both"].includes(deliveryMethod) && !smsConfigured()) blockers.push({ code: "sms_unavailable", message: "Text delivery is unavailable. Choose email or Copy link.", target: "quote" });
  let policy: any = state.row ? rowToQuote(state.row) : null;
  if (!quote.matches || quote.status === "draft") {
    if (!quote.reasons.length) {
      const calculated = await reviewSavedQuotePolicy(leadId, quote.matches && state.row ? state.row.line_items : quote.lines, quote.discount);
      policy = { pricingVersionId: calculated.active.versionId, pricingVersionCode: calculated.active.snapshot.version, travelEligibility: calculated.travelEligibility, routeEvidence: calculated.routeEvidence, pricingAdjustments: calculated.pricingAdjustments };
      if (cents(calculated.finalPreTaxTotal) !== cents(quote.total)) blockers.push({ code: "quote_policy", message: "The current pricing policy differs from this saved amount. Review the price before approval; the saved total has not changed.", target: "quote", field: "setup-quote-review" });
    }
  }
  quote.requiresOwner = Boolean(policy?.travelEligibility?.requiresOwner && (!quote.matches || quote.status === "draft"));
  if (policy?.travelEligibility?.canApprove === false || policy?.travelEligibility?.status === "out_of_range") blockers.push({ code: "quote_policy", message: "This job is outside the current service policy. Review its address and scope.", target: "details" });
  if (quote.requiresOwner && !actor.isOwner) blockers.push({ code: "owner_approval", message: "This quote needs the business owner's review.", target: "quote" });
  return { ...state, policy, blockers, reviewHash: workflowHash({ version: state.version, quote, policy: { pricingVersionId: policy?.pricingVersionId, travelEligibility: policy?.travelEligibility, pricingAdjustments: policy?.pricingAdjustments }, deliveryMethod }), deliveryMethod,
    recipient: { name: `${lead.firstName} ${lead.lastName}`, email: lead.email, phone: lead.phone },
    smsConsent: Boolean(lead.smsConsent), invoiceAvailable: squareInvoiceService.isConfigured() && Boolean(getSquareLocationId()) && (process.env.NODE_ENV !== "production" || getSquareEnvironment() === "production") };
}

async function audit(client: Queryable, lead: any, actorId: string, note: string) {
  await client.query("INSERT INTO lead_history (lead_id, from_status, to_status, changed_by_user_id, note) VALUES ($1,$2,$2,$3,$4)", [lead.id, lead.status, actorId, note]);
}

/** Called from the setup transaction through a query adapter. */
export async function syncSavedQuote(client: Queryable, lead: any, previousLead: any) {
  const changed = workflowHash(quoteTerms(lead)) !== workflowHash(quoteTerms(previousLead)) || JSON.stringify(lead.orderLineItems) !== JSON.stringify(previousLead.orderLineItems);
  if (!changed || !(Number(lead.totalPrice ?? lead.basePrice) > 0)) return;
  const { rows } = await client.query("SELECT * FROM quote_revisions WHERE lead_id=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE", [lead.id]);
  const latest = rows[0];
  const quote = savedWorkflowQuote(lead, null);
  const evidence = { workflowTermsHash: workflowHash(quoteTerms(lead)), workflowSavedSnapshot: customerAgreementSnapshot(lead, null) };
  if (latest?.status === "draft") {
    await client.query("UPDATE quote_revisions SET line_items=$2::jsonb,subtotal=$3,discount_total=$4,final_pre_tax_total=$5,customer_total=$5,route_evidence=$6::jsonb,pricing_adjustments='{}'::jsonb,travel_eligibility='{}'::jsonb,updated_at=NOW() WHERE id=$1", [latest.id, JSON.stringify(quote.lines), quote.subtotal, quote.discount, quote.total, JSON.stringify(evidence)]);
  } else {
    const id = crypto.randomUUID();
    await client.query("INSERT INTO quote_revisions(id,lead_id,revision,status,line_items,subtotal,discount_total,final_pre_tax_total,customer_total,route_evidence,pricing_version_code) VALUES($1,$2,$3,'draft',$4::jsonb,$5,$6,$7,$7,$8::jsonb,'saved_job')", [id, lead.id, Number(latest?.revision || 0) + 1, JSON.stringify(quote.lines), quote.subtotal, quote.discount, quote.total, JSON.stringify(evidence)]);
    if (latest) await client.query("UPDATE quote_revisions SET status='superseded',superseded_by_quote_id=$2,updated_at=NOW() WHERE id=$1", [latest.id, id]);
  }
}

function linkSecret() { return process.env.SESSION_SECRET || "jc-on-the-move-development-quote-link"; }
export function workflowQuoteLink(leadId: string, quoteId: string) {
  const encoded = Buffer.from(JSON.stringify({ leadId, quoteId, exp: Date.now() + 30 * 86400000 })).toString("base64url");
  const token = `${encoded}.${crypto.createHmac("sha256", linkSecret()).update(encoded).digest("base64url")}`;
  return `${process.env.PUBLIC_APP_URL || process.env.APP_URL || "https://www.jconthemove.com"}/quote-order/${encodeURIComponent(leadId)}?token=${encodeURIComponent(token)}`;
}
export function readWorkflowQuoteToken(token: string) {
  try {
    const [encoded, signature] = token.split(".");
    const expected = crypto.createHmac("sha256", linkSecret()).update(encoded).digest("base64url");
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString());
    return data.quoteId && data.leadId && data.exp > Date.now() ? data as { leadId: string; quoteId: string } : null;
  } catch { return null; }
}

export async function approveAndSend(leadId: string, actor: WorkflowActor, input: { version: string; reviewHash: string; idempotencyKey: string; deliveryMethod: "email" | "sms" | "both" | "copy"; message?: string; recordSmsConsent?: boolean; overrideReason?: string }) {
  if (!actor.canApproveStandard) throw new WorkflowError(403, "Quote approval authority is required.");
  await ensureRegionalAutomationSchema();
  const operationKey = `job-quote:${leadId}:${input.idempotencyKey}`;
  const existing = await pool.query("SELECT payload FROM customer_job_events WHERE event_key=$1", [operationKey]);
  if (existing.rows[0]) {
    if (existing.rows[0].payload.actorId !== actor.userId) throw new WorkflowError(409, "This action belongs to another staff member.");
    return finishQuoteDelivery(leadId, actor, input, operationKey, existing.rows[0].payload.quoteId);
  }
  const review = await reviewJobQuote(leadId, actor, input.deliveryMethod);
  if (review.version !== input.version || review.reviewHash !== input.reviewHash) throw new WorkflowError(409, "This job changed. Review the current details before sending.", [{ code: "stale_review", message: "Review the updated job and quote.", target: "quote" }]);
  if (review.blockers.length) throw new WorkflowError(409, "Complete the highlighted details before sending.", review.blockers);
  if (["sms", "both"].includes(input.deliveryMethod) && !review.smsConsent && !input.recordSmsConsent) throw new WorkflowError(400, "Record the customer's permission before sending a text.", [{ code: "sms_consent", message: "Confirm the customer agreed to receive this text.", target: "quote" }]);
  try { if (!review.quote.matches || review.quote.status === "draft") assertQuoteApprovalAllowed({ travelEligibility: review.policy?.travelEligibility || {}, actor, overrideReason: input.overrideReason }); }
  catch (error) { throw new WorkflowError(403, error instanceof Error ? error.message : "Quote approval is not allowed.", [{ code: "approval_required", message: error instanceof Error ? error.message : "Review quote approval.", target: "quote" }]); }
  const client = await pool.connect();
  let quoteId = "";
  try {
    await client.query("BEGIN");
    const locked = await loadState(leadId, client, true);
    const same = await client.query("SELECT payload FROM customer_job_events WHERE event_key=$1", [operationKey]);
    if (same.rows[0]) quoteId = same.rows[0].payload.quoteId;
    else {
      if (locked.version !== input.version) throw new WorkflowError(409, "This job changed. Review it again before sending.");
      if (!locked.quote.matches) await syncSavedQuote(client, locked.lead, { ...locked.lead, totalPrice: "0", basePrice: "0" });
      const { rows } = await client.query("SELECT * FROM quote_revisions WHERE lead_id=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE", [leadId]);
      let row = rows[0];
      if (!row) throw new WorkflowError(409, "Save the job price before approval.");
      quoteId = row.id;
      if (row.status === "draft") {
        await client.query("UPDATE quote_revisions SET status='approved',approved_by_user_id=$2,approved_at=NOW(),line_items=$3::jsonb,subtotal=$4,discount_total=$5,final_pre_tax_total=$6,customer_total=$6,pricing_version_id=$7,pricing_version_code=$8,travel_eligibility=$9::jsonb,route_evidence=$10::jsonb,pricing_adjustments='{}'::jsonb,owner_override_reason=$11,updated_at=NOW() WHERE id=$1", [quoteId, actor.userId, JSON.stringify(review.quote.lines), review.quote.subtotal, review.quote.discount, review.quote.total, review.policy?.pricingVersionId || null, review.policy?.pricingVersionCode || "saved_job", JSON.stringify(review.policy?.travelEligibility || {}), JSON.stringify({ ...(review.policy?.routeEvidence || {}), workflowTermsHash: workflowHash(quoteTerms(locked.lead)), workflowSavedSnapshot: customerAgreementSnapshot(locked.lead, quoteId) }), input.overrideReason || null]);
        await client.query("INSERT INTO quote_approvals(lead_id,booking_id,quote_revision_id,submitted_by_user_id,approved_by_user_id,approval_role,status,notes) VALUES($1,$2,$3,$4,$4,$5,'approved',$6)", [leadId, locked.lead.bookingId, quoteId, actor.userId, actor.isOwner ? "owner_approval" : "gold_vote", input.overrideReason || null]);
        await audit(client, locked.lead, actor.userId, `Quote revision ${row.revision} reviewed and approved.`);
      }
      if (input.recordSmsConsent && ["sms", "both"].includes(input.deliveryMethod)) await client.query("UPDATE leads SET sms_consent=true,sms_consent_recorded_at=NOW(),sms_consent_source='verbal',sms_consent_recorded_by=$2 WHERE id=$1", [leadId, actor.userId]);
      await client.query("UPDATE quote_revisions SET route_evidence=route_evidence || $2::jsonb WHERE id=$1", [quoteId, JSON.stringify({ workflowBillingAddOns: review.quote.addOns || [] })]);
      await client.query("INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload) VALUES($1,'quote_reviewed',$2,'Quote approved','Staff reviewed this quote.',$3::jsonb)", [leadId, operationKey, JSON.stringify({ quoteId, actorId: actor.userId, deliveryMethod: input.deliveryMethod, message: input.message || "", email: locked.lead.email, phone: locked.lead.phone, addOns: review.quote.addOns || [] })]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return finishQuoteDelivery(leadId, actor, input, operationKey, quoteId);
}

async function finishQuoteDelivery(leadId: string, actor: WorkflowActor, input: { deliveryMethod: string; message?: string }, operationKey: string, quoteId: string) {
  try { return await deliverApprovedQuote(leadId, actor, input, operationKey, quoteId); }
  catch (error) {
    if (error instanceof WorkflowError) return { saved: true, approved: true, quoteRevisionId: quoteId, warning: error.message, delivery: { email: { status: "not_requested" as const }, sms: { status: "not_requested" as const }, invoice: { status: "not_requested" as const } }, workflow: await getJobWorkflow(leadId, actor).catch(() => undefined) };
    console.error("[job-workflow] quote saved; delivery reporting needs verification:", error);
    const unknown: DeliveryOutcome = { status: "unknown", message: "Quote saved. Verify delivery status before trying again." };
    return { saved: true, approved: true, quoteRevisionId: quoteId, delivery: { email: unknown, sms: unknown, invoice: unknown, quoteAccessUrl: workflowQuoteLink(leadId, quoteId) }, workflow: await getJobWorkflow(leadId, actor).catch(() => undefined) };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Reserve before crossing an external boundary. A crash or timeout stays
 * unknown; a retry never blindly repeats an uncertain delivery. */
async function deliverChannel(eventId: string, channel: string, destination: string, send: () => Promise<{ ok: boolean; reference?: string; error?: string }>): Promise<DeliveryOutcome> {
  const hash = workflowHash(destination.trim().toLowerCase());
  const { rows } = await pool.query("INSERT INTO customer_notification_deliveries(event_id,channel,destination_hash,status,attempts) VALUES($1,$2,$3,'pending',1) ON CONFLICT(event_id,channel,destination_hash) DO UPDATE SET status='pending',attempts=customer_notification_deliveries.attempts+1,updated_at=NOW() WHERE customer_notification_deliveries.status='failed' RETURNING id", [eventId, channel, hash]);
  if (!rows[0]) {
    const prior = (await pool.query("SELECT status,provider_reference,error FROM customer_notification_deliveries WHERE event_id=$1 AND channel=$2 AND destination_hash=$3", [eventId, channel, hash])).rows[0];
    return { status: prior?.status === "sent" ? "sent" : "unknown", reference: prior?.provider_reference, message: prior?.status === "sent" ? "Already sent" : "Delivery may have started. Verify before sending again." };
  }
  let result: DeliveryOutcome;
  try {
    const sent = await send();
    result = { status: sent.ok ? "sent" : "failed", reference: sent.reference, message: sent.error };
  } catch { result = { status: "unknown", message: "Provider response could not be confirmed. Verify before retrying." }; }
  await pool.query("UPDATE customer_notification_deliveries SET status=$2,provider_reference=$3,error=$4,updated_at=NOW() WHERE id=$1", [rows[0].id, result.status, result.reference || null, result.message || null]);
  return result;
}

async function deliverApprovedQuote(leadId: string, actor: WorkflowActor, input: { deliveryMethod: string; message?: string }, operationKey: string, quoteId: string) {
  const state = await loadState(leadId);
  if (state.row?.id !== quoteId || !state.quote.matches || !["approved", "sent"].includes(state.row.status)) throw new WorkflowError(409, "This quote has changed. Review the current revision before sending.");
  const event = (await pool.query("SELECT id,payload FROM customer_job_events WHERE event_key=$1", [operationKey])).rows[0];
  // A retry uses the originally approved recipients/method, never changes its scope.
  const deliveryMethod = event.payload.deliveryMethod;
  const message = String(event.payload.message || "");
  const { lead, quote } = state;
  if (workflowHash(quote.addOns || []) !== workflowHash(event.payload.addOns || [])) throw new WorkflowError(409, "The invoice add-ons changed. Review the billing details before sharing.");
  if (lead.email !== event.payload.email || lead.phone !== event.payload.phone) throw new WorkflowError(409, "Customer contact details changed. Review the recipients before sending again.");
  const deliveryEvent = (await pool.query("INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload) VALUES($1,'quote_delivery',$2,'Quote delivery','Per-channel quote delivery status','{}'::jsonb) ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id", [leadId, `workflow-delivery:${quoteId}`])).rows[0];
  const quoteAccessUrl = event.payload.quoteAccessUrl || workflowQuoteLink(leadId, quoteId);
  await pool.query("UPDATE customer_job_events SET payload=payload || $2::jsonb WHERE id=$1", [event.id, JSON.stringify({ quoteAccessUrl })]);
  let paymentUrl: string | null = null;
  const invoiceEventKey = `workflow-invoice:${quoteId}`;
  const inv = await pool.query("INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload) VALUES($1,'quote_invoice',$2,'Quote invoice','Invoice creation status','{}'::jsonb) ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id,payload", [leadId, invoiceEventKey]);
  let invoice: DeliveryOutcome = { status: "unavailable", message: "Online payment setup pending" };
  if (squareInvoiceService.isConfigured() && getSquareLocationId() && (process.env.NODE_ENV !== "production" || getSquareEnvironment() === "production")) {
    invoice = await deliverChannel(inv.rows[0].id, "invoice", quoteId, async () => {
      const billableLines = [...quote.lines.map((l, index) => ({ id: `quote-${quoteId}-${index}`, name: l.name, qty: l.quantity, unitPrice: l.total / l.quantity, total: l.total })), ...(quote.addOns || []).map(item => ({ id: item.id, name: item.name, qty: 1, unitPrice: item.total, total: item.total, excludeFromBundleDiscount: true }))];
      const created = await squareInvoiceService.createItemizedInvoiceForLead(lead as any, billableLines, undefined, "none", {
        quoteRevisionId: quoteId, idempotencyKey: `quote-${quoteId}`, purpose: "final_balance", expectedTotal: quote.invoiceTotal ?? quote.total,
        discounts: quote.discount > 0 ? [{ code: "APPROVED_QUOTE_DISCOUNT", name: "Discount", amount: quote.discount }] : [],
      });
      if (quote.addOns?.length) await pool.query("UPDATE wallet_credit_grants SET square_invoice_id=$2 WHERE id=ANY($1::varchar[]) AND status='pending'", [quote.addOns.map(item => item.id), created.squareInvoiceId]);
      await pool.query("UPDATE customer_job_events SET payload=payload || $2::jsonb WHERE id=$1", [inv.rows[0].id, JSON.stringify({ paymentUrl: created.invoiceUrl })]);
      await pool.query("UPDATE leads SET square_payment_url=$2 WHERE id=$1", [leadId, created.invoiceUrl]);
      return { ok: true, reference: created.squareInvoiceId };
    });
  }
  const invoiceData = (await pool.query("SELECT payload FROM customer_job_events WHERE id=$1", [inv.rows[0].id])).rows[0]?.payload;
  if (invoice.status === "sent") paymentUrl = invoiceData?.paymentUrl || null;
  const billingNote = quote.addOns?.length ? `\nShop-card add-ons: $${(quote.invoiceTotal! - quote.total).toFixed(2)}. Invoice total: $${quote.invoiceTotal!.toFixed(2)}.` : "";
  const summary = `Hi ${lead.firstName}, your JC ON THE MOVE quote (JC-${lead.orderNumber}) is $${quote.total.toFixed(2)}.${billingNote} Review your job: ${quoteAccessUrl}${paymentUrl ? `\nPay online: ${paymentUrl}` : "\nOnline payment setup is pending. Contact us to confirm the job."}${message ? `\n${message}` : ""}`;
  const email = ["email", "both"].includes(deliveryMethod)
    ? await deliverChannel(deliveryEvent.id, "email", lead.email, async () => ({ ok: await sendEmail({ to: lead.email, from: "upmichiganstatemovers@gmail.com", subject: `Your JC ON THE MOVE quote — JC-${lead.orderNumber}`, text: summary, html: `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>JC ON THE MOVE · JC-${lead.orderNumber}</h2><p>${escapeHtml(String(lead.serviceType))} · <strong>$${quote.total.toFixed(2)}</strong></p><p>${escapeHtml(String(lead.confirmedDate || "Date to confirm"))}${lead.arrivalWindow ? ` · ${escapeHtml(lead.arrivalWindow)}` : ""}</p><p><a href="${escapeHtml(quoteAccessUrl)}">Review your job and quote</a></p>${paymentUrl ? `<p><a href="${escapeHtml(paymentUrl)}">Pay online</a></p>` : "<p>Online payment setup pending.</p>"}${billingNote ? `<p>${escapeHtml(billingNote)}</p>` : ""}${message ? `<p>${escapeHtml(message)}</p>` : ""}<p>Contact us to confirm or make changes: (906) 285-9312.</p></div>` }) })) : { status: "not_requested" as const };
  const sms = ["sms", "both"].includes(deliveryMethod)
    ? await deliverChannel(deliveryEvent.id, "sms", lead.phone, async () => { const result = await smsService.sendSMS(lead.phone, summary); if (!result.success && /timeout|timed out|ECONN|socket|network/i.test(result.error || "")) throw new Error("Provider outcome unknown"); return { ok: result.success, reference: result.messageSid, error: result.error }; }) : { status: "not_requested" as const };
  const delivery = { email, sms, invoice, quoteAccessUrl };
  if (email.status === "sent" || sms.status === "sent") {
    await pool.query("UPDATE quote_revisions SET status='sent',sent_at=COALESCE(sent_at,NOW()),sent_by_user_id=$2 WHERE id=$1 AND status IN ('approved','sent')", [quoteId, actor.userId]);
    await pool.query("UPDATE leads SET quote_sent_at=COALESCE(quote_sent_at,NOW()),status=CASE WHEN status IN ('new','quote_requested','chatbot_pending') THEN 'quoted' ELSE status END WHERE id=$1", [leadId]);
  }
  await pool.query("UPDATE leads SET job_plan_details=COALESCE(job_plan_details,'{}'::jsonb) || $2::jsonb WHERE id=$1", [leadId, JSON.stringify({ quoteDelivery: { ...delivery, quoteId, operationKey } })]);
  return { saved: true, approved: true, quoteRevisionId: quoteId, delivery, workflow: await getJobWorkflow(leadId, actor) };
}

export async function confirmCustomer(leadId: string, actor: WorkflowActor, input: { version: string; method: string; attested: boolean; note?: string }) {
  if (!actor.manage) throw new WorkflowError(403, "Job management permission is required.");
  if (!input.attested) throw new WorkflowError(400, "Confirm that the customer agreed to these details.");
  await ensureQuoteRevisionInfrastructure();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await loadState(leadId, client, true);
    if (state.version !== input.version) throw new WorkflowError(409, "The job changed. Review it before recording agreement.");
    const blocked = dispatchBlockers(state.lead, state.quote, true, false).filter(b => !["payment_required", "crew_roster"].includes(b.code));
    if (blocked.length) throw new WorkflowError(409, "Complete the job and schedule before confirming.", blocked);
    const confirmation = { snapshotHash: state.confirmationHash, quoteRevisionId: state.quote.id, method: input.method, recordedAt: new Date().toISOString(), recordedByUserId: actor.userId, note: input.note || "" };
    await client.query("UPDATE leads SET job_plan_details=COALESCE(job_plan_details,'{}'::jsonb) || $2::jsonb WHERE id=$1", [leadId, JSON.stringify({ customerConfirmation: confirmation })]);
    await audit(client, state.lead, actor.userId, `Customer agreement recorded by ${input.method} for quote revision ${state.quote.revision}.`);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return getJobWorkflow(leadId, actor);
}

export async function checkWorkflowDispatch(leadId: string, fullRoster = true) {
  await ensureQuoteRevisionInfrastructure();
  const state = await loadState(leadId);
  return dispatchBlockers(state.lead, state.quote, state.lead.jobPlanDetails?.customerConfirmation?.snapshotHash === state.confirmationHash, fullRoster);
}

export async function recordWorkflowPayment(leadId: string, actor: WorkflowActor, input: { version: string; method: string; attested: boolean }) {
  if (!actor.manage) throw new WorkflowError(403, "Job management permission is required.");
  if (!input.attested || !["cash", "check"].includes(input.method)) throw new WorkflowError(400, "Verify the received cash or check payment.");
  await ensureQuoteRevisionInfrastructure();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await loadState(leadId, client, true);
    if (state.lead.paymentPaidAt) {
      await client.query("COMMIT");
      return { saved: true, alreadyRecorded: true, total: state.quote.total, status: state.lead.status };
    }
    if (state.version !== input.version) throw new WorkflowError(409, "The job changed. Review payment again.");
    if (!state.quote.matches || !["approved", "sent"].includes(state.quote.status)) throw new WorkflowError(409, "Approve the current quote before recording its payment.", [{ code: "quote_approval", message: "Review the current quote.", target: "quote" }]);
    await client.query("UPDATE leads SET payment_paid_at=NOW(),deposit_paid=true,job_plan_details=COALESCE(job_plan_details,'{}'::jsonb) || $2::jsonb WHERE id=$1", [leadId, JSON.stringify({ paymentReceipt: { method: input.method, amount: state.quote.invoiceTotal ?? state.quote.total, actorId: actor.userId, recordedAt: new Date().toISOString() } })]);
    await audit(client, state.lead, actor.userId, `Full ${input.method} payment of ${(state.quote.invoiceTotal ?? state.quote.total).toFixed(2)} recorded. Crew was not dispatched.`);
    await client.query("COMMIT");
    return { saved: true, alreadyRecorded: false, total: state.quote.total, status: state.lead.status };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function executeCrewAction(leadId: string, actor: WorkflowActor, input: { version: string; action: "notify" | "dispatch"; idempotencyKey: string }) {
  if (!actor.manage) throw new WorkflowError(403, "Job management permission is required.");
  await ensureQuoteRevisionInfrastructure();
  await ensureRegionalAutomationSchema();
  const client = await pool.connect();
  let lead: any;
  let eventId = "";
  let deliveryEvent: any;
  let alreadyPerformed = false;
  try {
    await client.query("BEGIN");
    const state = await loadState(leadId, client, true);
    lead = state.lead;
    // One event per reviewed plan prevents a refreshed page or a new request
    // key from repeating dispatch. Definite delivery failures can still retry.
    eventId = `job-${input.action}:${workflowHash([leadId, state.quote.id, lead.confirmedDate, lead.arrivalWindow, [...(lead.crewMembers || [])].sort()])}`;
    const prior = await client.query("SELECT id,payload FROM customer_job_events WHERE event_key=$1", [eventId]);
    alreadyPerformed = Boolean(prior.rows[0]);
    if (!alreadyPerformed && state.version !== input.version) throw new WorkflowError(409, "The job changed. Review the current crew plan.");
    const blockers = input.action === "dispatch" ? dispatchBlockers(lead, state.quote, lead.jobPlanDetails?.customerConfirmation?.snapshotHash === state.confirmationHash) : (!lead.crewMembers?.length ? [{ code: "crew_roster", message: "Select crew before notifying them.", target: "crew" as const }] : []);
    if (!alreadyPerformed && blockers.length) throw new WorkflowError(409, "Complete dispatch setup first.", blockers);
    if (!alreadyPerformed) {
      if (input.action === "dispatch") await client.query("UPDATE leads SET status='dispatched',dispatch_sent_at=NOW() WHERE id=$1", [leadId]);
      await audit(client, lead, actor.userId, input.action === "dispatch" ? "Crew dispatched. Payment state was preserved." : "Staff requested a crew plan notification.");
      deliveryEvent = (await client.query("INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload) VALUES($1,'crew_workflow',$2,$3,'Staff reviewed the crew plan.','{}'::jsonb) RETURNING id,payload", [leadId, eventId, input.action === "dispatch" ? "Crew dispatched" : "Crew plan notification"])).rows[0];
    } else deliveryEvent = prior.rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const notifications: Array<{ recipient: string; outcome: DeliveryOutcome }> = [];
  try {
    await deliverChannel(deliveryEvent.id, "job_event", eventId, async () => {
      const { emitJobEvent } = await import("./jobEventBus");
      await emitJobEvent(input.action === "dispatch" ? "crew_assigned" : "crew_plan_saved", { ...lead, status: input.action === "dispatch" ? "dispatched" : lead.status } as any, { eventId, actorId: actor.userId, source: "guided_job_workflow" });
      return { ok: true };
    });
    const workers = (await pool.query("SELECT id,email,first_name,last_name FROM users WHERE id=ANY($1::varchar[])", [lead.crewMembers || []])).rows;
    const recipients = [...workers.map((worker: any) => ({ label: [worker.first_name, worker.last_name].filter(Boolean).join(" ") || "Crew member", email: worker.email })), { label: "Company alerts", email: "upmichiganstatemovers@gmail.com" }];
    for (const recipient of recipients) {
      const outcome: DeliveryOutcome = usableEmail(recipient.email) ? await deliverChannel(deliveryEvent.id, "email", recipient.email, async () => ({ ok: await sendEmail({ to: recipient.email, from: "upmichiganstatemovers@gmail.com", subject: `JC-${lead.orderNumber}: ${input.action === "dispatch" ? "crew dispatched" : "crew plan"}`, text: `JC-${lead.orderNumber}\n${lead.confirmedDate || "Date pending"} · ${lead.arrivalWindow || "Time pending"} Central\nOpen your assigned job in JC ON THE MOVE for the operational details.\n${process.env.PUBLIC_APP_URL || "https://www.jconthemove.com"}/lead/${encodeURIComponent(leadId)}\nPayment has not been changed by this crew action.` }) })) : { status: "unavailable", message: "No usable email address" };
      notifications.push({ recipient: recipient.label, outcome });
    }
  } catch {
    notifications.push({ recipient: "Notification reporting", outcome: { status: "unknown", message: "Verify notification history before retrying." } });
  }
  return { saved: true, alreadyPerformed, notifications, notificationPending: notifications.some(n => n.outcome.status !== "sent"), eventId, workflow: await getJobWorkflow(leadId, actor).catch(() => undefined) };
}
