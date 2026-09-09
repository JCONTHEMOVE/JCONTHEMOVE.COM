import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pool } from "../db";
import {
  applyGeographicQuotePolicy,
  assertQuoteApprovalAllowed,
  calculateRateCardLine,
  type CanonicalPricingSnapshot,
  type GeographicQuotePolicyResult,
} from "@shared/canonicalPricing";
import { getActivePricingSnapshot } from "./pricingVersions";
import { resolveQuoteRouteEvidence, type QuoteRouteEvidence } from "./quoteGeography";

export type QuoteLineItem = {
  id?: string;
  name: string;
  serviceCode?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  discountEligible?: boolean;
  metadata?: Record<string, unknown>;
};

export type QuoteRevisionRecord = {
  id: string;
  leadId: string;
  bookingId: string | null;
  revision: number;
  status: "draft" | "approved" | "sent" | "superseded" | "void";
  pricingVersionId: string | null;
  pricingVersionCode: string | null;
  currency: string;
  lineItems: QuoteLineItem[];
  pricingAdjustments: GeographicQuotePolicyResult["pricingAdjustments"] | Record<string, never>;
  travelEligibility: GeographicQuotePolicyResult["travelEligibility"] | Record<string, unknown>;
  routeEvidence: QuoteRouteEvidence | Record<string, unknown>;
  subtotal: number;
  discountTotal: number;
  finalPreTaxTotal: number;
  customerTotal: number;
  notes: string | null;
  ownerOverrideReason: string | null;
  ownerOverrideByUserId: string | null;
  ownerOverrideAt: string | Date | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | Date | null;
  sentByUserId: string | null;
  sentAt: string | Date | null;
  supersededByQuoteId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type QuoteActor = {
  userId: string;
  email?: string | null;
  isOwner: boolean;
  canApproveStandard: boolean;
};

type LeadForQuote = {
  id: string;
  booking_id: string | null;
  service_type: string;
  from_address: string;
  to_address: string | null;
  confirmed_from_address: string | null;
  confirmed_to_address: string | null;
  confirmed_date: string | null;
  move_date: string | null;
  crew_size: number | null;
  confirmed_hours: number | null;
  base_price: string | null;
  total_price: string | null;
  total_special_items_fee: string | null;
  order_line_items: unknown;
  quote_snapshot: unknown;
  quote_notes: string | null;
};

let infrastructurePromise: Promise<void> | null = null;

function money(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function rowToQuote(row: any): QuoteRevisionRecord {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    bookingId: row.booking_id ? String(row.booking_id) : null,
    revision: Number(row.revision),
    status: row.status,
    pricingVersionId: row.pricing_version_id ? String(row.pricing_version_id) : null,
    pricingVersionCode: row.pricing_version_code || null,
    currency: row.currency || "USD",
    lineItems: Array.isArray(row.line_items) ? row.line_items : [],
    pricingAdjustments: row.pricing_adjustments || {},
    travelEligibility: row.travel_eligibility || {},
    routeEvidence: row.route_evidence || {},
    subtotal: money(row.subtotal),
    discountTotal: money(row.discount_total),
    finalPreTaxTotal: money(row.final_pre_tax_total),
    customerTotal: money(row.customer_total),
    notes: row.notes || null,
    ownerOverrideReason: row.owner_override_reason || null,
    ownerOverrideByUserId: row.owner_override_by_user_id || null,
    ownerOverrideAt: row.owner_override_at || null,
    createdByUserId: row.created_by_user_id || null,
    approvedByUserId: row.approved_by_user_id || null,
    approvedAt: row.approved_at || null,
    sentByUserId: row.sent_by_user_id || null,
    sentAt: row.sent_at || null,
    supersededByQuoteId: row.superseded_by_quote_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureQuoteRevisionInfrastructure(): Promise<void> {
  if (infrastructurePromise) return infrastructurePromise;
  infrastructurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quote_revisions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id varchar NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        booking_id varchar,
        revision integer NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        pricing_version_id varchar,
        pricing_version_code text,
        currency text NOT NULL DEFAULT 'USD',
        line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
        pricing_adjustments jsonb NOT NULL DEFAULT '{}'::jsonb,
        travel_eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
        route_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        subtotal numeric(12,2) NOT NULL DEFAULT 0,
        discount_total numeric(12,2) NOT NULL DEFAULT 0,
        final_pre_tax_total numeric(12,2) NOT NULL DEFAULT 0,
        customer_total numeric(12,2) NOT NULL DEFAULT 0,
        notes text,
        owner_override_reason text,
        owner_override_by_user_id varchar REFERENCES users(id),
        owner_override_at timestamp,
        created_by_user_id varchar REFERENCES users(id),
        approved_by_user_id varchar REFERENCES users(id),
        approved_at timestamp,
        sent_by_user_id varchar REFERENCES users(id),
        sent_at timestamp,
        superseded_by_quote_id varchar,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        UNIQUE(lead_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_quote_revisions_lead_status ON quote_revisions(lead_id, status);
      CREATE INDEX IF NOT EXISTS idx_quote_revisions_booking ON quote_revisions(booking_id);
      ALTER TABLE quote_approvals ADD COLUMN IF NOT EXISTS quote_revision_id varchar REFERENCES quote_revisions(id);

      INSERT INTO quote_revisions (
        lead_id, booking_id, revision, status, pricing_version_code, line_items,
        pricing_adjustments, travel_eligibility, route_evidence,
        subtotal, discount_total, final_pre_tax_total, customer_total, notes,
        approved_by_user_id, approved_at, sent_at, created_at, updated_at
      )
      SELECT
        l.id,
        l.booking_id,
        1,
        CASE
          WHEN l.quote_sent_at IS NOT NULL THEN 'sent'
          WHEN qa.approved_at IS NOT NULL THEN 'approved'
          ELSE 'draft'
        END,
        COALESCE(l.quote_snapshot->>'pricingVersion', 'legacy'),
        CASE
          WHEN jsonb_typeof(l.order_line_items) = 'array' AND jsonb_array_length(l.order_line_items) > 0
            THEN l.order_line_items
          ELSE jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid()::text,
            'name', COALESCE(l.service_type, 'Service'),
            'quantity', 1,
            'unitPrice', COALESCE(l.total_price, l.base_price, 0),
            'total', COALESCE(l.total_price, l.base_price, 0)
          ))
        END,
        COALESCE(l.quote_snapshot->'pricingAdjustments', '{}'::jsonb),
        COALESCE(l.quote_snapshot->'travelEligibility', '{}'::jsonb),
        COALESCE(l.zone_snapshot, '{}'::jsonb),
        COALESCE(l.base_price, l.total_price, 0),
        COALESCE(l.bundle_discount_amount, 0),
        COALESCE(l.total_price, l.base_price, 0),
        COALESCE(l.total_price, l.base_price, 0),
        l.quote_notes,
        qa.approved_by_user_id,
        qa.approved_at,
        l.quote_sent_at,
        COALESCE(l.last_quote_updated_at, l.created_at, now()),
        COALESCE(l.last_quote_updated_at, l.created_at, now())
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT approved_by_user_id, created_at AS approved_at
        FROM quote_approvals
        WHERE lead_id = l.id AND status = 'approved'
        ORDER BY created_at DESC
        LIMIT 1
      ) qa ON true
      WHERE COALESCE(l.total_price, l.base_price) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM quote_revisions qr WHERE qr.lead_id = l.id);
    `);
  })().catch((error) => {
    infrastructurePromise = null;
    throw error;
  });
  return infrastructurePromise;
}

const quoteLeadSelect = `
    SELECT id, booking_id, service_type, from_address, to_address,
           confirmed_from_address, confirmed_to_address, confirmed_date, move_date,
           crew_size, confirmed_hours, base_price, total_price,
           total_special_items_fee, order_line_items, quote_snapshot, quote_notes
    FROM leads WHERE id = $1 LIMIT 1
`;

async function getLead(leadId: string): Promise<LeadForQuote | null> {
  const result = await pool.query<LeadForQuote>(quoteLeadSelect, [leadId]);
  return result.rows[0] || null;
}

function plainRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function inferredRateCardService(lead: LeadForQuote): "load_unload" | "pack_unpack" | "cleaning" | null {
  const service = String(lead.service_type || "").toLowerCase();
  const snapshot = plainRecord(lead.quote_snapshot);
  const requested = Array.isArray(snapshot.requestedItems) ? snapshot.requestedItems : [];
  const first = plainRecord(requested[0]);
  const details = plainRecord(first.details);
  const path = String(details.movingPath || details.loadType || "").toLowerCase();
  if (service.includes("clean")) return "cleaning";
  if (service.includes("pack") || path.includes("pack")) return "pack_unpack";
  if (/move|moving|residential|commercial|labor|load|unload|u-?box/.test(service)) return "load_unload";
  return null;
}

function normalizeLineItems(input: unknown): QuoteLineItem[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw, index) => {
    const item = plainRecord(raw);
    const quantity = Math.max(0.01, Number(item.quantity ?? item.qty ?? 1) || 1);
    const explicitTotal = Number(item.total ?? item.amount);
    const unitPrice = money(item.unitPrice ?? (Number.isFinite(explicitTotal) ? explicitTotal / quantity : 0));
    return {
      id: String(item.id || randomUUID()),
      name: String(item.name || item.label || `Service ${index + 1}`).slice(0, 160),
      serviceCode: item.serviceCode ? String(item.serviceCode) : null,
      quantity,
      unitPrice,
      total: money(Number.isFinite(explicitTotal) ? explicitTotal : quantity * unitPrice),
      discountEligible: item.discountEligible !== false,
      metadata: plainRecord(item.metadata),
    };
  }).filter((item) => item.total >= 0);
}

function generatedLineItems(lead: LeadForQuote, snapshot: CanonicalPricingSnapshot): QuoteLineItem[] {
  const code = inferredRateCardService(lead);
  const crewSize = Math.max(1, Math.round(Number(lead.crew_size) || 2));
  const hours = Math.max(1, Number(lead.confirmed_hours) || 2);
  const rate = code ? calculateRateCardLine({ serviceCode: code, crewSize, hours, snapshot }) : null;
  const items: QuoteLineItem[] = [];
  if (rate) {
    items.push({
      id: randomUUID(),
      name: `${code === "load_unload" ? "Load/Unload" : code === "pack_unpack" ? "Pack/Unpack" : "Cleaning"} — ${crewSize} helper${crewSize === 1 ? "" : "s"}`,
      serviceCode: code,
      quantity: 1,
      unitPrice: rate.subtotal,
      total: rate.subtotal,
      discountEligible: true,
      metadata: rate,
    });
  }
  const specialItems = money(lead.total_special_items_fee);
  if (specialItems > 0) {
    items.push({ id: randomUUID(), name: "Specialty-item charges", serviceCode: "special_items", quantity: 1, unitPrice: specialItems, total: specialItems, discountEligible: true });
  }
  if (items.length > 0) return items;
  const legacy = normalizeLineItems(lead.order_line_items);
  if (legacy.length > 0) return legacy;
  const total = money(lead.total_price || lead.base_price);
  return [{ id: randomUUID(), name: lead.service_type || "Service", serviceCode: null, quantity: 1, unitPrice: total, total, discountEligible: true }];
}

function serviceStopsFromLead(lead: LeadForQuote): string[] {
  const snapshot = plainRecord(lead.quote_snapshot);
  const storedStops = Array.isArray(snapshot.serviceStops)
    ? snapshot.serviceStops.filter((value: unknown): value is string => typeof value === "string")
    : [];
  const route = plainRecord(snapshot.routeEvidence);
  const routedStops = Array.isArray(route.addresses)
    ? route.addresses.filter((value: unknown): value is string => typeof value === "string")
    : [];
  return [...new Set([
    lead.confirmed_from_address || lead.from_address,
    lead.confirmed_to_address || lead.to_address || "",
    ...storedStops,
    ...routedStops,
  ].map((value) => value.trim()).filter((value) => value.length >= 4))];
}

async function calculateDraft(input: {
  lead: LeadForQuote;
  lineItems?: unknown;
  discountTotal?: unknown;
  serviceDate?: string | null;
}) {
  const active = await getActivePricingSnapshot();
  const provided = normalizeLineItems(input.lineItems);
  const lineItems = provided.length > 0 ? provided : generatedLineItems(input.lead, active.snapshot);
  const subtotal = money(lineItems.reduce((sum, item) => sum + item.total, 0));
  const requestedDiscountTotal = money(input.discountTotal);
  const routeEvidence = await resolveQuoteRouteEvidence({
    snapshot: active.snapshot,
    addresses: serviceStopsFromLead(input.lead),
  });
  const preliminaryPolicy = applyGeographicQuotePolicy({
    baseSubtotal: subtotal,
    automaticDiscountTotal: 0,
    serviceDate: input.serviceDate || input.lead.confirmed_date || input.lead.move_date,
    stopCoordinates: routeEvidence.stopCoordinates,
    routeVerified: routeEvidence.verified,
    oneWayMinutes: routeEvidence.oneWayMinutes,
    oneWayMiles: routeEvidence.oneWayMiles,
    snapshot: active.snapshot,
  });
  const discountBase = preliminaryPolicy?.adjustedSubtotal ?? subtotal;
  const discountTotal = money(Math.min(
    requestedDiscountTotal,
    discountBase * (active.snapshot.offers.totalPercentageCap / 100),
  ));
  const policy = applyGeographicQuotePolicy({
    baseSubtotal: subtotal,
    automaticDiscountTotal: discountTotal,
    serviceDate: input.serviceDate || input.lead.confirmed_date || input.lead.move_date,
    stopCoordinates: routeEvidence.stopCoordinates,
    routeVerified: routeEvidence.verified,
    oneWayMinutes: routeEvidence.oneWayMinutes,
    oneWayMiles: routeEvidence.oneWayMiles,
    snapshot: active.snapshot,
  });
  const finalPreTaxTotal = policy?.finalPreTaxTotal ?? money(Math.max(0, subtotal - discountTotal));
  return {
    active,
    lineItems,
    subtotal,
    discountTotal,
    finalPreTaxTotal,
    pricingAdjustments: policy?.pricingAdjustments || {},
    travelEligibility: policy?.travelEligibility || {
      status: "legacy_policy",
      routeVerified: false,
      requiresOwner: false,
      canApprove: true,
      reasons: ["The active legacy pricing version predates geographic routing; standard staff review remains available until the owner publishes the new policy."],
    },
    routeEvidence,
  };
}

export async function listQuoteRevisions(leadId: string): Promise<QuoteRevisionRecord[]> {
  await ensureQuoteRevisionInfrastructure();
  const result = await pool.query(`SELECT * FROM quote_revisions WHERE lead_id = $1 ORDER BY revision DESC`, [leadId]);
  return result.rows.map(rowToQuote);
}

export async function getQuoteRevision(quoteId: string): Promise<QuoteRevisionRecord | null> {
  await ensureQuoteRevisionInfrastructure();
  const result = await pool.query(`SELECT * FROM quote_revisions WHERE id = $1 LIMIT 1`, [quoteId]);
  return result.rows[0] ? rowToQuote(result.rows[0]) : null;
}

export async function getLatestQuoteRevision(leadId: string): Promise<QuoteRevisionRecord | null> {
  await ensureQuoteRevisionInfrastructure();
  const result = await pool.query(`SELECT * FROM quote_revisions WHERE lead_id = $1 ORDER BY revision DESC LIMIT 1`, [leadId]);
  return result.rows[0] ? rowToQuote(result.rows[0]) : null;
}

export async function saveQuoteDraft(input: {
  leadId: string;
  actorUserId: string | null;
  lineItems?: unknown;
  discountTotal?: unknown;
  notes?: string | null;
  serviceDate?: string | null;
}): Promise<QuoteRevisionRecord> {
  await ensureQuoteRevisionInfrastructure();
  const lead = await getLead(input.leadId);
  if (!lead) throw new Error("Lead not found");
  const calculated = await calculateDraft({
    lead,
    lineItems: input.lineItems,
    discountTotal: input.discountTotal,
    serviceDate: input.serviceDate,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Payment/refund/reward writers lock the job before its quote. Use the
    // same order, including when this is the first draft for a job.
    const lockedLead = await client.query<LeadForQuote>(`${quoteLeadSelect} FOR UPDATE`, [lead.id]);
    if (!lockedLead.rows.length) throw new Error("Lead not found");
    // Route lookup stays outside the transaction. Check every job field used
    // by calculation/persistence again under the lock before saving its result.
    if (!isDeepStrictEqual(lead, lockedLead.rows[0])) {
      throw new Error("Job details changed while calculating the quote. Reload the job and retry.");
    }
    const latestResult = await client.query(`SELECT * FROM quote_revisions WHERE lead_id = $1 ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [lead.id]);
    const latest = latestResult.rows[0];
    if (latest?.status === "draft") {
      const updated = await client.query(`
        UPDATE quote_revisions SET
          pricing_version_id=$2, pricing_version_code=$3, currency=$4,
          line_items=$5::jsonb, pricing_adjustments=$6::jsonb,
          travel_eligibility=$7::jsonb, route_evidence=$8::jsonb,
          subtotal=$9, discount_total=$10, final_pre_tax_total=$11, customer_total=$11,
          notes=$12, updated_at=NOW()
        WHERE id=$1 RETURNING *
      `, [
        latest.id,
        calculated.active.versionId,
        calculated.active.snapshot.version,
        calculated.active.snapshot.currency,
        JSON.stringify(calculated.lineItems),
        JSON.stringify(calculated.pricingAdjustments),
        JSON.stringify(calculated.travelEligibility),
        JSON.stringify(calculated.routeEvidence),
        calculated.subtotal,
        calculated.discountTotal,
        calculated.finalPreTaxTotal,
        input.notes ?? lead.quote_notes,
      ]);
      await client.query("COMMIT");
      return rowToQuote(updated.rows[0]);
    }

    const nextRevision = Number(latest?.revision || 0) + 1;
    const quoteId = randomUUID();
    const inserted = await client.query(`
      INSERT INTO quote_revisions (
        id, lead_id, booking_id, revision, status, pricing_version_id, pricing_version_code,
        currency, line_items, pricing_adjustments, travel_eligibility, route_evidence,
        subtotal, discount_total, final_pre_tax_total, customer_total, notes, created_by_user_id
      ) VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$14,$15,$16)
      RETURNING *
    `, [
      quoteId,
      lead.id,
      lead.booking_id,
      nextRevision,
      calculated.active.versionId,
      calculated.active.snapshot.version,
      calculated.active.snapshot.currency,
      JSON.stringify(calculated.lineItems),
      JSON.stringify(calculated.pricingAdjustments),
      JSON.stringify(calculated.travelEligibility),
      JSON.stringify(calculated.routeEvidence),
      calculated.subtotal,
      calculated.discountTotal,
      calculated.finalPreTaxTotal,
      input.notes ?? lead.quote_notes,
      input.actorUserId,
    ]);
    // A draft does not replace an approved financial basis. Supersession
    // happens atomically with approval of the replacement revision below.
    await client.query("COMMIT");
    return rowToQuote(inserted.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* transaction already closed */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function approveQuoteRevision(input: {
  quoteId: string;
  actor: QuoteActor;
  overrideReason?: string | null;
}): Promise<QuoteRevisionRecord> {
  await ensureQuoteRevisionInfrastructure();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedLead = await client.query(
      "SELECT id FROM leads WHERE id=(SELECT lead_id FROM quote_revisions WHERE id=$1) FOR UPDATE", [input.quoteId],
    );
    if (!lockedLead.rows.length) throw new Error("Quote revision lead not found");
    const result = await client.query(`SELECT * FROM quote_revisions WHERE id=$1 FOR UPDATE`, [input.quoteId]);
    const row = result.rows[0];
    if (!row) throw new Error("Quote revision not found");
    if (row.lead_id !== lockedLead.rows[0].id) throw new Error("Quote revision changed jobs; retry approval");
    if (row.status !== "draft") throw new Error("Only a draft quote can be approved");
    const newer = await client.query(
      "SELECT id FROM quote_revisions WHERE lead_id=$1 AND revision>$2 AND status IN ('draft','approved','sent') LIMIT 1",
      [row.lead_id, row.revision],
    );
    if (newer.rows.length) throw new Error("A newer quote revision must be reviewed instead");
    const eligibility = plainRecord(row.travel_eligibility);
    const { requiresOwner, overrideReason } = assertQuoteApprovalAllowed({
      travelEligibility: eligibility,
      actor: input.actor,
      overrideReason: input.overrideReason,
    });

    await client.query(`
      UPDATE quote_revisions SET status='superseded',superseded_by_quote_id=$2,updated_at=NOW()
      WHERE lead_id=$1 AND id<>$2 AND status IN ('approved','sent')
    `, [row.lead_id, row.id]);
    const updated = await client.query(`
      UPDATE quote_revisions SET
        status='approved', approved_by_user_id=$2::varchar, approved_at=NOW(),
        owner_override_reason=$3,
        owner_override_by_user_id=CASE WHEN $4 THEN $2::varchar ELSE NULL END,
        owner_override_at=CASE WHEN $4 THEN NOW() ELSE NULL END,
        updated_at=NOW()
      WHERE id=$1 RETURNING *
    `, [row.id, input.actor.userId, requiresOwner ? overrideReason : null, requiresOwner]);
    await client.query(`
      INSERT INTO quote_approvals
        (lead_id, booking_id, quote_revision_id, submitted_by_user_id, approved_by_user_id, approval_role, status, notes)
      VALUES ($1,$2,$3,$4,$4,$5,'approved',$6)
    `, [row.lead_id, row.booking_id, row.id, input.actor.userId, input.actor.isOwner ? "owner_approval" : "gold_vote", requiresOwner ? overrideReason : null]);
    await client.query(`
      UPDATE leads SET
        base_price=$2, total_price=$3, order_line_items=$4::jsonb,
        quote_notes=COALESCE($5, quote_notes), last_quote_updated_at=NOW()
      WHERE id=$1
    `, [row.lead_id, row.subtotal, row.final_pre_tax_total, JSON.stringify(row.line_items || []), row.notes]);
    await client.query("COMMIT");
    return rowToQuote(updated.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* transaction already closed */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestApprovedQuote(leadId: string): Promise<QuoteRevisionRecord | null> {
  await ensureQuoteRevisionInfrastructure();
  const result = await pool.query(`
    SELECT * FROM quote_revisions
    WHERE lead_id=$1 AND status IN ('approved', 'sent')
    ORDER BY revision DESC LIMIT 1
  `, [leadId]);
  return result.rows[0] ? rowToQuote(result.rows[0]) : null;
}

export async function getLatestSentQuote(leadId: string): Promise<QuoteRevisionRecord | null> {
  await ensureQuoteRevisionInfrastructure();
  const result = await pool.query(`
    SELECT * FROM quote_revisions
    WHERE lead_id=$1
      AND sent_at IS NOT NULL
      AND status IN ('sent','superseded')
    ORDER BY revision DESC LIMIT 1
  `, [leadId]);
  return result.rows[0] ? rowToQuote(result.rows[0]) : null;
}

export async function markQuoteRevisionSent(input: {
  quoteId: string;
  actorUserId: string | null;
  sentAt: Date;
}): Promise<QuoteRevisionRecord> {
  await ensureQuoteRevisionInfrastructure();
  const result = await pool.query(`
    UPDATE quote_revisions SET status='sent', sent_by_user_id=$2, sent_at=$3, updated_at=NOW()
    WHERE id=$1 AND status IN ('approved', 'sent')
    RETURNING *
  `, [input.quoteId, input.actorUserId, input.sentAt]);
  if (!result.rows[0]) throw new Error("Only an approved or previously sent quote can be sent");
  return rowToQuote(result.rows[0]);
}
