import assert from "node:assert/strict";
import { validateConfirmedJobPayment, reconcileJobPaymentTotals, type ConfirmedJobPayment } from "../jobPaymentLedgerPolicy";

const payment: ConfirmedJobPayment = { provider: "square", providerPaymentId: "test-payment",
  leadId: "test-job", quoteRevisionId: "test-quote", amountCents: 10000, giftFundedCents: 2000, currency: "USD",
  tenderType: "mixed", paidAt: "2026-09-09T12:00:00Z" };
validateConfirmedJobPayment(payment);
for (const amountCents of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => validateConfirmedJobPayment({ ...payment, amountCents }));
}
for (const giftFundedCents of [-1, 10001, 0.5]) {
  assert.throws(() => validateConfirmedJobPayment({ ...payment, giftFundedCents }));
}
assert.throws(() => validateConfirmedJobPayment({ ...payment, currency: "EUR" as "USD" }));
assert.throws(() => validateConfirmedJobPayment({ ...payment, paidAt: "invalid" }));
assert.throws(() => validateConfirmedJobPayment({ ...payment, providerPaymentId: " " }));
assert.throws(() => validateConfirmedJobPayment({ ...payment, quoteRevisionId: " " }));
assert.throws(() => validateConfirmedJobPayment({ ...payment, metadata: { oversized: "🙂".repeat(3000) } }));
validateConfirmedJobPayment({ ...payment, metadata: { eventId: "verified-test-event" } });
assert.equal(reconcileJobPaymentTotals(200000, 60000, 0).paidInFull, false);
assert.equal(reconcileJobPaymentTotals(200000, 199999, 0).outstandingCents, 1);
assert.deepEqual(reconcileJobPaymentTotals(200000, 200000, 50000), {
  paidInFull: true, outstandingCents: 0, overpaidCents: 0, customerEligibleCents: 150000,
});
assert.deepEqual(reconcileJobPaymentTotals(200000, 210000, 0), {
  paidInFull: true, outstandingCents: 0, overpaidCents: 10000, customerEligibleCents: 200000,
});
assert.equal(reconcileJobPaymentTotals(200000, 200000, 200000).customerEligibleCents, 0);
assert.throws(() => reconcileJobPaymentTotals(0, 100, 0));
assert.throws(() => reconcileJobPaymentTotals(100, 100, 101));
console.log("Canonical payment ledger input and settlement policy passed");
