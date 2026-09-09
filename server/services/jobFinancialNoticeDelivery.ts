import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from '@neondatabase/serverless';
import { pool } from '../db';

export function financialNoticeDeliveryEnabled() {
  return process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true'
    && process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED === 'true';
}

export type FinancialNoticeClaim = {
  event_key: string; lead_id: string; closeout_id: string; kind: string;
  payload: Record<string, unknown>; lease_token: string;
};
export type FinancialNoticeAttempt = {
  eventKey: string; channel: 'email' | 'sms'; token: string;
};

/** No provider calls here. An expired send is uncertain, never retryable merely
 * because its worker disappeared. Rows with no attempted sends can be reclaimed. */
export async function claimFinancialNotice(): Promise<FinancialNoticeClaim | null> {
  if (!financialNoticeDeliveryEnabled()) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<FinancialNoticeClaim>(`SELECT * FROM job_financial_notifications
      WHERE (status IN ('pending','retry') AND next_attempt_at<=NOW())
        OR (status='processing' AND lease_expires_at<NOW())
      ORDER BY next_attempt_at,event_key FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) { await client.query('COMMIT'); return null; }
    await client.query(`UPDATE job_financial_notice_attempts SET status='review',updated_at=NOW()
      WHERE event_key=$1 AND status='sending'`, [row.event_key]);
    const uncertain = (await client.query(`SELECT 1 FROM job_financial_notice_attempts
      WHERE event_key=$1 AND status='review'`, [row.event_key])).rows.length > 0;
    if (uncertain) {
      await client.query(`UPDATE job_financial_notifications SET status='review',
        lease_token=NULL,lease_expires_at=NULL,last_failure_code='delivery_outcome_unknown',updated_at=NOW()
        WHERE event_key=$1`, [row.event_key]);
      await client.query('COMMIT');
      return null;
    }
    const token = randomUUID();
    await client.query(`UPDATE job_financial_notifications SET status='processing',
      lease_token=$2,lease_expires_at=NOW()+INTERVAL '5 minutes',attempts=attempts+1,updated_at=NOW()
      WHERE event_key=$1`, [row.event_key, token]);
    await client.query('COMMIT');
    return { ...row, lease_token: token };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

/** Call inside the transaction that rechecks the job and current recipient /
 * consent, after checking legacy delivery history. COMMIT successfully before
 * sending. A lost COMMIT response means do not send. One channel per event,
 * including after a destination changes; never infer a resend from a new hash. */
export async function reserveFinancialNoticeAttempt(client: PoolClient, claim: FinancialNoticeClaim,
  channel: FinancialNoticeAttempt['channel'], destination: string): Promise<FinancialNoticeAttempt | null> {
  if (!financialNoticeDeliveryEnabled()) return null;
  const normalized = destination.trim().toLowerCase();
  if (!normalized) throw new Error('Financial notice destination is missing');
  const active = (await client.query(`SELECT event_key FROM job_financial_notifications
    WHERE event_key=$1 AND status='processing' AND lease_token=$2 AND lease_expires_at>NOW()
    FOR UPDATE`, [claim.event_key, claim.lease_token])).rows.length === 1;
  if (!active) return null;
  const token = randomUUID();
  const result = await client.query(`INSERT INTO job_financial_notice_attempts
    (event_key,channel,destination_hash,attempt_token,status) VALUES($1,$2,$3,$4,'sending')
    ON CONFLICT(event_key,channel) DO NOTHING RETURNING event_key`,
  [claim.event_key, channel, createHash('sha256').update(normalized).digest('hex'), token]);
  return result.rows.length ? { eventKey: claim.event_key, channel, token } : null;
}

/** False/throw from a provider is ambiguous unless it proves no send occurred.
 * Persist review; do not reset to pending or fall back to a second provider.
 * A late positive receipt may resolve its original attempt, but never a new one. */
export async function acknowledgeFinancialNoticeAttempt(attempt: FinancialNoticeAttempt,
  result: { sent: boolean; providerReference?: string }) {
  const updated = await pool.query(`UPDATE job_financial_notice_attempts SET
    status=CASE WHEN $4 THEN 'sent' ELSE 'review' END,
    provider_reference=COALESCE($5,provider_reference),updated_at=NOW()
    WHERE event_key=$1 AND channel=$2 AND attempt_token=$3 AND status IN ('sending','review')
    RETURNING event_key`, [attempt.eventKey, attempt.channel, attempt.token, result.sent, result.providerReference || null]);
  return updated.rows.length === 1;
}
