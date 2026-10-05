import assert from 'node:assert/strict';
import { pool } from '../server/db';
import { JOB_FINANCIAL_NOTIFICATIONS_SCHEMA, queueFinalInvoiceNotice, queuePaidCloseoutNotice } from '../server/services/jobFinancialNotifications';
import { processOneFinancialNotice, type FinancialNoticeProvider } from '../server/services/jobFinancialNoticeWorker';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousQuery = pool.query, previousConnect = pool.connect, previousFetch = globalThis.fetch;
const flags = ['JOB_PAYMENT_LEDGER_ENABLED','JOB_FINANCIAL_NOTIFICATIONS_ENABLED','PUBLIC_APP_URL','APP_URL'] as const;
const previous = flags.map(flag => process.env[flag]);
let failAcknowledgement = false, loseReservationCommit = false, reservationWritten = false;
pool.query = (async (sql: string, args?: unknown[]) => {
  if (failAcknowledgement && sql.includes('provider_reference=COALESCE')) throw new Error('Lost acknowledgement');
  const result = await database.query(sql, args);
  if (sql.includes('INSERT INTO job_financial_notice_attempts')) reservationWritten = true;
  if (sql === 'COMMIT' && loseReservationCommit && reservationWritten) {
    loseReservationCommit = false; reservationWritten = false; throw new Error('Lost reservation commit');
  }
  return result;
}) as typeof pool.query;
pool.connect = (async () => ({ query: pool.query, release() {} })) as typeof pool.connect;
globalThis.fetch = async () => { throw new Error('No live sends in notification tests'); };
process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED = 'true';
process.env.PUBLIC_APP_URL = 'https://example.invalid';
type SentMessage = Parameters<FinancialNoticeProvider['send']>[1];
let sent: { channel: string; input: SentMessage }[] = [];
let afterSend: (() => Promise<void>) | undefined;
let sendSuccess = true, available = true;
let smsAvailable = true;
const provider: FinancialNoticeProvider = {
  async available(channel) { return available && (channel !== 'sms' || smsAvailable); },
  async send(channel, input) {
    sent.push({ channel, input }); await afterSend?.();
    return { sent: sendSuccess, providerReference: 'test-receipt' };
  },
};
const status = async () => (await database.query('SELECT status FROM job_financial_notifications')).rows[0].status;
async function reset(paid = false) {
  await database.exec(`DELETE FROM job_financial_notice_attempts; DELETE FROM job_financial_notifications;
    DELETE FROM customer_notification_deliveries; DELETE FROM customer_job_events;
    DELETE FROM job_confirmed_refunds;
    UPDATE job_confirmed_payments SET amount_cents=3000;
    UPDATE leads SET status='completed',financial_status='balance_due',final_balance_amount=90,sms_consent=true,email='customer@example.invalid';
    UPDATE job_closeouts SET status='balance_due',balance_due=90;
    UPDATE quote_revisions SET customer_total=120;
    UPDATE square_invoices SET status='sent';`);
  if (paid) await database.exec(`UPDATE job_confirmed_payments SET amount_cents=12000;
    UPDATE leads SET financial_status='paid',final_balance_amount=0;
    UPDATE job_closeouts SET status='paid',balance_due=0; UPDATE square_invoices SET status='paid';`);
  const client = await pool.connect();
  if (paid) await queuePaidCloseoutNotice(client, { leadId:'job',closeoutId:'closeout',quoteId:'quote',totalCents:12000 });
  else await queueFinalInvoiceNotice(client, { leadId:'job',closeoutId:'closeout',quoteId:'quote',invoiceId:'invoice',invoiceUrl:'https://example.invalid/pay',amountCents:9000 });
  client.release();
  sent=[]; afterSend=undefined; sendSuccess=true; available=true; smsAvailable=true;
  failAcknowledgement=false; loseReservationCommit=false; reservationWritten=false;
}
const retryNow = () => database.exec("UPDATE job_financial_notifications SET next_attempt_at=NOW()");
try {
  await database.exec(`CREATE TABLE leads(id varchar PRIMARY KEY,total_price numeric,status text,financial_status text,
      final_balance_amount numeric,email text,phone text,sms_consent boolean);
    INSERT INTO leads VALUES('job',120,'completed','balance_due',90,'customer@example.invalid','+15555550100',true);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY,lead_id varchar,revision integer,status text,approved_at timestamptz,customer_total numeric,currency text);
    INSERT INTO quote_revisions VALUES('quote','job',1,'approved',NOW(),120,'USD');
    CREATE TABLE job_closeouts(id varchar PRIMARY KEY,lead_id varchar,status text,customer_approved_at timestamptz,pricing_snapshot jsonb,
      calculated_final_total numeric,balance_due numeric,square_invoice_id varchar);
    INSERT INTO job_closeouts VALUES('closeout','job','balance_due',NOW(),'{"finalQuoteRevisionId":"quote"}',120,90,'invoice');
    CREATE TABLE square_invoices(square_invoice_id varchar PRIMARY KEY,lead_id varchar,purpose text,status text,
      quote_revision_id varchar,closeout_id varchar,amount numeric,currency text);
    INSERT INTO square_invoices VALUES('invoice','job','final_balance','sent','quote','closeout',90,'USD');
    CREATE TABLE job_confirmed_payments(id bigint PRIMARY KEY,lead_id varchar,amount_cents bigint,gift_funded_cents bigint,paid_at timestamptz);
    INSERT INTO job_confirmed_payments VALUES(1,'job',3000,0,NOW());
    CREATE TABLE job_confirmed_refunds(payment_id bigint,amount_cents bigint,gift_funded_cents bigint);
    CREATE TABLE customer_job_events(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),lead_id varchar,event_type text,
      event_key text UNIQUE,title text,message text,payload jsonb);
    CREATE TABLE customer_notification_deliveries(event_id varchar,channel text,status text);`);
  await database.exec(JOB_FINANCIAL_NOTIFICATIONS_SCHEMA);
  await reset();
  process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED='false';
  assert.equal((await processOneFinancialNotice(provider)).status,'disabled'); assert.equal(sent.length,0);
  process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED='true';
  assert.equal((await processOneFinancialNotice(provider)).status,'sent');
  assert.deepEqual(sent.map(item=>item.channel),['email','sms']);
  assert.equal(sent[0].input.url,'https://example.invalid/my-jobs');
  assert.equal(sent[0].input.message.includes('$90'),false);
  assert.equal((await processOneFinancialNotice(provider)).status,'idle'); assert.equal(sent.length,2);
  assert.equal((await database.query('SELECT * FROM customer_job_events')).rows.length,1);

  await reset(true);
  await database.exec("UPDATE square_invoices SET status='sent'");
  assert.equal((await processOneFinancialNotice(provider)).status,'sent'); assert.equal(sent.length,2);
  await reset(); await database.exec('UPDATE job_confirmed_payments SET amount_cents=12000');
  assert.equal((await processOneFinancialNotice(provider)).status,'suppressed'); assert.equal(sent.length,0);
  await reset(); await database.exec('UPDATE job_confirmed_payments SET amount_cents=4000');
  assert.equal((await processOneFinancialNotice(provider)).status,'suppressed'); assert.equal(sent.length,0);
  await reset(); await database.exec("UPDATE square_invoices SET status='canceled'");
  assert.equal((await processOneFinancialNotice(provider)).status,'suppressed'); assert.equal(sent.length,0);
  await reset(); await database.exec('UPDATE quote_revisions SET customer_total=121');
  assert.equal((await processOneFinancialNotice(provider)).status,'suppressed'); assert.equal(sent.length,0);
  await reset(true); await database.exec('INSERT INTO job_confirmed_refunds VALUES(1,100,0)');
  await processOneFinancialNotice(provider); assert.equal(await status(),'review'); assert.equal(sent.length,0);

  await reset(); afterSend=()=>database.exec('UPDATE leads SET sms_consent=false');
  assert.equal((await processOneFinancialNotice(provider)).status,'sent'); assert.equal(sent.length,1);
  await reset(); afterSend=()=>database.exec('UPDATE job_confirmed_payments SET amount_cents=12000');
  assert.equal((await processOneFinancialNotice(provider)).status,'suppressed'); assert.equal(sent.length,1);
  await reset(); available=false;
  assert.equal((await processOneFinancialNotice(provider)).status,'retry'); assert.equal(sent.length,0);
  assert.equal((await database.query('SELECT * FROM job_financial_notice_attempts')).rows.length,0);
  available=true; await retryNow();
  assert.equal((await processOneFinancialNotice(provider)).status,'sent'); assert.equal(sent.length,2);
  await reset(); smsAvailable=false;
  assert.equal((await processOneFinancialNotice(provider)).status,'retry'); assert.equal(sent.length,1);
  smsAvailable=true; await retryNow();
  assert.equal((await processOneFinancialNotice(provider)).status,'sent');
  assert.deepEqual(sent.map(item=>item.channel),['email','sms'],'retry sends only the previously unavailable channel');
  await reset(); await database.exec("UPDATE leads SET email=NULL,sms_consent=false");
  assert.equal((await processOneFinancialNotice(provider)).status,'sent'); assert.equal(sent.length,0);
  assert.equal((await database.query('SELECT * FROM customer_job_events')).rows.length,1,'portal-only notification persists');
  await reset(); afterSend=async()=>{ throw new Error('Provider accepted message then lost response'); };
  assert.equal((await processOneFinancialNotice(provider)).status,'review'); assert.equal(sent.length,1);

  await reset(); sendSuccess=false;
  assert.equal((await processOneFinancialNotice(provider)).status,'review'); assert.equal(sent.length,1);
  assert.equal((await processOneFinancialNotice(provider)).status,'idle'); assert.equal(sent.length,1);
  await reset(); failAcknowledgement=true;
  assert.equal((await processOneFinancialNotice(provider)).status,'retry'); assert.equal(sent.length,1);
  failAcknowledgement=false; await retryNow(); await processOneFinancialNotice(provider);
  assert.equal(await status(),'review'); assert.equal(sent.length,1);
  await reset(); loseReservationCommit=true;
  assert.equal((await processOneFinancialNotice(provider)).status,'retry'); assert.equal(sent.length,0);
  await retryNow(); await processOneFinancialNotice(provider);
  assert.equal(await status(),'review'); assert.equal(sent.length,0);

  await reset();
  await database.exec(`INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload)
    SELECT lead_id,kind,event_key,'legacy','legacy','{}' FROM job_financial_notifications;`);
  await processOneFinancialNotice(provider); assert.equal(await status(),'review'); assert.equal(sent.length,0);
  await reset();
  await database.exec(`INSERT INTO customer_job_events(lead_id,event_type,event_key,title,message,payload)
    SELECT lead_id,kind,event_key,'legacy','legacy','{}' FROM job_financial_notifications;
    INSERT INTO customer_notification_deliveries SELECT id,'email','sent' FROM customer_job_events;
    INSERT INTO customer_notification_deliveries SELECT id,'sms','sent' FROM customer_job_events;`);
  assert.equal((await processOneFinancialNotice(provider)).status,'sent'); assert.equal(sent.length,0);
  console.log('PASS: real notice worker rechecks finances and consent, preserves portal/delivery history, retries unavailable providers and never resends uncertain attempts');
} finally {
  pool.query=previousQuery; pool.connect=previousConnect; globalThis.fetch=previousFetch;
  flags.forEach((flag,index)=>{ if(previous[index]===undefined) delete process.env[flag]; else process.env[flag]=previous[index]; });
  await database.close();
}
