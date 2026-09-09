import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from '@neondatabase/serverless';

export const JOB_FINANCIAL_NOTIFICATIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS job_financial_notifications (
    event_key TEXT PRIMARY KEY,
    lead_id VARCHAR NOT NULL REFERENCES leads(id),
    closeout_id VARCHAR NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('final_payment_received','final_invoice_sent')),
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','sent','suppressed','review')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token UUID,lease_expires_at TIMESTAMPTZ,
    last_failure_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_job_financial_notifications_due ON job_financial_notifications(status,next_attempt_at);
  CREATE TABLE IF NOT EXISTS job_financial_notice_attempts (
    event_key TEXT NOT NULL REFERENCES job_financial_notifications(event_key),
    channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
    destination_hash TEXT NOT NULL,
    attempt_token UUID NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sending','sent','review')),
    provider_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(event_key,channel)
  );
`;

async function queue(client: PoolClient, input: {
  key: string; leadId: string; closeoutId: string; kind: string; payload: Record<string,unknown>;
}) {
  if(process.env.JOB_PAYMENT_LEDGER_ENABLED!=='true') throw new Error('Canonical payment ledger is disabled');
  await client.query(`INSERT INTO job_financial_notifications(event_key,lead_id,closeout_id,kind,payload)
    VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(event_key) DO NOTHING`,
  [input.key,input.leadId,input.closeoutId,input.kind,JSON.stringify(input.payload)]);
  const row=(await client.query('SELECT lead_id,closeout_id,kind,payload FROM job_financial_notifications WHERE event_key=$1',[input.key])).rows[0];
  if(!row || row.lead_id!==input.leadId || row.closeout_id!==input.closeoutId || row.kind!==input.kind
      || !isDeepStrictEqual(row.payload,input.payload)) throw new Error('Financial notification identity requires reconciliation');
}

export async function queuePaidCloseoutNotice(client: PoolClient, input: {
  leadId: string; closeoutId: string; quoteId: string; totalCents: number;
}) {
  await queue(client,{key:`${input.leadId}:financially_complete:${input.closeoutId}`,leadId:input.leadId,
    closeoutId:input.closeoutId,kind:'final_payment_received',payload:{quoteId:input.quoteId,totalCents:input.totalCents,
      title:'Your job is financially complete',message:'Your approved job is fully paid. No additional payment is due.'}});
}

export async function queueFinalInvoiceNotice(client: PoolClient, input: {
  leadId: string; closeoutId: string; quoteId: string; invoiceId: string; invoiceUrl: string; amountCents: number;
}) {
  await queue(client,{key:`${input.leadId}:final_invoice_sent:${input.invoiceId}`,leadId:input.leadId,
    closeoutId:input.closeoutId,kind:'final_invoice_sent',payload:{quoteId:input.quoteId,invoiceId:input.invoiceId,
      invoiceUrl:input.invoiceUrl,amountCents:input.amountCents,title:'Your final balance is ready',
      message:`The approved final balance is $${(input.amountCents/100).toFixed(2)}. Pay securely through Square.`}});
}
