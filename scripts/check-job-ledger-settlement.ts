// Runs actual settlement SQL against disposable PGlite, never production.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { pool } from "../server/db";
import { settleJobLedgerRecipient } from "../server/services/jobLedgerSettlement";

if (!process.argv[2]) throw new Error("Provide an installed PGlite dist/index.js path");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const database = new PGlite();
const previous = pool.connect;
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
  console.log("PASS: immutable award on rate-change retry, atomic rollback, replay, identity and ambiguous-history rejection");
} finally {
  pool.connect = previous;
  await database.close();
}
