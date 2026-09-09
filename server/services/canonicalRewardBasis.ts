import { pool } from "../db";
import type { PoolClient } from "@neondatabase/serverless";
import { JOB_PAYMENT_TOTALS_SQL } from "./jobPaymentLedger";
import { reconcileJobPaymentTotals } from "./jobPaymentLedgerPolicy";

/** Caller owns the transaction. Lock the same job row as payment/refund writers
 * and retain it until the recipient's wallet transaction commits. */
export async function lockCanonicalRewardBasis(client: PoolClient, leadId: string) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true"
      || process.env.JOB_PAYMENT_REWARDS_ENABLED !== "true") throw new Error("Canonical job rewards are disabled");
  const { rows: jobs } = await client.query<{ status: string; payment_paid_at: Date | null; total_price: string }>(
    "SELECT status,payment_paid_at,total_price FROM leads WHERE id=$1 FOR UPDATE", [leadId]);
  const job = jobs[0];
  if (!job || job.status !== "completed" || !job.payment_paid_at) throw new Error("Job must be completed and paid before rewards");
  const { rows: quotes } = await client.query<{ id: string; customer_total: string; currency: string }>(
    `SELECT id,customer_total,currency FROM quote_revisions WHERE lead_id=$1 AND approved_at IS NOT NULL
      AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1 FOR SHARE`, [leadId]);
  const quote = quotes[0];
  const totalCents = Math.round(Number(quote?.customer_total) * 100);
  if (!quote || quote.currency !== "USD" || !Number.isSafeInteger(totalCents) || totalCents <= 0
      || Math.round(Number(job.total_price) * 100) !== totalCents) throw new Error("Reward quote requires reconciliation");
  const { rows } = await client.query<{ paid: string; gift: string; refund_count: string }>(JOB_PAYMENT_TOTALS_SQL, [leadId]);
  const giftCents = Number(rows[0].gift);
  const totals = reconcileJobPaymentTotals(totalCents, Number(rows[0].paid), giftCents);
  if (!totals.paidInFull || Number(rows[0].refund_count) > 0) throw new Error("Payment or refund requires reward reconciliation");
  return { quoteRevisionId: quote.id, quoteTotalUsd: totalCents / 100,
    giftFundedUsd: Math.min(totalCents, giftCents) / 100, customerEligibleUsd: totals.customerEligibleCents / 100 };
}

/** Calculation snapshot only; settlement must recheck under its own lock. */
export async function readCanonicalRewardBasis(leadId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const basis = await lockCanonicalRewardBasis(client, leadId);
    await client.query("COMMIT");
    return basis;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
