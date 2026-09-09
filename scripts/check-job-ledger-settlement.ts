// Runs actual settlement SQL against disposable PostgreSQL/PGlite, never production.
import assert from "node:assert/strict";
import { createDisposableLedgerDatabase } from "./disposable-ledger-database";
import { pool } from "../server/db";
import { settleJobLedgerRecipient } from "../server/services/jobLedgerSettlement";
import { JOB_PAYMENT_LEDGER_SCHEMA } from "../server/services/jobPaymentLedger";
import { readCanonicalRewardBasis } from "../server/services/canonicalRewardBasis";
import { recordConfirmedJobRefund } from "../server/services/jobPaymentRefunds";
import { enqueueJobReward, claimJobReward, finishJobReward } from "../server/services/jobRewardQueue";
import { processOneJobReward, enqueueCompletedPaidJobs } from "../server/services/jobRewardWorker";

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previous = pool.connect;
const previousQuery = pool.query;
pool.query = ((sql: string, args?: unknown[]) => database.query(sql, args)) as typeof pool.query;
const previousLedgerFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
const previousRewardFlag = process.env.JOB_PAYMENT_REWARDS_ENABLED;
delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
let failWallet = true;
(pool as any).connect = async () => ({ query: async (sql: string, args?: unknown[]) => {
  if (failWallet && sql.includes("UPDATE wallet_accounts")) throw new Error("injected wallet failure");
  return database.query(sql, args);
}, release() {} });
try {
  await database.exec(`CREATE TABLE job_jcmoves_ledger(id int PRIMARY KEY,lead_id text,recipient_user_id text,
    reward_kind text,token_amount numeric,quote_total numeric,rate_per_dollar numeric,metadata jsonb);
    CREATE TABLE rewards(user_id text,reward_type text,token_amount numeric,cash_value numeric,status text,
      earned_date timestamptz,reference_id text,metadata jsonb);
    CREATE TABLE wallet_accounts(user_id text PRIMARY KEY,token_balance numeric DEFAULT 0,
      total_earned numeric DEFAULT 0,last_activity timestamptz);
    INSERT INTO job_jcmoves_ledger VALUES(1,'job','customer','customer_paid_completed_pool',1000,100,10,'{}');`);
  const retry = { ledgerId: 1, leadId: "job", userId: "customer", rewardType: "customer_paid_completed_pool" as const,
    amount: 2000, quoteTotal: 100, ratePerDollar: 20 };
  await assert.rejects(settleJobLedgerRecipient(retry), /injected wallet failure/);
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM rewards")).rows[0].n, 0);
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM wallet_accounts")).rows[0].n, 0);
  failWallet = false;
  assert.equal(await settleJobLedgerRecipient(retry), true);
  assert.equal(await settleJobLedgerRecipient({ ...retry, amount: 3000, ratePerDollar: 30 }), false);
  const wallet = (await database.query("SELECT token_balance::text,total_earned::text FROM wallet_accounts")).rows[0];
  assert.equal(Number(wallet.token_balance), 1000);
  assert.equal(Number(wallet.total_earned), 1000);
  const rewards = (await database.query("SELECT token_amount::text,metadata FROM rewards")).rows;
  assert.equal(rewards.length, 1);
  assert.equal(Number(rewards[0].token_amount), 1000);
  assert.equal(rewards[0].metadata.ratePerDollar, 10);
  await assert.rejects(settleJobLedgerRecipient({ ...retry, userId: "other" }), /mismatch/);
  await database.exec("UPDATE job_jcmoves_ledger SET metadata='{}' WHERE id=1");
  await assert.rejects(settleJobLedgerRecipient(retry), /requires reconciliation/);
  assert.equal(Number((await database.query("SELECT token_balance::text FROM wallet_accounts")).rows[0].token_balance), 1000);
  await database.exec(`CREATE TABLE leads(id varchar PRIMARY KEY,total_price numeric,status text,payment_paid_at timestamptz);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY,lead_id varchar,revision int,status text,
      approved_at timestamptz,customer_total numeric,currency text);
    INSERT INTO leads VALUES('canonical',100,'completed',NOW());
    INSERT INTO quote_revisions VALUES('quote','canonical',1,'approved',NOW(),100,'USD');`);
  await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  await database.exec(`INSERT INTO job_confirmed_payments(provider,provider_payment_id,lead_id,quote_revision_id,
    amount_cents,currency,tender_type,gift_funded_cents,paid_at)
    VALUES('square:sandbox','mixed','canonical','quote',10000,'USD','mixed',4000,NOW());
    INSERT INTO job_jcmoves_ledger VALUES(2,'canonical','gift-customer','customer_paid_completed_pool',600,60,10,'{}');`);
  process.env.JOB_PAYMENT_LEDGER_ENABLED = "true";
  delete process.env.JOB_PAYMENT_REWARDS_ENABLED;
  await assert.rejects(readCanonicalRewardBasis("canonical"), /disabled/);
  assert.equal(await claimJobReward(), null);
  process.env.JOB_PAYMENT_REWARDS_ENABLED = "true";
  const queueClient = await pool.connect();
  assert.equal(await enqueueJobReward(queueClient, "canonical"), true);
  assert.equal(await enqueueJobReward(queueClient, "canonical"), false);
  queueClient.release();
  const firstClaim = await claimJobReward();
  assert.ok(firstClaim);
  assert.equal(await claimJobReward(), null);
  await database.exec("UPDATE job_reward_queue SET lease_expires_at=NOW()-INTERVAL '1 second'");
  const replacement = await claimJobReward();
  assert.ok(replacement);
  assert.notEqual(firstClaim.lease_token, replacement.lease_token);
  assert.equal(await finishJobReward(firstClaim, true), false);
  assert.equal(await finishJobReward(replacement, false), true);
  assert.equal(await claimJobReward(), null);
  await database.exec("UPDATE job_reward_queue SET next_attempt_at=NOW()-INTERVAL '1 second'");
  const retryClaim = await claimJobReward();
  assert.ok(retryClaim);
  assert.equal(await finishJobReward(retryClaim, true), true);
  assert.equal(await claimJobReward(), null);
  console.log("PASS: durable reward queue deduplication, expiry, stale-worker fencing and retry scheduling");
  const basis = await readCanonicalRewardBasis("canonical");
  assert.equal(basis.customerEligibleUsd, 60);
  assert.equal(basis.giftFundedUsd, 40);
  const canonicalRecipient = { ...retry, ledgerId: 2, leadId: "canonical", userId: "gift-customer" };
  await database.exec("UPDATE job_jcmoves_ledger SET quote_total=100 WHERE id=2");
  await assert.rejects(settleJobLedgerRecipient(canonicalRecipient), /funding differs/);
  await database.exec("UPDATE job_jcmoves_ledger SET quote_total=60 WHERE id=2");
  assert.equal(await settleJobLedgerRecipient(canonicalRecipient), true);
  assert.equal(Number((await database.query("SELECT token_balance::text FROM wallet_accounts WHERE user_id='gift-customer'")).rows[0].token_balance), 600);
  await database.exec(`ALTER TABLE leads ADD COLUMN tokens_disbursed_at timestamptz,
    ADD COLUMN completion_rewarded_at timestamptz,ADD COLUMN crew_members text[],ADD COLUMN assigned_to_user_id varchar;
    ALTER TABLE job_jcmoves_ledger ADD COLUMN recipient_type text DEFAULT 'customer';
    UPDATE job_reward_queue SET status='pending',next_attempt_at=NOW() WHERE lead_id='canonical';`);
  assert.equal((await processOneJobReward(async () => null)).status, "retry", "missing stamps cannot complete the handoff");
  await database.exec("UPDATE job_reward_queue SET next_attempt_at=NOW()-INTERVAL '1 second'");
  const finished = await processOneJobReward(async () => {
    await database.exec("UPDATE leads SET tokens_disbursed_at=NOW(),completion_rewarded_at=NOW() WHERE id='canonical'");
  });
  assert.equal(finished.status, "done");
  assert.equal((await processOneJobReward(async () => { throw new Error('must not reissue'); })).status, "idle");
  assert.equal(Number((await database.query("SELECT token_balance::text FROM wallet_accounts WHERE user_id='gift-customer'")).rows[0].token_balance), 600);
  await database.exec(`UPDATE leads SET crew_members=ARRAY['missing-crew'] WHERE id='canonical';
    UPDATE job_reward_queue SET status='pending',next_attempt_at=NOW() WHERE lead_id='canonical';`);
  assert.equal((await processOneJobReward(async () => null)).status, "retry", "missing assigned crew cannot complete the handoff");
  console.log("PASS: worker retries incomplete proof, completes durable settlement and refuses missing crew");
  await database.exec(`INSERT INTO leads(id,total_price,status,payment_paid_at) VALUES('payment-first',100,'new',NOW());
    INSERT INTO quote_revisions VALUES('payment-first-quote','payment-first',1,'approved',NOW(),100,'USD');
    INSERT INTO job_confirmed_payments(provider,provider_payment_id,lead_id,quote_revision_id,
      amount_cents,currency,tender_type,gift_funded_cents,paid_at)
      VALUES('square:sandbox','payment-first','payment-first','payment-first-quote',10000,'USD','card',0,NOW());`);
  assert.equal(await enqueueCompletedPaidJobs(), 0);
  await database.exec("UPDATE leads SET status='completed' WHERE id='payment-first'");
  assert.equal(await enqueueCompletedPaidJobs(), 1);
  assert.equal(await enqueueCompletedPaidJobs(), 0);
  console.log("PASS: payment-before-completion sweep and duplicate handoff prevention");
  await database.exec("UPDATE leads SET status='new' WHERE id='canonical'");
  await assert.rejects(readCanonicalRewardBasis("canonical"), /completed and paid/);
  await database.exec("UPDATE leads SET status='completed' WHERE id='canonical'");
  await recordConfirmedJobRefund({ provider: "square:sandbox", providerPaymentId: "mixed", providerRefundId: "refund",
    amountCents: 100, giftFundedCents: 0, currency: "USD", refundedAt: "2026-09-09T14:00:00Z" });
  await assert.rejects(readCanonicalRewardBasis("canonical"), /requires reward reconciliation/);
  console.log("PASS: canonical reward flag, gift exclusion, funding mismatch, completion gate and refund hold");
  console.log("PASS: immutable award on rate-change retry, atomic rollback, replay, identity and ambiguous-history rejection");
} finally {
  pool.connect = previous;
  pool.query = previousQuery;
  if (previousLedgerFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousLedgerFlag;
  if (previousRewardFlag === undefined) delete process.env.JOB_PAYMENT_REWARDS_ENABLED;
  else process.env.JOB_PAYMENT_REWARDS_ENABLED = previousRewardFlag;
  await database.close();
}
