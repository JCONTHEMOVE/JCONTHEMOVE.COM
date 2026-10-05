import assert from 'node:assert/strict';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { pool } from '../server/db';
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from '../server/services/jobPaymentLedger';
import { recordConfirmedJobRefund } from '../server/services/jobPaymentRefunds';
import { classifyCanonicalInvoicePayment } from '../server/services/canonicalInvoicePayment';
import { claimJobInvoiceReconciliation, finishJobInvoiceReconciliation } from '../server/services/jobInvoiceReconciliationQueue';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previousConnect = pool.connect, previousQuery = pool.query;
const previousFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
const previousWorkerFlag = process.env.JOB_INVOICE_RECONCILIATION_ENABLED;
let failQueue = false;
pool.connect = (async () => ({ query: (sql: string, args?: unknown[]) => {
  if (failQueue && sql.includes('INSERT INTO job_invoice_reconciliation_queue')) throw new Error('Injected queue failure');
  return database.query(sql, args);
}, release() {} })) as typeof pool.connect;
pool.query = ((sql: string, args?: unknown[]) => database.query(sql, args)) as typeof pool.query;
process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
delete process.env.JOB_INVOICE_RECONCILIATION_ENABLED;
try {
  await database.exec(`CREATE TABLE leads(id varchar PRIMARY KEY,total_price numeric,status text,payment_paid_at timestamptz,
    tokens_disbursed_at timestamptz,completion_rewarded_at timestamptz);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY,lead_id varchar,revision int,status text,
    approved_at timestamptz,customer_total numeric,currency text);
    CREATE TABLE job_closeouts(lead_id varchar PRIMARY KEY,status text,customer_approved_at timestamptz,pricing_snapshot jsonb);
    INSERT INTO leads VALUES('job',100,'new',NULL,NULL,NULL);
    INSERT INTO quote_revisions VALUES('quote','job',1,'approved',NOW(),100,'USD');`);
  await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  const invoice = { leadId: 'job', orderId: 'deposit-order', invoiceAmount: 30, depositRequired: true, depositAmount: 30 };
  await assert.rejects(classifyCanonicalInvoicePayment(invoice), /waiting for verified/);
  const payment = { provider: 'square:production', providerPaymentId: 'deposit', leadId: 'job', quoteRevisionId: 'quote',
    amountCents: 3000, currency: 'USD' as const, tenderType: 'card', giftFundedCents: 0,
    paidAt: '2026-09-09T12:00:00Z', metadata: { squareOrderId: 'deposit-order' } };
  await confirmJobPayment(payment);
  const queued = async () => (await database.query("SELECT *,generation::text AS generation FROM job_invoice_reconciliation_queue WHERE lead_id='job'")).rows[0];
  assert.equal((await queued()).generation, '1');
  await confirmJobPayment(payment);
  assert.equal((await queued()).generation, '1', 'duplicate provider delivery does not supersede work');
  assert.equal(await claimJobInvoiceReconciliation(), null, 'worker defaults off while work is durably queued');
  process.env.JOB_INVOICE_RECONCILIATION_ENABLED = 'true';
  const firstClaim = (await claimJobInvoiceReconciliation())!;
  assert.ok(firstClaim);
  failQueue = true;
  await assert.rejects(confirmJobPayment({ ...payment, providerPaymentId: 'rollback-queue', amountCents: 1 }), /Injected queue failure/);
  failQueue = false;
  assert.equal((await database.query("SELECT * FROM job_confirmed_payments WHERE provider_payment_id='rollback-queue'")).rows.length, 0);
  assert.equal((await queued()).generation, '1');
  assert.equal((await classifyCanonicalInvoicePayment(invoice)).kind, 'deposit');
  const balance = { ...invoice, orderId: 'balance-order', invoiceAmount: 70 };
  await assert.rejects(classifyCanonicalInvoicePayment(balance), /waiting for verified/);
  await confirmJobPayment({ ...payment, providerPaymentId: 'balance', amountCents: 7000, metadata: { squareOrderId: 'balance-order' } });
  assert.equal((await queued()).generation, '2');
  assert.equal((await queued()).status, 'processing');
  assert.equal(await claimJobInvoiceReconciliation(), null, 'new work does not create a concurrent lease');
  await finishJobInvoiceReconciliation(firstClaim, true);
  assert.equal((await queued()).status, 'pending', 'old claim cannot consume a later payment');
  const expiredClaim = (await claimJobInvoiceReconciliation())!;
  await database.exec("UPDATE job_invoice_reconciliation_queue SET lease_expires_at=NOW()-INTERVAL '1 minute'");
  const replacementClaim = (await claimJobInvoiceReconciliation())!;
  assert.equal(await finishJobInvoiceReconciliation(expiredClaim, true), false);
  await finishJobInvoiceReconciliation(replacementClaim, true);
  assert.equal((await queued()).status, 'done');
  const result = await classifyCanonicalInvoicePayment(balance);
  assert.equal(result.kind, 'paid_in_full');
  assert.equal(result.accountingAmount, 100);
  assert.equal(result.invoiceAmount, 70);
  await database.exec("INSERT INTO job_closeouts VALUES('job','awaiting_customer',NULL,'{}')");
  await assert.rejects(classifyCanonicalInvoicePayment(balance), /waiting for final closeout approval/);
  await database.exec("UPDATE job_closeouts SET status='paid' WHERE lead_id='job'");
  await assert.rejects(classifyCanonicalInvoicePayment(balance), /waiting for final closeout approval/);
  await database.exec("UPDATE job_closeouts SET status='balance_due',customer_approved_at=NOW(),pricing_snapshot='{\"finalQuoteRevisionId\":\"wrong-quote\"}' WHERE lead_id='job'");
  await assert.rejects(classifyCanonicalInvoicePayment(balance), /waiting for final closeout approval/);
  await database.exec("UPDATE job_closeouts SET pricing_snapshot='{\"finalQuoteRevisionId\":\"quote\"}' WHERE lead_id='job'");
  assert.equal((await classifyCanonicalInvoicePayment(balance)).kind, 'paid_in_full');
  console.log('PASS: invoice effects wait for customer closeout approval and the matching final quote');
  await assert.rejects(classifyCanonicalInvoicePayment({ ...balance, orderId: 'unrelated-order' }), /waiting for verified/);
  failQueue = true;
  await assert.rejects(recordConfirmedJobRefund({ provider: payment.provider, providerPaymentId: 'balance', providerRefundId: 'refund',
    amountCents: 100, giftFundedCents: 0, currency: 'USD', refundedAt: '2026-09-09T13:00:00Z' }), /Injected queue failure/);
  failQueue = false;
  assert.equal((await database.query('SELECT * FROM job_confirmed_refunds')).rows.length, 0);
  assert.equal((await queued()).generation, '2');
  await recordConfirmedJobRefund({ provider: payment.provider, providerPaymentId: 'balance', providerRefundId: 'refund',
    amountCents: 100, giftFundedCents: 0, currency: 'USD', refundedAt: '2026-09-09T13:00:00Z' });
  assert.equal((await queued()).status, 'pending');
  assert.equal((await queued()).generation, '3', 'refund reopens completed reconciliation');
  const refundClaim = (await claimJobInvoiceReconciliation())!;
  await finishJobInvoiceReconciliation(refundClaim, false);
  assert.equal((await queued()).status, 'retry');
  assert.equal(await claimJobInvoiceReconciliation(), null, 'failed work respects retry delay');
  console.log('PASS: payment/refund queue is atomic, deduplicated, generation-aware and fenced against expired workers');
  await assert.rejects(classifyCanonicalInvoicePayment(balance), /requires payment reconciliation/);
  console.log('PASS: invoice-before-payment retry, verified deposit, cumulative balance, order isolation and refund review');
} finally {
  pool.connect = previousConnect; pool.query = previousQuery;
  if (previousFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousFlag;
  if (previousWorkerFlag === undefined) delete process.env.JOB_INVOICE_RECONCILIATION_ENABLED;
  else process.env.JOB_INVOICE_RECONCILIATION_ENABLED = previousWorkerFlag;
  await database.close();
}
