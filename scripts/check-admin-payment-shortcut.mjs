// Isolated component acceptance: every API call is intercepted; no server is started.
// Install jsdom@26 in a disposable prefix and set JC_UI_TEST_RUNTIME to that prefix.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const require = createRequire(path.join(process.env.JC_UI_TEST_RUNTIME || process.cwd(), "package.json"));
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://example.test", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle", "localStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
dom.window.HTMLElement.prototype.setPointerCapture = function () {};
dom.window.HTMLElement.prototype.releasePointerCapture = function () {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const outputDir = path.resolve("node_modules/.cache/admin-payment-shortcut-test");
await mkdir(outputDir, { recursive: true });
const output = path.join(outputDir, "component.mjs");
await build({ entryPoints: ["client/src/components/AdminJobPaymentShortcut.tsx"], outfile: output, bundle: true,
  platform: "node", format: "esm", packages: "external", jsx: "automatic", define: { "import.meta.env": "{}" } });
const { AdminJobPaymentShortcut } = await import(pathToFileURL(output).href);
const { act } = React;
let fixture;
let requests;
let postHandler;
let role;
let root;
let client;
let passed = 0;
const initial = () => ({
  lead: { id: "test-job", orderNumber: 123, firstName: "Test", lastName: "Customer", email: "customer@example.test",
    status: "available", source: "website", fromAddress: "Test service address", moveDate: "2026-01-01",
    totalPrice: "450.00", paymentPaidAt: null, crewMembers: ["crew-a"], crewLeadUserId: "crew-a" },
  employees: [{ id: "crew-a", firstName: "Test", lastName: "Mover" }],
  rewards: { state: "full_payment_missing", paidInFull: false, completed: false, customerPool: 6750, crewPool: 6750, records: [] },
  reconciliation: { enabled: false, reviewReasons: [] },
});
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  const method = options.method || "GET";
  requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
  if (method === "POST") return postHandler(url, options);
  if (url === "/api/auth/user") return response({ id: "reviewer", role });
  const values = {
    "/api/leads/test-job": fixture.lead,
    "/api/employees": fixture.employees,
    "/api/leads/test-job/jcmoves-status": fixture.rewards,
    "/api/admin/payments/reconciliation/test-job": fixture.reconciliation,
  };
  assert.ok(url in values, `Unexpected request: ${method} ${url}`);
  return response(values[url]);
};
const posts = () => requests.filter(request => request.method === "POST");
const byTestId = id => document.querySelector(`[data-testid='${id}']`);
const button = text => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === text);
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function until(predicate, description) {
  for (let attempt = 0; attempt < 80; attempt++) { if (predicate()) return; await settle(); }
  assert.fail(`Timed out: ${description}\n${document.body.textContent}`);
}
async function click(node) { assert.ok(node, "Click target exists"); await act(async () => { node.click(); }); await settle(); }
async function mount(newRole = "admin") {
  fixture = initial(); requests = []; role = newRole;
  postHandler = () => { throw new Error("No POST expected in this scenario"); };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(AdminJobPaymentShortcut, { leadId: "test-job" }))));
  await settle();
}
async function cleanup() { await act(async () => root.unmount()); client.clear(); await settle(); }
async function open() {
  await until(() => byTestId("button-admin-payment-shortcut"), "admin shortcut");
  for (let count = 0; count < 5; count++) await click(byTestId("button-admin-payment-shortcut"));
  await until(() => document.querySelector("input[value='payment']:not(:disabled)"), "loaded payment choices");
  await until(() => !document.querySelector("fieldset")?.disabled, "fresh snapshot");
}
async function choose(action) { await click(document.querySelector(`input[value='${action}']`)); }
async function cash() {
  await click(document.getElementById("shortcut-payment-cash"));
}
async function review() { await click(byTestId("button-review-admin-payment")); }
async function acknowledge() { await click(document.querySelector("[role='checkbox']")); }
function paid() {
  fixture.lead.status = "completed"; fixture.lead.paymentPaidAt = "2026-01-01T18:00:00.000Z";
  fixture.rewards = { ...fixture.rewards, state: "ready_to_issue", paidInFull: true, completed: true };
}
async function test(name, run) {
  console.log(`RUN ${name}`);
  await mount();
  try { await run(); passed++; console.log(`PASS ${name}`); }
  finally { await cleanup(); }
}

try {
  await test("five clicks open a read-only dialog; four clicks and cancellation have no effect", async () => {
    for (let count = 0; count < 4; count++) await click(byTestId("button-admin-payment-shortcut"));
    assert.equal(byTestId("admin-payment-dialog"), null);
    assert.equal(requests.filter(request => request.url !== "/api/auth/user").length, 0);
    await click(byTestId("button-admin-payment-shortcut"));
    await until(() => byTestId("admin-payment-job-summary"), "job summary");
    assert.equal(posts().length, 0);
    await click(button("Cancel"));
    assert.equal(byTestId("admin-payment-dialog"), null);
    await click(byTestId("button-admin-payment-shortcut"));
    assert.equal(byTestId("admin-payment-dialog"), null, "closing resets the five-click sequence");
  });

  await test("payment review requires a method and acknowledgement; Back and Cancel never submit", async () => {
    await open(); await choose("payment");
    assert.ok(byTestId("button-review-admin-payment").disabled);
    await cash(); await review();
    assert.match(document.body.textContent, /Final admin confirmation/);
    assert.match(document.body.textContent, /Test Mover/);
    assert.match(document.body.textContent, /\$450\.00/);
    assert.ok(byTestId("button-final-confirm-admin-payment").disabled);
    await acknowledge();
    assert.equal(byTestId("button-final-confirm-admin-payment").disabled, false);
    await click(button("Back")); await click(button("Cancel"));
    assert.equal(posts().length, 0);
  });

  await test("only final confirmation records the captured cash receipt", async () => {
    await open(); await choose("payment"); await cash(); await review(); await acknowledge();
    assert.equal(posts().length, 0);
    postHandler = url => {
      assert.equal(url, "/api/leads/test-job/record-offline-payment");
      paid(); fixture.rewards.state = "issued";
      return response({ completion: { ok: true }, jcmoves: { creditedAccountCount: 2, pendingCustomerClaim: false } });
    };
    await click(byTestId("button-final-confirm-admin-payment"));
    await until(() => document.body.textContent.includes("Payment and completion recorded"), "receipt result");
    assert.equal(posts().length, 1);
    assert.equal(posts()[0].body.method, "cash");
    assert.equal(posts()[0].body.completeJob, true);
    assert.match(posts()[0].body.paidDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(posts()[0].body.reference, null);
  });

  await test("a changed total between review and confirmation blocks all financial writes", async () => {
    await open(); await choose("payment"); await cash(); await review(); await acknowledge();
    fixture.lead.totalPrice = "500.00";
    await click(byTestId("button-final-confirm-admin-payment"));
    await until(() => document.body.textContent.includes("changed. Review the updated details"), "changed-job rejection");
    assert.equal(posts().length, 0);
    assert.equal(byTestId("button-final-confirm-admin-payment"), null);
  });

  await test("recipient changes require a fresh review", async () => {
    paid(); await open(); await choose("payout"); await review(); await acknowledge();
    fixture.lead.crewMembers = ["crew-b"];
    fixture.employees.push({ id: "crew-b", firstName: "Other", lastName: "Mover" });
    await click(byTestId("button-final-confirm-admin-payment"));
    await until(() => document.body.textContent.includes("changed. Review the updated details"), "changed-recipient rejection");
    assert.equal(posts().length, 0);
  });

  await test("repeated final clicks send one payout request and keep pending controls disabled", async () => {
    paid(); await open(); await choose("payout"); await review(); await acknowledge();
    let finish;
    postHandler = url => { assert.equal(url, "/api/leads/test-job/retry-disbursement"); return new Promise(resolve => { finish = resolve; }); };
    const confirm = byTestId("button-final-confirm-admin-payment");
    await act(async () => { confirm.click(); confirm.click(); });
    await until(() => posts().length === 1, "one payout request");
    assert.ok(byTestId("button-final-confirm-admin-payment").disabled);
    assert.ok(button("Back").disabled);
    await act(async () => { fixture.rewards.state = "issued"; finish(response({ ok: true, note: "Verified existing awards" })); });
    await until(() => document.body.textContent.includes("Verified existing awards"), "payout result");
    assert.equal(posts().length, 1);
    assert.deepEqual(posts()[0].body, {});
  });

  await test("server rejection clears acknowledgement and never reports success", async () => {
    paid(); await open(); await choose("payout"); await review(); await acknowledge();
    postHandler = () => response({ error: "Administrator access required" }, 403);
    await click(byTestId("button-final-confirm-admin-payment"));
    await until(() => document.body.textContent.includes("Administrator access required"), "server rejection");
    assert.equal(posts().length, 1);
    assert.ok(byTestId("button-final-confirm-admin-payment").disabled);
    assert.equal(document.querySelector("[role='checkbox']").getAttribute("aria-checked"), "false");
    assert.equal(button("Done"), undefined);
  });

  await test("quote-only jobs cannot bypass closeout eligibility", async () => {
    fixture.lead.status = "quote_requested";
    await open(); await choose("payment");
    assert.match(document.body.textContent, /Confirm the job before/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    await choose("payout");
    assert.match(document.body.textContent, /Complete the job before/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    assert.equal(posts().length, 0);
  });

  await test("canonical payment and reward release flags remain enforced", async () => {
    fixture.reconciliation = { enabled: true, automaticRewardsEnabled: false, reviewReasons: [] };
    await open(); await choose("payment");
    assert.match(document.body.textContent, /uses verified payment reconciliation/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    await click(button("Cancel")); paid(); await open(); await choose("payout");
    assert.match(document.body.textContent, /processing is paused/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    assert.equal(posts().length, 0);
  });

  for (const newRole of ["employee", "customer"]) {
    await mount(newRole);
    try {
      assert.equal(byTestId("button-admin-payment-shortcut"), null);
      assert.equal(requests.filter(request => request.url !== "/api/auth/user").length, 0);
      passed++; console.log(`PASS ${newRole} cannot see or load the payment shortcut`);
    } finally { await cleanup(); }
  }
  console.log(`Admin payment shortcut: ${passed} acceptance scenarios passed. All requests used synthetic fixtures.`);
} finally {
  dom.window.close();
  await rm(outputDir, { recursive: true, force: true });
}
