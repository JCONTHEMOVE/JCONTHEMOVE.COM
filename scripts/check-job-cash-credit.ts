import assert from "node:assert/strict";
import { createDisposableLedgerDatabase } from "./disposable-ledger-database";
import { pool } from "../server/db";
import { creditJobCash } from "../server/services/jobCashCredit";

const database = await createDisposableLedgerDatabase(process.argv[2]);
const previous = pool.connect;
let failure = "";
pool.connect = (async () => ({
  query(sql: string, args?: unknown[]) {
    if (failure && sql.includes(failure)) throw new Error("injected cash-credit failure");
    return database.query(sql, args);
  }, release() {},
})) as typeof pool.connect;
try {
  await database.exec(`CREATE TABLE leads(id text PRIMARY KEY,email text);
    CREATE TABLE users(id text PRIMARY KEY,email text);
    CREATE TABLE rewards(user_id text,reward_type text,token_amount numeric,cash_value numeric,
      status text,reference_id text,metadata jsonb);
    CREATE TABLE wallet_accounts(user_id text PRIMARY KEY,token_balance numeric,cash_balance numeric);
    CREATE TABLE wallet_transactions(transaction_type text,amount numeric,balance_after numeric,status text,metadata jsonb);
    INSERT INTO leads VALUES('job','customer@example.test'),('unclaimed',NULL);
    INSERT INTO users VALUES('customer','customer@example.test');
    INSERT INTO wallet_accounts VALUES('customer',7,12.50);`);
  for (const statement of ["UPDATE wallet_accounts", "INSERT INTO rewards", "INSERT INTO wallet_transactions"]) {
    failure = statement;
    await assert.rejects(creditJobCash("job", 100, "webhook"), /injected/);
    assert.equal(Number((await database.query("SELECT cash_balance FROM wallet_accounts")).rows[0].cash_balance), 12.5);
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM rewards")).rows[0].n, 0);
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM wallet_transactions")).rows[0].n, 0);
  }
  failure = "";
  assert.equal(await creditJobCash("job", 100, "webhook"), "credited");
  assert.equal(await creditJobCash("job", 200, "invoice_sync"), "duplicate");
  const wallet = (await database.query("SELECT * FROM wallet_accounts")).rows[0];
  assert.equal(Number(wallet.cash_balance), 112.5);
  assert.equal(Number(wallet.token_balance), 7);
  const transaction = (await database.query("SELECT * FROM wallet_transactions")).rows;
  assert.equal(transaction.length, 1);
  assert.equal(Number(transaction[0].balance_after), 112.5);
  assert.equal(transaction[0].metadata.userId, "customer");
  assert.equal(await creditJobCash("unclaimed", 100, "webhook"), "unclaimed");
  await assert.rejects(creditJobCash("missing", 100, "webhook"), /not found/);
  for (const amount of [0, -1, NaN, Infinity, 0.001, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(creditJobCash("job", amount, "webhook"), /Invalid/);
  }
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM rewards")).rows[0].n, 1);
  console.log("PASS: cash credit rollback, cross-source replay, exact balance and unclaimed/invalid inputs");
} finally {
  pool.connect = previous;
  await database.close();
}
