import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { JOB_PAYMENT_TOTALS_SQL } from './jobPaymentLedger';
import { enqueueJobReward } from './jobRewardQueue';
import { queuePaidCloseoutNotice } from './jobFinancialNotifications';

/** Called only after the closeout's customer token/email authorization. */
export async function approveCanonicalCloseout(closeoutId: string) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true') throw new Error('Canonical closeout approval is disabled');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobs = await client.query(`SELECT id,total_price,status FROM leads
      WHERE id=(SELECT lead_id FROM job_closeouts WHERE id=$1) FOR UPDATE`, [closeoutId]);
    const job = jobs.rows[0];
    if (!job) throw new Error('Closeout job not found');
    const closeouts = await client.query('SELECT * FROM job_closeouts WHERE id=$1 FOR UPDATE', [closeoutId]);
    const closeout = closeouts.rows[0];
    const resuming = closeout?.status === 'approved';
    if (closeout?.lead_id !== job.id || !['awaiting_customer','approved'].includes(closeout.status)) throw new Error('Closeout is not awaiting customer approval');
    const cents = (value: unknown) => Math.round(Number(value) * 100);
    const finalCents = cents(closeout.calculated_final_total), expectedBalance = cents(closeout.balance_due);
    if (!Number.isSafeInteger(finalCents) || finalCents <= 0 || !Number.isSafeInteger(expectedBalance) || expectedBalance < 0) {
      throw new Error('Closeout final total requires reconciliation');
    }
    const sums = (await client.query(JOB_PAYMENT_TOTALS_SQL, [job.id])).rows[0];
    const paid = Number(sums.paid);
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > finalCents || Number(sums.refund_count) !== 0
        || finalCents - paid !== expectedBalance) throw new Error('Closeout payment coverage requires reconciliation');
    const quotes = await client.query(`SELECT * FROM quote_revisions WHERE lead_id=$1
      AND status IN ('approved','sent') AND approved_at IS NOT NULL ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [job.id]);
    const source = quotes.rows[0];
    const snapshot = closeout.pricing_snapshot || {};
    if (!source || source.currency !== 'USD'
        || ![snapshot.quoteRevisionId, snapshot.finalQuoteRevisionId].includes(source.id)) throw new Error('Closeout approved quote has changed');
    if (![cents(source.customer_total), finalCents].includes(cents(job.total_price))) {
      throw new Error('Closeout job total changed; reconciliation required');
    }
    const newer = await client.query("SELECT id FROM quote_revisions WHERE lead_id=$1 AND revision>$2 AND status='draft' LIMIT 1", [job.id, source.revision]);
    if (newer.rows.length) throw new Error('Closeout has a newer quote awaiting review');
    if (resuming) {
      if (!closeout.customer_approved_at || snapshot.finalQuoteRevisionId !== source.id
          || cents(source.customer_total) !== finalCents || cents(job.total_price) !== finalCents
          || expectedBalance <= 0 || typeof snapshot.invoiceDueDate !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.invoiceDueDate)) {
        throw new Error('Recorded closeout approval requires reconciliation');
      }
      // A timeout after approval or provider submission does not authorize a
      // new approval, quote, due date or provider request identity.
      await client.query('COMMIT');
      return { quoteRevisionId:source.id as string,balanceDue:expectedBalance/100,
        invoiceDueDate:snapshot.invoiceDueDate,invoiceRequestKey:`closeout:${closeoutId}:${source.id}` };
    }
    let quoteRevisionId = source.id as string;
    if (cents(source.customer_total) !== finalCents) {
      quoteRevisionId = randomUUID();
      const revision = Number((await client.query('SELECT MAX(revision) AS revision FROM quote_revisions WHERE lead_id=$1', [job.id])).rows[0].revision) + 1;
      await client.query(`INSERT INTO quote_revisions(id,lead_id,booking_id,revision,status,pricing_version_id,
        pricing_version_code,currency,line_items,pricing_adjustments,travel_eligibility,route_evidence,
        subtotal,discount_total,final_pre_tax_total,customer_total,notes,approved_at)
        SELECT $2,lead_id,booking_id,$3,'approved',pricing_version_id,pricing_version_code,'USD',$4::jsonb,
        pricing_adjustments,travel_eligibility,route_evidence || $5::jsonb,$6,0,$6,$6,
        'Customer-approved job closeout',NOW() FROM quote_revisions WHERE id=$1`,
      [source.id, quoteRevisionId, revision, JSON.stringify([{ id: closeoutId, name: 'Approved job closeout',
        quantity: 1, unitPrice: finalCents / 100, total: finalCents / 100, metadata: { closeoutId, sourceQuoteRevisionId: source.id } }]),
      JSON.stringify({ closeoutId, sourceQuoteRevisionId: source.id, approvalSource: 'customer_closeout' }), (finalCents / 100).toFixed(2)]);
      await client.query(`UPDATE quote_revisions SET status='superseded',superseded_by_quote_id=$2,updated_at=NOW()
        WHERE lead_id=$1 AND id<>$2 AND status IN ('approved','sent')`, [job.id, quoteRevisionId]);
    }
    const invoiceDueDate = typeof snapshot.invoiceDueDate === 'string' ? snapshot.invoiceDueDate
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await client.query('UPDATE leads SET total_price=$2,last_quote_updated_at=NOW() WHERE id=$1', [job.id, (finalCents / 100).toFixed(2)]);
    await client.query(`UPDATE job_closeouts SET status=$2,customer_approved_at=COALESCE(customer_approved_at,NOW()),
      pricing_snapshot=pricing_snapshot || jsonb_build_object('finalQuoteRevisionId',$3::text,'invoiceDueDate',$4::text),updated_at=NOW() WHERE id=$1`,
    [closeoutId, expectedBalance === 0 ? 'paid' : 'approved', quoteRevisionId, invoiceDueDate]);
    if (expectedBalance === 0) {
      await client.query(`UPDATE leads SET closeout_status='paid',financial_status='paid',
        payment_paid_at=COALESCE(payment_paid_at,$2::timestamptz) WHERE id=$1`, [job.id, sums.settled_at]);
      if (job.status === 'completed') await enqueueJobReward(client, job.id);
      await queuePaidCloseoutNotice(client,{leadId:job.id,closeoutId,quoteId:quoteRevisionId,totalCents:finalCents});
    }
    await client.query('COMMIT');
    return { quoteRevisionId, balanceDue: expectedBalance / 100, invoiceDueDate,
      invoiceRequestKey: `closeout:${closeoutId}:${quoteRevisionId}` };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
