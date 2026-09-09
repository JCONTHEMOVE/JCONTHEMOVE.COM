import assert from 'node:assert/strict';
import { pool } from '../server/db';
import { recordSquareInvoicePublication } from '../server/services/squareInvoicePublication';
import { recordSquareInvoiceCancellation } from '../server/services/squareInvoiceCancellation';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousQuery = pool.query;
let loseResponse = false;
pool.query = (async (sql: string, args?: unknown[]) => {
  const result = await database.query(sql, args);
  if (loseResponse) { loseResponse = false; throw new Error('Lost committed acknowledgement'); }
  return result;
}) as typeof pool.query;
try {
  await database.exec(`CREATE TABLE square_invoices(id varchar PRIMARY KEY,
    square_invoice_id varchar UNIQUE,status text NOT NULL,invoice_url text,square_invoice_number text,
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
  console.log('PASS: cancellation acknowledgement rejects paid/refunded state and missing rows, preserves payment timestamps and recovers committed responses');
  console.log('PASS: actual publication acknowledgement preserves payment/closed state, timestamps and metadata across lost-response replay');
} finally {
  pool.query = previousQuery;
  await database.close();
}
