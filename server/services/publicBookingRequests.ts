import crypto from "node:crypto";
import type { PublicBookingStatus } from "../../shared/homepageBooking";

export type BookingSql = { query: (text: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
// Identity only: the existing lead, quote, booking and hold remain authoritative.
export const PUBLIC_BOOKING_REQUEST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS public_booking_requests (
    key_hash TEXT PRIMARY KEY,
    lead_id VARCHAR NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`;
export const publicRequestHash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");
export async function lockPublicBookingRequest(client: BookingSql, key: string) {
  const hash = publicRequestHash(key);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`public-booking:${hash}`]);
  const result = await client.query("SELECT lead_id FROM public_booking_requests WHERE key_hash=$1", [hash]);
  return result.rows[0]?.lead_id as string | undefined;
}
export async function bindPublicBookingRequest(client: BookingSql, key: string, leadId: string) {
  await client.query("INSERT INTO public_booking_requests(key_hash,lead_id) VALUES($1,$2)", [publicRequestHash(key), leadId]);
}

/** Capability lookup. No contact data, staff costs, payouts, route evidence or
 * raw snapshots are returned. A lead/booking ID alone never authorizes access. */
export async function publicBookingStatus(client: BookingSql, key: string): Promise<PublicBookingStatus | null> {
  const { rows } = await client.query(`
    SELECT l.id, l.booking_id, l.deposit_paid, l.financial_status, l.square_payment_url,
           l.deposit_amount_gate, h.id AS hold_id, h.status AS hold_status,
           h.start_at, h.expires_at,
           q.revision, q.customer_total,
           (h.expires_at IS NOT NULL AND h.expires_at <= clock_timestamp()) AS expired
      FROM public_booking_requests r JOIN leads l ON l.id=r.lead_id
      LEFT JOIN LATERAL (SELECT * FROM booking_slot_holds WHERE lead_id=l.id ORDER BY created_at DESC LIMIT 1) h ON true
      LEFT JOIN LATERAL (SELECT revision,customer_total FROM quote_revisions WHERE lead_id=l.id
        AND status IN ('draft','approved','sent') ORDER BY revision DESC LIMIT 1) q ON true
     WHERE r.key_hash=$1`, [publicRequestHash(key)]);
  const row = rows[0];
  if (!row) return null;
  const status = row.hold_id
    ? row.expired && ["pending_review", "awaiting_deposit"].includes(row.hold_status) ? "expired" : row.hold_status
    : "callback_requested";
  const paid = row.financial_status === "paid";
  const depositPaid = row.deposit_paid === true;
  const messages: Record<string, string> = {
    callback_requested: "Your callback request is in the owner's queue. No deposit or booking is required.",
    pending_review: "Your time is held pending team review. It is not confirmed. No deposit is requested yet.",
    awaiting_deposit: "Your time is held while the scheduling deposit is due. It is not confirmed until payment is verified.",
    confirmed: "Your time is confirmed. A scheduling deposit is separate from the remaining job balance.",
    expired: "Your hold expired. This time is no longer reserved. Contact the team to check another time.",
    released: "Your hold was released. This time is no longer reserved.",
    payment_review: "Payment was received after the hold became unavailable. The owner must reconcile the payment and schedule. Your time is not confirmed.",
  };
  return {
    success: true, kind: row.hold_id ? "hold" : "callback", leadId: row.id,
    bookingId: row.booking_id || null, holdId: row.hold_id || null, status,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
    paymentState: paid ? "paid" : depositPaid ? "deposit_paid" : "unpaid",
    paymentUrl: status === "awaiting_deposit" && !paid && !depositPaid ? row.square_payment_url || null : null,
    depositAmount: row.hold_id && row.deposit_amount_gate != null ? Number(row.deposit_amount_gate) : null,
    quoteRevision: row.revision ?? null, customerTotal: row.customer_total == null ? null : Number(row.customer_total),
    message: messages[status] || "The team is reviewing your request.",
  };
}

export function publicInstantQuote(quote: any) {
  return {
    minEstimate: quote.minEstimate, maxEstimate: quote.maxEstimate, estimateLabel: quote.estimateLabel,
    crewSize: quote.crewSize, requestedHours: quote.requestedHours,
    reviewRequired: quote.reviewRequired, autoBookEligible: quote.autoBookEligible,
    travelFallback: quote.travelFallback, conditionalHold: quote.conditionalHold,
    recommendation: quote.recommendation || null,
    // Digest binds the review to the server's price, selection and policy version.
    fingerprint: crypto.createHash("sha256").update(JSON.stringify([
      quote.pricingVersion, quote.minEstimate, quote.maxEstimate, quote.crewSize,
      quote.requestedHours, quote.reviewRequired, quote.autoBookEligible, quote.lineItems,
    ])).digest("hex"),
  };
}
