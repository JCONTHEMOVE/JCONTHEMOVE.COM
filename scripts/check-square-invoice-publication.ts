import assert from 'node:assert/strict';
import { pool } from '../server/db';
import { recordSquareInvoicePublication } from '../server/services/squareInvoicePublication';
import { recordSquareInvoiceCancellation } from '../server/services/squareInvoiceCancellation';
import { JOB_INVOICE_RECONCILIATION_QUEUE_SCHEMA } from '../server/services/jobInvoiceReconciliationQueue';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousQuery = pool.query;
const previousConnect = pool.connect, previousFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
process.env.JOB_PAYMENT_LEDGER_ENABLED = 'false';
let loseResponse = false;
let failQueue = false;
pool.query = (async (sql: string, args?: unknown[]) => {
  if (failQueue && sql.includes('INSERT INTO job_invoice_reconciliation_queue')) throw new Error('Injected publication queue failure');
  const result = await database.query(sql, args);
  if (loseResponse) { loseResponse = false; throw new Error('Lost committed acknowledgement'); }
  return result;
}) as typeof pool.query;
pool.connect = (async () => ({ query: pool.query, release() {} })) as typeof pool.connect;
try {
  await database.exec(`CREATE TABLE square_invoices(id varchar PRIMARY KEY,
    square_invoice_id varchar UNIQUE,status text NOT NULL,invoice_url text,square_invoice_number text,lead_id varchar,purpose text,
    sent_at timestamptz,paid_at timestamptz,updated_at timestamptz);
    INSERT INTO square_invoices(id,square_invoice_id,status) VALUES('local','provider','draft');`);
  const input = { squareInvoiceId: 'provider', invoiceUrl: 'https://example.invalid/invoice', invoiceNumber: 'TEST-1' };
  loseResponse = true;
  await assert.rejects(recordSquareInvoicePublication(input), /Lost committed acknowledgement/);
  const first = (await database.query('SELECT * FROM square_invoices')).rows[0];
  assert.equal(first.status, 'sent');
  await recordSquareInvoicePublication(input);
  const retried = (await database.query('SELECT * FROM square_invoices')).rows[0];
  assert.equal(String(retried.sent_at), String(first.sent_at));
  assert.equal(retried.invoice_url, input.invoiceUrl);
  assert.equal(retried.square_invoice_number, 'TEST-1');
  for (const status of ['paid', 'partially_paid', 'canceled', 'failed', 'refunded']) {
    // Model a webhook commit after publication, before its local acknowledgement.
    await database.query(`UPDATE square_invoices SET status=$1,paid_at='2026-09-09T12:00:00Z'`, [status]);
    await recordSquareInvoicePublication({ squareInvoiceId: 'provider' });
    const row = (await database.query('SELECT * FROM square_invoices')).rows[0];
    assert.equal(row.status, status);
    assert.equal(new Date(row.paid_at).toISOString(), '2026-09-09T12:00:00.000Z');
    assert.equal(row.invoice_url, input.invoiceUrl, 'missing retry URL preserves prior publication metadata');
    assert.equal(String(row.sent_at), String(first.sent_at));
  }
  await assert.rejects(recordSquareInvoicePublication({ squareInvoiceId: 'missing' }), /missing its local recovery record/);
  for (const status of ['paid', 'refunded', 'failed', 'unknown']) {
    await database.query('UPDATE square_invoices SET status=$1', [status]);
    await assert.rejects(recordSquareInvoiceCancellation('provider'), /payment-state reconciliation/);
    assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status, status);
  }
  await database.exec("UPDATE square_invoices SET status='sent'");
  loseResponse = true;
  await assert.rejects(recordSquareInvoiceCancellation('provider'), /Lost committed acknowledgement/);
  await recordSquareInvoiceCancellation('provider');
  const canceled = (await database.query('SELECT * FROM square_invoices')).rows[0];
  assert.equal(canceled.status, 'canceled');
  assert.equal(new Date(canceled.paid_at).toISOString(), '2026-09-09T12:00:00.000Z');
  await assert.rejects(recordSquareInvoiceCancellation('missing'), /payment-state reconciliation/);
  await database.exec("CREATE TABLE leads(id varchar PRIMARY KEY); INSERT INTO leads VALUES('job');");
  await database.exec(JOB_INVOICE_RECONCILIATION_QUEUE_SCHEMA);
  await database.exec("UPDATE square_invoices SET lead_id='job',purpose='final_balance',status='draft'");
  process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
  failQueue = true;
  await assert.rejects(recordSquareInvoicePublication(input), /publication queue failure/);
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status, 'draft');
  assert.equal((await database.query('SELECT * FROM job_invoice_reconciliation_queue')).rows.length, 0);
  failQueue = false;
  await recordSquareInvoicePublication(input);
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status, 'sent');
  assert.equal((await database.query('SELECT status FROM job_invoice_reconciliation_queue')).rows[0].status, 'pending');
  console.log('PASS: publication acknowledgement and reconciliation request commit or roll back together');
  console.log('PASS: cancellation acknowledgement rejects paid/refunded state and missing rows, preserves payment timestamps and recovers committed responses');
  console.log('PASS: actual publication acknowledgement preserves payment/closed state, timestamps and metadata across lost-response replay');
} finally {
  pool.query = previousQuery;
  pool.connect = previousConnect;
  if (previousFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousFlag;
  await database.close();
}
