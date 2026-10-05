import { pool } from '../db';
import { JOB_PAYMENT_TOTALS_SQL } from './jobPaymentLedger';
import { attachCanonicalFinalInvoice } from './reconciledCloseout';
import type { CanonicalReplacementRequest } from './canonicalInvoiceReplacement';

type Dependencies = {
  getLead: typeof import('../storage').storage.getLead;
  createInvoice: typeof import('./square-invoice').squareInvoiceService.createInvoiceForLead;
};

export function replacementIssuanceEnabled() {
  return process.env.JOB_PAYMENT_LEDGER_ENABLED==='true' && process.env.JOB_INVOICE_RECONCILIATION_ENABLED==='true'
    && process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED==='true'
    && process.env.JOB_INVOICE_REPLACEMENT_ENABLED==='true';
}

/** Recheck the saved request before any provider entry. A known publication
 * resumes at attachment; ambiguous earlier phases retain their original keys. */
export async function issueCanonicalReplacement(requestKey: string, dependencies?: Dependencies) {
  if (!replacementIssuanceEnabled()) throw new Error('Replacement issuance is disabled');
  const client=await pool.connect();
  let request: CanonicalReplacementRequest;
  let published: {squareInvoiceId:string;invoiceUrl:string} | undefined;
  try {
    await client.query('BEGIN');
    const identity=(await client.query('SELECT lead_id FROM job_invoice_replacements WHERE request_key=$1',[requestKey])).rows[0];
    if (!identity) throw new Error('Replacement request not found');
    const job=(await client.query('SELECT total_price,status FROM leads WHERE id=$1 FOR UPDATE',[identity.lead_id])).rows[0];
    const row=(await client.query('SELECT * FROM job_invoice_replacements WHERE request_key=$1 FOR UPDATE',[requestKey])).rows[0];
    request={...row.request_payload,requestKey};
    const closeout=(await client.query('SELECT * FROM job_closeouts WHERE id=$1 AND lead_id=$2 FOR UPDATE',[request.closeoutId,request.leadId])).rows[0];
    const quote=(await client.query(`SELECT id,customer_total,currency FROM quote_revisions WHERE lead_id=$1
      AND approved_at IS NOT NULL AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1 FOR SHARE`,[request.leadId])).rows[0];
    const phase=(await client.query("SELECT result FROM square_invoice_intent_phases WHERE request_key=$1 AND phase='invoice'",[requestKey])).rows[0];
    const invoiceId=phase?.result?.id;
    const invoices=(await client.query(`SELECT square_invoice_id,square_order_id,amount,currency,quote_revision_id,closeout_id,status,invoice_url
      FROM square_invoices WHERE lead_id=$1 AND purpose='final_balance' FOR SHARE`,[request.leadId])).rows;
    const current=invoices.find(invoice=>invoice.square_invoice_id===invoiceId);
    const prior=invoices.filter(invoice=>invoice.square_invoice_id!==invoiceId);
    if (!job || job.status!=='completed' || row.lead_id!==request.leadId || row.closeout_id!==request.closeoutId
        || quote?.id!==request.quoteId || quote.currency!=='USD' || Math.round(Number(quote.customer_total)*100)!==request.totalCents
        || Math.round(Number(job.total_price)*100)!==request.totalCents || !closeout?.customer_approved_at
        || !['approved','balance_due'].includes(closeout.status) || closeout.pricing_snapshot?.finalQuoteRevisionId!==request.quoteId
        || Math.round(Number(closeout.calculated_final_total)*100)!==request.totalCents
        || Math.round(Number(closeout.balance_due)*100)!==request.amountCents
        || ![request.previousInvoiceId,invoiceId].includes(closeout.square_invoice_id || null)
        || (row.attached_invoice_id && row.attached_invoice_id!==invoiceId)
        || prior.length!==request.predecessorInvoiceIds.length
        || prior.some(invoice=>!request.predecessorInvoiceIds.includes(invoice.square_invoice_id)
          || invoice.closeout_id!==request.closeoutId || !['paid','canceled','failed'].includes(invoice.status))
        || (current && (current.currency!=='USD' || current.closeout_id!==request.closeoutId || current.quote_revision_id!==request.quoteId
          || Math.round(Number(current.amount)*100)!==request.amountCents || !['draft','sent'].includes(current.status)))) {
      throw new Error('Replacement basis requires reconciliation');
    }
    const totals=(await client.query(JOB_PAYMENT_TOTALS_SQL,[request.leadId])).rows[0];
    const own=current ? Number((await client.query(`SELECT COALESCE(SUM(amount_cents),0)::text AS paid FROM job_confirmed_payments
      WHERE lead_id=$1 AND metadata->>'squareOrderId'=$2 AND provider IN ('square:production','square:sandbox')`,
    [request.leadId,current.square_order_id])).rows[0].paid) : 0;
    const paid=Number(totals.paid);
    if (!Number.isSafeInteger(paid) || !Number.isSafeInteger(own) || paid<0 || own<0 || own>paid || own>=request.amountCents
        || Number(totals.refund_count)!==0 || request.totalCents-paid+own!==request.amountCents) {
      throw new Error('Replacement funding requires reconciliation');
    }
    if (current?.status==='sent' && current.invoice_url) published={squareInvoiceId:current.square_invoice_id,invoiceUrl:current.invoice_url};
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally {client.release();}
  if (!published) {
    let api=dependencies;
    if (!api) {
      const {storage}=await import('../storage');
      const {squareInvoiceService}=await import('./square-invoice');
      api={getLead:storage.getLead.bind(storage),createInvoice:squareInvoiceService.createInvoiceForLead.bind(squareInvoiceService)};
    }
    const lead=await api.getLead(request.leadId);
    if (!lead) throw new Error('Replacement job not found');
    published=await api.createInvoice(lead,request.amountCents/100,'Final balance after payment reconciliation',request.dueDate,'none',
      {purpose:'final_balance',closeoutId:request.closeoutId,quoteRevisionId:request.quoteId,idempotencyKey:request.requestKey});
  }
  return attachCanonicalFinalInvoice({leadId:request.leadId,closeoutId:request.closeoutId,quoteId:request.quoteId,
    invoiceId:published.squareInvoiceId,invoiceUrl:published.invoiceUrl,balanceDue:request.amountCents/100,replacementRequestKey:request.requestKey});
}

export async function resumePendingReplacement(leadId:string) {
  if (!replacementIssuanceEnabled()) return false;
  const pending=(await pool.query('SELECT request_key FROM job_invoice_replacements WHERE lead_id=$1 AND attached_invoice_id IS NULL',[leadId])).rows;
  if (!pending.length) return false;
  if (pending.length!==1) throw new Error('Multiple replacement requests require review');
  await issueCanonicalReplacement(pending[0].request_key);
  return true;
}
