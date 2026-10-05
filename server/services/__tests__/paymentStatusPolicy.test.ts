import assert from "node:assert/strict";
import { derivePaymentStatusFromRecord as status } from "../paymentStatusPolicy";

// Payment intent must not unlock UI that treats wallet_paid as settled.
assert.deepEqual(status({ paymentPlan: "wallet_pay_now", paymentPaidAt: null }), {
  key: "awaiting_wallet", label: "Awaiting wallet payment", color: "yellow",
});
assert.equal(status({ paymentPlan: "wallet_pay_now" }).key, "awaiting_wallet");
assert.equal(status({ paymentPlan: "wallet_pay_now", depositPaid: true }).key, "awaiting_wallet");
const paymentPaidAt = "2026-09-09T16:00:00.000Z";
assert.equal(status({ paymentPlan: "wallet_pay_now", paymentPaidAt }).key, "wallet_paid");
assert.equal(status({ paymentPlan: "pay_on_completion", paymentPaidAt }).key, "fully_paid");
assert.equal(status({ depositRequired: true, depositPaid: true }).key, "deposit_paid");
assert.equal(status({ depositRequired: true, depositPaid: false }).key, "awaiting_deposit");
assert.equal(status({ paymentPlan: "cash_or_btc" }).key, "cash_on_site");
assert.equal(status({ paymentPlan: "pay_on_completion" }).key, "pay_on_completion");
assert.equal(status({}).key, "unknown");
console.log("Payment status settlement policy passed");
