import assert from "node:assert/strict";
import { mapVerifiedSquareJobPayment as map, type SquarePaymentSnapshot } from "../squareJobPaymentPolicy";
const context = { paymentId: "payment", orderId: "order", locationId: "location",
  leadId: "job", quoteRevisionId: "quote", environment: "sandbox" as const };
const payment: SquarePaymentSnapshot = { id: "payment", orderId: "order", locationId: "location",
  status: "COMPLETED", sourceType: "CARD", amountMoney: { amount: 10000n, currency: "USD" },
  updatedAt: "2026-09-09T12:00:00Z", cardDetails: { card: { cardBrand: "VISA" } } };
assert.equal(map(payment, context).amountCents, 10000);
assert.equal(map(payment, context).provider, "square:sandbox");
assert.equal(map(payment, context).giftFundedCents, 0);
assert.equal(map({ ...payment, cardDetails: { card: { cardBrand: "SQUARE_GIFT_CARD" } } }, context).giftFundedCents, 10000);
for (const status of ["APPROVED", "PENDING", "CANCELED", "FAILED"]) assert.throws(() => map({ ...payment, status }, context));
assert.throws(() => map({ ...payment, id: "different" }, context));
assert.throws(() => map({ ...payment, orderId: "different" }, context));
assert.throws(() => map({ ...payment, locationId: "different" }, context));
assert.throws(() => map({ ...payment, refundedMoney: { amount: 1n, currency: "USD" } }, context));
assert.throws(() => map({ ...payment, refundIds: ["refund"] }, context));
assert.throws(() => map({ ...payment, sourceType: "EXTERNAL" }, context));
assert.throws(() => map({ ...payment, cardDetails: undefined }, context));
assert.throws(() => map({ ...payment, amountMoney: { amount: 1n, currency: "EUR" } }, context));
assert.throws(() => map({ ...payment, amountMoney: { amount: 9007199254740992n, currency: "USD" } }, context));
console.log("Square verified payment mapping policy passed");
