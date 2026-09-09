import { pool } from "../db";
import { lockCanonicalRewardBasis } from "./canonicalRewardBasis";
import { canonicalRewardQueueEnabled, claimJobReward, finishJobReward } from "./jobRewardQueue";

/** A completion stamp alone is insufficient after crashes or legacy failures.
 * Prove every assigned recipient has its durable settlement, then finish the
 * claim under the same job lock used by refund/payment writers. */
export async function completeSettledRewardClaim(claim: { lead_id: string; lease_token: string }) {
  if (!canonicalRewardQueueEnabled()) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const basis = await lockCanonicalRewardBasis(client, claim.lead_id);
    const { rows: jobs } = await client.query<{
      tokens_disbursed_at: Date | null; completion_rewarded_at: Date | null;
      crew_members: string[] | null; assigned_to_user_id: string | null;
    }>(`SELECT tokens_disbursed_at,completion_rewarded_at,crew_members,assigned_to_user_id FROM leads WHERE id=$1`, [claim.lead_id]);
    const job = jobs[0];
    if (!job?.tokens_disbursed_at || !job.completion_rewarded_at) throw new Error("Reward completion not recorded");
    const { rows } = await client.query<{
      recipient_type: string; recipient_user_id: string | null; reward_kind: string;
      token_amount: string; quote_total: string; metadata: Record<string, unknown> | null;
      reward_matches: boolean; wallet_exists: boolean;
    }>(`SELECT j.recipient_type,j.recipient_user_id,j.reward_kind,j.token_amount::text,j.quote_total::text,j.metadata,
      EXISTS(SELECT 1 FROM rewards r WHERE r.user_id=j.recipient_user_id AND r.reference_id=j.lead_id
        AND r.reward_type=j.reward_kind AND r.token_amount=j.token_amount) AS reward_matches,
      EXISTS(SELECT 1 FROM wallet_accounts w WHERE w.user_id=j.recipient_user_id) AS wallet_exists
      FROM job_jcmoves_ledger j WHERE j.lead_id=$1 FOR SHARE`, [claim.lead_id]);
    const customers = rows.filter(row => row.recipient_type === "customer");
    if (customers.length !== 1 || Math.round(Number(customers[0].quote_total) * 100) !== Math.round(basis.customerEligibleUsd * 100)) {
      throw new Error("Customer reward ledger requires reconciliation");
    }
    const expectedCrew = new Set([...(job.crew_members || []), job.assigned_to_user_id].filter(Boolean));
    for (const id of expectedCrew) {
      if (rows.filter(row => row.recipient_type === "crew" && row.recipient_user_id === id).length !== 1) {
        throw new Error("Crew reward ledger is incomplete");
      }
    }
    for (const row of rows) {
      if (!['customer', 'crew'].includes(row.recipient_type)
          || (row.recipient_type === 'crew' && row.reward_kind !== 'crew_paid_completed_pool')
          || (row.recipient_type === 'customer' && !['customer_paid_completed_pool', 'customer_paid_completed_pool_pending_claim'].includes(row.reward_kind))) {
        throw new Error("Unexpected reward ledger entry requires reconciliation");
      }
      const amount = Number(row.token_amount);
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid persisted reward");
      if (row.recipient_type === "crew" && (!expectedCrew.has(row.recipient_user_id)
          || Math.round(Number(row.quote_total) * 100) !== Math.round(basis.quoteTotalUsd * 100))) {
        throw new Error("Crew reward assignment or funding changed");
      }
      if (row.recipient_type === "customer" && !row.recipient_user_id
          && row.reward_kind === "customer_paid_completed_pool_pending_claim" && row.metadata?.pendingCustomerClaim === true) continue;
      if (!row.recipient_user_id || (amount > 0 && (!row.metadata?.walletCreditedAt || !row.reward_matches || !row.wallet_exists))) {
        throw new Error("Reward wallet settlement is incomplete");
      }
    }
    const finished = await finishJobReward(claim, true, client);
    await client.query("COMMIT");
    return finished;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Reconciles payment-before-completion and missing handoffs after downtime.
 * No application event or browser claim can by itself establish eligibility. */
export async function enqueueCompletedPaidJobs() {
  if (!canonicalRewardQueueEnabled()) return 0;
  const { rows } = await pool.query(`INSERT INTO job_reward_queue(lead_id)
    SELECT l.id FROM leads l WHERE l.status='completed' AND l.payment_paid_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM job_confirmed_payments p WHERE p.lead_id=l.id)
      AND NOT EXISTS(SELECT 1 FROM job_reward_queue q WHERE q.lead_id=l.id)
    ORDER BY l.id LIMIT 100 ON CONFLICT(lead_id) DO NOTHING RETURNING lead_id`);
  return rows.length;
}

export async function processOneJobReward(disburse?: (leadId: string) => Promise<unknown>) {
  if (!canonicalRewardQueueEnabled()) return { status: "disabled" as const };
  const claim = await claimJobReward();
  if (!claim) return { status: "idle" as const };
  try {
    const issue = disburse || (await import("./disburse-job-tokens")).disburseJobTokens;
    await issue(claim.lead_id);
    const finished = await completeSettledRewardClaim(claim);
    return { status: finished ? "done" as const : "superseded" as const, leadId: claim.lead_id };
  } catch {
    // Persist a bounded code, never raw provider/credential-bearing errors.
    const updated = await finishJobReward(claim, false);
    return { status: updated ? "retry" as const : "superseded" as const, leadId: claim.lead_id };
  }
}
