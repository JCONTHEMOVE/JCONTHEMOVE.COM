// node --import tsx scripts/check-job-payment-ledger.ts <pglite-dist-index.js>
// Exercises the real service against disposable PostgreSQL, never production.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { pool } from "../server/db";
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from "../server/services/jobPaymentLedger";
import type { ConfirmedJobPayment } from "../server/services/jobPaymentLedgerPolicy";
import { verifyAndConfirmSquarePayment } from "../server/services/squareJobPaymentVerification";
import { getJobPaymentReconciliation } from "../server/services/jobPaymentReconciliation";
import { recordConfirmedJobRefund } from "../server/services/jobPaymentRefunds";

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
    status text NOT NULL, payment_paid_at timestamptz,tokens_disbursed_at timestamptz,completion_rewarded_at timestamptz);
    INSERT INTO leads(id,total_price,status,payment_paid_at) VALUES ('job',2000,'completed',NULL),('other',2000,'new',NULL),
      ('rollback',100,'completed',NULL);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY, lead_id varchar REFERENCES leads(id),
      revision int, status text, approved_at timestamptz, customer_total numeric(10,2), currency text);
    INSERT INTO quote_revisions VALUES ('quote','job',1,'approved',NOW(),2000,'USD'),
      ('other-quote','other',1,'approved',NOW(),2000,'USD'),
      ('rollback-quote','rollback',1,'approved',NOW(),100,'USD');`);
  for (let repeat = 0; repeat < 3; repeat++) await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  const base: ConfirmedJobPayment = { provider: "square", providerPaymentId: "deposit", leadId: "job",
    quoteRevisionId: "quote", amountCents: 60000, currency: "USD", tenderType: "card", giftFundedCents: 0,
    paidAt: "2026-09-09T12:00:00Z", metadata: { eventId: "test-event" } };
  delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  await assert.rejects(confirmJobPayment(base), /disabled/);
  assert.equal(connections, 0);
  process.env.JOB_PAYMENT_LEDGER_ENABLED = "true";
  assert.equal((await confirmJobPayment(base)).paidInFull, false);
  assert.equal((await database.query("SELECT payment_paid_at FROM leads WHERE id='job'")).rows[0].payment_paid_at, null);
  assert.equal((await confirmJobPayment(base)).duplicate, true);
  const stored = (await database.query("SELECT quote_revision_id,metadata FROM job_confirmed_payments WHERE provider_payment_id='deposit'")).rows[0];
  assert.equal(stored.quote_revision_id, "quote");
  assert.equal(stored.metadata.eventId, "test-event");
  await assert.rejects(confirmJobPayment({ ...base, amountCents: 60001 }), /conflicts/);
  await assert.rejects(confirmJobPayment({ ...base, leadId: "other", quoteRevisionId: "other-quote" }), /conflicts/);
  await assert.rejects(confirmJobPayment({ ...base, quoteRevisionId: "other-quote" }), /approved quote/);
  const adapted = await verifyAndConfirmSquarePayment("adapter-payment", { locationId: "test-location", environment: "sandbox" }, {
    getPayment: async () => ({ id: "adapter-payment", orderId: "test-order", locationId: "test-location",
      status: "COMPLETED", sourceType: "CARD", amountMoney: { amount: 200000n, currency: "USD" },
      updatedAt: "2026-09-09T12:00:00Z", cardDetails: { card: { cardBrand: "SQUARE_GIFT_CARD" } } }),
    findJobQuotes: async (orderId) => {
      assert.equal(orderId, "test-order");
      return [{ lead_id: "other", quote_revision_id: "other-quote" }];
    },
    confirm: confirmJobPayment,
  });
  assert.equal(adapted.paidInFull, true);
  assert.equal(adapted.customerEligibleCents, 0);
  assert.equal(adapted.completed, false);
  assert.equal(adapted.rewardsTriggered, false);
  const report = await getJobPaymentReconciliation("other");
  assert.ok(report?.enabled);
  assert.equal(report.paymentCount, 1);
  assert.equal(report.giftFundedCents, 200000);
  assert.deepEqual(report.reviewReasons, []);
  await database.exec("UPDATE leads SET total_price=2500,tokens_disbursed_at=NOW() WHERE id='other'; UPDATE quote_revisions SET customer_total=2500 WHERE id='other-quote'");
  const mismatched = await getJobPaymentReconciliation("other");
  assert.ok(mismatched?.enabled);
  assert.ok(mismatched.reviewReasons.includes("paid_marker_without_ledger_coverage"));
  assert.ok(mismatched.reviewReasons.includes("reward_marker_requires_review"));
  assert.equal(mismatched.totals?.outstandingCents, 50000);
  assert.ok((await database.query("SELECT payment_paid_at FROM leads WHERE id='other'")).rows[0].payment_paid_at);
  const settled = await confirmJobPayment({ ...base, providerPaymentId: "balance",
    amountCents: 140000, giftFundedCents: 50000, tenderType: "mixed" });
  assert.equal(settled.paidInFull, true);
  assert.equal(settled.paidCents, 200000);
  assert.equal(settled.customerEligibleCents, 150000);
  assert.equal(settled.completed, true);
  assert.equal(settled.rewardsTriggered, false);
  assert.ok((await database.query("SELECT payment_paid_at FROM leads WHERE id='job'")).rows[0].payment_paid_at);
  const refund = { provider: "square", providerPaymentId: "balance", providerRefundId: "refund-one",
    amountCents: 10000, giftFundedCents: 5000, currency: "USD" as const, refundedAt: "2026-09-09T13:00:00Z" };
  assert.equal((await recordConfirmedJobRefund(refund)).duplicate, false);
  assert.equal((await recordConfirmedJobRefund(refund)).duplicate, true);
  await assert.rejects(recordConfirmedJobRefund({ ...refund, amountCents: 10001 }), /conflicts/);
  await assert.rejects(recordConfirmedJobRefund({ ...refund, providerRefundId: "too-much", amountCents: 200000 }), /exceeds/);
  await assert.rejects(recordConfirmedJobRefund({ ...refund, providerRefundId: "wrong-funding", providerPaymentId: "deposit", amountCents: 100, giftFundedCents: 100 }), /funding/);
  await assert.rejects(recordConfirmedJobRefund({ ...refund, providerPaymentId: "unknown" }), /original payment/);
  const afterRefund = await confirmJobPayment(base);
  assert.equal(afterRefund.paidCents, 190000);
  assert.equal(afterRefund.giftFundedCents, 45000);
  assert.equal(afterRefund.paidInFull, false);
  assert.equal(afterRefund.requiresOwnerReview, true);
  const refundReport = await getJobPaymentReconciliation("job");
  assert.ok(refundReport?.enabled);
  assert.equal(refundReport.refundCount, 1);
  assert.equal(refundReport.refundedCents, 10000);
  assert.ok(refundReport.reviewReasons.includes("refund_requires_review"));
  assert.ok(refundReport.reviewReasons.includes("paid_marker_without_ledger_coverage"));
  const rollbackPayment = { ...base, leadId: "rollback", quoteRevisionId: "rollback-quote", providerPaymentId: "retry", amountCents: 10000 };
  failSettlement = true;
  await assert.rejects(confirmJobPayment(rollbackPayment), /injected/);
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM job_confirmed_payments WHERE lead_id='rollback'")).rows[0].n, 0);
  failSettlement = false;
  assert.equal((await confirmJobPayment(rollbackPayment)).paidInFull, true);
  assert.equal((await confirmJobPayment(rollbackPayment)).duplicate, true);
  await database.exec("UPDATE quote_revisions SET status='draft',approved_at=NULL WHERE id='rollback-quote'");
  await assert.rejects(confirmJobPayment(rollbackPayment), /approved quote/);
  await database.exec("UPDATE quote_revisions SET status='approved',approved_at=NOW(),customer_total=101 WHERE id='rollback-quote'");
  await assert.rejects(confirmJobPayment(rollbackPayment), /disagree/);
  await database.exec("UPDATE quote_revisions SET currency='EUR' WHERE id='rollback-quote'");
  await assert.rejects(confirmJobPayment(rollbackPayment), /approved quote/);
  await assert.rejects(database.query("UPDATE job_confirmed_payments SET gift_funded_cents=amount_cents+1"));
  console.log("PASS: repeated schema, disabled gate, cumulative settlement, duplicate/conflict checks, gift exclusion, rollback/retry, refund allocation and net reconciliation");
  console.log("LIMIT: no concurrent-session test, live provider/refund verification, production schema/restore or reward delivery/reversal");
} finally {
  pool.connect = previousConnect;
  if (previousFlag === undefined) delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  else process.env.JOB_PAYMENT_LEDGER_ENABLED = previousFlag;
  await database.close();
}
