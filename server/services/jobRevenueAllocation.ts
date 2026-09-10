import { pool } from "../db";

/** Records planning allocations only; no money or tokens are transferred. */
export async function recordJobRevenue(amountUsd: number, leadId: string, source: string): Promise<boolean> {
  const cents = Math.round(amountUsd * 100);
  if (!leadId || !Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Invalid job revenue allocation");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await client.query("SELECT id FROM leads WHERE id=$1 FOR UPDATE", [leadId]);
    if (!lead.rows.length) throw new Error("Revenue allocation lead was not found");
    const inserted = await client.query(
      `INSERT INTO revenue_allocations
       (lead_id,payment_amount_usd,buyback_usd,staking_usd,jackpot_usd,liquidity_usd,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (lead_id) WHERE lead_id IS NOT NULL DO NOTHING RETURNING id`,
      [leadId, (cents / 100).toFixed(2), ...[0.4, 0.3, 0.2, 0.1].map(part => (Math.round(cents * part) / 100).toFixed(2)), source],
    );
    if (inserted.rows.length) {
      // Increment in SQL so allocations for different jobs cannot lose counts.
      await client.query(`UPDATE buyback_fund SET last_updated=NOW(),
        fee_contribution_count=COALESCE(fee_contribution_count,0)+1
        WHERE id=(SELECT id FROM buyback_fund ORDER BY id LIMIT 1)`);
    }
    await client.query("COMMIT");
    return inserted.rows.length > 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
