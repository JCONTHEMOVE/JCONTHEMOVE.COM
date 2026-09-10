import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { PoolClient } from "@neondatabase/serverless";

export const JOB_REWARD_QUEUE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS job_reward_queue (
    lead_id VARCHAR PRIMARY KEY REFERENCES leads(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','done')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token UUID, lease_expires_at TIMESTAMPTZ,
    last_failure_code TEXT, completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_job_reward_queue_due ON job_reward_queue(status,next_attempt_at);
`;

export function canonicalRewardQueueEnabled() {
  return process.env.JOB_PAYMENT_LEDGER_ENABLED === "true" && process.env.JOB_PAYMENT_REWARDS_ENABLED === "true";
}

/** Use the payment/completion transaction so eligibility and the handoff commit
 * together. The worker must recheck eligibility before touching a wallet. */
export async function enqueueJobReward(client: PoolClient, leadId: string) {
  if (!canonicalRewardQueueEnabled()) return false;
  const result = await client.query(
    "INSERT INTO job_reward_queue(lead_id) VALUES($1) ON CONFLICT(lead_id) DO NOTHING RETURNING lead_id", [leadId]);
  return result.rows.length > 0;
}

/** Leases survive process crashes. SKIP LOCKED allows independent workers;
 * a unique token prevents an expired worker from completing a newer claim. */
export async function claimJobReward() {
  if (!canonicalRewardQueueEnabled()) return null;
  const token = randomUUID();
  const { rows } = await pool.query<{ lead_id: string; lease_token: string; attempts: number }>(
    `UPDATE job_reward_queue SET status='processing',lease_token=$1,
      lease_expires_at=NOW()+INTERVAL '5 minutes',attempts=attempts+1,updated_at=NOW()
     WHERE lead_id=(SELECT lead_id FROM job_reward_queue
       WHERE (status IN ('pending','retry') AND next_attempt_at<=NOW())
         OR (status='processing' AND lease_expires_at<NOW())
       ORDER BY next_attempt_at,lead_id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING lead_id,lease_token,attempts`, [token]);
  return rows[0] || null;
}

export async function finishJobReward(claim: { lead_id: string; lease_token: string }, settled: boolean, transaction?: PoolClient) {
  if (!canonicalRewardQueueEnabled()) return false;
  const { rows } = await (transaction || pool).query(
    `UPDATE job_reward_queue SET status=$3,lease_token=NULL,lease_expires_at=NULL,
       completed_at=CASE WHEN $3='done' THEN NOW() ELSE NULL END,
       next_attempt_at=NOW()+INTERVAL '1 minute'*LEAST(60,GREATEST(1,attempts)),
       last_failure_code=CASE WHEN $3='done' THEN NULL ELSE 'settlement_incomplete' END,updated_at=NOW()
     WHERE lead_id=$1 AND lease_token=$2 AND status='processing' RETURNING lead_id`,
    [claim.lead_id, claim.lease_token, settled ? "done" : "retry"]);
  return rows.length > 0;
}
