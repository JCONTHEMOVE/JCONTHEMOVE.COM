import { pool } from "../db";
import { lockCanonicalRewardBasis } from "./canonicalRewardBasis";
const TOKEN_PRICE = 0.00000508432;
export type JobLedgerRecipient = {
  ledgerId: number;
  leadId: string;
  userId: string;
  rewardType: "customer_paid_completed_pool" | "crew_paid_completed_pool";
  amount: number;
  quoteTotal: number;
  ratePerDollar: number;
  metadata?: Record<string, unknown>;
};

/**
 * Settles an already-recorded job ledger entry atomically. The durable ledger
 * is written before this runs; the reward row, wallet balance, and settlement
 * marker are committed together, so a retry cannot double-credit after a
 * partial failure.
 */
export async function settleJobLedgerRecipient(input: JobLedgerRecipient): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const canonicalBasis = process.env.JOB_PAYMENT_LEDGER_ENABLED === "true"
      ? await lockCanonicalRewardBasis(client, input.leadId) : null;
    const { rows: ledgerRows } = await client.query<{
      lead_id: string; recipient_user_id: string; reward_kind: string;
      token_amount: string; quote_total: string; rate_per_dollar: string;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT lead_id,recipient_user_id,reward_kind,token_amount::text,quote_total::text,
              rate_per_dollar::text,metadata FROM job_jcmoves_ledger WHERE id = $1 FOR UPDATE`,
      [input.ledgerId],
    );
    if (!ledgerRows.length) throw new Error(`JCMOVES ledger ${input.ledgerId} was not found`);
    const ledger = ledgerRows[0];
    if (ledger.lead_id !== input.leadId || ledger.recipient_user_id !== input.userId
        || ledger.reward_kind !== input.rewardType) throw new Error("JCMOVES ledger recipient or job mismatch");
    const amount = Number(ledger.token_amount), quoteTotal = Number(ledger.quote_total), rate = Number(ledger.rate_per_dollar);
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(quoteTotal) || quoteTotal < 0
        || !Number.isFinite(rate) || rate < 0) throw new Error("Invalid persisted JCMOVES settlement amounts");
    // The persisted award is authoritative across retries and rate changes.
    input = { ...input, amount, quoteTotal, ratePerDollar: rate,
      metadata: { ...input.metadata, ...ledger.metadata } };
    if (ledgerRows[0].metadata?.walletCreditedAt) {
      await client.query("COMMIT");
      return false;
    }
    if (canonicalBasis) {
      const expectedQuote = input.rewardType === "customer_paid_completed_pool"
        ? canonicalBasis.customerEligibleUsd : canonicalBasis.quoteTotalUsd;
      if (Math.round(quoteTotal * 100) !== Math.round(expectedQuote * 100)) {
        throw new Error("Persisted reward funding differs from canonical payments; reconciliation required");
      }
    }

    const existingReward = await client.query(
      `SELECT 1 FROM rewards
        WHERE user_id = $1 AND reward_type = $2 AND reference_id = $3
        LIMIT 1`,
      [input.userId, input.rewardType, input.leadId],
    );
    if (existingReward.rows.length > 0) {
      // This transaction writes the reward and credited marker together.
      // A pre-existing reward without that marker has ambiguous wallet history.
      throw new Error("Existing reward without ledger settlement marker requires reconciliation");
    }
    {
      await client.query(
        `INSERT INTO rewards (user_id, reward_type, token_amount, cash_value, status, earned_date, reference_id, metadata)
         VALUES ($1,$2,$3,$4,'confirmed',NOW(),$5,$6::jsonb)`,
        [
          input.userId,
          input.rewardType,
          input.amount.toFixed(8),
          (input.amount * TOKEN_PRICE).toFixed(6),
          input.leadId,
          JSON.stringify({
            jobId: input.leadId,
            ratePerDollar: input.ratePerDollar,
            quoteTotal: input.quoteTotal,
            ...(input.metadata ?? {}),
          }),
        ],
      );
    }

    await client.query(
      "INSERT INTO wallet_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [input.userId],
    );
    await client.query(
      `UPDATE wallet_accounts
          SET token_balance = (COALESCE(token_balance, 0)::numeric + $2)::numeric(18,8),
              total_earned = (COALESCE(total_earned, 0)::numeric + $2)::numeric(18,8),
              last_activity = NOW()
        WHERE user_id = $1`,
      [input.userId, input.amount],
    );
    await client.query(
      `UPDATE job_jcmoves_ledger
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('walletCreditedAt', NOW()::text)
        WHERE id = $1`,
      [input.ledgerId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

