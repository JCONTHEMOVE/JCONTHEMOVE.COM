import { pool } from '../db';
import { JOB_PAYMENT_TOTALS_SQL } from './jobPaymentLedger';
import { claimJobInvoiceReconciliation, finishJobInvoiceReconciliation, invoiceReconciliationWorkerEnabled,
  type InvoiceReconciliationClaim } from './jobInvoiceReconciliationQueue';
import { finishReconciledCloseout, type ReconciledInvoiceEvidence } from './reconciledCloseout';

type ProviderInvoice = { id: string; orderId: string; status: string; amountCents: number; currency: string; publicUrl?: string };
type Invoice = { square_invoice_id: string; square_order_id: string; amount: string; currency: string;
  quote_revision_id: string; closeout_id: string; status: string; order_paid: string; quote_valid: boolean };
export type InvoiceReconciliationProvider = {
  inspect(invoiceId: string, orderId: string): Promise<ProviderInvoice>;
  cancel(invoiceId: string): Promise<void>;
};

async function provider(): Promise<InvoiceReconciliationProvider> {
  const { getLedgerClient } = await import('./squareJobPaymentAdapter');
  const { client, locationId } = await getLedgerClient();
  const { SquareInvoiceService } = await import('./square-invoice');
  const service = new SquareInvoiceService({ getClient: async () => client });
  return {
    inspect: async (invoiceId, orderId) => {
      const invoice = (await client.invoices.get({ invoiceId }, { timeoutInSeconds: 10, maxRetries: 0 })).invoice;
      const order = (await client.orders.get({ orderId }, { timeoutInSeconds: 10, maxRetries: 0 })).order;
      if (invoice?.id !== invoiceId || invoice.orderId !== orderId || invoice.locationId !== locationId
          || order?.id !== orderId || order.locationId !== locationId || order.totalMoney?.currency !== 'USD'
          || (order.totalTipMoney && order.totalTipMoney.currency !== 'USD')) throw new Error('Provider binding mismatch');
      const total = Number(order.totalMoney.amount), tip = Number(order.totalTipMoney?.amount ?? 0);
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(tip) || tip < 0 || total <= tip) throw new Error('Invalid provider amount');
      return { id: invoiceId, orderId, status: invoice.status || '', amountCents: total - tip, currency: 'USD',publicUrl:invoice.publicUrl || undefined };
    },
    cancel: id => service.cancelInvoice(id),
  };
}

async function readBasis(claim: InvoiceReconciliationClaim) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT total_price FROM leads WHERE id=$1 FOR UPDATE', [claim.lead_id])).rows[0];
    const lease = (await client.query(`SELECT lead_id FROM job_invoice_reconciliation_queue
      WHERE lead_id=$1 AND lease_token=$2 AND generation=$3::bigint AND status='processing'
        AND lease_expires_at>NOW() FOR UPDATE`, [claim.lead_id, claim.lease_token, claim.generation])).rows[0];
    if (!job || !lease) throw new Error('Reconciliation claim changed');
    const quote = (await client.query(`SELECT id,customer_total,currency FROM quote_revisions
      WHERE lead_id=$1 AND approved_at IS NOT NULL AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1`, [claim.lead_id])).rows[0];
    const closeout = (await client.query('SELECT id,status,customer_approved_at,pricing_snapshot FROM job_closeouts WHERE lead_id=$1', [claim.lead_id])).rows[0];
    const total = Math.round(Number(quote?.customer_total) * 100);
    if (!quote || quote.currency !== 'USD' || !Number.isSafeInteger(total) || total <= 0
        || Math.round(Number(job.total_price) * 100) !== total) throw new Error('Quote requires review');
    const totals = (await client.query(JOB_PAYMENT_TOTALS_SQL, [claim.lead_id])).rows[0];
    const paid = Number(totals.paid);
    if (!Number.isSafeInteger(paid) || paid < 0 || Number(totals.refund_count) !== 0) throw new Error('Payments require review');
    const invoices = (await client.query<Invoice>(`SELECT i.square_invoice_id,i.square_order_id,i.amount,i.currency,
      i.quote_revision_id,i.closeout_id,i.status,
      EXISTS(SELECT 1 FROM quote_revisions q WHERE q.id=i.quote_revision_id AND q.lead_id=i.lead_id
        AND q.approved_at IS NOT NULL AND q.currency='USD' AND q.status IN ('approved','sent','superseded')) AS quote_valid,
      (SELECT COALESCE(SUM(p.amount_cents),0)::text FROM job_confirmed_payments p WHERE p.lead_id=i.lead_id
        AND p.metadata->>'squareOrderId'=i.square_order_id AND p.provider IN ('square:production','square:sandbox')) AS order_paid
      FROM square_invoices i WHERE i.lead_id=$1 AND i.purpose='final_balance' ORDER BY i.square_invoice_id`, [claim.lead_id])).rows;
    if (invoices.length && (!closeout?.customer_approved_at || !['approved','balance_due','paid'].includes(closeout.status)
        || closeout.pricing_snapshot?.finalQuoteRevisionId !== quote.id)) throw new Error('Closeout requires review');
    const orders = new Set<string>();
    for (const invoice of invoices) {
      if (!invoice.square_invoice_id || !invoice.square_order_id || orders.has(invoice.square_order_id)
          || invoice.currency !== 'USD' || !invoice.quote_valid || invoice.closeout_id !== closeout.id) throw new Error('Invoice binding requires review');
      orders.add(invoice.square_order_id);
    }
    await client.query('COMMIT');
    return { total, paid, quoteId: quote.id as string, invoices };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Reconcile collection and already-approved financial closeout. Replacement
 * issuance has an additional opt-in gate. No HTTP runs under a DB lock; this
 * worker does not issue refunds, deliver notices or settle rewards. */
export async function processOneJobInvoiceReconciliation(injectedProvider?: InvoiceReconciliationProvider) {
  if (!invoiceReconciliationWorkerEnabled()) return { status: 'disabled' as const };
  const claim = await claimJobInvoiceReconciliation();
  if (!claim) return { status: 'idle' as const };
  let complete = true;
  const canceled: string[] = [];
  try {
    const initial = await readBasis(claim);
    const api = initial.invoices.length ? injectedProvider || await provider() : null;
    let collectible = 0;
    const evidence: ReconciledInvoiceEvidence[] = [];
    for (const original of initial.invoices) {
      const remote = await api!.inspect(original.square_invoice_id, original.square_order_id);
      // Provider inspection can take time. Recheck the claim and all financial
      // inputs after that await, before deciding on an external cancellation.
      const basis = await readBasis(claim);
      const invoice = basis.invoices.find(row => row.square_invoice_id === original.square_invoice_id);
      if (!invoice) throw new Error('Invoice changed during reconciliation');
      const amount = Math.round(Number(invoice.amount) * 100), ownPaid = Number(invoice.order_paid);
      if (remote.id !== invoice.square_invoice_id || remote.orderId !== invoice.square_order_id
          || remote.currency !== 'USD' || remote.amountCents !== amount || !Number.isSafeInteger(amount) || amount <= 0
          || !Number.isSafeInteger(ownPaid) || ownPaid < 0 || ownPaid > basis.paid) throw new Error('Invoice amount requires review');
      const observed = { id:invoice.square_invoice_id,orderId:invoice.square_order_id,amountCents:amount,
        quoteId:invoice.quote_revision_id,closeoutId:invoice.closeout_id,status:remote.status };
      evidence.push(observed);
      if (remote.status === 'CANCELED') {
        if (invoice.status !== 'canceled') await api!.cancel(invoice.square_invoice_id);
        continue;
      }
      if (remote.status === 'FAILED') continue;
      if (remote.status === 'PAID') { if (ownPaid !== amount) complete = false; continue; }
      if (!['UNPAID','SCHEDULED','PARTIALLY_PAID'].includes(remote.status)) { complete = false; continue; }
      // A publish response may have been lost while the provider invoice is
      // already collectible. Persist its verified URL/status instead of
      // relying on another publication request to recover acknowledgement.
      if (invoice.status==='draft' && remote.publicUrl) {
        const {recordSquareInvoicePublication}=await import('./squareInvoicePublication');
        await recordSquareInvoicePublication({squareInvoiceId:invoice.square_invoice_id,invoiceUrl:remote.publicUrl});
        // Publication advances the queue generation. Stop this claim and let
        // a fresh one recheck the new local state before attachment/cancel.
        await finishJobInvoiceReconciliation(claim,false);
        return {status:'retry' as const,canceled,publicationRecovered:true};
      }
      const availableForInvoice = Math.max(0, basis.total - (basis.paid - ownPaid));
      if (amount > availableForInvoice || invoice.quote_revision_id !== basis.quoteId) {
        await api!.cancel(invoice.square_invoice_id);
        observed.status = 'CANCELED';
        canceled.push(invoice.square_invoice_id);
      } else {
        collectible++;
        if (ownPaid >= amount || (remote.status === 'PARTIALLY_PAID' && ownPaid === 0)) complete = false;
      }
      if (basis.paid > basis.total) complete = false;
    }
    // Multiple live final invoices or an overpayment still need review, even
    // when none individually exceeds the remaining approved amount.
    if (collectible > 1 || initial.paid > initial.total) complete = false;
    if (!complete) {
      await finishJobInvoiceReconciliation(claim,false);
      const {resumePendingReplacement}=await import('./canonicalReplacementIssuance');
      if (await resumePendingReplacement(claim.lead_id)) return {status:'retry' as const,canceled,replacementIssued:true};
      return { status:'retry' as const,canceled };
    }
    const result = await finishReconciledCloseout(claim,{quoteId:initial.quoteId,totalCents:initial.total,invoices:evidence});
    if (!result.closed && result.pendingReplacement) {
      const {resumePendingReplacement}=await import('./canonicalReplacementIssuance');
      if (await resumePendingReplacement(claim.lead_id)) return {status:'retry' as const,canceled,replacementIssued:true};
    }
    if (result.needsReplacement) return { status:'retry' as const,canceled,needsReplacement:true };
    if (result.pendingReplacement) return {status:'retry' as const,canceled};
    return { status:'done' as const,canceled,closeoutPaid:result.closed };
  } catch {
    await finishJobInvoiceReconciliation(claim, false);
    return { status: 'retry' as const, canceled };
  }
}
