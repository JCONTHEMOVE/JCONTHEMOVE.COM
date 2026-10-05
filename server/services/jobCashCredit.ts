import { pool } from "../db";

/** One legacy service-credit grant per job, serialized on its lead row. */
export async function creditJobCash(leadId: string, amountUsd: number, source: string): Promise<"credited" | "duplicate" | "unclaimed"> {
  const cents = Math.round(amountUsd * 100);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Invalid job cash-credit amount");
  }
  const amount = (cents / 100).toFixed(2);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await client.query<{ email: string | null }>(
      "SELECT email FROM leads WHERE id = $1 FOR UPDATE", [leadId],
    );
    if (!lead.rows.length) throw new Error("Job cash-credit lead was not found");
    const existing = await client.query(
      "SELECT 1 FROM rewards WHERE reward_type = 'jcmoves_usd_mint' AND reference_id = $1 LIMIT 1", [leadId],
    );
    if (existing.rows.length) {
      await client.query("COMMIT");
      return "duplicate";
    }
    const users = lead.rows[0].email
      ? await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [lead.rows[0].email])
      : { rows: [] };
    if (users.rows.length > 1) throw new Error("Ambiguous job cash-credit recipient requires reconciliation");
    if (!users.rows.length) {
      await client.query("COMMIT");
      return "unclaimed";
    }
    const userId = users.rows[0].id;
    await client.query(
      `INSERT INTO wallet_accounts (user_id, token_balance, cash_balance)
       VALUES ($1, '0', '0.00') ON CONFLICT (user_id) DO NOTHING`, [userId],
    );
    const updated = await client.query<{ cash_balance: string }>(
      "UPDATE wallet_accounts SET cash_balance = cash_balance + $1 WHERE user_id = $2 RETURNING cash_balance", [amount, userId],
    );
    if (updated.rows.length !== 1 || updated.rows[0].cash_balance == null) throw new Error("Job cash-credit wallet update failed");
    await client.query(
      `INSERT INTO rewards (user_id, reward_type, token_amount, cash_value, status, reference_id, metadata)
       VALUES ($1, 'jcmoves_usd_mint', '0', $2, 'confirmed', $3, $4)`,
      [userId, amount, leadId, JSON.stringify({ source, leadId })],
    );
    await client.query(
      `INSERT INTO wallet_transactions (transaction_type, amount, balance_after, status, metadata)
       VALUES ('jcmoves_usd_mint', $1, $2, 'confirmed', $3::jsonb)`,
      [amount, updated.rows[0].cash_balance, JSON.stringify({ userId, leadId, source, currency: "JCMOVES_USD" })],
    );
    await client.query("COMMIT");
    return "credited";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
