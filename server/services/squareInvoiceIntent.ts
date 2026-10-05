import { isDeepStrictEqual } from 'node:util';
import { pool } from '../db';

export const SQUARE_INVOICE_INTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS square_invoice_intents (
    request_key TEXT PRIMARY KEY,
    lead_id VARCHAR NOT NULL REFERENCES leads(id),
    request_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS square_invoice_intent_phases (
    request_key TEXT NOT NULL REFERENCES square_invoice_intents(request_key),
    phase TEXT NOT NULL CHECK(phase IN ('customer','order','invoice')),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(request_key,phase)
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

export type SquareInvoicePhaseResult = { id: string; version?: number; invoiceNumber?: string };
type Phase = 'customer' | 'order' | 'invoice';
function normalizePhase(phase: Phase, result: SquareInvoicePhaseResult): SquareInvoicePhaseResult {
  if (!result || typeof result.id !== 'string' || !result.id.trim() || result.id.length>255) {
    throw new Error('Square phase identity requires reconciliation');
  }
  if (phase !== 'invoice') return { id:result.id };
  if (!Number.isSafeInteger(result.version) || result.version!<0 || result.version!>2147483647
    || result.invoiceNumber != null && typeof result.invoiceNumber !== 'string') {
    throw new Error('Square invoice phase version requires reconciliation');
  }
  return { id:result.id,version:result.version,...(result.invoiceNumber ? {invoiceNumber:result.invoiceNumber} : {}) };
}

/** Persist each identity before constructing the next provider request. Two
 * competing results cannot replace one another; the losing caller stops. */
export async function recoverSquareInvoicePhase(requestKey: string, phase: Phase,
  operation: () => Promise<SquareInvoicePhaseResult>): Promise<SquareInvoicePhaseResult> {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') throw new Error('Canonical payment ledger is disabled');
  const intent=(await pool.query('SELECT request_key FROM square_invoice_intents WHERE request_key=$1',[requestKey])).rows[0];
  if (!intent) throw new Error('Invoice intent must exist before a provider phase');
  const read=async()=>(await pool.query('SELECT result FROM square_invoice_intent_phases WHERE request_key=$1 AND phase=$2',[requestKey,phase])).rows[0];
  const existing=await read();
  if (existing) return normalizePhase(phase,existing.result);
  const result=normalizePhase(phase,await operation());
  await pool.query(`INSERT INTO square_invoice_intent_phases(request_key,phase,result) VALUES($1,$2,$3::jsonb)
    ON CONFLICT(request_key,phase) DO NOTHING`,[requestKey,phase,JSON.stringify(result)]);
  const stored=await read();
  if (!stored || !isDeepStrictEqual(stored.result,result)) throw new Error('Competing Square phase identities require reconciliation');
  return result;
}
