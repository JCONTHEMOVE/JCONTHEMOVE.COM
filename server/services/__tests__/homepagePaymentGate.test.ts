import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
// Exercise the actual signed-webhook gate with mocked GetInvoice. The gate runs
// before invoice-paid writes, reward effects or scheduling confirmation.
const source = readFileSync("server/squareWebhook.ts", "utf8");
const start = source.indexOf('          const localInvoice = await storage.getSquareInvoiceBySquareId(squareInvoiceId);');
const end = source.indexOf('          const { claimSquareInvoicePaymentEffect }', start);
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(`async function run(){${source.slice(start,end)} return verifiedBookingInvoiceStatus;}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
for (const providerState of ["UNPAID", "DRAFT", "SCHEDULED", "PARTIALLY_PAID", "PAID"]) {
  let reads = 0;
  const dependencies = {
    squareInvoiceId: "synthetic-invoice", storage: { getSquareInvoiceBySquareId: async () => ({ leadId: "synthetic-lead" }) },
    pool: { query: async (query: string) => ({ rows: query.includes("to_regclass") ? [{ name: "booking_slot_holds" }] : [{ id: "synthetic-hold" }] }) },
    squareInvoiceService: { getInvoiceStatus: async (id: string) => { assert.equal(id, "synthetic-invoice"); reads++; return providerState; } },
  };
  const run = new Function(...Object.keys(dependencies), compiled + ";return run;")(...Object.values(dependencies));
  if (providerState === "PAID") assert.equal(await run(), "PAID");
  else await assert.rejects(run(), /not server-verified paid/);
  assert.equal(reads, 1);
}
console.log("Homepage payment gate: mocked Square GetInvoice must verify PAID before local paid state or booking effects");
