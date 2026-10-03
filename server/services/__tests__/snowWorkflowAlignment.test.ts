import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The existing guided-workflow projection is pure. Evaluate its real exported
// function with persistence adapters stubbed, rather than importing providers
// or copying the workflow arithmetic into this regression test.
const moduleApi = await import("node:module") as any;
const hook = typeof moduleApi.registerHooks === "function" ? moduleApi.registerHooks({
  resolve(specifier: string, context: any, next: any) {
    return specifier.startsWith(".") && !path.extname(specifier)
      ? next(new URL(`${specifier}.ts`, context.parentURL).href, context)
      : next(specifier, context);
  },
}) : null;
try {
  const { snowWorkflowLeadFields } = await import(pathToFileURL(path.resolve("server/services/snowBookingPricing.ts")).href);
  const source = await readFile("server/services/jobWorkflow.ts", "utf8");
  const start = source.indexOf("export function savedWorkflowQuote(");
  const end = source.indexOf("\nexport async function loadWorkflowState(", start);
  assert.ok(start >= 0 && end > start, "The guided-workflow projection must remain available for snow quotes");
  const isolated = source.slice(start, end).replace("export function", "function");
  const esbuild = await import("esbuild").catch(() => null);
  const javascript = esbuild
    ? (await esbuild.transform(isolated, { loader: "ts", format: "cjs", target: "node20" })).code
    : moduleApi.stripTypeScriptTypes(isolated);
  const savedWorkflowQuote = new Function("cents", "rowToQuote", "workflowHash", "quoteTerms", `${javascript}; return savedWorkflowQuote;`)(
    (value: unknown) => Math.round((Number(value) || 0) * 100),
    (row: unknown) => row,
    (value: unknown) => JSON.stringify(value),
    (lead: unknown) => lead,
  );
  const inputDetails = { snowQuote: { version: 1, plan: "seasonal" }, snowEstimateSnapshot: { contractTotal: 6000, installmentPreferenceAmount: 1200 } };
  const exercise = (raw: number, geographic: number, weekend: number, discount: number) => {
    const quote = { discountTotal: discount, items: [{ serviceCode: "snow_removal", label: "Snow seasonal estimate — The Works; 20 × 100 ft; 4 in; 60 total visits", quantity: 1, unitPrice: raw, lineSubtotal: raw, discountEligible: false, details: inputDetails }] };
    const fields = snowWorkflowLeadFields(quote);
    const total = +(raw + geographic + weekend - discount).toFixed(2);
    const lead = { serviceType: "snow", totalPrice: String(total), quoteSnapshot: { discountTotal: discount }, ...fields };
    const row = { id: "snow-draft", revision: 1, status: "draft", customerTotal: total,
      lineItems: fields.orderLineItems, discountTotal: discount,
      pricingAdjustments: { geographicAmount: geographic, weekendAmount: weekend },
      routeEvidence: {}, travelEligibility: { requiresOwner: true } };
    const projected = savedWorkflowQuote(lead, row);
    assert.equal(projected.matches, true, "The original detailed snow revision must be reused");
    assert.equal(projected.total, total);
    assert.equal(projected.subtotal, +(raw + geographic + weekend).toFixed(2), "Saved geographic adjustments belong in the invoice exactly once");
    assert.equal(projected.discount, discount);
    assert.deepEqual(projected.reasons, []);
    assert.equal(projected.lines[0].total, raw, "The full contract base must not become an installment or geography-adjusted base");
    assert.deepEqual(projected.lines[0].metadata.details, inputDetails, "Scope and installment preferences survive guided approval");
    assert.equal(fields.bundleDiscountAmount, discount.toFixed(2));
    // Regression witness: the old lead shape could not match the detailed
    // saved revision and would fall back to a generic, already-adjusted line.
    assert.equal(savedWorkflowQuote({ ...lead, orderLineItems: null }, row).matches, false);
    return { fields, lead };
  };
  exercise(100, 0, 0, 0);
  exercise(100, 50, 22.5, 8.63);
  const season = exercise(6000, 0, 0, 300);
  assert.equal(season.fields.orderLineItems[0].unitPrice, 6000);
  assert.notEqual(season.fields.orderLineItems[0].unitPrice, 1200);
  const recovered = savedWorkflowQuote(season.lead, null);
  assert.deepEqual(recovered.reasons, [], "If draft persistence fails, recorded discounts still explain the saved total for staff recovery");
  assert.equal(recovered.matches, false, "Staff recovery must still approve a persisted revision");
  console.log("Snow guided-workflow alignment: PASS (full scope, full contract, geography once).");
} finally {
  hook?.deregister();
}
