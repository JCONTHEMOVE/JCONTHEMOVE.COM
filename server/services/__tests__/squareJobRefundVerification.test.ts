import assert from "node:assert/strict";
import { verifyAndRecordSquareRefund as verify, type SquareRefundSnapshot } from "../squareJobRefundVerification";
import { mapVerifiedSquareJobPayment, type SquarePaymentSnapshot } from "../squareJobPaymentPolicy";
import type { ConfirmedJobPayment } from "../jobPaymentLedgerPolicy";
import type { ConfirmedJobRefund } from "../jobPaymentRefunds";

const context = { locationId: "location", environment: "sandbox" as const };
const refund: SquareRefundSnapshot = { id: "refund", paymentId: "payment", locationId: "location",
  status: "COMPLETED", amountMoney: { amount: 2500n, currency: "USD" }, updatedAt: "2026-09-09T12:00:00Z" };
const payment: SquarePaymentSnapshot = { id: "payment", orderId: "order", locationId: "location",
  status: "COMPLETED", sourceType: "CARD", amountMoney: { amount: 10000n, currency: "USD" },
  refundedMoney: { amount: 2500n, currency: "USD" }, refundIds: ["refund"],
  cardDetails: { card: { cardBrand: "VISA" }, cardPaymentTimeline: { capturedAt: "2026-09-08T12:00:00Z" } } };
const calls: string[] = [];
const dependencies = {
  getRefund: async (id: string) => { calls.push(`refund:${id}`); return refund; },
  getPayment: async (id: string) => { calls.push(`payment:${id}`); return payment; },
  findJobQuotes: async (id: string) => { calls.push(`order:${id}`); return [{ lead_id: "job", quote_revision_id: "quote" }]; },
  record: async (original: ConfirmedJobPayment, completed: ConfirmedJobRefund) => { calls.push("record"); return { original, completed }; },
};
const result = await verify("refund", context, dependencies);
assert.deepEqual(calls, ["refund:refund", "payment:payment", "order:order", "record"]);
assert.equal(result.completed.giftFundedCents, 0);
assert.equal(result.original.paidAt, "2026-09-08T12:00:00Z");
const gift = await verify("refund", context, { ...dependencies, getPayment: async () => ({ ...payment,
  cardDetails: { ...payment.cardDetails, card: { cardBrand: "SQUARE_GIFT_CARD" } } }) });
assert.equal(gift.completed.giftFundedCents, 2500);
let recorded = 0;
const rejectRecord = async () => { recorded++; throw new Error("Unexpected recording"); };
for (const bad of [undefined, { ...refund, id: "other" }, { ...refund, status: "PENDING" },
  { ...refund, unlinked: true }, { ...refund, paymentId: null }, { ...refund, locationId: "elsewhere" },
  { ...refund, amountMoney: { amount: 0n, currency: "USD" } },
  { ...refund, amountMoney: { amount: 2500n, currency: "CAD" } }, { ...refund, updatedAt: "invalid" },
  { ...refund, amountMoney: { amount: 10001n, currency: "USD" } }]) {
  await assert.rejects(verify("refund", context, { ...dependencies, getRefund: async () => bad, record: rejectRecord }));
}
for (const bad of [{ ...payment, id: "other" }, { ...payment, tipMoney: { amount: 100n, currency: "USD" } },
  { ...payment, cardDetails: { card: { cardBrand: "VISA" } } }]) {
  await assert.rejects(verify("refund", context, { ...dependencies, getPayment: async () => bad, record: rejectRecord }));
}
assert.equal(recorded, 0);
await assert.rejects(verify("refund", context, { ...dependencies, record: async () => { throw new Error("database failure"); } }), /database failure/);
assert.throws(() => mapVerifiedSquareJobPayment(payment, { ...context, paymentId: "payment", orderId: "order",
  leadId: "job", quoteRevisionId: "quote" }), /requires refund reconciliation/);
console.log("Square refund verification, funding, ordering and fail-closed checks passed");
