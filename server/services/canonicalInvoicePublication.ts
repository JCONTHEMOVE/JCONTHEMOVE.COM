import { pool } from '../db';
import { JOB_PAYMENT_TOTALS_SQL } from './jobPaymentLedger';

/** Revalidate immediately before publication. This does not cover a provider
 * payment arriving after this transaction; postpublication reconciliation is
 * still required before canonical payments can be enabled. */
export async function assertCanonicalFinalInvoicePublication(input: {
  leadId: string; closeoutId?: string | null; quoteRevisionId?: string | null; amount: number;
}) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') throw new Error('Canonical payment ledger is disabled');
  const amountCents = Math.round(input.amount * 100);
  if (!input.closeoutId || !input.quoteRevisionId || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error('Final invoice requires an approved closeout and positive amount');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT total_price FROM leads WHERE id=$1 FOR UPDATE', [input.leadId])).rows[0];
    const closeout = (await client.query('SELECT * FROM job_closeouts WHERE id=$1 AND lead_id=$2 FOR UPDATE',
      [input.closeoutId, input.leadId])).rows[0];
    const quote = (await client.query(`SELECT id,customer_total,currency FROM quote_revisions
      WHERE lead_id=$1 AND status IN ('approved','sent') AND approved_at IS NOT NULL
      ORDER BY revision DESC LIMIT 1 FOR SHARE`, [input.leadId])).rows[0];
    const cents = (value: unknown) => Math.round(Number(value) * 100);
    const total = cents(quote?.customer_total);
    if (!job || !closeout || !['approved','balance_due'].includes(closeout.status)
        || !closeout.customer_approved_at || quote?.id !== input.quoteRevisionId || quote.currency !== 'USD'
        || closeout.pricing_snapshot?.finalQuoteRevisionId !== input.quoteRevisionId
        || !Number.isSafeInteger(total) || total <= 0 || cents(job.total_price) !== total
        || cents(closeout.calculated_final_total) !== total) {
      throw new Error('Final invoice approval changed; reconciliation required before publication');
    }
    const sums = (await client.query(JOB_PAYMENT_TOTALS_SQL, [input.leadId])).rows[0];
    const paid = Number(sums.paid), refunds = Number(sums.refund_count);
    if (!Number.isSafeInteger(paid) || paid < 0 || !Number.isSafeInteger(refunds) || refunds !== 0
        || Math.max(0, total - paid) !== amountCents || cents(closeout.balance_due) !== amountCents) {
      throw new Error('Final invoice payment coverage changed; reconciliation required before publication');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
