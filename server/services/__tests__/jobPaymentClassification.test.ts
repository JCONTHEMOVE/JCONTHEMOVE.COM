import assert from "node:assert/strict";
import { classifyJobInvoicePayment } from "../jobPaymentClassification";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log("job invoice payment classification");

test("does not treat a paid 30% deposit invoice as a paid-in-full job", () => {
  assert.deepEqual(classifyJobInvoicePayment({
    invoiceAmount: 600,
    jobTotal: 2000,
    depositAmount: 600,
    depositRequired: true,
    depositAlreadyPaid: false,
  }), { kind: "deposit", invoiceAmount: 600, jobTotal: 2000, accountingAmount: 0 });
});

test("treats a full-price first invoice as paid in full", () => {
  assert.equal(classifyJobInvoicePayment({
    invoiceAmount: 2000,
    jobTotal: 2000,
    depositAmount: 600,
    depositRequired: true,
    depositAlreadyPaid: false,
  }).kind, "paid_in_full");
});

test("accounts for the full approved total when the balance follows a deposit", () => {
  assert.deepEqual(classifyJobInvoicePayment({
    invoiceAmount: 1400,
    jobTotal: 2000,
    depositAmount: 600,
    depositRequired: true,
    depositAlreadyPaid: true,
  }), { kind: "paid_in_full", invoiceAmount: 1400, jobTotal: 2000, accountingAmount: 2000 });
});

test("keeps a duplicate deposit webhook classified as a deposit", () => {
  assert.equal(classifyJobInvoicePayment({
    invoiceAmount: 600,
    jobTotal: 2000,
    depositAmount: 600,
    depositRequired: true,
    depositAlreadyPaid: true,
  }).kind, "deposit");
});

test("does not infer a finalized job total from an invoice", () => {
  assert.equal(classifyJobInvoicePayment({
    invoiceAmount: "725.50",
    jobTotal: null,
    depositRequired: false,
  }).kind, "partial");
});

test("a final-balance label cannot turn an underpayment into full settlement", () => {
  const result = classifyJobInvoicePayment({ invoiceAmount: 100, jobTotal: 2000,
    depositAmount: 600, depositAlreadyPaid: true, invoicePurpose: "final_balance" });
  assert.equal(result.kind, "partial");
  assert.equal(result.accountingAmount, 0);
});

test("a supplement label and an unpaid deposit do not establish settlement", () => {
  assert.equal(classifyJobInvoicePayment({ invoiceAmount: 1400, jobTotal: 2000,
    depositAmount: 600, depositAlreadyPaid: false, invoicePurpose: "supplement" }).kind, "partial");
});

test("ordinary partial invoices and zero payments do not settle a job", () => {
  for (const invoiceAmount of [0, 100, 1999.99]) {
    assert.equal(classifyJobInvoicePayment({ invoiceAmount, jobTotal: 2000 }).kind, "partial");
  }
});

test("uses explicit deposit purpose even when legacy amounts are ambiguous", () => {
  assert.equal(classifyJobInvoicePayment({
    invoiceAmount: 500,
    jobTotal: 500,
    depositRequired: false,
    invoicePurpose: "deposit",
  }).kind, "deposit");
});

test("uses explicit final-balance purpose after an earlier deposit", () => {
  assert.deepEqual(classifyJobInvoicePayment({
    invoiceAmount: 1400,
    jobTotal: 2000,
    depositAmount: 600,
    depositRequired: true,
    depositAlreadyPaid: true,
    invoicePurpose: "final_balance",
  }), { kind: "paid_in_full", invoiceAmount: 1400, jobTotal: 2000, accountingAmount: 2000 });
});

test("zero and short deposit invoices cannot confirm dispatch", () => {
  for (const invoicePurpose of [undefined, "deposit"]) {
    for (const invoiceAmount of [0, 1, 599.98, 599.99]) {
      assert.equal(classifyJobInvoicePayment({ invoiceAmount, jobTotal: 2000,
        depositAmount: 600, depositRequired: true, depositAlreadyPaid: false,
        invoicePurpose }).kind, "partial");
    }
  }
});

test("a one-cent final balance is still due", () => {
  assert.equal(classifyJobInvoicePayment({ invoiceAmount: 1999.99, jobTotal: 2000,
    depositAmount: 600, depositRequired: true, depositAlreadyPaid: true,
    invoicePurpose: "deposit" }).kind, "deposit");
  assert.equal(classifyJobInvoicePayment({ invoiceAmount: 1399.99, jobTotal: 2000,
    depositAmount: 600, depositRequired: true, depositAlreadyPaid: true,
    invoicePurpose: "final_balance" }).kind, "partial");
});

if (!process.exitCode) console.log(`  ${passed} tests passed`);
