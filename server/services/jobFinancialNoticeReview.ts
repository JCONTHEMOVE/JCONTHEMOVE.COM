import { isDeepStrictEqual } from 'node:util';
import { pool } from '../db';
import { financialNoticeDeliveryEnabled } from './jobFinancialNoticeDelivery';
import { FinancialNoticeReviewConflict, financialNoticeResolutionSchema } from './financialNoticeReviewPolicy';

export type FinancialNoticeResolution = {
  requestId: string; eventKey: string; action: 'confirm_sent' | 'suppress'; evidence: string;
  channel?: 'email' | 'sms'; attemptToken?: string; providerReference?: string;
};
export type FinancialNoticeReviewRow = {
  event_key: string; kind: string; status: string; created_at: string; last_failure_code: string | null;
  deliveries: { channel: 'email' | 'sms'; status: string; attempt_token: string; provider_reference: string | null; created_at: string }[];
  reviews: { actor_id: string; request_payload: FinancialNoticeResolution; created_at: string }[];
};

export async function getFinancialNoticeReview(leadId: string) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') return { enabled: false as const };
  const { rows } = await pool.query<FinancialNoticeReviewRow>(`SELECT n.event_key,n.kind,n.status,n.created_at,n.last_failure_code,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',a.channel,'status',a.status,'attempt_token',a.attempt_token,
      'provider_reference',a.provider_reference,'created_at',a.created_at) ORDER BY a.channel)
      FROM job_financial_notice_attempts a WHERE a.event_key=n.event_key),'[]'::jsonb) AS deliveries,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('actor_id',r.actor_id,'request_payload',r.request_payload,'created_at',r.created_at)
      ORDER BY r.created_at) FROM job_financial_notice_reviews r WHERE r.event_key=n.event_key),'[]'::jsonb) AS reviews
    FROM job_financial_notifications n WHERE n.lead_id=$1 ORDER BY n.created_at DESC,n.event_key LIMIT 51`, [leadId]);
  return { enabled: true as const, deliveryEnabled: financialNoticeDeliveryEnabled(), notices: rows.slice(0,50), truncated: rows.length > 50 };
}

/** Owner authorization is enforced by the HTTP handler. This service records an
 * explicit receipt or suppresses future sends; it never erases a send barrier. */
export async function resolveFinancialNotice(leadId: string, actorId: string, input: FinancialNoticeResolution) {
  input = financialNoticeResolutionSchema.parse(input);
  if (!actorId?.trim() || !leadId?.trim()) throw new FinancialNoticeReviewConflict('Reviewer and job are required');
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') throw new FinancialNoticeReviewConflict('Financial notice review is disabled');
  const request = { ...input, channel: input.channel || null, attemptToken: input.attemptToken || null, providerReference: input.providerReference || null };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM leads WHERE id=$1 FOR UPDATE', [leadId]);
    const notice = (await client.query(`SELECT * FROM job_financial_notifications WHERE event_key=$1 AND lead_id=$2 FOR UPDATE`,
      [input.eventKey, leadId])).rows[0];
    if (!notice) throw new FinancialNoticeReviewConflict('Notice is unavailable for this job');
    const existing = (await client.query('SELECT * FROM job_financial_notice_reviews WHERE request_id=$1', [input.requestId])).rows[0];
    if (existing) {
      if (existing.event_key !== input.eventKey || existing.actor_id !== actorId || !isDeepStrictEqual(existing.request_payload, request)) {
        throw new FinancialNoticeReviewConflict('Review request was already used with different evidence');
      }
      await client.query('COMMIT');
      return { status: existing.resulting_status as string, replayed: true };
    }
    if (notice.status !== 'review') throw new FinancialNoticeReviewConflict('Notice changed; refresh before reviewing');
    let status = 'suppressed';
    if (input.action === 'confirm_sent') {
      const attempt = (await client.query(`SELECT * FROM job_financial_notice_attempts WHERE event_key=$1 AND channel=$2 FOR UPDATE`,
        [input.eventKey, input.channel])).rows[0];
      if (!attempt || attempt.attempt_token !== input.attemptToken || !['review','sent'].includes(attempt.status)) {
        throw new FinancialNoticeReviewConflict('Delivery attempt changed; refresh before reviewing');
      }
      if (attempt.status === 'sent' && attempt.provider_reference && attempt.provider_reference !== input.providerReference) {
        throw new FinancialNoticeReviewConflict('Provider receipt differs from the recorded receipt');
      }
      await client.query(`UPDATE job_financial_notice_attempts SET status='sent',provider_reference=$3,updated_at=NOW()
        WHERE event_key=$1 AND channel=$2`, [input.eventKey, input.channel, input.providerReference]);
      const unresolved = (await client.query(`SELECT 1 FROM job_financial_notice_attempts WHERE event_key=$1 AND status<>'sent'`,
        [input.eventKey])).rows.length > 0;
      status = unresolved ? 'review' : 'pending';
    }
    await client.query(`INSERT INTO job_financial_notice_reviews(request_id,event_key,actor_id,request_payload,resulting_status)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [input.requestId, input.eventKey, actorId, JSON.stringify(request), status]);
    await client.query(`UPDATE job_financial_notifications SET status=$2,next_attempt_at=NOW(),lease_token=NULL,lease_expires_at=NULL,
      last_failure_code=CASE WHEN $2='review' THEN 'delivery_outcome_unknown' ELSE NULL END,updated_at=NOW() WHERE event_key=$1`,
      [input.eventKey, status]);
    await client.query('COMMIT');
    return { status, replayed: false };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
