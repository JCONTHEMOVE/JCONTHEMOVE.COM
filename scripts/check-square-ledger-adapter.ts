import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { pool } from '../server/db';
import { JOB_PAYMENT_LEDGER_SCHEMA } from '../server/services/jobPaymentLedger';
import { processCanonicalSquareWebhook } from '../server/services/canonicalSquareWebhook';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { createSquareWebhookHandler } from '../server/squareWebhook';

// Real adapter, SDK decoding and SQL; every provider request is intercepted.
const database = await createDisposableLedgerDatabase(process.argv[2]);
const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = globalThis.fetch;
const settings = {
  JOB_PAYMENT_LEDGER_ENABLED: 'true', SQUARE_JOB_PAYMENT_LEDGER_ENABLED: 'true',
  SQUARE_ENVIRONMENT: 'production', SQUARE_PRODUCTION_ACCESS_TOKEN: 'synthetic-adapter-token',
  SQUARE_PRODUCTION_LOCATION_ID: 'location', NODE_ENV: 'production',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'synthetic-signature-key', SQUARE_WEBHOOK_URL: 'https://example.invalid/api/webhooks/square',
};
const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
Object.assign(process.env, settings);
pool.query = ((sql: string, args?: unknown[]) => {
  // Unrelated startup schema installation is excluded; event claims use real SQL below.
  if (sql.includes('CREATE TABLE IF NOT EXISTS quote_revisions') || sql.includes('service_area_capabilities')) return Promise.resolve({ rows: [] });
  return database.query(sql, args);
}) as typeof pool.query;
pool.connect = (async () => ({ query: pool.query, release() {} })) as typeof pool.connect;
let location = 'location', order = 'order', amount = 3000;
let refundAmount = 1000;
const requests: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  assert.equal(method, 'GET', 'acceptance must never issue a provider mutation');
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  assert.equal(headers.get('authorization'), 'Bearer synthetic-adapter-token');
  requests.push(url);
  let body: unknown;
  if (url === 'https://connect.squareup.com/v2/payments/payment') {
    body = { payment: { id: 'payment', status: 'COMPLETED', order_id: order, location_id: location,
      source_type: 'CARD', amount_money: { amount, currency: 'USD' },
      card_details: { card: { card_brand: 'VISA' },
        card_payment_timeline: { captured_at: '2026-09-09T12:00:00Z' } } } };
  } else if (url === 'https://connect.squareup.com/v2/refunds/refund') {
    body = { refund: { id: 'refund', status: 'COMPLETED', payment_id: 'payment', location_id: location,
      amount_money: { amount: refundAmount, currency: 'USD' }, updated_at: '2026-09-09T13:00:00Z' } };
  } else throw new Error('Unexpected SDK request');
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
try {
  await database.exec(`CREATE TABLE leads(id varchar PRIMARY KEY,total_price numeric,status text,payment_paid_at timestamptz,
    tokens_disbursed_at timestamptz,completion_rewarded_at timestamptz);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY,lead_id varchar,revision int,status text,
    approved_at timestamptz,customer_total numeric,currency text);
    CREATE TABLE square_invoices(square_order_id text,lead_id varchar,quote_revision_id varchar);
    INSERT INTO leads VALUES('job',100,'new',NULL,NULL,NULL);
    INSERT INTO quote_revisions VALUES('quote','job',1,'approved',NOW(),100,'USD');
    INSERT INTO square_invoices VALUES('order','job','quote');`);
  await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  const state = async () => ({
    payments: (await database.query('SELECT * FROM job_confirmed_payments')).rows,
    refunds: (await database.query('SELECT * FROM job_confirmed_refunds')).rows,
    queue: (await database.query('SELECT generation::text AS generation FROM job_invoice_reconciliation_queue')).rows,
    lead: (await database.query('SELECT payment_paid_at FROM leads')).rows[0],
  });
  process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED = 'false';
  await processCanonicalSquareWebhook('payment.updated', 'payment');
  assert.equal(requests.length, 0);
  process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED = 'true';
  location = 'wrong-location';
  await assert.rejects(processCanonicalSquareWebhook('payment.updated', 'payment'), /location mismatch/);
  assert.equal((await state()).payments.length, 0);
  location = 'location'; order = 'unknown';
  await assert.rejects(processCanonicalSquareWebhook('payment.updated', 'payment'), /requires reconciliation/);
  assert.equal((await state()).queue.length, 0);
  order = 'order';
  await processCanonicalSquareWebhook('payment.updated', 'payment');
  const first = await state();
  assert.equal(first.payments.length, 1);
  assert.equal(Number(first.payments[0].amount_cents), 3000);
  assert.equal(first.payments[0].provider, 'square:production');
  assert.equal(first.queue[0].generation, '1');
  assert.equal(first.lead.payment_paid_at, null, 'deposit must not mark the job paid');
  await processCanonicalSquareWebhook('payment.created', 'payment');
  assert.deepEqual(await state(), first, 'another event for the same payment cannot duplicate effects');
  amount = 3100;
  await assert.rejects(processCanonicalSquareWebhook('payment.updated', 'payment'), /conflict/i);
  assert.deepEqual(await state(), first);
  amount = 3000;
  await processCanonicalSquareWebhook('refund.updated', 'refund');
  const refunded = await state();
  assert.equal(refunded.payments.length, 1);
  assert.equal(refunded.refunds.length, 1);
  assert.equal(Number(refunded.refunds[0].amount_cents), 1000);
  assert.equal(refunded.queue[0].generation, '2');
  await processCanonicalSquareWebhook('refund.updated', 'refund');
  assert.deepEqual(await state(), refunded);
  refundAmount = 1100;
  await assert.rejects(processCanonicalSquareWebhook('refund.updated', 'refund'), /conflict/i);
  assert.deepEqual(await state(), refunded);
  console.log('PASS: actual Square SDK routing to SQL payment/refund records, replay, conflict rollback and reconciliation queue');
  await database.exec(`CREATE TABLE square_webhook_events(event_id text PRIMARY KEY,event_type text NOT NULL,
    square_object_id text,payload_hash text NOT NULL,status text NOT NULL,claim_token uuid,
    received_at timestamptz NOT NULL DEFAULT NOW(),processed_at timestamptz,last_error text);`);
  await database.exec('DELETE FROM job_confirmed_refunds; DELETE FROM job_confirmed_payments; DELETE FROM job_invoice_reconciliation_queue;');
  const unexpectedEffect = async (): Promise<never> => { throw new Error('Unexpected legacy effect'); };
  const app = express();
  app.post('/api/webhooks/square', express.raw({ type: 'application/json' }), createSquareWebhookHandler({
    writeLeadHistory: unexpectedEffect, sendCompletedJobReviewRequest: unexpectedEffect,
    recordRevenueSplit: unexpectedEffect, creditJcMovesUsd: unexpectedEffect,
    creditJcMovesUsdFromPrepaid: unexpectedEffect, awardPrepaidCreditBonusTokens: unexpectedEffect,
  }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const send = (body: string, signature?: string) => originalFetch(`http://127.0.0.1:${address.port}/api/webhooks/square`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      'x-square-hmacsha256-signature': signature ?? crypto.createHmac('sha256', settings.SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(settings.SQUARE_WEBHOOK_URL + body).digest('base64') }, body,
  });
  // Spoofed event status/amount/order cannot replace provider retrieval and stored bindings.
  const event = JSON.stringify({ event_id: 'signed-event', type: 'payment.updated',
    data: { object: { payment: { id: 'payment', status: 'PENDING', order_id: 'spoofed', amount_money: { amount: 999999 } } } } });
  try {
    const before = requests.length;
    assert.equal((await send(event, 'invalid')).status, 401);
    assert.equal(requests.length, before);
    assert.equal((await database.query('SELECT * FROM square_webhook_events')).rows.length, 0);
    assert.equal((await send(event)).status, 200);
    assert.equal(requests.length, before + 2, 'signed event must retrieve routing and verified payment records');
    const signedPayment = await state();
    assert.equal(signedPayment.payments.length, 1);
    assert.equal(Number(signedPayment.payments[0].amount_cents), 3000, 'provider amount wins over webhook amount');
    assert.equal(signedPayment.queue[0].generation, '1');
    assert.equal(signedPayment.lead.payment_paid_at, null);
    const duplicate = await send(event);
    assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(requests.length, before + 2);
    assert.equal((await send(event.replace('999999', '999998'))).status, 500);
    assert.equal((await database.query("SELECT status FROM square_webhook_events WHERE event_id='signed-event'")).rows[0].status, 'processed');
    const retryEvent = event.replace('signed-event', 'retry-event');
    order = 'unknown';
    assert.equal((await send(retryEvent)).status, 500);
    assert.equal((await database.query("SELECT status FROM square_webhook_events WHERE event_id='retry-event'")).rows[0].status, 'failed');
    order = 'order';
    assert.equal((await send(retryEvent)).status, 200);
    assert.equal((await database.query("SELECT status FROM square_webhook_events WHERE event_id='retry-event'")).rows[0].status, 'processed');
    assert.deepEqual(await state(), signedPayment);
    console.log('PASS: production signed HTTP handler rejects invalid signatures, verifies provider data, deduplicates and reclaims failed events');
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
} finally {
  pool.query = originalQuery; pool.connect = originalConnect; globalThis.fetch = originalFetch;
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await database.close(); await pool.end();
}
