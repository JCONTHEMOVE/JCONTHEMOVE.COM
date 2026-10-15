import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
import { evaluateQuickBookReadiness, quickBookDraftSchema } from "../../../shared/quickBook";
import { mergeQuickBookDraft } from "../quickBookSessions";

// Execute the registered message + booking handlers. Only persistence and
// delivery are replaced; timing, merging, authorization and request parsing run.
const source = readFileSync("server/routes.ts", "utf8");
const start = source.indexOf("  async function quickBookActor");
const js = ts.transpileModule(source.slice(start, source.indexOf("  const jobPlanDetailsSchema", start)), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function fixture() {
  let time = Date.parse("2026-10-13T14:19:08Z");
  class Clock extends Date {
    constructor(value?: string | number | Date) { super(value === undefined ? time : value instanceof Date ? value.getTime() : value); }
    static now() { return time; }
  }
  const draft = quickBookDraftSchema.parse({
    customerName: "Fixture Customer", customerPhone: "9065550100", smsConsent: true,
    pickupAddress: "100 Example Street, Ironwood, MI 49938", confirmedDate: "2026-10-13",
    arrivalWindow: "9:00 AM – 10:00 AM", workScope: "load_only", truckConfig: "customer_truck",
    crewSize: 2, estimatedHours: 2, crewMemberIds: ["owner", "worker"], crewLeadUserId: "worker",
    crewConfirmed: true, stairsFlights: 0, hasElevator: false, specialItemsConfirmed: true,
  });
  const quote = { total: 275, rewardEligibleTotal: 275, labor: 275, projectedCustomerJcMoves: 4125, rateCard: { jcmovesPerDollar: 15 } };
  let row: any = { id: "fixture-session", createdByUserId: "owner", status: "draft", revision: 1,
    structuredDraft: draft, pricingPreview: quote, metrics: {}, fieldMeta: {}, createdAt: new Clock() };
  let pending: any = null;
  let lead: any = null;
  let inserts = 0;
  let committed = false;
  let conflict = false;
  let expireAfterWorkerCheck = false;
  const events: any[] = [];
  const sqls: string[] = [];
  const env: Record<string, string> = { QUICK_BOOK_ENABLED: "true", QUICK_BOOK_LIVE_BOOKING_ENABLED: "true", QUICK_BOOK_OWNER_ONLY: "true" };
  const client = {
    release() {},
    async query(sql: string, args: any[] = []) {
      sqls.push(sql);
      if (sql === "COMMIT") { row = pending; pending = null; committed = true; return {}; }
      if (sql === "ROLLBACK") { pending = null; return {}; }
      if (sql.includes("FOR UPDATE")) return { rows: [{ status: row.status, revision: row.revision }] };
      if (sql.includes("INSERT INTO bookings")) { inserts++; return { rows: [{ id: "booking" }] }; }
      if (sql.includes("INSERT INTO leads")) {
        inserts++;
        assert.match(sql, /'staff_quick_book','assigned'/, "Booking must not mark work started or skip dispatch");
        lead = { id: "lead", order_number: 99, confirmed_date: args[18], arrival_window: args[27],
          jobPlanDetails: JSON.parse(args[13]), totalPrice: args[23] };
        return { rows: [lead] };
      }
      if (sql.includes("SET status='booked'")) {
        pending = { ...row, status: "booked", revision: row.revision + 1, structuredDraft: JSON.parse(args[2]),
          bookingId: args[5], leadId: args[6], agentMetadata: JSON.parse(args[7]), metrics: JSON.parse(args[8]) };
        return { rowCount: 1, rows: [{ revision: pending.revision }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const routes = new Map<string, Function>();
  const app = Object.fromEntries(["get", "post"].map(method => [method, (path: string, ...handlers: Function[]) => routes.set(`${method} ${path}`, handlers.at(-1)!)]));
  const deps = {
    app, isAuthenticated: () => {}, process: { env }, Date: Clock, z, crypto,
    storage: { getLead: async () => lead },
    getQuickBookSession: async () => row,
    sessionDraft: (saved: any) => quickBookDraftSchema.parse(saved.structuredDraft),
    mergeQuickBookDraft: (args: any) => mergeQuickBookDraft({ ...args, now: new Clock() }),
    evaluateQuickBookReadiness,
    calculateQuickBookState: async (value: any) => {
      const parsed = quickBookDraftSchema.parse(value);
      return { draft: parsed, quote, crewSuggestions: parsed.crewMemberIds.map(id => ({ id, available: true })),
        ...evaluateQuickBookReadiness(parsed, { now: new Clock(), quoteReady: true }) };
    },
    quickBookNextPrompt: () => ({ question: "Review", suggestions: [] }),
    quickBookSessionResponse: (saved: any, state: any) => ({ ...saved, draft: state.draft, readiness: { ready: state.ready } }),
    updateQuickBookSession: async ({ expectedRevision, values }: any) => {
      assert.equal(expectedRevision, row.revision);
      row = { ...row, ...values, revision: row.revision + 1 };
      return row;
    },
    pool: { connect: async () => client, query: async () => ({ rows: [] }) },
    quickBookTransactionCrewUnavailable: async () => {
      if (expireAfterWorkerCheck) time = Date.parse("2026-10-13T15:00:00Z");
      return new Set();
    },
    quickBookCrewConflicts: async () => new Set(conflict ? ["worker"] : []),
    rowToProfitShareSettings: () => ({ driverHourlyPremium: 0 }), getDefaultPayoutSettings: async () => ({}),
    db: { select: () => ({ from: () => ({ where: async () => [] }) }) }, workerProfiles: { userId: "id" }, inArray: () => null,
    normalizePayoutRole: () => "mover", defaultHourlyRateForRole: () => 20, defaultBonusWeightForRole: () => 1,
    dbMoney: String, dbRatio: String, encryptJobAccessDetails: () => null, sealQuickBookDraft: (value: any) => value,
    writeLeadHistory: async () => {}, emitJobEvent: async (...args: any[]) => {
      assert.equal(committed, true, "Crew alerts must follow commit"); events.push(args);
    },
    console: { error: (...args: any[]) => { throw Error(`Unexpected handler error: ${args}`); } },
  };
  new Function(...Object.keys(deps), js)(...Object.values(deps));
  async function request(action: "message" | "book", body: any) {
    let status = 200; let payload: any;
    const res: any = { status(value: number) { status = value; return res; }, json(value: any) { payload = value; return res; } };
    await routes.get(`post /api/quick-book/sessions/:id/${action}`)!({ currentUser: { id: "owner", role: "business_owner" }, params: { id: row.id }, body }, res);
    return { status, payload };
  }
  return { request, env, events, sqls, row: () => row, lead: () => lead, inserts: () => inserts,
    setTime: (value: string) => { time = Date.parse(value); },
    setConflict: () => { conflict = true; }, expireDuringBooking: () => { expireAfterWorkerCheck = true; } };
}

const good = fixture();
const choice = await good.request("message", { expectedRevision: 1, source: "tap", patch: { startNow: true } });
assert.equal(choice.status, 200);
assert.equal(choice.payload.readiness.ready, true);
assert.equal(choice.payload.draft.crewConfirmed, true);
assert.equal(good.inserts(), 0, "Selecting now only updates the existing draft");
const booked = await good.request("book", { expectedRevision: 2, idempotencyKey: "fixture-book-key" });
assert.equal(booked.status, 201);
assert.equal(booked.payload.startNowBookedAt, "2026-10-13T14:19:08.000Z");
assert.equal(booked.payload.total, 275);
assert.equal(booked.payload.customerMessageSent, false);
assert.equal(booked.payload.squareInvoiceCreated, false);
assert.equal(good.lead().confirmed_date, "2026-10-13");
assert.equal(good.lead().arrival_window, "9:00 AM – 10:00 AM");
assert.equal(good.lead().jobPlanDetails.startNowBookedAt, booked.payload.startNowBookedAt);
assert.equal(good.row().metrics.startNowBookedAt, booked.payload.startNowBookedAt);
assert.equal(good.inserts(), 2);
assert.equal(good.events[0][0], "crew_plan_saved");
assert.ok(good.sqls.every(sql => !/en_route_at|on_site_at|SET status='in_progress'/.test(sql)));
good.setTime("2026-10-13T15:01:00Z");
const retry = await good.request("book", { expectedRevision: 2, idempotencyKey: "new-retry-key" });
assert.equal(retry.status, 200);
assert.equal(retry.payload.alreadyBooked, true);
assert.equal(retry.payload.startNowBookedAt, booked.payload.startNowBookedAt);
assert.equal(good.inserts(), 2, "A retry after the window ends must return the existing job");
assert.equal(good.events[0][2].eventId, good.events[1][2].eventId, "Alert retries retain the original deduplication key");

for (const reason of ["conflict", "expired", "disabled"] as const) {
  const blocked = fixture();
  await blocked.request("message", { expectedRevision: 1, source: "tap", patch: { startNow: true } });
  if (reason === "conflict") blocked.setConflict();
  if (reason === "expired") blocked.expireDuringBooking();
  if (reason === "disabled") blocked.env.QUICK_BOOK_LIVE_BOOKING_ENABLED = "false";
  const result = await blocked.request("book", { expectedRevision: 2, idempotencyKey: "blocked-book-key" });
  assert.equal(result.status, reason === "disabled" ? 403 : 409);
  assert.equal(blocked.inserts(), 0);
  assert.equal(blocked.events.length, 0);
  assert.notEqual(blocked.row().status, "booked");
}
const closed = fixture();
closed.setTime("2026-10-13T22:00:00Z");
const rejected = await closed.request("message", { expectedRevision: 1, source: "tap", patch: { startNow: true } });
assert.equal(rejected.status, 400);
assert.equal(closed.row().revision, 1);
console.log("Quick Book Start now actual-handler save, book, conflict, expiry, flag and replay checks passed");
