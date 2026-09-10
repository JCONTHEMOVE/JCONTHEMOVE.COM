import { pool } from "../db";

export type JobAlertChannel = "in_app" | "push" | "email" | "sms" | "webhook";
export type JobAlertStatus = "sent" | "failed" | "skipped";

/**
 * A durable, append-only audit of operational alert delivery.  This is kept
 * separate from the in-app notification itself so a missing push subscription
 * or a provider outage is visible rather than looking like a sent alert.
 */
export async function recordJobAlertDelivery(input: {
  eventId: string;
  leadId?: string | null;
  recipientUserId?: string | null;
  channel: JobAlertChannel;
  status: JobAlertStatus;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO job_alert_deliveries
      (event_id, lead_id, recipient_user_id, channel, status, error_message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (event_id, recipient_user_id, channel)
     DO UPDATE SET
       status = EXCLUDED.status,
       error_message = EXCLUDED.error_message,
       metadata = EXCLUDED.metadata,
       attempts = job_alert_deliveries.attempts + 1,
       updated_at = NOW()`,
    [
      input.eventId,
      input.leadId || null,
      input.recipientUserId || null,
      input.channel,
      input.status,
      input.errorMessage || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export async function hasJobAlertDelivery(eventId: string, recipientUserId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM job_alert_deliveries WHERE event_id = $1 AND recipient_user_id = $2 LIMIT 1",
    [eventId,recipientUserId],
  );
  return (rowCount || 0) > 0;
}

export type JobWebhookDeliveryStatus = "sent" | "failed";

/**
 * Webhooks aggregate attempts separately from per-user notifications. Preserve
 * confirmed success even if another in-flight attempt later reports failure.
 * A target hash avoids storing the Discord/Slack webhook secret.
 */
export async function recordJobWebhookDelivery(input: {
  eventId: string;
  leadId?: string | null;
  webhookUrlHash: string;
  provider: string;
  status: JobWebhookDeliveryStatus;
  responseStatus?: number | null;
  errorMessage?: string | null;
  attempts: number;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO job_webhook_deliveries
      (event_id, lead_id, webhook_url_hash, provider, status, response_status, error_message, attempts, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (event_id, webhook_url_hash)
     DO UPDATE SET
       lead_id = COALESCE(EXCLUDED.lead_id, job_webhook_deliveries.lead_id),
       provider = EXCLUDED.provider,
       status = CASE WHEN job_webhook_deliveries.status='sent' THEN 'sent' ELSE EXCLUDED.status END,
       response_status = CASE WHEN job_webhook_deliveries.status='sent' THEN job_webhook_deliveries.response_status ELSE EXCLUDED.response_status END,
       error_message = CASE WHEN job_webhook_deliveries.status='sent' THEN job_webhook_deliveries.error_message ELSE EXCLUDED.error_message END,
       attempts = job_webhook_deliveries.attempts + EXCLUDED.attempts,
       metadata = CASE WHEN job_webhook_deliveries.status='sent' THEN job_webhook_deliveries.metadata ELSE EXCLUDED.metadata END,
       updated_at = NOW()`,
    [
      input.eventId,
      input.leadId || null,
      input.webhookUrlHash,
      input.provider,
      input.status,
      input.responseStatus || null,
      input.errorMessage || null,
      input.attempts,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export async function hasSuccessfulJobWebhookDelivery(eventId: string, webhookUrlHash: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM job_webhook_deliveries
      WHERE event_id = $1 AND webhook_url_hash = $2 AND status = 'sent'
      LIMIT 1`,
    [eventId, webhookUrlHash],
  );
  return (rowCount || 0) > 0;
}
