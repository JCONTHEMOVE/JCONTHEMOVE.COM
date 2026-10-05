import { randomUUID } from "node:crypto";

export const SQUARE_INVOICE_CLAIM_UPGRADE = `
  ALTER TABLE square_invoice_payment_effects ADD COLUMN IF NOT EXISTS claim_token UUID;
`;
export type InvoiceEffectClaim = { invoiceId: string; token: string };
type Query = (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Each attempt owns a fresh token, even when Square reuses the event ID. */
export function createInvoiceEffectClaims(query: Query) {
  return {
    async claim(invoiceId: string, eventId: string): Promise<
      { status: "claimed"; claim: InvoiceEffectClaim } | { status: "processed" } | { status: "in_progress" }
    > {
      const token = randomUUID();
      const inserted = await query(
        `INSERT INTO square_invoice_payment_effects (square_invoice_id,event_id,status,claim_token)
         VALUES ($1,$2,'processing',$3)
         ON CONFLICT (square_invoice_id) DO UPDATE SET
           event_id=EXCLUDED.event_id,status='processing',claim_token=EXCLUDED.claim_token,
           last_error=NULL,started_at=NOW(),completed_at=NULL
         WHERE square_invoice_payment_effects.status='failed'
            OR (square_invoice_payment_effects.status='processing'
                AND square_invoice_payment_effects.started_at<NOW()-INTERVAL '5 minutes')
         RETURNING square_invoice_id`, [invoiceId, eventId, token],
      );
      if (inserted.rows.length) return { status: "claimed", claim: { invoiceId, token } };
      const current = await query("SELECT status FROM square_invoice_payment_effects WHERE square_invoice_id=$1", [invoiceId]);
      return { status: current.rows[0]?.status === "processed" ? "processed" : "in_progress" };
    },
    async complete(claim: InvoiceEffectClaim): Promise<boolean> {
      const result = await query(
        `UPDATE square_invoice_payment_effects SET status='processed',completed_at=NOW(),last_error=NULL
         WHERE square_invoice_id=$1 AND claim_token=$2 AND status='processing' RETURNING square_invoice_id`,
        [claim.invoiceId, claim.token],
      );
      return result.rows.length > 0;
    },
    async fail(claim: InvoiceEffectClaim, error: unknown): Promise<boolean> {
      const result = await query(
        `UPDATE square_invoice_payment_effects SET status='failed',last_error=$3
         WHERE square_invoice_id=$1 AND claim_token=$2 AND status='processing' RETURNING square_invoice_id`,
        [claim.invoiceId, claim.token, error instanceof Error ? error.message : String(error)],
      );
      return result.rows.length > 0;
    },
  };
}
