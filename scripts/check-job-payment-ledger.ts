// node --import tsx scripts/check-job-payment-ledger.ts <pglite-dist-index.js>
// Exercises the real service against disposable PostgreSQL, never production.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { pool } from "../server/db";
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from "../server/services/jobPaymentLedger";
import type { ConfirmedJobPayment } from "../server/services/jobPaymentLedgerPolicy";

if (!process.argv[2]) throw new Error("Provide an installed PGlite dist/index.js path");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const database = new PGlite();
const previousConnect = pool.connect;
const previousFlag = process.env.JOB_PAYMENT_LEDGER_ENABLED;
let failSettlement = false;
let connections = 0;
(pool as any).connect = async () => {
  connections++;
  return { query: async (sql: string, args?: unknown[]) => {
    if (failSettlement && sql.startsWith("UPDATE leads")) throw new Error("injected settlement failure");
    return database.query(sql, args);
  }, release() {} };
};
try {
  await database.exec(`CREATE TABLE leads(id varchar PRIMARY KEY, total_price numeric(10,2),
    status text NOT NULL, payment_paid_at timestamptz);
    INSERT INTO leads VALUES ('job',2000,'completed',NULL),('other',2000,'new',NULL),
      ('rollback',100,'completed',NULL);`);
  for (let repeat = 0; repeat < 3; repeat++) await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  const base: ConfirmedJobPayment = { provider: "square", providerPaymentId: "deposit", leadId: "job",
    amountCents: 60000, currency: "USD", tenderType: "card", giftFundedCents: 0,
    paidAt: "2026-09-09T12:00:00Z" };
  delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  await assert.rejects(confirmJobPayment(base), /disabled/);
  assert.equal(connections, 0);
  process.env.JOB_PAYMENT_LEDGER_ENABLED = "true";
  assert.equal((await confirmJobPayment(base)).paidInFull, false);
  assert.equal((await database.query("SELECT payment_paid_at FROM leads WHERE id='job'")).rows[0].payment_paid_at, null);
  assert.equal((await confirmJobPayment(base)).duplicate, true);
  await assert.rejects(confirmJobPayment({ ...base, amountCents: 60001 }), /conflicts/);
  await assert.rejects(confirmJobPayment({ ...base, leadId: "other" }), /conflicts/);
  const settled = await confirmJobPayment({ ...base, providerPaymentId: "balance",
    amountCents: 140000, giftFundedCents: 50000, tenderType: "mixed" });
  assert.equal(settled.paidInFull, true);
  assert.equal(settled.paidCents, 200000);
  assert.equal(settled.customerEligibleCents, 150000);
  assert.equal(settled.completed, true);
  assert.equal(settled.rewardsTriggered, false);
  assert.ok((await database.query("SELECT payment_paid_at FROM leads WHERE id='job'")).rows[0].payment_paid_at);
  const rollbackPayment = { ...base, leadId: "rollback", providerPaymentId: "retry", amountCents: 10000 };
  failSettlement = true;
  await assert.rejects(confirmJobPayment(rollbackPayment), /injected/);
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM job_confirmed_payments WHERE lead_id='rollback'")).rows[0].n, 0);
  failSettlement = false;
  assert.equal((await confirmJobPayment(rollbackPayment)).paidInFull, true);
  assert.equal((await confirmJobPayment(rollbackPayment)).duplicate, true);
  await assert.rejects(database.query("UPDATE job_confirmed_payments SET gift_funded_cents=amount_cents+1"));
  console.log("PASS: repeated schema, disabled gate, cumulative settlement, duplicate/conflict checks, gift exclusion, rollback and retry");
  console.log("LIMIT: no concurrent-session test, provider verification, refunds, production schema/restore or reward delivery");
} finally {
  pool.connect = previousConnect;
  if (previousFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousFlag;
  await database.close();
}
