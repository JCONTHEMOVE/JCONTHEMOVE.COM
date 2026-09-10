import assert from "node:assert/strict";
import { verifyAndConfirmSquarePayment as verify, type SquareJobPaymentVerificationDependencies } from "../squareJobPaymentVerification";
import type { ConfirmedJobPayment } from "../jobPaymentLedgerPolicy";
import type { SquarePaymentSnapshot } from "../squareJobPaymentPolicy";

const context = { locationId: "configured-location", environment: "sandbox" as const };
const payment: SquarePaymentSnapshot = { id: "provider-payment", orderId: "provider-order",
  locationId: context.locationId, status: "COMPLETED", sourceType: "CARD",
  amountMoney: { amount: 60000n, currency: "USD" }, updatedAt: "2026-09-09T12:00:00Z",
  cardDetails: { card: { cardBrand: "VISA" } } };
const calls: string[] = [];
let recorded: ConfirmedJobPayment | undefined;
const dependencies: SquareJobPaymentVerificationDependencies<string> = {
  getPayment: async (id) => { calls.push(`retrieve:${id}`); return payment; },
  findJobQuotes: async (id) => { calls.push(`resolve:${id}`); return [{ lead_id: "stored-job", quote_revision_id: "stored-quote" }]; },
  confirm: async (record) => { calls.push("confirm"); recorded = record; return "committed"; },
};
assert.equal(await verify("provider-payment", context, dependencies), "committed");
assert.deepEqual(calls, ["retrieve:provider-payment", "resolve:provider-order", "confirm"]);
assert.equal(recorded?.leadId, "stored-job");
assert.equal(recorded?.quoteRevisionId, "stored-quote");
assert.equal(recorded?.amountCents, 60000);

let confirmations = 0;
const forbiddenConfirm = async () => { confirmations++; throw new Error("must not settle"); };
await assert.rejects(verify("provider-payment", context, { ...dependencies,
  getPayment: async () => { throw new Error("provider unavailable"); }, confirm: forbiddenConfirm }), /provider unavailable/);
for (const result of [undefined, { ...payment, status: "APPROVED" }, { ...payment, locationId: "wrong" },
  { ...payment, refundedMoney: { amount: 1n, currency: "USD" } }]) {
  await assert.rejects(verify("provider-payment", context, { ...dependencies,
    getPayment: async () => result, confirm: forbiddenConfirm }));
}
for (const bindings of [[], [{ lead_id: "a", quote_revision_id: "one" }, { lead_id: "b", quote_revision_id: "two" }]]) {
  await assert.rejects(verify("provider-payment", context, { ...dependencies,
    findJobQuotes: async () => bindings, confirm: forbiddenConfirm }), /exactly one/);
}
assert.equal(confirmations, 0);
await assert.rejects(verify("provider-payment", context, { ...dependencies,
  confirm: async () => { throw new Error("ledger failure"); } }), /ledger failure/);
console.log("Square retrieval, association, rejection and failure propagation passed");
