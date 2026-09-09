import { pool } from "../db";
import { reconcileJobPaymentTotals } from "./jobPaymentLedgerPolicy";
import { JOB_PAYMENT_TOTALS_SQL } from "./jobPaymentLedger";

export async function getJobPaymentReconciliation(leadId: string) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true") return { enabled: false as const };
  if (!leadId?.trim() || leadId.length > 255) throw new Error("Invalid job ID");
  // One read-only transaction gives the summary and payment list one snapshot.
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: jobs } = await client.query<{
      id: string; status: string; total_price: string | null; payment_paid_at: string | null;
      tokens_disbursed_at: string | null; completion_rewarded_at: string | null;
      quote_id: string | null; customer_total: string | null; currency: string | null;
    }>(`SELECT l.id,l.status,l.total_price,l.payment_paid_at,l.tokens_disbursed_at,l.completion_rewarded_at,
        q.id AS quote_id,q.customer_total,q.currency
      FROM leads l LEFT JOIN LATERAL (
        SELECT id,customer_total,currency FROM quote_revisions WHERE lead_id=l.id
          AND approved_at IS NOT NULL AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1
      ) q ON true WHERE l.id=$1`, [leadId]);
    if (!jobs.length) { await client.query("COMMIT"); return null; }
    const job = jobs[0];
    const { rows: sums } = await client.query<{ paid: string; gift: string; count: string; refunded: string; refund_count: string }>(JOB_PAYMENT_TOTALS_SQL, [leadId]);
    const paidCents = Number(sums[0].paid);
    const giftFundedCents = Number(sums[0].gift);
    const totalCents = Math.round(Number(job.customer_total) * 100);
    const reasons: string[] = [];
    if (Number(sums[0].refund_count) > 0) reasons.push("refund_requires_review");
    if (!job.quote_id || job.currency !== "USD" || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
      reasons.push("missing_approved_usd_quote");
    }
    if (job.quote_id && Math.round(Number(job.total_price) * 100) !== totalCents) reasons.push("quote_total_mismatch");
    const totals = reasons.includes("missing_approved_usd_quote") ? null
      : reconcileJobPaymentTotals(totalCents, paidCents, giftFundedCents);
    if (job.payment_paid_at && !totals?.paidInFull) reasons.push("paid_marker_without_ledger_coverage");
    if (!job.payment_paid_at && totals?.paidInFull) reasons.push("ledger_covered_without_paid_marker");
    if (totals?.overpaidCents) reasons.push("overpayment");
    const rewardRecordedAt = job.tokens_disbursed_at || job.completion_rewarded_at;
    if (rewardRecordedAt && (!totals?.paidInFull || job.status !== "completed")) reasons.push("reward_marker_requires_review");
    const { rows: payments } = await client.query(
      `SELECT id::text,provider,provider_payment_id,quote_revision_id,amount_cents::text,
        currency,tender_type,gift_funded_cents::text,paid_at,recorded_at
       FROM job_confirmed_payments WHERE lead_id=$1 ORDER BY id DESC LIMIT 100`, [leadId]);
    const { rows: refunds } = await client.query(
      `SELECT r.id::text,r.provider,r.provider_refund_id,p.provider_payment_id,r.amount_cents::text,
        r.gift_funded_cents::text,r.refunded_at FROM job_confirmed_refunds r
       JOIN job_confirmed_payments p ON p.id=r.payment_id WHERE p.lead_id=$1 ORDER BY r.id DESC LIMIT 100`, [leadId]);
    const { rows: rewardQueue } = await client.query<{
      status: string; attempts: number; next_attempt_at: string; lease_expires_at: string | null;
      last_failure_code: string | null; completed_at: string | null;
    }>(`SELECT status,attempts,next_attempt_at,lease_expires_at,last_failure_code,completed_at
      FROM job_reward_queue WHERE lead_id=$1`, [leadId]);
    if (rewardQueue[0]?.status === 'retry') reasons.push('reward_retry_pending');
    await client.query("COMMIT");
    return { enabled: true as const, leadId, status: job.status, quoteRevisionId: job.quote_id,
      paidMarkerAt: job.payment_paid_at, rewardRecordedAt, paidCents, giftFundedCents,
      approvedTotalCents: totals ? totalCents : null, totals, reviewReasons: reasons,
      payments, paymentCount: Number(sums[0].count), paymentsTruncated: Number(sums[0].count) > payments.length,
      refunds, refundedCents: Number(sums[0].refunded), refundCount: Number(sums[0].refund_count),
      refundsTruncated: Number(sums[0].refund_count) > refunds.length,
      refundReconciliationAvailable: true as const, rewardQueue: rewardQueue[0] || null,
      automaticRewardsEnabled: process.env.JOB_PAYMENT_REWARDS_ENABLED === 'true'
        && process.env.JOB_PAYMENT_REWARD_WORKER_ENABLED === 'true' };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
