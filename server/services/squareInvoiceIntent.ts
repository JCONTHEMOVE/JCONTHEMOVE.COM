import { isDeepStrictEqual } from 'node:util';
import { pool } from '../db';

export const SQUARE_INVOICE_INTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS square_invoice_intents (
    request_key TEXT PRIMARY KEY,
    lead_id VARCHAR NOT NULL REFERENCES leads(id),
    request_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

/** Commit before the first provider request. An unknown commit result must stop
 * this attempt; replay can read it safely. Never overwrite the original input. */
export async function reserveSquareInvoiceIntent(requestKey: string, leadId: string, payload: Record<string,unknown>) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') throw new Error('Canonical payment ledger is disabled');
  if (!requestKey || !leadId) throw new Error('Stable invoice identity is required');
  await pool.query(`INSERT INTO square_invoice_intents(request_key,lead_id,request_payload)
    VALUES($1,$2,$3::jsonb) ON CONFLICT(request_key) DO NOTHING`, [requestKey,leadId,JSON.stringify(payload)]);
  const existing=(await pool.query('SELECT lead_id,request_payload FROM square_invoice_intents WHERE request_key=$1',[requestKey])).rows[0];
  if (!existing || existing.lead_id!==leadId || !isDeepStrictEqual(existing.request_payload,payload)) {
    throw new Error('Invoice request changed; reconcile the original intent before retrying');
  }
}
