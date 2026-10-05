import assert from "node:assert/strict";
import { SNOW_INITIAL_SELECTION, SNOW_PRICING_VERSION } from "../../../shared/snowPricing";
import { computeBookingQuote, SERVICE_LINE_MINIMUMS } from "../bookingPricing";
import { assertSnowDraftPaymentAllowed, isSnowCalculatorItem, resolveSnowBookingItem } from "../snowBookingPricing";

const seasonal = {
  ...SNOW_INITIAL_SELECTION, plan: "seasonal" as const, seasonalPayment: "installment" as const,
};
const untrusted = {
  serviceCode: "snow_removal", quantity: 1, unitPrice: 0.01, label: "Already approved",
  details: {
    snowQuote: { ...seasonal, total: 1, unitPrice: 1, reviewRequired: false },
    snowEstimateSnapshot: { contractTotal: 1, reviewRequired: false },
    snowPricingVersion: "forged", pricingRateSource: "approved", estimateOnly: false,
    laborMeta: { crewSize: 1, laborHours: 1, ratePerHour: 0.01 },
    crewSize: 1, hours: 1, price: 1, total: 1, minimumLineSubtotal: 9999,
    packageLabel: "Unlimited visits, fully paid", scope: "Free snow removal", notes: "Payment approved",
    serviceAddress: "123 Test Lane", requestedDate: "2026-12-01", date: "2026-12-01", arrivalWindow: "Morning",
  },
};
const original = structuredClone(untrusted);
const resolved = resolveSnowBookingItem(untrusted)!;
assert.equal(resolved.line.unitPrice, 6000, "the server bills the complete contract, not the requested installment");
assert.equal(resolved.line.quantity, 1);
assert.equal(resolved.line.priceMode, "quote");
assert.equal(resolved.line.discountEligible, false);
assert.equal(resolved.line.minimumLineSubtotal, 0, "the calculator already enforces the snow-specific minimum");
assert.equal(resolved.line.laborMeta, undefined, "snow does not inherit a fabricated labor calculation");
assert.match(resolved.line.label, /20 × 100 ft; 4 in; 12 visits\/month for 5 months \(60 total visits\)/);
const details = resolved.line.details!;
assert.equal(details.estimateOnly, true);
assert.equal(details.snowPricingVersion, SNOW_PRICING_VERSION);
assert.equal(details.pricingRateSource, "snow_calculator");
assert.equal(details.scope, "Driveway Only");
assert.match(String(details.packageLabel), /4 × \$1200\.00 and final \$1200\.00/);
assert.match(String(details.packageLabel), /does not create automatic charges/);
assert.match(String(details.packageLabel), /entire service period is fulfilled/);
assert.match(String(details.packageLabel), /Extra visits/);
for (const key of ["laborMeta", "crewSize", "hours", "price", "total", "minimumLineSubtotal"]) {
  assert.equal(key in details, false, `${key} cannot leak from the client into authoritative details`);
}
assert.deepEqual(details.snowQuote, seasonal, "input prices and approval flags are removed");
assert.equal(details.serviceAddress, "123 Test Lane");
assert.equal(details.requestedDate, "2026-12-01");
assert.equal(details.date, "2026-12-01");
assert.equal(details.arrivalWindow, "Morning");
const snapshot = details.snowEstimateSnapshot as Record<string, unknown>;
assert.equal(snapshot.contractTotal, 6000);
assert.equal(snapshot.installmentPreferenceAmount, 1200);
assert.equal(snapshot.reviewRequired, true);
assert.equal(snapshot.manualQuoteRequired, false);
assert(resolved.reviewReasons.length > 0);
assert.deepEqual(untrusted, original, "resolving an intake never mutates the original request");

const small = resolveSnowBookingItem({ serviceCode: "snow_removal", quantity: 1, details: {
  snowQuote: { ...SNOW_INITIAL_SELECTION, widthFeet: 10, lengthFeet: 40, backDrag: false, streetBank: false },
} })!;
assert.equal(small.line.unitPrice, 35);
assert.equal(computeBookingQuote([small.line]).finalTotal, 35,
  "new structured snow retains its $35 calculator floor through the generic quote engine");
assert.equal(computeBookingQuote([small.line], { serviceMinimums: { snow_removal: 999 } }).finalTotal, 35,
  "active legacy rate cards cannot silently replace an explicit snow calculator minimum");
const legacyLine = { serviceCode: "snow_removal", label: "Snow", quantity: 1, unitPrice: 35 };
assert.equal(computeBookingQuote([legacyLine]).finalTotal, SERVICE_LINE_MINIMUMS.snow_removal,
  "existing snow bookings keep their canonical minimum");
for (const floor of [-1, NaN, Infinity]) {
  assert.equal(computeBookingQuote([{ ...legacyLine, minimumLineSubtotal: floor }]).finalTotal,
    SERVICE_LINE_MINIMUMS.snow_removal, "invalid floor overrides fall back to the canonical minimum");
}

for (const item of [
  { serviceCode: "snow_removal", quantity: 1 },
  { serviceCode: "snow_removal", quantity: 1, details: { snowDrivewaySize: "large", price: 1 } },
  { serviceCode: "lawn_care", quantity: 1, details: { snowQuote: seasonal } },
]) {
  assert.equal(isSnowCalculatorItem(item), false);
  assert.equal(resolveSnowBookingItem(item), null, "legacy and other-service intake is left to existing pricing");
}
const inheritedMarker = { serviceCode: "snow_removal", quantity: 1, details: Object.create({ snowQuote: seasonal }) };
assert.equal(isSnowCalculatorItem(inheritedMarker), false, "the structured marker must be an own property");
const invalidDetails: unknown[] = [
  null, undefined, false, true, 0, 42, "", "snowQuote", JSON.stringify({ snowQuote: seasonal }),
  [], [{ snowQuote: seasonal }], Object.assign([], { snowQuote: seasonal }),
];
for (const details of invalidDetails) {
  assert.equal(isSnowCalculatorItem({ serviceCode: "snow_removal", details }), false,
    "only non-array object details can carry a snow calculator marker");
}
// Persisted Drizzle rows deliberately expose JSON details as unknown. Keep
// the detector usable as their Array.some callback without a cast.
const storedServiceItems: Array<{ serviceCode: string; details: unknown }> = [
  ...invalidDetails.map(details => ({ serviceCode: "snow_removal", details })),
  { serviceCode: "snow_removal", details: {} },
  { serviceCode: "moving", details: { snowQuote: seasonal } },
];
assert.equal(storedServiceItems.some(isSnowCalculatorItem), false);
storedServiceItems.push({ serviceCode: "snow_removal", details: { snowQuote: seasonal } });
assert.equal(storedServiceItems.some(isSnowCalculatorItem), true, "valid stored snow quotes are detected");
for (const invalid of [null, undefined, false, 0, "invalid", [], {}, { ...seasonal, version: 2 }]) {
  const item = { serviceCode: "snow_removal", quantity: 1, details: { snowQuote: invalid } };
  assert.equal(isSnowCalculatorItem(item), true, "an invalid explicit marker must not fall back to legacy pricing");
  assert.throws(() => resolveSnowBookingItem(item), { name: "SnowPricingValidationError" });
  assert.throws(() => assertSnowDraftPaymentAllowed([item], { payFromWallet: true }), /staff approval before payment/);
  assert.throws(() => assertSnowDraftPaymentAllowed([item], { applyTokens: 1 }), /staff approval before payment/);
}
for (const quantity of [0, 2, -1, 0.5, NaN]) {
  assert.throws(() => resolveSnowBookingItem({ ...untrusted, quantity }), /one snow plan/);
}
for (const [field, value] of [
  ["widthFeet", 0], ["widthFeet", "20"], ["lengthFeet", Infinity], ["depthInches", 15],
  ["backDragPercent", 19], ["backDragPercent", 41], ["visitsPerMonth", 1.5],
  ["seasonMonths", 13], ["installments", 0], ["streetBank", "true"], ["plan", "unlimited"],
]) {
  assert.throws(() => resolveSnowBookingItem({ serviceCode: "snow_removal", quantity: 1,
    details: { snowQuote: { ...seasonal, [field]: value } },
  }), { name: "SnowPricingValidationError" }, `${field} is validated at the server boundary`);
}
const endOnly = resolveSnowBookingItem({ serviceCode: "snow_removal", quantity: 1,
  details: { snowQuote: { ...SNOW_INITIAL_SELECTION, serviceType: "end_only" } },
})!;
assert.equal(endOnly.line.unitPrice, 0, "an apron-only job needs a manual quote, not a driveway formula");
assert.equal(computeBookingQuote([endOnly.line]).finalTotal, 0, "pending manual quotes are not floored into a charge");
assert.equal((endOnly.line.details!.snowEstimateSnapshot as Record<string, unknown>).manualQuoteRequired, true);
assert(endOnly.reviewReasons.some(reason => reason.includes("apron")));

for (const payment of [{ payFromWallet: true }, { applyTokens: 1 }, { payFromWallet: true, applyTokens: 100 }]) {
  assert.throws(() => assertSnowDraftPaymentAllowed([untrusted], payment), /staff approval before payment/);
  assert.throws(() => assertSnowDraftPaymentAllowed([
    { serviceCode: "moving" }, untrusted,
  ], payment), /staff approval before payment/, "mixed-service carts cannot pay an unapproved snow draft");
}
assert.doesNotThrow(() => assertSnowDraftPaymentAllowed([untrusted], { payFromWallet: false, applyTokens: 0 }));
assert.doesNotThrow(() => assertSnowDraftPaymentAllowed([{ serviceCode: "snow_removal", details: {} }], {
  payFromWallet: true, applyTokens: 100,
}), "legacy payment behavior stays unchanged");
assert.doesNotThrow(() => assertSnowDraftPaymentAllowed([{ serviceCode: "moving" }], { payFromWallet: true }));

console.log("snowBookingPricing: authoritative contract totals, draft payment gate, legacy floors and input validation passed");
