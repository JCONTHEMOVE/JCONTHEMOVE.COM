// CI-only disposable PostgreSQL acceptance. Never uses DATABASE_URL.
import assert from "node:assert/strict";
import pg from "pg";
import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "../server/db";
import { JOB_PAYMENT_LEDGER_SCHEMA, confirmJobPayment } from "../server/services/jobPaymentLedger";
import { recordConfirmedJobRefund } from "../server/services/jobPaymentRefunds";
import { settleJobLedgerRecipient } from "../server/services/jobLedgerSettlement";
import { acquireJobDisbursementLock } from "../server/services/jobDisbursementLock";
import { creditJobCash } from "../server/services/jobCashCredit";
import { recordJobRevenue } from "../server/services/jobRevenueAllocation";
import { createInvoiceEffectClaims, SQUARE_INVOICE_CLAIM_UPGRADE } from "../server/services/squareInvoiceEffectClaims";
import { createSquareEventClaims, SQUARE_EVENT_CLAIM_UPGRADE } from "../server/services/squareEventClaims";

const url = new URL(process.env.TEST_DATABASE_URL || "http://missing");
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.pathname !== "/jc_ledger_test") throw new Error("Use a local disposable jc_ledger_test database");
const testPool = new pg.Pool({ connectionString: url.href, max: 8, connectionTimeoutMillis: 5000,
  options: "-c search_path=jc_ledger_concurrency -c statement_timeout=10000" });
const previous = pool.connect;
const previousFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
const previousRewardFlag = process.env.JOB_PAYMENT_REWARDS_ENABLED;
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
  process.env.JOB_PAYMENT_LEDGER_ENABLED = "true";
  process.env.JOB_PAYMENT_REWARDS_ENABLED = "true";
  await testPool.query(`INSERT INTO leads VALUES('canonical',100,'completed',NULL),('refund-race',100,'completed',NULL);
    INSERT INTO quote_revisions VALUES('canonical-quote','canonical',1,'approved',NOW(),100,'USD'),
      ('race-quote','refund-race',1,'approved',NOW(),100,'USD');
    INSERT INTO job_jcmoves_ledger VALUES(2,'canonical','canonical-customer','customer_paid_completed_pool',600,60,10,'{}'),
      (3,'refund-race','race-customer','customer_paid_completed_pool',600,60,10,'{}');`);
  await confirmJobPayment({ ...payment, providerPaymentId: "canonical-payment", leadId: "canonical",
    quoteRevisionId: "canonical-quote", amountCents: 10000, giftFundedCents: 4000 });
  await confirmJobPayment({ ...payment, providerPaymentId: "race-payment", leadId: "refund-race",
    quoteRevisionId: "race-quote", amountCents: 10000, giftFundedCents: 4000 });
  const canonicalRecipient = { ...recipient, ledgerId: 2, leadId: "canonical", userId: "canonical-customer" };
  const canonicalAwards = await Promise.all([settleJobLedgerRecipient(canonicalRecipient), settleJobLedgerRecipient(canonicalRecipient)]);
  assert.equal(canonicalAwards.filter(Boolean).length, 1);
  assert.equal(Number((await testPool.query("SELECT token_balance FROM wallet_accounts WHERE user_id='canonical-customer'")).rows[0].token_balance), 600);

  const refundWriter = await testPool.connect();
  let waitingAward: Promise<unknown> | undefined;
  try {
    await refundWriter.query("BEGIN");
    await refundWriter.query("SELECT id FROM leads WHERE id='refund-race' FOR UPDATE");
    const blockerPid = (await refundWriter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    waitingAward = settleJobLedgerRecipient({ ...recipient, ledgerId: 3, leadId: "refund-race", userId: "race-customer" })
      .then(() => ({ credited: true }), error => ({ error }));
    // Observe actual PostgreSQL blocking rather than assuming Promise timing.
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (!blocked && Date.now() < deadline) {
      const result = await testPool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS blocked", [blockerPid]);
      blocked = result.rows[0].blocked;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(blocked, "reward settlement must wait for the refund's job lock");
    await recordConfirmedJobRefund({ ...refund, providerPaymentId: "race-payment", providerRefundId: "race-refund", amountCents: 100 },
      refundWriter as unknown as PoolClient);
    await refundWriter.query("COMMIT");
    const outcome = await waitingAward as { error?: unknown };
    assert.match(String(outcome.error), /requires reward reconciliation/);
    assert.equal((await testPool.query("SELECT COUNT(*)::int AS n FROM wallet_accounts WHERE user_id='race-customer'")).rows[0].n, 0);
    assert.equal((await testPool.query("SELECT COUNT(*)::int AS n FROM rewards WHERE user_id='race-customer'")).rows[0].n, 0);
  } finally {
    await refundWriter.query("ROLLBACK");
    refundWriter.release();
    if (waitingAward) await waitingAward;
  }
  await testPool.query(`ALTER TABLE leads ADD COLUMN email text;
    ALTER TABLE wallet_accounts ADD COLUMN cash_balance numeric DEFAULT 0;
    CREATE TABLE users(id text PRIMARY KEY,email text);
    CREATE TABLE wallet_transactions(transaction_type text,amount numeric,balance_after numeric,status text,metadata jsonb);
    INSERT INTO users VALUES('cash-customer','cash@example.test');
    INSERT INTO leads(id,email) VALUES('cash-job','cash@example.test');`);
  const cashResults = await Promise.all([
    creditJobCash('cash-job', 100, 'webhook'), creditJobCash('cash-job', 100, 'invoice_sync'),
  ]);
  assert.deepEqual(cashResults.sort(), ['credited', 'duplicate']);
  assert.equal(Number((await testPool.query("SELECT cash_balance FROM wallet_accounts WHERE user_id='cash-customer'")).rows[0].cash_balance), 100);
  assert.equal((await testPool.query("SELECT COUNT(*)::int AS n FROM rewards WHERE reference_id='cash-job'")).rows[0].n, 1);
  assert.equal((await testPool.query("SELECT COUNT(*)::int AS n FROM wallet_transactions")).rows[0].n, 1);
  console.log("PASS: concurrent cross-source job cash credits issue one grant");
  await testPool.query(`CREATE TABLE revenue_allocations(id serial PRIMARY KEY,lead_id text,
    payment_amount_usd numeric,buyback_usd numeric,staking_usd numeric,jackpot_usd numeric,liquidity_usd numeric,source text);
    CREATE UNIQUE INDEX revenue_lead ON revenue_allocations(lead_id) WHERE lead_id IS NOT NULL;
    CREATE TABLE buyback_fund(id text PRIMARY KEY,fee_contribution_count int,last_updated timestamptz);
    INSERT INTO buyback_fund VALUES('fund',4,NOW());`);
  const allocations = await Promise.all([
    recordJobRevenue(100, 'cash-job', 'webhook'), recordJobRevenue(100, 'cash-job', 'invoice_sync'),
    recordJobRevenue(100, 'job', 'webhook'),
  ]);
  assert.equal(allocations.filter(Boolean).length, 2);
  assert.equal((await testPool.query('SELECT COUNT(*)::int AS n FROM revenue_allocations')).rows[0].n, 2);
  assert.equal((await testPool.query('SELECT fee_contribution_count FROM buyback_fund')).rows[0].fee_contribution_count, 6);
  console.log("PASS: same-job allocation replay and different-job contribution increments");
  await testPool.query(`CREATE TABLE square_invoice_payment_effects(square_invoice_id text PRIMARY KEY,
    event_id text NOT NULL,status text NOT NULL,last_error text,started_at timestamptz DEFAULT NOW(),completed_at timestamptz);
    CREATE TABLE square_webhook_events(event_id text PRIMARY KEY,event_type text NOT NULL,square_object_id text,
    payload_hash text NOT NULL,status text NOT NULL,last_error text,received_at timestamptz DEFAULT NOW(),processed_at timestamptz);
    ${SQUARE_INVOICE_CLAIM_UPGRADE}
    ${SQUARE_EVENT_CLAIM_UPGRADE}`);
  const claimClients = await Promise.all([testPool.connect(), testPool.connect()]);
  try {
    const claimPids = await Promise.all(claimClients.map(client => client.query('SELECT pg_backend_pid() AS pid')));
    assert.notEqual(claimPids[0].rows[0].pid, claimPids[1].rows[0].pid);
    const invoiceAttempts = claimClients.map(client => createInvoiceEffectClaims((sql, args) => client.query(sql, args)));
    const invoiceRace = await Promise.all(invoiceAttempts.map(attempt => attempt.claim('racing-invoice', 'event')));
    assert.deepEqual(invoiceRace.map(result => result.status).sort(), ['claimed', 'in_progress']);
    const originalInvoice = invoiceRace.find(result => result.status === 'claimed');
    assert.ok(originalInvoice?.status === 'claimed');
    await testPool.query("UPDATE square_invoice_payment_effects SET started_at=NOW()-INTERVAL '6 minutes'");
    const invoiceReclaims = await Promise.all(invoiceAttempts.map(attempt => attempt.claim('racing-invoice', 'event')));
    assert.deepEqual(invoiceReclaims.map(result => result.status).sort(), ['claimed', 'in_progress']);
    assert.equal(await invoiceAttempts[0].complete(originalInvoice.claim), false);
    assert.equal(await invoiceAttempts[1].fail(originalInvoice.claim, 'stale'), false);
    const eventAttempts = claimClients.map(client => createSquareEventClaims((sql, args) => client.query(sql, args)));
    const eventInput = { eventId: 'racing-event', eventType: 'payment.updated', rawBody: '{"id":"racing-event"}' };
    const eventRace = await Promise.all(eventAttempts.map(attempt => attempt.claim(eventInput)));
    assert.deepEqual(eventRace.map(result => result.status).sort(), ['claimed', 'in_progress']);
    const originalEvent = eventRace.find(result => result.status === 'claimed');
    assert.ok(originalEvent?.status === 'claimed');
    await testPool.query("UPDATE square_webhook_events SET received_at=NOW()-INTERVAL '6 minutes'");
    const eventReclaims = await Promise.all(eventAttempts.map(attempt => attempt.claim(eventInput)));
    assert.deepEqual(eventReclaims.map(result => result.status).sort(), ['claimed', 'in_progress']);
    assert.equal(await eventAttempts[0].complete(originalEvent.claim), false);
    assert.equal(await eventAttempts[1].fail(originalEvent.claim, 'stale'), false);
  } finally { claimClients.forEach(client => client.release()); }
  console.log('PASS: distinct PostgreSQL sessions race invoice/event claims and expired reclaims with one winner');
  console.log("PASS: canonical gift-funded reward replay and observed refund/settlement lock contention");
  console.log("PASS: separate PostgreSQL sessions, duplicate/concurrent payments, competing refunds, advisory lock and exactly-once wallet settlement");
} finally {
  pool.connect = previous;
  if (previousFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousFlag;
  if (previousRewardFlag === undefined) delete process.env.JOB_PAYMENT_REWARDS_ENABLED;
  else process.env.JOB_PAYMENT_REWARDS_ENABLED = previousRewardFlag;
  try {
    if (createdSchema) await testPool.query("DROP SCHEMA jc_ledger_concurrency CASCADE");
  } finally { await testPool.end(); }
}
