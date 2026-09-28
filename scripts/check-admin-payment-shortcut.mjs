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
await build({ stdin: { contents: 'export { AdminJobPaymentShortcut } from "./client/src/components/AdminJobPaymentShortcut"; export { JobSetupWorkspace } from "./client/src/components/job-setup-workspace"; export { closeoutRepairs } from "./client/src/lib/job-closeout-repair";', resolveDir: process.cwd(), loader: "tsx" }, outfile: output, bundle: true,
  platform: "node", format: "esm", packages: "external", jsx: "automatic", define: { "import.meta.env": "{}" } });
const { AdminJobPaymentShortcut, JobSetupWorkspace, closeoutRepairs } = await import(pathToFileURL(output).href);
const { act } = React;
let fixture;
let requests;
let postHandler;
let patchHandler;
let editorEnabled = false;
let role;
let root;
let client;
let passed = 0;
const initial = () => ({
  lead: { id: "test-job", orderNumber: 123, firstName: "Test", lastName: "Customer", email: "customer@example.test",
    status: "available", source: "website", fromAddress: "Test service address", moveDate: "2026-01-01",
    totalPrice: "450.00", phone: "", serviceType: "residential", confirmedHours: 7, crewSize: 2, paymentPaidAt: null, crewMembers: ["crew-a"], crewLeadUserId: "crew-a" },
  employees: [{ id: "crew-a", firstName: "Test", lastName: "Mover", isApproved: true, status: "active" }],
  rewards: { paymentWorkflow: "legacy", state: "full_payment_missing", paidInFull: false, completed: false, customerPool: 6750, crewPool: 6750, records: [] },
});
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  const method = options.method || "GET";
  requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
  if (method === "POST") return postHandler(url, options);
  if (method === "PATCH") return patchHandler(url, options);
  if (url === "/api/auth/user") return response({ id: "reviewer", role });
  const values = {
    "/api/leads/test-job": fixture.lead,
    "/api/employees": fixture.employees,
    "/api/leads/test-job/jcmoves-status": fixture.rewards,
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
async function input(node, value) {
  assert.ok(node, "Input exists");
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
function CloseoutHarness() {
  const [repair, setRepair] = React.useState(null);
  const [section, setSection] = React.useState("");
  const [resumeKey, setResumeKey] = React.useState(0);
  const [lead, setLead] = React.useState(fixture.lead);
  const resume = () => { setRepair(null); setResumeKey(key => key + 1); };
  return React.createElement(React.Fragment, null,
    React.createElement(AdminJobPaymentShortcut, { leadId: "test-job", resumeKey, onFixJob: target => {
      setRepair(target); setSection(closeoutRepairs[target].section);
      setTimeout(() => document.getElementById(closeoutRepairs[target].fieldId)?.focus(), 0);
    } }),
    editorEnabled && React.createElement(JobSetupWorkspace, { lead, employees: fixture.employees, canManageSetup: true,
      closeoutRepair: repair, activeSection: section, onSectionChange: setSection,
      onReturnToCloseout: resume, onSaved: () => { setLead({ ...fixture.lead }); resume(); } }));
}
async function mount(newRole = "admin") {
  fixture = initial(); requests = []; role = newRole;
  if (editorEnabled) { fixture.lead.moveDate = "2099-09-29"; fixture.lead.totalPrice = "1225.00"; }
  postHandler = () => { throw new Error("No POST expected in this scenario"); };
  patchHandler = () => { throw new Error("No PATCH expected in this scenario"); };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CloseoutHarness))));
  await settle();
}
async function cleanup() { await act(async () => root.unmount()); client.clear(); await settle(); }
async function open() {
  await until(() => byTestId("button-admin-payment-shortcut"), "admin shortcut");
  for (let count = 0; count < 5; count++) await click(byTestId("button-admin-payment-shortcut"));
  await until(() => document.querySelector("input[value='payment']:not(:disabled)"), "loaded payment choices");
  await until(() => !byTestId("admin-payment-dialog").querySelector("fieldset")?.disabled, "fresh snapshot");
}
async function choose(action) { await click(document.querySelector(`input[value='${action}']`)); }
async function cash() {
  await click(document.getElementById("shortcut-payment-cash"));
}
async function review() { await click(byTestId("button-review-admin-payment")); }
async function acknowledge() { await click(byTestId("admin-payment-dialog").querySelector("[role='checkbox']")); }
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
  editorEnabled = true;
  await test("date repair saves the actual past date, preserves the saved price and reopens a fresh unconfirmed closeout", async () => {
    fixture.lead.moveDate = "2099-09-29";
    fixture.lead.totalPrice = "1225.00";
    await open(); await choose("payment");
    assert.equal(button("Fix job date"), byTestId("button-fix-closeout"));
    await click(byTestId("button-fix-closeout"));
    await until(() => document.activeElement?.id === "setup-closeout-date", "focus on actual job date");
    assert.equal(byTestId("admin-payment-dialog"), null);
    assert.ok(byTestId("button-save-return-closeout").disabled);
    await input(document.getElementById("setup-closeout-date"), "2026-01-01");
    assert.equal(byTestId("button-save-return-closeout").disabled, false);
    patchHandler = (url, options) => {
      assert.equal(url, "/api/leads/test-job/setup");
      const payload = JSON.parse(options.body);
      assert.equal(payload.confirmedDate, "2026-01-01");
      assert.equal(payload.quote, undefined, "date correction must not replace $1,225 with a recalculated quote");
      fixture.lead = { ...fixture.lead, confirmedDate: payload.confirmedDate };
      return response(fixture.lead);
    };
    await click(byTestId("button-save-return-closeout"));
    await until(() => byTestId("admin-payment-dialog") && !byTestId("admin-payment-dialog").querySelector("fieldset")?.disabled, "fresh closeout after save");
    assert.match(byTestId("admin-payment-job-summary").textContent, /2026-01-01/);
    assert.match(byTestId("admin-payment-job-summary").textContent, /\$1,225\.00/);
    assert.equal(byTestId("button-fix-closeout"), null);
    assert.ok(document.querySelector("input[value='payment']").checked);
    assert.equal(posts().length, 0, "repair must not quote, invoice, complete or pay the job");
    await cash(); await review();
    assert.ok(byTestId("button-final-confirm-admin-payment").disabled);
    await acknowledge();
    postHandler = () => { paid(); return response({ completion: { ok: true }, jcmoves: { creditedAccountCount: 2 } }); };
    await click(byTestId("button-final-confirm-admin-payment"));
    await until(() => document.body.textContent.includes("Payment and completion recorded"), "explicit closeout succeeds");
    assert.equal(posts().length, 1);
  });
  await test("failed correction stays editable; returning without saving rechecks the original blocker", async () => {
    fixture.lead.moveDate = "2099-09-29";
    await open(); await choose("payment"); await click(byTestId("button-fix-closeout"));
    await input(document.getElementById("setup-closeout-date"), "2026-01-01");
    patchHandler = () => response({ error: "Schedule could not be saved" }, 409);
    await click(byTestId("button-save-return-closeout"));
    await until(() => byTestId("closeout-repair-panel")?.textContent.includes("Schedule could not be saved"), "save error next to correction");
    assert.equal(byTestId("admin-payment-dialog"), null);
    assert.equal(document.getElementById("setup-closeout-date").value, "2026-01-01");
    await click(button("Return without saving"));
    await until(() => byTestId("button-fix-closeout") && !byTestId("button-fix-closeout").disabled, "saved date still blocks closeout");
    assert.match(byTestId("admin-payment-job-summary").textContent, /2099-09-29/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    assert.equal(posts().length, 0);
  });
  editorEnabled = false;
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

  await test("canonical workflows cannot use legacy payment or payout actions", async () => {
    fixture.rewards.paymentWorkflow = "canonical";
    await open(); await choose("payment");
    assert.match(document.body.textContent, /unavailable for the current payment workflow/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    await click(button("Cancel")); paid(); await open(); await choose("payout");
    assert.match(document.body.textContent, /unavailable for the current payment workflow/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    assert.equal(posts().length, 0);
  });

  await test("missing server capability fails closed during mixed-version deployment", async () => {
    delete fixture.rewards.paymentWorkflow;
    await open(); await choose("payment");
    assert.match(document.body.textContent, /unavailable for the current payment workflow/);
    assert.ok(byTestId("button-review-admin-payment").disabled);
    await click(button("Cancel")); paid(); await open(); await choose("payout");
    assert.ok(byTestId("button-review-admin-payment").disabled);
    assert.equal(posts().length, 0);
  });

  await test("a workflow change after review blocks final submission", async () => {
    await open(); await choose("payment"); await cash(); await review(); await acknowledge();
    fixture.rewards.paymentWorkflow = "canonical";
    await click(byTestId("button-final-confirm-admin-payment"));
    await until(() => document.body.textContent.includes("changed. Review the updated details"), "workflow change rejection");
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
