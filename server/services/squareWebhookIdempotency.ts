import { createInvoiceEffectClaims, type InvoiceEffectClaim } from "./squareInvoiceEffectClaims";
import crypto from "crypto";
import { pool } from "../db";
import { ensureRegionalAutomationSchema } from "./regionalAutomationMigration";

export async function claimSquareWebhookEvent(input: {
  eventId: string;
  eventType: string;
  squareObjectId?: string | null;
  rawBody: string;
}): Promise<"claimed" | "processed" | "in_progress"> {
  await ensureRegionalAutomationSchema();
  const payloadHash = crypto.createHash("sha256").update(input.rawBody).digest("hex");
  const inserted = await pool.query(
    `INSERT INTO square_webhook_events
       (event_id, event_type, square_object_id, payload_hash, status)
     VALUES ($1,$2,$3,$4,'processing')
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [input.eventId, input.eventType, input.squareObjectId || null, payloadHash],
  );
  if (inserted.rows.length > 0) return "claimed";

  const { rows } = await pool.query<{ status: string; received_at: Date }>(
    `SELECT status, received_at FROM square_webhook_events WHERE event_id=$1`,
    [input.eventId],
  );
  if (rows[0]?.status === "processed") return "processed";

  const reclaimed = await pool.query(
    `UPDATE square_webhook_events
        SET status='processing', last_error=NULL, received_at=NOW()
      WHERE event_id=$1
        AND (status='failed' OR received_at < NOW() - INTERVAL '5 minutes')
      RETURNING event_id`,
    [input.eventId],
  );
  return reclaimed.rows.length > 0 ? "claimed" : "in_progress";
}

export async function completeSquareWebhookEvent(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE square_webhook_events SET status='processed', processed_at=NOW(), last_error=NULL WHERE event_id=$1`,
    [eventId],
  );
}

export async function failSquareWebhookEvent(eventId: string, error: unknown): Promise<void> {
  await pool.query(
    `UPDATE square_webhook_events SET status='failed', last_error=$2 WHERE event_id=$1`,
    [eventId, error instanceof Error ? error.message : String(error)],
  ).catch(() => undefined);
}

const invoiceClaims = createInvoiceEffectClaims((sql, args) => pool.query(sql, args));

export async function claimSquareInvoicePaymentEffect(squareInvoiceId: string, eventId: string) {
  await ensureRegionalAutomationSchema();
  return invoiceClaims.claim(squareInvoiceId, eventId);
}

export async function completeSquareInvoicePaymentEffect(claim: InvoiceEffectClaim): Promise<void> {
  if (!(await invoiceClaims.complete(claim))) throw new Error("Square invoice claim was superseded");
}

export async function failSquareInvoicePaymentEffect(claim: InvoiceEffectClaim, error: unknown): Promise<void> {
  await invoiceClaims.fail(claim, error).catch(() => undefined);
}
