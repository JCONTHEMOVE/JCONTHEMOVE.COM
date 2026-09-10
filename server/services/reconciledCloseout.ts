import { pool } from '../db';
import { JOB_PAYMENT_TOTALS_SQL } from './jobPaymentLedger';
import { authorizeReplacementAttachment, reserveCanonicalReplacement, type CanonicalReplacementRequest } from './canonicalInvoiceReplacement';
import { enqueueJobReward } from './jobRewardQueue';
import { queuePaidCloseoutNotice, queueFinalInvoiceNotice } from './jobFinancialNotifications';
import { finishJobInvoiceReconciliation, invoiceReconciliationWorkerEnabled, type InvoiceReconciliationClaim } from './jobInvoiceReconciliationQueue';

export type ReconciledInvoiceEvidence = {
  id: string; orderId: string; amountCents: number; quoteId: string; closeoutId: string; status: string;
};

/** Commit financial closeout and completion of this queue generation together.
 * Provider evidence comes only from the internal reconciliation worker. */
export async function finishReconciledCloseout(claim: InvoiceReconciliationClaim, input: {
  quoteId: string; totalCents: number; invoices: ReconciledInvoiceEvidence[];
}) {
  if (!invoiceReconciliationWorkerEnabled()) throw new Error('Invoice reconciliation is disabled');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT total_price,status FROM leads WHERE id=$1 FOR UPDATE', [claim.lead_id])).rows[0];
    const closeout = (await client.query('SELECT * FROM job_closeouts WHERE lead_id=$1 FOR UPDATE', [claim.lead_id])).rows[0];
    const quote = (await client.query(`SELECT id,customer_total,currency FROM quote_revisions WHERE lead_id=$1
      AND approved_at IS NOT NULL AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1 FOR SHARE`, [claim.lead_id])).rows[0];
    const total = Math.round(Number(quote?.customer_total) * 100);
    if (!job || quote?.id !== input.quoteId || quote.currency !== 'USD' || !Number.isSafeInteger(total) || total<=0 || total !== input.totalCents
        || Math.round(Number(job.total_price) * 100) !== total) throw new Error('Reconciled quote changed');
    const invoices = (await client.query(`SELECT square_invoice_id,square_order_id,amount,currency,quote_revision_id,closeout_id
      FROM square_invoices WHERE lead_id=$1 AND purpose='final_balance' FOR SHARE`, [claim.lead_id])).rows;
    if (invoices.length !== input.invoices.length || new Set(input.invoices.map(invoice=>invoice.id)).size !== invoices.length) {
      throw new Error('Invoice set changed during reconciliation');
    }
    for (const invoice of invoices) {
      const evidence = input.invoices.find(item=>item.id===invoice.square_invoice_id);
      if (!evidence || evidence.orderId !== invoice.square_order_id || evidence.amountCents !== Math.round(Number(invoice.amount)*100)
          || invoice.currency !== 'USD' || evidence.quoteId !== invoice.quote_revision_id || evidence.closeoutId !== invoice.closeout_id) {
        throw new Error('Invoice binding changed during reconciliation');
      }
    }
    // Lock after invoice rows: publication acknowledgement updates invoice then queue.
    const lease = (await client.query(`SELECT lead_id FROM job_invoice_reconciliation_queue WHERE lead_id=$1
      AND lease_token=$2 AND generation=$3::bigint AND status='processing' AND lease_expires_at>NOW() FOR UPDATE`,
    [claim.lead_id,claim.lease_token,claim.generation])).rows[0];
    if (!lease) throw new Error('Reconciliation claim changed');
    const sums = (await client.query(JOB_PAYMENT_TOTALS_SQL,[claim.lead_id])).rows[0];
    const paid = Number(sums.paid);
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > total || Number(sums.refund_count)!==0) throw new Error('Payment coverage requires review');
    let closed = false;
    let needsReplacement = false;
    let replacementRequest: CanonicalReplacementRequest | undefined;
    if (paid < total && closeout
        && (input.invoices.length > 0 || closeout.customer_approved_at || ['approved','balance_due'].includes(closeout.status))
        && input.invoices.every(invoice=>['PAID','CANCELED','FAILED'].includes(invoice.status))) {
      if (job.status !== 'completed' || !closeout.customer_approved_at || !['approved','balance_due'].includes(closeout.status)
          || closeout.pricing_snapshot?.finalQuoteRevisionId !== quote.id
          || Math.round(Number(closeout.calculated_final_total)*100)!==total) {
        throw new Error('Replacement invoice basis requires review');
      }
      const balance = (total-paid)/100;
      // Retain the old invoice binding for audit/replacement coordination, but
      // never present its canceled payment link as a way to pay this remainder.
      // Without a local invoice, preserve approved status so the authorized
      // customer retry can resume its existing provider request identity.
      await client.query("UPDATE job_closeouts SET status=$3,balance_due=$2,updated_at=NOW() WHERE id=$1",
        [closeout.id,balance,input.invoices.length ? 'balance_due' : closeout.status]);
      if (input.invoices.length) replacementRequest=await reserveCanonicalReplacement(client,{
        leadId:claim.lead_id,closeoutId:closeout.id,quoteId:quote.id,totalCents:total,paidCents:paid,
        dueDate:closeout.pricing_snapshot?.invoiceDueDate,previousInvoiceId:closeout.square_invoice_id || null,
        invoices:input.invoices,
      });
      await client.query(`UPDATE leads SET closeout_status='balance_due',financial_status='balance_due',
        final_balance_amount=$2,final_invoice_url=NULL WHERE id=$1`,[claim.lead_id,balance]);
      needsReplacement = true;
    }
    if (paid === total && closeout) {
      if (job.status !== 'completed' || !closeout.customer_approved_at || !['approved','balance_due','paid'].includes(closeout.status)
          || closeout.pricing_snapshot?.finalQuoteRevisionId !== quote.id
          || Math.round(Number(closeout.calculated_final_total)*100)!==total
          || input.invoices.some(invoice=>!['PAID','CANCELED','FAILED'].includes(invoice.status))) {
        throw new Error('Financial closeout is not ready');
      }
      await client.query("UPDATE job_closeouts SET status='paid',balance_due=0,updated_at=NOW() WHERE id=$1",[closeout.id]);
      await client.query(`UPDATE leads SET closeout_status='paid',financial_status='paid',final_balance_amount=0,
        final_invoice_url=NULL,payment_paid_at=COALESCE(payment_paid_at,$2::timestamptz) WHERE id=$1`,[claim.lead_id,sums.settled_at]);
      await enqueueJobReward(client,claim.lead_id);
      await queuePaidCloseoutNotice(client,{leadId:claim.lead_id,closeoutId:closeout.id,quoteId:quote.id,totalCents:total});
      closed = true;
    }
    if (!await finishJobInvoiceReconciliation(claim,!needsReplacement,client)) throw new Error('Reconciliation completion lost its claim');
    await client.query('COMMIT');
    return { closed, needsReplacement, replacementRequest };
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}

/** The original HTTP request may resume after the worker has finished payment.
 * Never attach its stale balance over the worker's paid result. */
export async function attachCanonicalFinalInvoice(input: {
  leadId: string; closeoutId: string; quoteId: string; invoiceId: string; invoiceUrl: string; balanceDue: number;
  replacementRequestKey?: string;
}) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED!=='true') throw new Error('Canonical payment ledger is disabled');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const job=(await client.query('SELECT total_price FROM leads WHERE id=$1 FOR UPDATE',[input.leadId])).rows[0];
    const closeout=(await client.query('SELECT * FROM job_closeouts WHERE id=$1 AND lead_id=$2 FOR UPDATE',[input.closeoutId,input.leadId])).rows[0];
    const quote=(await client.query(`SELECT id,customer_total,currency FROM quote_revisions WHERE lead_id=$1
      AND approved_at IS NOT NULL AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1 FOR SHARE`,[input.leadId])).rows[0];
    const invoice=(await client.query(`SELECT amount,currency,status,square_order_id FROM square_invoices WHERE square_invoice_id=$1
      AND lead_id=$2 AND closeout_id=$3 AND quote_revision_id=$4 FOR SHARE`,
    [input.invoiceId,input.leadId,input.closeoutId,input.quoteId])).rows[0];
    if (!job || !closeout?.customer_approved_at || closeout.pricing_snapshot?.finalQuoteRevisionId!==input.quoteId
        || !invoice || invoice.currency!=='USD' || Math.round(Number(invoice.amount)*100)!==Math.round(input.balanceDue*100)
        || quote?.id!==input.quoteId || quote.currency!=='USD'
        || !Number.isSafeInteger(Math.round(Number(quote.customer_total)*100)) || Number(quote.customer_total)<=0
        || Math.round(Number(closeout.calculated_final_total)*100)!==Math.round(Number(quote.customer_total)*100)
        || Math.round(Number(quote.customer_total)*100)!==Math.round(Number(job.total_price)*100)) throw new Error('Final invoice attachment requires reconciliation');
    if (input.replacementRequestKey) await authorizeReplacementAttachment(client,{
      requestKey:input.replacementRequestKey,leadId:input.leadId,closeoutId:input.closeoutId,quoteId:input.quoteId,
      invoiceId:input.invoiceId,orderId:invoice.square_order_id,amountCents:Math.round(input.balanceDue*100),
      currentInvoiceId:closeout.square_invoice_id || null,
    });
    else if (closeout.square_invoice_id && closeout.square_invoice_id!==input.invoiceId) throw new Error('Final invoice attachment requires reconciliation');
    if (closeout.status==='paid') {
      const sums=(await client.query(JOB_PAYMENT_TOTALS_SQL,[input.leadId])).rows[0];
      if (Number(sums.paid)!==Math.round(Number(job.total_price)*100) || Number(sums.refund_count)!==0) throw new Error('Paid closeout requires reconciliation');
      await client.query('COMMIT');
      return { status:'paid' as const };
    }
    if (!['approved','balance_due'].includes(closeout.status)) throw new Error('Closeout approval changed');
    if (!['draft','sent'].includes(invoice.status) || !Number.isFinite(input.balanceDue) || input.balanceDue<=0
        || Math.round(Number(closeout.balance_due)*100)!==Math.round(input.balanceDue*100)) throw new Error('Final invoice balance requires reconciliation');
    // Provider publication and this request can finish after another payment.
    // Payments on this invoice reduce its outstanding amount, whereas payments
    // on other orders reduce how much this invoice may collect in total.
    const sums=(await client.query(JOB_PAYMENT_TOTALS_SQL,[input.leadId])).rows[0];
    const own=(await client.query(`SELECT COALESCE(SUM(amount_cents),0)::text AS paid FROM job_confirmed_payments
      WHERE lead_id=$1 AND metadata->>'squareOrderId'=$2 AND provider IN ('square:production','square:sandbox')`,
    [input.leadId,invoice.square_order_id])).rows[0];
    const paid=Number(sums.paid), ownPaid=Number(own.paid), amount=Math.round(input.balanceDue*100);
    if (!invoice.square_order_id || !Number.isSafeInteger(paid) || paid<0 || !Number.isSafeInteger(ownPaid)
        || ownPaid<0 || ownPaid>=amount || ownPaid>paid || Number(sums.refund_count)!==0
        || Math.round(Number(quote.customer_total)*100)-paid+ownPaid!==amount) {
      throw new Error('Final invoice funding requires reconciliation');
    }
    await client.query("UPDATE job_closeouts SET status='balance_due',square_invoice_id=$2,updated_at=NOW() WHERE id=$1",[input.closeoutId,input.invoiceId]);
    await client.query("UPDATE leads SET closeout_status='balance_due',financial_status='balance_due',final_invoice_url=$2,final_balance_amount=$3 WHERE id=$1",
      [input.leadId,input.invoiceUrl,input.balanceDue]);
    await queueFinalInvoiceNotice(client,{...input,amountCents:Math.round(input.balanceDue*100)});
    if (input.replacementRequestKey) await client.query(`UPDATE job_invoice_replacements
      SET attached_invoice_id=$2,attached_at=COALESCE(attached_at,NOW()) WHERE request_key=$1`,[input.replacementRequestKey,input.invoiceId]);
    await client.query('COMMIT');
    return { status:'balance_due' as const };
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}
