import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { quickRequestSchema, projectIntakeInput } from "../quickRequest";
import { projectIntakeSchema, projectScheduleError, projectScheduleLabel, projectServiceLabel, readProjectIntake, projectEntry } from "../../../shared/projectRequest";
import { insertLeadSchema, leads, formatOrderNumber } from "../../../shared/schema";
import { updateCustomerNotes } from "../../../shared/leadDetails";

const contact = { firstName: "Test", lastName: "Customer", phone: "(202) 555-0123", serviceCode: "moving" };
const project = { ...contact, requestType: "project", serviceAddress: "123 Main St, Ironwood, MI, 49938", city: "Ironwood", state: "MI", zip: "49938", schedulingPreference: "callback", additionalServices: ["painting", "flooring"] };
assert.equal(quickRequestSchema.parse(contact).requestType, "callback");
assert.equal(quickRequestSchema.parse({ ...contact, email: "" }).email, "");
const parsed = quickRequestSchema.parse(project);
assert.equal(parsed.email, "");
assert.equal(quickRequestSchema.safeParse({ ...project, city: "" }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...project, schedulingPreference: undefined }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...project, additionalServices: ["invalid"] }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...project, serviceCode: "invalid" }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...project, phone: "123" }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...project, email: "invalid" }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...project, schedulingPreference: "preferred_time", preferredDate: "2099-04-05", preferredStartTime: "10:00" }).success, true);
assert.equal(quickRequestSchema.safeParse({ ...contact, requestType: "scheduled" }).success, false);
assert.equal(quickRequestSchema.safeParse({ ...contact, requestType: "scheduled", email: "test@example.test", serviceAddress: "123 Main St", zip: "49938", workScope: "Move a home", sizingBasis: "truck", truckSize: "26_ft", preferredDate: "2099-04-05", preferredStartTime: "10:00" }).success, true);
const now = new Date("2026-09-28T15:30:00Z");
assert.equal(projectScheduleError("preferred_time", "2026-09-28", "11:00", now), null);
assert.match(projectScheduleError("preferred_time", "2026-09-28", "10:00", now)!, /passed/);
assert.match(projectScheduleError("preferred_time", "2026-02-30", "10:00", now)!, /valid/);
assert.match(projectScheduleError("preferred_time", "2026-09-27", "10:00", now)!, /future/);
assert.equal(projectScheduleError("callback", undefined, undefined, now), null);
assert.equal(projectScheduleError("preferred_time", "2026-09-29", "17:00", now), "Choose a preferred arrival window.");
const normalized = projectIntakeSchema.parse(projectIntakeInput({ ...parsed, additionalServices: ["painting", "moving", "painting"], preferredDate: "2026-01-01", preferredStartTime: "08:00" }));
assert.equal(normalized.preferredDate, undefined);
assert.deepEqual(normalized.additionalServices, ["painting"]);
const edited = updateCustomerNotes(JSON.stringify({ projectIntake: normalized, customerNotes: "before" }), "after");
assert.deepEqual(readProjectIntake(edited), JSON.parse(JSON.stringify(normalized)));
const entry = projectEntry("?mode=quick&service=junk&services=painting,flooring&promo=help&rep=North&jc_campaign=fall&jc_route_day=tuesday&utm_source=google&address=123%20Main&date=2099-04-05");
assert.equal(entry.serviceCode, "junk_removal");
assert.deepEqual(entry.additionalServices, ["painting", "flooring"]);
assert.equal(entry.attribution.promoCode, "HELP");
assert.equal(entry.attribution.referralSlug, "north");
assert.equal(entry.attribution.marketingTracking.jcRouteDay, "tuesday");
assert.equal(entry.attribution.marketingCampaignId, "fall");

// Execute the actual HTTP handler with a transactional in-memory store, never a live database.
const source = readFileSync("server/routes.ts", "utf8");
const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
let handler = "";
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "app.post" && node.arguments[0]?.getText(ast) === '"/api/leads/quick-request"') handler = node.arguments[node.arguments.length - 1].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler);
const compiled = ts.transpileModule("const run = " + handler, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
let rows: any[] = [], serial = 0, notifications = 0, events = 0, lockCount = 0;
let failure = "", transactionTail = Promise.resolve();
const columnValue = (column: any, row: any): any => column?.phoneExpression ? String(row.phone).replace(/\D/g, "") : row[Object.keys(leads).find(key => (leads as any)[key] === column) || ""];
const sql = (strings: TemplateStringsArray, ...values: any[]) => ({ text: strings.join("?"), values, phoneExpression: strings.join("").includes("regexp_replace") });
const tx = {
  execute: async (query: any) => { assert.match(query.text, /pg_advisory_xact_lock/); lockCount++; },
  select: () => {
    let predicate = (_row: any) => true;
    const query: any = { from: () => query, where: (filter: any) => { predicate = filter; return query; }, orderBy: () => query, limit: async () => rows.filter(predicate).slice(-1) };
    return query;
  },
  insert: () => ({ values: (value: any) => ({ returning: async () => { if (failure === "insert") throw Error("insert failed"); const row = { ...value, id: "lead-" + ++serial, orderNumber: serial, createdAt: new Date() }; rows.push(row); return [row]; } }) }),
};
const db = { transaction: async (work: any) => {
  const previous = transactionTail;
  let unlock!: () => void;
  transactionTail = new Promise<void>(resolve => { unlock = resolve; });
  await previous;
  const before = [...rows];
  try { const result = await work(tx); if (failure === "commit") throw Error("commit failed"); return result; }
  catch (error) { rows = before; throw error; } finally { unlock(); }
} };
const deps = {
  quickRequestSchema, projectIntakeInput, projectIntakeSchema, projectScheduleLabel, projectServiceLabel, insertLeadSchema, leads, formatOrderNumber, crypto, db, sql,
  safeMarketingTracking: (value: any) => value,
  QUICK_REQUEST_SERVICE_MAP: { moving: { serviceType: "residential", label: "Moving" }, painting: { serviceType: "painting", label: "Painting" } },
  and: (...filters: any[]) => (row: any) => filters.every(filter => typeof filter === "function" ? filter(row) : filter.phoneExpression && String(row.phone).replace(/\D/g, "") === filter.values[1]),
  eq: (column: any, value: any) => (row: any) => columnValue(column, row) === value,
  gte: (column: any, value: any) => (row: any) => columnValue(column, row) >= value, desc: (column: any) => column,
  notifyAdminNewLead: async (data: any) => { assert.equal(data.recipient, "upmichiganstatemovers@gmail.com"); notifications++; if (failure === "notification") throw Error("notification failed"); return failure !== "email"; },
  emitJobEvent: async (_event: string, _lead: any, options: any) => { events++; assert.equal(options.ownerReviewOnly, true); if (failure === "event") throw Error("event failed"); },
  process: { env: {} }, console: { error() {}, warn() {} },
  respondLeadError: (res: any, error: any) => res.status(error.name === "ZodError" ? 400 : 500).json({ error: error.message }),
};
const run = new Function(...Object.keys(deps), compiled + "; return run;")(...Object.values(deps));
async function call(body: any) {
  let status = 200, payload: any;
  const res = { status(value: number) { status = value; return res; }, json(value: any) { payload = value; return res; } };
  await run({ body, session: {} }, res);
  return { status, payload };
}
for (const scenario of ["", "notification", "email", "event"]) {
  rows = []; failure = scenario; notifications = 0; events = 0;
  const result = await call({ ...project, email: "test@example.test" });
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "quote_requested");
  assert.equal(rows[0].email, "test@example.test");
  assert.equal(rows[0].fromAddress, project.serviceAddress);
  assert.equal(rows[0].moveDate, "");
  assert.equal(rows[0].crewSize, null);
  assert.equal(result.payload.scheduleRequest, null);
  assert.equal(readProjectIntake(rows[0].details)?.schedulingPreference, "callback");
  assert.equal(notifications, 1);
}
rows = []; failure = ""; notifications = 0;
const pair = await Promise.all([call(project), call(project)]);
assert.equal(rows.length, 1);
assert.ok(pair.every(result => result.payload.lead), JSON.stringify(pair));
assert.equal(pair[0].payload.lead.id, pair[1].payload.lead.id);
assert.equal(pair.filter(result => result.payload.duplicate).length, 1);
assert.equal(notifications, 1);
assert.ok(lockCount >= 6);
await call({ ...project, destinationAddress: "456 Second St" });
assert.equal(rows.length, 2, "A different destination is a separate request");
rows = [];
const scheduled = await call({ ...project, schedulingPreference: "preferred_time", preferredDate: "2099-04-05", preferredStartTime: "10:00" });
assert.equal(scheduled.status, 201);
assert.equal(readProjectIntake(rows[0].details)?.preferredDate, "2099-04-05");
assert.equal(rows[0].moveDate, "", "A preference must not appear as a confirmed date");
for (const scenario of ["insert", "commit"]) { rows = []; failure = scenario; const result = await call(project); assert.equal(result.status, 500); assert.equal(rows.length, 0); }
console.log("Project requests: validation, attribution, staff metadata, concurrent retries, rollback and notification failures passed.");
