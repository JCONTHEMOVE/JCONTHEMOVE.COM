// CI-only disposable PostgreSQL acceptance. Never uses DATABASE_URL.
import assert from "node:assert/strict";
import pg from "pg";
import { pool } from "../server/db";
import { JOB_PAYMENT_LEDGER_SCHEMA, confirmJobPayment } from "../server/services/jobPaymentLedger";
import { recordConfirmedJobRefund } from "../server/services/jobPaymentRefunds";
import { settleJobLedgerRecipient } from "../server/services/jobLedgerSettlement";
import { acquireJobDisbursementLock } from "../server/services/jobDisbursementLock";

const url = new URL(process.env.TEST_DATABASE_URL || "http://missing");
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.pathname !== "/jc_ledger_test") throw new Error("Use a local disposable jc_ledger_test database");
const testPool = new pg.Pool({ connectionString: url.href, max: 8, connectionTimeoutMillis: 5000,
  options: "-c search_path=jc_ledger_concurrency -c statement_timeout=10000" });
const previous = pool.connect;
const previousFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
pool.connect = testPool.connect.bind(testPool) as unknown as typeof pool.connect;
process.env.JOB_PAYMENT_LEDGER_ENABLED = "true";
let createdSchema = false;
try {
  await testPool.query("CREATE SCHEMA jc_ledger_concurrency");
  createdSchema = true;
  await testPool.query(`CREATE TABLE leads(id varchar PRIMARY KEY,total_price numeric(10,2),status text,payment_paid_at timestamptz);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY,lead_id varchar REFERENCES leads(id),revision int,
      status text,approved_at timestamptz,customer_total numeric(10,2),currency text);
    INSERT INTO leads VALUES('job',100,'completed',NULL);
    INSERT INTO quote_revisions VALUES('quote','job',1,'approved',NOW(),100,'USD');`);
  await testPool.query(JOB_PAYMENT_LEDGER_SCHEMA);
  const payment = { provider: "square:sandbox", providerPaymentId: "one", leadId: "job", quoteRevisionId: "quote",
    amountCents: 5000, currency: "USD" as const, tenderType: "card", giftFundedCents: 0, paidAt: "2026-09-09T12:00:00Z" };
  const connections = await Promise.all([testPool.connect(), testPool.connect()]);
  const pids = await Promise.all(connections.map(client => client.query("SELECT pg_backend_pid() AS pid")));
  assert.notEqual(pids[0].rows[0].pid, pids[1].rows[0].pid);
  connections.forEach(client => client.release());
  const payments = await Promise.all([confirmJobPayment(payment), confirmJobPayment(payment),
    confirmJobPayment({ ...payment, providerPaymentId: "two" })]);
  assert.equal(payments.filter(result => result.duplicate).length, 1);
  assert.equal((await testPool.query("SELECT COUNT(*)::int AS n FROM job_confirmed_payments")).rows[0].n, 2);
  assert.ok((await testPool.query("SELECT payment_paid_at FROM leads WHERE id='job'")).rows[0].payment_paid_at);
  const refund = { provider: payment.provider, providerPaymentId: "one", providerRefundId: "refund-a",
    amountCents: 4000, giftFundedCents: 0, currency: "USD" as const, refundedAt: "2026-09-09T13:00:00Z" };
  const refunds = await Promise.allSettled([recordConfirmedJobRefund(refund),
    recordConfirmedJobRefund({ ...refund, providerRefundId: "refund-b" })]);
  assert.equal(refunds.filter(result => result.status === "fulfilled").length, 1);
  const rejected = refunds.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && /exceeds/.test(String(rejected.reason)));
  assert.equal(Number((await testPool.query("SELECT SUM(amount_cents) AS total FROM job_confirmed_refunds")).rows[0].total), 4000);
  const lockPool = testPool as unknown as Parameters<typeof acquireJobDisbursementLock>[0];
  const unlock = await acquireJobDisbursementLock(lockPool, 424242);
  assert.ok(unlock);
  assert.equal(await acquireJobDisbursementLock(lockPool, 424242), null);
  await unlock();
  const nextUnlock = await acquireJobDisbursementLock(lockPool, 424242);
  assert.ok(nextUnlock);
  await nextUnlock();
  // This section verifies legacy recipient settlement independently of the
  // disabled canonical reward integration (the synthetic job has a refund).
  delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  await testPool.query(`CREATE TABLE job_jcmoves_ledger(id int PRIMARY KEY,lead_id text,recipient_user_id text,
    reward_kind text,token_amount numeric,quote_total numeric,rate_per_dollar numeric,metadata jsonb);
    CREATE TABLE rewards(user_id text,reward_type text,token_amount numeric,cash_value numeric,status text,
      earned_date timestamptz,reference_id text,metadata jsonb);
    CREATE TABLE wallet_accounts(user_id text PRIMARY KEY,token_balance numeric DEFAULT 0,
      total_earned numeric DEFAULT 0,last_activity timestamptz);
    INSERT INTO job_jcmoves_ledger VALUES(1,'job','customer','customer_paid_completed_pool',1000,100,10,'{}');`);
  const recipient = { ledgerId: 1, leadId: "job", userId: "customer", rewardType: "customer_paid_completed_pool" as const,
    amount: 2000, quoteTotal: 100, ratePerDollar: 20 };
  const awards = await Promise.all([settleJobLedgerRecipient(recipient), settleJobLedgerRecipient(recipient)]);
  assert.equal(awards.filter(Boolean).length, 1);
  assert.equal((await testPool.query("SELECT COUNT(*)::int AS n FROM rewards")).rows[0].n, 1);
  const wallet = (await testPool.query("SELECT token_balance::text,total_earned::text FROM wallet_accounts")).rows[0];
  assert.equal(Number(wallet.token_balance), 1000);
  assert.equal(Number(wallet.total_earned), 1000);
  console.log("PASS: separate PostgreSQL sessions, duplicate/concurrent payments, competing refunds, advisory lock and exactly-once wallet settlement");
} finally {
  pool.connect = previous;
  if (previousFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousFlag;
  try {
    if (createdSchema) await testPool.query("DROP SCHEMA jc_ledger_concurrency CASCADE");
  } finally { await testPool.end(); }
}
