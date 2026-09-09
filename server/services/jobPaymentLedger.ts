import { pool } from "../db";
import { validateConfirmedJobPayment, reconcileJobPaymentTotals, type ConfirmedJobPayment } from "./jobPaymentLedgerPolicy";

// Additive and deliberately not registered in boot or provider routes yet.
// Provider adapters and refund/reward policy must pass acceptance before use.
export const JOB_PAYMENT_LEDGER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS job_confirmed_payments (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_payment_id TEXT NOT NULL,
    lead_id VARCHAR NOT NULL REFERENCES leads(id),
    quote_revision_id VARCHAR NOT NULL REFERENCES quote_revisions(id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
    currency TEXT NOT NULL CHECK (currency = 'USD'),
    tender_type TEXT NOT NULL,
    gift_funded_cents BIGINT NOT NULL CHECK (gift_funded_cents >= 0 AND gift_funded_cents <= amount_cents),
    paid_at TIMESTAMPTZ NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_payment_id)
  );
  ALTER TABLE job_confirmed_payments
    ADD COLUMN IF NOT EXISTS quote_revision_id VARCHAR NOT NULL REFERENCES quote_revisions(id),
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object');
  CREATE INDEX IF NOT EXISTS idx_job_confirmed_payments_lead
    ON job_confirmed_payments (lead_id, paid_at);
`;

/** Record only a server-verified provider payment. Never call with browser claims.
 * This foundation does not issue rewards, dispatch work, or accept refunds.
 * It remains unwired until adapters, migration/restore and refund gates pass.
 */
export async function confirmJobPayment(payment: ConfirmedJobPayment) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true") {
    throw new Error("Canonical payment ledger is disabled");
  }
  validateConfirmedJobPayment(payment);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize all rails for a job, not just duplicate events from one rail.
    const { rows: leads } = await client.query<{ total_price: string | null; status: string }>(
      "SELECT total_price, status FROM leads WHERE id=$1 FOR UPDATE", [payment.leadId],
    );
    if (!leads.length) throw new Error("Payment job does not exist");
    const { rows: sourceQuotes } = await client.query(
      `SELECT id FROM quote_revisions WHERE id=$1 AND lead_id=$2
       AND currency=$3 AND approved_at IS NOT NULL AND status IN ('approved','sent','superseded') FOR SHARE`,
      [payment.quoteRevisionId, payment.leadId, payment.currency],
    );
    if (!sourceQuotes.length) throw new Error("Payment requires an approved quote revision for this job");
    const { rows: activeQuotes } = await client.query<{ id: string; customer_total: string; currency: string }>(
      `SELECT id,customer_total,currency FROM quote_revisions WHERE lead_id=$1
       AND approved_at IS NOT NULL AND status IN ('approved','sent')
       ORDER BY revision DESC LIMIT 1 FOR SHARE`, [payment.leadId],
    );
    const activeQuote = activeQuotes[0];
    if (!activeQuote || activeQuote.currency !== payment.currency) throw new Error("Job needs a current approved USD quote");
    const totalCents = Math.round(Number(activeQuote.customer_total) * 100);
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error("Job needs a finalized positive total");
    if (Math.round(Number(leads[0].total_price) * 100) !== totalCents) {
      throw new Error("Job total and approved quote disagree; reconciliation required");
    }
    const inserted = await client.query(
      `INSERT INTO job_confirmed_payments
        (provider,provider_payment_id,lead_id,amount_cents,currency,tender_type,gift_funded_cents,paid_at,quote_revision_id,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (provider,provider_payment_id) DO NOTHING RETURNING id`,
      [payment.provider, payment.providerPaymentId, payment.leadId, payment.amountCents,
        payment.currency, payment.tenderType, payment.giftFundedCents, payment.paidAt,
        payment.quoteRevisionId, JSON.stringify(payment.metadata || {})],
    );
    const { rows: existing } = await client.query<{
      lead_id: string; quote_revision_id: string; amount_cents: string; currency: string; tender_type: string; gift_funded_cents: string;
    }>(`SELECT lead_id,quote_revision_id,amount_cents,currency,tender_type,gift_funded_cents
        FROM job_confirmed_payments WHERE provider=$1 AND provider_payment_id=$2`,
      [payment.provider, payment.providerPaymentId]);
    const event = existing[0];
    if (!event || event.lead_id !== payment.leadId || event.quote_revision_id !== payment.quoteRevisionId || Number(event.amount_cents) !== payment.amountCents
        || event.currency !== payment.currency || event.tender_type !== payment.tenderType
        || Number(event.gift_funded_cents) !== payment.giftFundedCents) {
      throw new Error("Provider payment ID conflicts with its recorded settlement");
    }
    const { rows: totals } = await client.query<{ paid: string; gift: string; settled_at: string }>(
      `SELECT COALESCE(SUM(amount_cents),0)::text AS paid,
              COALESCE(SUM(gift_funded_cents),0)::text AS gift, MAX(paid_at) AS settled_at
         FROM job_confirmed_payments WHERE lead_id=$1`, [payment.leadId],
    );
    const paidCents = Number(totals[0].paid);
    const giftFundedCents = Number(totals[0].gift);
    const reconciliation = reconcileJobPaymentTotals(totalCents, paidCents, giftFundedCents);
    // Existing legacy markers are not cleared by an incomplete new-ledger
    // backfill. Migration/reconciliation must resolve those before activation.
    if (reconciliation.paidInFull) {
      await client.query(
        "UPDATE leads SET payment_paid_at=COALESCE(payment_paid_at,$2::timestamptz) WHERE id=$1",
        [payment.leadId, totals[0].settled_at],
      );
    }
    await client.query("COMMIT");
    return { ...reconciliation, duplicate: inserted.rows.length === 0, paidCents, giftFundedCents,
      quoteRevisionId: activeQuote.id, completed: leads[0].status === "completed", rewardsTriggered: false as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
