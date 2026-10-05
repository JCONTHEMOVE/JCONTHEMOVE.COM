import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/db';
import { JOB_FINANCIAL_NOTIFICATIONS_SCHEMA } from '../server/services/jobFinancialNotifications';
import { claimFinancialNotice, reserveFinancialNoticeAttempt, acknowledgeFinancialNoticeAttempt } from '../server/services/jobFinancialNoticeDelivery';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousQuery = pool.query, previousConnect = pool.connect;
const previousLedger = process.env.JOB_PAYMENT_LEDGER_ENABLED;
const previousDelivery = process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED;
pool.query = ((sql: string, args?: unknown[]) => database.query(sql, args)) as typeof pool.query;
pool.connect = (async () => ({ query: pool.query, release() {} })) as typeof pool.connect;
async function reserve(claim: NonNullable<Awaited<ReturnType<typeof claimFinancialNotice>>>,
  channel: 'email' | 'sms' = 'email', destination = 'customer@example.invalid') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attempt = await reserveFinancialNoticeAttempt(client, claim, channel, destination);
    await client.query('COMMIT');
    return attempt;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function reset() {
  await database.exec(`DELETE FROM job_financial_notice_attempts; DELETE FROM job_financial_notifications;
    INSERT INTO job_financial_notifications(event_key,lead_id,closeout_id,kind,payload)
    VALUES('event','job','closeout','final_payment_received','{}');`);
}
async function expire() {
  await database.exec("UPDATE job_financial_notifications SET lease_expires_at=NOW()-INTERVAL '1 minute'");
}
try {
  await database.exec("CREATE TABLE leads(id varchar PRIMARY KEY); INSERT INTO leads VALUES('job');");
  await database.exec(JOB_FINANCIAL_NOTIFICATIONS_SCHEMA);
  await reset();
  process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
  delete process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED;
  assert.equal(await claimFinancialNotice(), null);
  process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED = 'true';
  process.env.JOB_PAYMENT_LEDGER_ENABLED = 'false';
  assert.equal(await claimFinancialNotice(), null);
  process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
  const first = await claimFinancialNotice(); assert.ok(first);
  assert.equal(await claimFinancialNotice(), null, 'live claim cannot be stolen');
  await expire();
  const recovered = await claimFinancialNotice(); assert.ok(recovered);
  assert.notEqual(recovered.lease_token, first.lease_token);
  assert.equal(await reserve(first), null, 'expired worker cannot start sending');
  const client = await pool.connect();
  await client.query('BEGIN');
  assert.ok(await reserveFinancialNoticeAttempt(client, recovered, 'email', 'customer@example.invalid'));
  await client.query('ROLLBACK'); client.release();
  assert.equal((await database.query('SELECT * FROM job_financial_notice_attempts')).rows.length, 0);
  const attempt = await reserve(recovered); assert.ok(attempt);
  assert.equal(await reserve(recovered), null);
  assert.equal(await reserve(recovered, 'email', 'changed@example.invalid'), null, 'new destination is not a new send permission');
  assert.equal(await acknowledgeFinancialNoticeAttempt({ ...attempt, token: randomUUID() }, { sent: true }), false);
  await expire();
  assert.equal(await claimFinancialNotice(), null, 'crash after send reservation requires review');
  assert.equal((await database.query('SELECT status FROM job_financial_notifications')).rows[0].status, 'review');
  assert.equal((await database.query('SELECT status FROM job_financial_notice_attempts')).rows[0].status, 'review');
  assert.equal(await acknowledgeFinancialNoticeAttempt(attempt, { sent: true, providerReference: 'receipt' }), true);
  assert.equal(await acknowledgeFinancialNoticeAttempt(attempt, { sent: false }), false, 'late failure cannot erase a receipt');
  const sent = (await database.query('SELECT * FROM job_financial_notice_attempts')).rows[0];
  assert.equal(sent.status, 'sent'); assert.equal(sent.provider_reference, 'receipt');
  assert.equal(sent.destination_hash.includes('@'), false);

  await reset();
  const next = await claimFinancialNotice(); assert.ok(next);
  const email = await reserve(next); assert.ok(email);
  await acknowledgeFinancialNoticeAttempt(email, { sent: true });
  await expire();
  const resume = await claimFinancialNotice(); assert.ok(resume);
  assert.equal(await reserve(resume), null, 'successful email is retained while recovering unsent SMS');
  const sms = await reserve(resume, 'sms', '+15555550100'); assert.ok(sms);
  await acknowledgeFinancialNoticeAttempt(sms, { sent: false });
  assert.equal(await reserve(resume, 'sms', '+15555550200'), null);
  await expire();
  assert.equal(await claimFinancialNotice(), null);
  assert.equal((await database.query("SELECT status FROM job_financial_notice_attempts WHERE channel='email'")).rows[0].status, 'sent');
  assert.equal((await database.query('SELECT status FROM job_financial_notifications')).rows[0].status, 'review');
  console.log('PASS: delivery default off; expired claims fenced; rollback cannot authorize a send; uncertain sends require review; successful channels survive recovery');
} finally {
  pool.query = previousQuery; pool.connect = previousConnect;
  if (previousLedger === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousLedger;
  if (previousDelivery === undefined) delete process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED;
  else process.env.JOB_FINANCIAL_NOTIFICATIONS_ENABLED = previousDelivery;
  await database.close();
}
