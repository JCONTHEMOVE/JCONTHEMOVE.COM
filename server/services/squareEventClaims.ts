import { createHash, randomUUID } from "node:crypto";

export const SQUARE_EVENT_CLAIM_UPGRADE = `
  ALTER TABLE square_webhook_events ADD COLUMN IF NOT EXISTS claim_token UUID;
`;
export type SquareEventClaim = { eventId: string; token: string };
export type SquareEventInput = { eventId: string; eventType: string; squareObjectId?: string | null; rawBody: string };
type Query = (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export function createSquareEventClaims(query: Query) {
  return {
    async claim(input: SquareEventInput): Promise<
      { status: "claimed"; claim: SquareEventClaim } | { status: "processed" } | { status: "in_progress" }
    > {
      const token = randomUUID();
      const hash = createHash("sha256").update(input.rawBody).digest("hex");
      const inserted = await query(
        `INSERT INTO square_webhook_events(event_id,event_type,square_object_id,payload_hash,status,claim_token)
         VALUES($1,$2,$3,$4,'processing',$5) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
        [input.eventId, input.eventType, input.squareObjectId || null, hash, token],
      );
      if (inserted.rows.length) return { status: "claimed", claim: { eventId: input.eventId, token } };
      const existing = await query("SELECT status,payload_hash FROM square_webhook_events WHERE event_id=$1", [input.eventId]);
      if (existing.rows[0]?.payload_hash !== hash) throw new Error("Square event identity requires reconciliation");
      if (existing.rows[0]?.status === "processed") return { status: "processed" };
      const reclaimed = await query(
        `UPDATE square_webhook_events SET status='processing',last_error=NULL,received_at=NOW(),
         processed_at=NULL,claim_token=$2 WHERE event_id=$1 AND payload_hash=$3
         AND (status='failed' OR (status='processing' AND received_at<NOW()-INTERVAL '5 minutes'))
         RETURNING event_id`, [input.eventId, token, hash],
      );
      return reclaimed.rows.length ? { status: "claimed", claim: { eventId: input.eventId, token } } : { status: "in_progress" };
    },
    async complete(claim: SquareEventClaim): Promise<boolean> {
      const result = await query(
        `UPDATE square_webhook_events SET status='processed',processed_at=NOW(),last_error=NULL
         WHERE event_id=$1 AND claim_token=$2 AND status='processing' RETURNING event_id`, [claim.eventId, claim.token],
      );
      return result.rows.length > 0;
    },
    async fail(claim: SquareEventClaim, error: unknown): Promise<boolean> {
      const result = await query(
        `UPDATE square_webhook_events SET status='failed',last_error=$3
         WHERE event_id=$1 AND claim_token=$2 AND status='processing' RETURNING event_id`,
        [claim.eventId, claim.token, error instanceof Error ? error.message : String(error)],
      );
      return result.rows.length > 0;
    },
  };
}
