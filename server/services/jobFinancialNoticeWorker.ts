import { pool } from '../db';
import { JOB_PAYMENT_TOTALS_SQL } from './jobPaymentLedger';
import { acknowledgeFinancialNoticeAttempt, claimFinancialNotice, financialNoticeDeliveryEnabled,
  reserveFinancialNoticeAttempt, type FinancialNoticeAttempt, type FinancialNoticeClaim } from './jobFinancialNoticeDelivery';

type Channel = 'email' | 'sms';
type Outcome = 'sent' | 'skipped' | 'retry' | 'review' | 'suppressed' | 'stale';
type Message = { destination: string; title: string; message: string; url: string };
export interface FinancialNoticeProvider {
  available(channel: Channel): Promise<boolean>;
  send(channel: Channel, message: Message): Promise<{ sent: boolean; providerReference?: string }>;
}
type Prepared = { status: Outcome } | { status: 'ready'; attempt: FinancialNoticeAttempt; message: Message };

const portalUrl = () => {
  const url = new URL('/my-jobs', process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://www.jconthemove.com');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Financial notice portal requires HTTPS');
  return url.href;
};
const cents = (value: unknown) => Math.round(Number(value) * 100);
const emailFrom = () => process.env.FROM_EMAIL || process.env.COMPANY_EMAIL || process.env.GMAIL_USER || '';

/** Recheck and reserve on the same connection. Provider HTTP happens only after
 * commit. Job locks precede outbox locks, matching the financial producers. */
async function prepare(claim: FinancialNoticeClaim, channel: Channel, available: boolean): Promise<Prepared> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [claim.lead_id])).rows[0];
    const closeout = (await client.query('SELECT * FROM job_closeouts WHERE id=$1 AND lead_id=$2 FOR UPDATE',
      [claim.closeout_id, claim.lead_id])).rows[0];
    const quote = (await client.query(`SELECT * FROM quote_revisions WHERE lead_id=$1 AND approved_at IS NOT NULL
      AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1 FOR SHARE`, [claim.lead_id])).rows[0];
    const invoices = (await client.query(`SELECT * FROM square_invoices WHERE lead_id=$1 AND purpose='final_balance' FOR SHARE`,
      [claim.lead_id])).rows;
    const row = (await client.query(`SELECT * FROM job_financial_notifications WHERE event_key=$1
      AND lease_token=$2 AND status='processing' AND lease_expires_at>clock_timestamp() FOR UPDATE`,
      [claim.event_key, claim.lease_token])).rows[0];
    if (!row) { await client.query('COMMIT'); return { status: 'stale' }; }
    const finish = async (status: 'review' | 'suppressed') => {
      if (status === 'review') { await client.query('COMMIT'); return { status }; }
      await client.query(`UPDATE job_financial_notifications SET status=$2,lease_token=NULL,lease_expires_at=NULL,
        last_failure_code=$3,updated_at=NOW() WHERE event_key=$1`,
        [row.event_key, status, 'financial_notice_outdated']);
      await client.query('COMMIT');
      return { status };
    };
    if (row.lead_id !== claim.lead_id || row.closeout_id !== claim.closeout_id || !job || !closeout || !quote) return await finish('review');
    const payload = row.payload;
    const total = cents(quote.customer_total);
    const sums = (await client.query(JOB_PAYMENT_TOTALS_SQL, [claim.lead_id])).rows[0];
    const paid = Number(sums.paid);
    if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(paid) || paid < 0 || paid > total
      || Number(sums.refund_count) !== 0 || quote.currency !== 'USD') return await finish('review');
    if (quote.id !== payload.quoteId || cents(job.total_price) !== total || cents(closeout.calculated_final_total) !== total
      || closeout.pricing_snapshot?.finalQuoteRevisionId !== quote.id || !closeout.customer_approved_at
      || job.status !== 'completed') return await finish('suppressed');
    if (row.kind === 'final_payment_received') {
      if (payload.totalCents !== total || paid !== total || closeout.status !== 'paid' || job.financial_status !== 'paid'
        || cents(closeout.balance_due) !== 0 || cents(job.final_balance_amount) !== 0) return await finish('suppressed');
    } else if (row.kind === 'final_invoice_sent') {
      const invoice = invoices.find(item => item.square_invoice_id === payload.invoiceId);
      if (paid >= total || closeout.status !== 'balance_due' || job.financial_status !== 'balance_due'
        || cents(closeout.balance_due) !== total - paid || cents(job.final_balance_amount) !== total - paid
        || payload.amountCents !== total - paid || closeout.square_invoice_id !== payload.invoiceId
        || !invoice || invoice.quote_revision_id !== quote.id || invoice.closeout_id !== closeout.id
        || invoice.currency !== 'USD' || cents(invoice.amount) !== payload.amountCents || invoice.status !== 'sent'
        || invoices.filter(item => ['draft','sent'].includes(item.status)).length !== 1) return await finish('suppressed');
    } else return await finish('review');

    // Ownership distinguishes our durable portal event from legacy inline sends,
    // which could have reached a provider before recording delivery history.
    let event = (await client.query('SELECT * FROM customer_job_events WHERE event_key=$1 FOR UPDATE', [row.event_key])).rows[0];
    if (event && (event.lead_id !== row.lead_id || event.event_type !== row.kind)) return await finish('review');
    if (event && event.payload?.financialNoticeOwner !== row.event_key) {
      const history = (await client.query(`SELECT status FROM customer_notification_deliveries WHERE event_id=$1 AND channel=$2`,
        [event.id, channel])).rows;
      if (history.length === 1 && history[0].status === 'sent') {
        await client.query('COMMIT'); return { status: 'sent' };
      }
      return await finish('review');
    }
    const title = row.kind === 'final_invoice_sent' ? 'Your final invoice is available' : 'Your payment is recorded';
    // Do not embed a stale dollar amount or reusable provider payment link.
    const message = row.kind === 'final_invoice_sent'
      ? 'Your final invoice is available. Check your job for the current balance before paying.'
      : 'Payment has been recorded for your job. View your job for the current payment status.';
    if (!event) {
      event = (await client.query(`INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`, [row.lead_id, row.kind, row.event_key, title, message,
        JSON.stringify({ financialNoticeOwner: row.event_key, quoteId: quote.id })])).rows[0];
    }
    const previous = (await client.query(`SELECT status FROM job_financial_notice_attempts WHERE event_key=$1 AND channel=$2`,
      [row.event_key, channel])).rows[0];
    if (previous) {
      await client.query('COMMIT');
      return { status: previous.status === 'sent' ? 'sent' : 'review' };
    }
    const destination = String(channel === 'email' ? job.email || '' : job.phone || '').trim();
    if (channel === 'sms' && job.sms_consent !== true || !destination) {
      await client.query('COMMIT'); return { status: 'skipped' };
    }
    const valid = channel === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)
      : /^(?:\+?[1-9]\d{7,14})$/.test(destination.replace(/[\s().-]/g, ''));
    if (!valid) return await finish('review');
    if (!available) { await client.query('COMMIT'); return { status: 'retry' }; }
    const url = portalUrl();
    const attempt = await reserveFinancialNoticeAttempt(client, claim, channel, destination);
    if (!attempt) { await client.query('COMMIT'); return { status: 'stale' }; }
    await client.query('COMMIT');
    return { status: 'ready', attempt, message: { destination, title, message, url } };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

const defaultProvider: FinancialNoticeProvider = {
  async available(channel) {
    if (channel === 'email') return Boolean(emailFrom()) && (await import('./gmail')).isGmailAvailable();
    return (await import('./sms')).smsService.initialize();
  },
  async send(channel, input) {
    const text = `${input.message}\n\nView your job: ${input.url}`;
    if (channel === 'email') {
      const { sendGmailEmail } = await import('./gmail');
      // Direct Gmail only: an ambiguous result must not fall back to SendGrid.
      const sent = await sendGmailEmail({ to: input.destination, from: emailFrom(), subject: `${input.title} | JC ON THE MOVE`, text });
      return { sent };
    }
    const result = await (await import('./sms')).smsService.sendSMS(input.destination, `${input.title}: ${text}`);
    return { sent: result.success, providerReference: result.messageSid };
  },
};

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Financial notice provider timed out')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function processOneFinancialNotice(provider: FinancialNoticeProvider = defaultProvider) {
  if (!financialNoticeDeliveryEnabled()) return { status: 'disabled' };
  const claim = await claimFinancialNotice();
  if (!claim) return { status: 'idle' };
  let outcome: Outcome = 'sent';
  try {
    for (const channel of ['email','sms'] as const) {
      const available = await bounded(provider.available(channel), 10_000).catch(() => false);
      const prepared = await prepare(claim, channel, available);
      if (prepared.status === 'suppressed' || prepared.status === 'stale') return { status: prepared.status };
      if (prepared.status === 'review') { outcome = 'review'; break; }
      if (prepared.status === 'retry') { outcome = 'retry'; continue; }
      if (prepared.status !== 'ready') continue;
      // Timeout does not prove the provider stopped. The durable attempt enters
      // review even if that request eventually succeeds after this worker moves on.
      const result = await bounded(provider.send(channel, prepared.message), 60_000).catch(() => ({ sent: false }));
      if (!await acknowledgeFinancialNoticeAttempt(prepared.attempt, result) || !result.sent) { outcome = 'review'; break; }
    }
  } catch {
    // The send barrier survives an acknowledgement or COMMIT failure. Recovery
    // examines it before authorizing another attempt, regardless of this retry.
    outcome = 'retry';
  }
  const result = await pool.query(`UPDATE job_financial_notifications SET status=$3,
    next_attempt_at=NOW()+INTERVAL '5 minutes',lease_token=NULL,lease_expires_at=NULL,
    last_failure_code=CASE WHEN $3='sent' THEN NULL ELSE 'financial_notice_incomplete' END,updated_at=NOW()
    WHERE event_key=$1 AND lease_token=$2 AND status='processing' RETURNING event_key`,
    [claim.event_key, claim.lease_token, outcome]);
  return { status: result.rows.length ? outcome : 'stale' };
}
