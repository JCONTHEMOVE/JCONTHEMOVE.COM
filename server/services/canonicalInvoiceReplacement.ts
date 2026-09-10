import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from '@neondatabase/serverless';

export const CANONICAL_INVOICE_REPLACEMENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS job_invoice_replacements (
    request_key TEXT PRIMARY KEY,
    lead_id VARCHAR NOT NULL REFERENCES leads(id),
    closeout_id VARCHAR NOT NULL,
    request_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_job_invoice_replacements_closeout ON job_invoice_replacements(lead_id,closeout_id);
`;

export type CanonicalReplacementRequest = {
  requestKey: string; leadId: string; closeoutId: string; quoteId: string;
  amountCents: number; paidCents: number; totalCents: number; dueDate: string;
  previousInvoiceId: string | null; predecessorInvoiceIds: string[];
};

/** Called with the job, closeout and reconciliation lease locked, after fresh
 * provider inspection. Commit this request with the corrected local balance;
 * never contact Square inside this transaction. */
export async function reserveCanonicalReplacement(client: PoolClient, input: {
  leadId: string; closeoutId: string; quoteId: string; totalCents: number; paidCents: number;
  dueDate: string; previousInvoiceId: string | null;
  invoices: { id: string; status: string }[];
}): Promise<CanonicalReplacementRequest> {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED!=='true') throw new Error('Canonical payment ledger is disabled');
  const ids=input.invoices.map(invoice=>invoice.id).sort();
  if (!input.leadId || !input.closeoutId || !input.quoteId || !ids.length || ids.some(id=>!id)
      || new Set(ids).size!==ids.length || input.invoices.some(invoice=>!['PAID','CANCELED','FAILED'].includes(invoice.status))
      || (input.previousInvoiceId && !ids.includes(input.previousInvoiceId))
      || !Number.isSafeInteger(input.totalCents) || !Number.isSafeInteger(input.paidCents)
      || input.paidCents<0 || input.totalCents<=input.paidCents
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
      || !Number.isFinite(Date.parse(input.dueDate)) || new Date(input.dueDate).toISOString().slice(0,10)!==input.dueDate) {
    throw new Error('Replacement invoice request requires reconciliation');
  }
  const payload={leadId:input.leadId,closeoutId:input.closeoutId,quoteId:input.quoteId,
    amountCents:input.totalCents-input.paidCents,paidCents:input.paidCents,totalCents:input.totalCents,
    dueDate:input.dueDate,previousInvoiceId:input.previousInvoiceId,predecessorInvoiceIds:ids};
  // The replaced invoice set defines this recovery attempt. A changed amount,
  // quote or date must not silently create another provider request for it.
  const key='replacement:'+createHash('sha256').update(JSON.stringify([input.leadId,input.closeoutId,ids])).digest('hex');
  await client.query(`INSERT INTO job_invoice_replacements(request_key,lead_id,closeout_id,request_payload)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(request_key) DO NOTHING`,[key,input.leadId,input.closeoutId,JSON.stringify(payload)]);
  const stored=(await client.query('SELECT lead_id,closeout_id,request_payload FROM job_invoice_replacements WHERE request_key=$1',[key])).rows[0];
  if (!stored || stored.lead_id!==input.leadId || stored.closeout_id!==input.closeoutId || !isDeepStrictEqual(stored.request_payload,payload)) {
    throw new Error('Replacement request changed; reconcile its existing provider intent');
  }
  return {requestKey:key,...payload};
}
