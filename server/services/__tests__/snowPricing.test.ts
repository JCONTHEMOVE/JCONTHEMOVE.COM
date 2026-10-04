import assert from "node:assert/strict";
import {
  SNOW_INITIAL_SELECTION, SNOW_PRICING_DEFAULTS, calculateSnowQuote, parseSnowQuoteInput,
  snowScenarioMatrix, buildSnowQuoteDetails, type SnowQuoteInput,
} from "../../../shared/snowPricing";

const initial = { ...SNOW_INITIAL_SELECTION };
const quote = calculateSnowQuote(initial);
assert.equal(quote.areaSqFt, 2000);
assert.deepEqual(quote.cases.map(c => [c.single, c.monthly, c.seasonal]), [
  [70, 560, 2800], [100, 1200, 6000], [125, 1875, 9375],
], "20x100 draft goldens include drag and the 25ft street bank");
assert.equal(quote.amount, 100);
assert.equal(quote.reviewRequired, true, "draft output never authorizes a charge");

const matrix = snowScenarioMatrix(initial);
assert.equal(matrix.length, 12);
assert.equal(new Set(matrix.map(row => `${row.widthFeet}/${row.lengthFeet}/${row.depthInches}`)).size, 12);
for (let size = 0; size < 3; size++) {
  const group = matrix.slice(size * 4, size * 4 + 4);
  assert(group[0].selected.single < group[1].selected.single);
  assert(group[1].selected.single < group[2].selected.single);
  assert(group[2].selected.single < group[3].selected.single);
  assert(group[2].reviewReasons.some(reason => reason.includes("24–36")));
}
const small = calculateSnowQuote({ ...initial, widthFeet: 10, lengthFeet: 40, backDrag: false, streetBank: false });
assert.equal(small.selected.single, 35, "minimum stops small properties falling below visit floor");
const standard = calculateSnowQuote({ ...initial, backDrag: false, streetBank: false });
assert.deepEqual(standard.cases.map(c => c.single), [50, 65, 75]);
const twentyFeet = calculateSnowQuote({ ...initial, bankWidthFeet: 20 });
const thirtyFeet = calculateSnowQuote({ ...initial, bankWidthFeet: 30 });
assert(thirtyFeet.selected.bank > twentyFeet.selected.bank);
assert.equal(calculateSnowQuote({ ...initial, serviceType: "works" }).selected.single, 140);

const monthly = calculateSnowQuote({ ...initial, plan: "monthly", visitsPerMonth: 8 });
assert.equal(monthly.amount, 800);
assert.equal(monthly.selected.visitsPerMonth, 8);
assert.equal(monthly.cases[2].visitsPerMonth, 15, "only the selected planning case is edited");
const seasonal = calculateSnowQuote({ ...initial, plan: "seasonal", visitsPerMonth: 8, seasonMonths: 6, installments: 7, seasonalPayment: "installment" });
assert.equal(seasonal.total, 4800);
assert.equal(seasonal.selected.seasonVisits, 48);
assert.equal(seasonal.amount, 685.71);
assert.equal(seasonal.selected.finalInstallment, 685.74);
assert.equal(Math.round((seasonal.selected.installment * 6 + seasonal.selected.finalInstallment) * 100), 480000,
  "installment rounding preserves the exact contract total");

const endOnly = calculateSnowQuote({ ...initial, serviceType: "end_only" });
assert.equal(endOnly.manualQuoteRequired, true);
assert.equal(endOnly.amount, 0, "whole-driveway dimensions cannot price an end-only apron job");
assert(endOnly.reviewReasons.some(reason => reason.includes("apron")));

for (const [field, value] of [
  ["widthFeet", 0], ["lengthFeet", Infinity], ["depthInches", 15], ["bankWidthFeet", -1],
  ["backDragPercent", 41], ["visitsPerMonth", 1.5], ["seasonMonths", 13], ["installments", 0],
  ["scenario", "fake"], ["plan", "annual-unlimited"], ["streetBank", "false"], ["widthFeet", "20"],
]) assert.throws(() => parseSnowQuoteInput({ ...initial, [field]: value }), `${field} rejects invalid input`);
assert.throws(() => parseSnowQuoteInput(null));
assert.throws(() => parseSnowQuoteInput({ ...initial, version: 2 }));
assert.throws(() => parseSnowQuoteInput({ ...initial, serviceType: "end_only", streetBank: false }));
const parsed = parseSnowQuoteInput({ ...initial, amount: 0.01, total: 0.01, reviewRequired: false, price: 1 });
assert.equal(calculateSnowQuote(parsed).amount, 100, "forged client prices are stripped and recomputed");
assert.equal("price" in parsed, false);
const details = buildSnowQuoteDetails(initial);
assert.equal(details.estimateOnly, true);
assert.equal("price" in details, false);
assert.deepEqual(details.snowQuote, initial);

const config = JSON.parse(JSON.stringify(SNOW_PRICING_DEFAULTS));
config.cases[1].base = 70;
assert.equal(calculateSnowQuote(initial, config).selected.single, 110, "owner config is a reusable engine input");
config.cases[1].base = NaN;
assert.throws(() => calculateSnowQuote(initial, config));
assert.deepEqual(initial, SNOW_INITIAL_SELECTION, "calculation must not mutate request inputs");
console.log("snowPricing: draft goldens, 12 cases, allowances, installments, scope review and validation passed");
