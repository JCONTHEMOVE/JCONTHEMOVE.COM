// Disposable fixtures only. --postgres uses multiple real PostgreSQL connections
// to exercise locks; the default PGlite run verifies SQL and HTTP behavior locally.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z, ZodError } from "zod";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import * as schema from "../shared/schema";
import { quickRequestSchema, projectIntakeInput } from "../server/services/quickRequest";
import { projectIntakeSchema, projectScheduleLabel, projectServiceLabel } from "../shared/projectRequest";
import { bookingTimeZoneSchema, bookingDateTimeToUtc, bookingTimeLabel, movePlanSchema, recommendMove, validBookingDate } from "../shared/homepageBooking";
import { PUBLIC_BOOKING_REQUEST_SCHEMA, bindPublicBookingRequest, lockPublicBookingRequest, publicRequestHash, publicBookingStatus, publicInstantQuote } from "../server/services/publicBookingRequests";
import { expireBookingHolds, instantCrewCapacity, lockBookingCapacity, lockActiveBookingHold, settleVerifiedBookingHold } from "../server/services/instantBookingIntegrity";
import { resolvePersonalPromoAttribution } from "../server/services/personalPromoCodes";

const realPostgres = process.argv.includes("--postgres");
let pool: any, db: any, close: () => Promise<void>;
if (realPostgres) {
  const url = new URL(process.env.TEST_DATABASE_URL || "http://missing");
  if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/jc_ledger_test") throw Error("Use a local disposable jc_ledger_test database only");
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({ connectionString: url.href });
  const name = "homepage_" + crypto.randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${name}`);
  pool = new pg.Pool({ connectionString: url.href, options: `-c search_path=${name}`, statement_timeout: 15000, max: 12 });
  db = (await import("drizzle-orm/node-postgres")).drizzle(pool);
  close = async () => { await pool.end(); await admin.query(`DROP SCHEMA ${name} CASCADE`); await admin.end(); };
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  // PGlite has one session: don't pretend it proves multi-session races.
  pool = { query: (text: string, values?: any[]) => values ? pg.query(text, values) : pg.exec(text).then(r => r[0] || { rows: [] }), connect: async () => ({ query: (text: string, values?: any[]) => pg.query(text, values), release() {} }) };
  db = (await import("drizzle-orm/pglite")).drizzle(pg);
  close = () => pg.close();
}
const dialect = new PgDialect();
const quoted = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const literal = (value: any): string => typeof value === "string" ? quoted(value) : typeof value === "object" && value?.queryChunks ? dialect.sqlToQuery(value).sql : quoted(JSON.stringify(value));
try {
  for (const table of [schema.users, schema.leads, schema.bookings, schema.bookingServiceItems, schema.quoteAttributions, schema.marketingReps, schema.promoCodes, schema.workerProfiles, schema.squareInvoices]) {
    const config = getTableConfig(table);
    await pool.query(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.default !== undefined ? " DEFAULT " + literal(c.default) : ""}${c.notNull ? " NOT NULL" : ""}`).join(",")})`);
  }
  await pool.query(`CREATE TABLE worker_schedule(user_id varchar,day_of_week int,start_hour int,end_hour int,is_available boolean);
    CREATE TABLE worker_day_blocks(user_id varchar,date text);
    CREATE TABLE worker_hour_overrides(user_id varchar,date text,start_hour int,end_hour int);
    CREATE TABLE lead_schedule_requests(id varchar,lead_id varchar,status text,preferred_date date,preferred_start_time time,timezone text,planning_minutes int,selected_crew_size int);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),lead_id varchar,revision int,status text,customer_total numeric);
    CREATE TABLE job_agreements(lead_id varchar,quote_revision_id varchar,terms_version text,terms_hash text,acceptance_method text,acceptance_token_id text,UNIQUE(lead_id,quote_revision_id,terms_hash));
    INSERT INTO users(id,email,first_name,last_name,role,status,is_approved,is_available) VALUES
      ('fixture-owner','owner@example.test','Fixture','Owner','business_owner','approved',true,false),
      ('fixture-a','a@example.test','Fixture','A','employee','approved',true,true),
      ('fixture-b','b@example.test','Fixture','B','employee','approved',true,true);
    INSERT INTO worker_schedule SELECT id,day,7,20,true FROM users CROSS JOIN generate_series(0,6) day WHERE role='employee';`);
  const source = readFileSync("server/routes/bookings.ts", "utf8");
  const ast = ts.createSourceFile("bookings.ts", source, ts.ScriptTarget.Latest, true);
  const names = new Set(["INSTANT_BOOKING_TIME_ZONE", "INSTANT_BOOKING_START_HOURS", "HOLD_LIFETIME_MS", "instantBookingRequestSchema", "instantBookingTablesReady"]);
  const functions = new Set(["ensureInstantBookingTables", "centralDateTimeToUtc", "centralDateKey", "timeLabel", "expireInstantBookingHolds", "capacityForInstantBooking", "availableInstantBookingSlots"]);
  const declarations = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.has(d.name.getText(ast))) || ts.isFunctionDeclaration(n) && functions.has(n.name?.text || "")).map(n => n.getText(ast)).join("\n");
  let squareCalls = 0, events = 0, failQuote = false, price = 555;
  const squareModule = { squareInvoiceService: {
    isConfigured: () => true,
    createInvoiceForLead: async () => { squareCalls++; return { invoiceUrl: "https://square.example.test/deposit", squareInvoiceId: "fixture-square-" + squareCalls }; },
    cancelInvoice: async () => {},
    getInvoiceStatus: async () => "PAID",
  } };
  const instantBookingQuote = async (input: any) => {
    const r = input.movePlan ? recommendMove(input.movePlan) : null;
    const crewSize = r?.selectedCrewSize || 2, requestedHours = r?.selectedHours || input.requestedHours;
    return { minEstimate: price, maxEstimate: price, estimateLabel: `$${price} estimate`, crewSize, requestedHours,
      durationMinutes: requestedHours * 60, eligibleForHold: true, recommendation: r,
      operatingEligibility: { decision: r?.reviewRequired ? "manual_review" : "eligible" },
      reviewRequired: !!r?.reviewRequired, autoBookEligible: !r?.reviewRequired,
      lineItems: [{ name: "Synthetic labor", quantity: 1, unitPrice: price, total: price }], pricingVersion: "synthetic-v1",
      zoneCode: "fixture", zoneName: "fixture", travelFallback: false,
    };
  };
  const saveQuoteDraft = async ({ leadId }: any) => {
    if (failQuote) throw Error("Injected quote revision failure");
    const result = await pool.query("INSERT INTO quote_revisions(lead_id,revision,status,customer_total) VALUES($1,1,'draft',$2) RETURNING *", [leadId, price]);
    return { id: result.rows[0].id, leadId, revision: 1, subtotal: price, discountTotal: 0, customerTotal: price, status: "draft" };
  };
  const approveQuoteRevision = async ({ quoteId }: any) => { const row = (await pool.query("UPDATE quote_revisions SET status='approved' WHERE id=$1 RETURNING *", [quoteId])).rows[0]; return { id: quoteId, revision: row.revision, subtotal: Number(row.customer_total), customerTotal: Number(row.customer_total), discountTotal: 0 }; };
  const deps: any = { z, ZodError, crypto, pool, db, ...schema, and, eq, gte, desc, sql, console,
    bookingTimeZoneSchema, bookingDateTimeToUtc, bookingTimeLabel, movePlanSchema, recommendMove, validBookingDate,
    PUBLIC_BOOKING_REQUEST_SCHEMA, bindPublicBookingRequest, lockPublicBookingRequest, publicRequestHash, publicBookingStatus, publicInstantQuote,
    expireBookingHolds, instantCrewCapacity, lockBookingCapacity, lockActiveBookingHold, resolvePersonalPromoAttribution,
    ensureJcOperationsInfrastructure: async () => {}, ensureQuoteRevisionInfrastructure: async () => {},
    instantBookingQuote, saveQuoteDraft, approveQuoteRevision,
    storage: { getLead: async (id: string) => (await db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0], getUser: async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0] },
    squareModule, lifecycleModule: { emitCustomerLifecycleEvent: async () => {} },
    emitJobEvent: async (_: string, _lead: any, options: any) => { events++; assert.equal(options.ownerReviewOnly, true); },
    requireAdmin: async (req: any, res: any) => { if (req.user?.role === "business_owner") return true; res.status(403).json({ error: "Admin access required" }); return false; },
    getLatestQuoteRevision: async (id: string) => { const row = (await pool.query("SELECT * FROM quote_revisions WHERE lead_id=$1 ORDER BY revision DESC LIMIT 1", [id])).rows[0]; return row ? { id: row.id, status: row.status, customerTotal: Number(row.customer_total) } : null; },
    markQuoteRevisionSent: async () => {},
  };
  function compile(text: string, returns: string) {
    const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
      .replaceAll('await import("../services/square-invoice")', "squareModule")
      .replaceAll('await import("../services/customerLifecycle")', "lifecycleModule");
    return new Function(...Object.keys(deps), compiled + `;return ${returns};`)(...Object.values(deps));
  }
  const route = (path: string) => {
    const node: any = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.arguments[0]?.getText(ast) === JSON.stringify(path));
    assert.ok(node, path);
    const reviewSchema = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === "reviewInstantBookingHoldSchema"))!.getText(ast);
    return compile(declarations + "\n" + reviewSchema + "\nconst handler=" + node.expression.arguments.at(-1).getText(ast), "handler");
  };
  const hold = route("/instant-booking/hold"), availability = route("/instant-booking/availability"), status = route("/instant-booking/status"), review = route("/admin/booking-holds/:id");
  async function call(handler: any, body: any, extras: any = {}) {
    let code = 200, data: any;
    const res: any = { status(c: number) { code = c; return res; }, json(d: any) { data = d; return res; }, setHeader() {} };
    await handler({ body, session: {}, ...extras }, res);
    return { code, data };
  }
  const base = { requestKey: crypto.randomUUID(), service: "labor", customerName: "Synthetic Customer", customerEmail: "fixture@example.test", customerPhone: "2025550123", serviceAddress: "123 Synthetic St, Ironwood MI 49938", zip: "49938", requestedDate: "2099-07-10", requestedHours: 4, truckSource: "customer", startTime: "10:00", termsAccepted: true };
  // Availability is populated by actual worker schedule SQL; disabled/blocked/
  // short shifts and legacy jobs all remove capacity.
  let available = await call(availability, base);
  assert.equal(available.code, 200, JSON.stringify(available.data));
  assert.ok(available.data.slots.length > 0);
  assert.match(available.data.slots[0].centralLabel, /CDT/);
  assert.match(available.data.slots[0].easternLabel, /EDT/);
  assert.equal(available.data.quote.ownerProfit, undefined);
  await pool.query("INSERT INTO worker_day_blocks VALUES('fixture-a','2099-07-10')");
  assert.equal((await call(availability, base)).data.slots.length, 0);
  await pool.query("DELETE FROM worker_day_blocks");
  await pool.query("INSERT INTO worker_hour_overrides VALUES('fixture-a','2099-07-10',10,11)");
  assert.equal((await call(availability, base)).data.slots.length, 0);
  await pool.query("DELETE FROM worker_hour_overrides");
  const body = { ...base, reviewedQuoteFingerprint: available.data.quote.fingerprint };
  assert.equal((await call(hold, { ...body, reviewedQuoteFingerprint: "0".repeat(64) })).code, 409);
  assert.equal((await call(hold, { ...body, requestedDate: "2099-02-30" })).code, 400);
  assert.equal(Number((await pool.query("SELECT count(*) FROM bookings")).rows[0].count), 0);
  // Different starts overlap (10:00-14:00 and 12:00-16:00). Only real PostgreSQL
  // proves these independently-connected submissions cannot both acquire capacity.
  const contenders = [body, { ...body, requestKey: crypto.randomUUID(), startTime: "12:00" }];
  const outcomes = realPostgres ? await Promise.all(contenders.map(b => call(hold, b))) : [await call(hold, contenders[0]), await call(hold, contenders[1])];
  assert.deepEqual(outcomes.map(o => o.code).sort(), [201, 409], JSON.stringify(outcomes));
  const winnerIndex = outcomes.findIndex(o => o.code === 201);
  const winner = outcomes[winnerIndex].data, winnerBody = contenders[winnerIndex];
  assert.equal(winner.status, "awaiting_deposit");
  assert.equal(squareCalls, 1);
  const retry = realPostgres ? await Promise.all([call(hold, winnerBody), call(hold, winnerBody)]) : [await call(hold, winnerBody)];
  assert.ok(retry.every(r => r.data.duplicate));
  assert.equal(Number((await pool.query("SELECT count(*) FROM bookings")).rows[0].count), 1);
  assert.equal(Number((await pool.query("SELECT count(*) FROM quote_revisions")).rows[0].count), 1);
  assert.equal(squareCalls, 1);
  const summary = (await call(status, { requestKey: winnerBody.requestKey, paid: true })).data;
  assert.equal(summary.paymentState, "unpaid"); assert.equal(summary.status, "awaiting_deposit");
  assert.equal(summary.customerEmail, undefined); assert.equal(summary.quote_snapshot, undefined);
  assert.equal((await call(status, { requestKey: crypto.randomUUID() })).code, 404);
  assert.equal((await call(review, { decision: "release" }, { params: { id: winner.holdId }, user: { id: "fixture-a", role: "employee" } })).code, 403);
  async function transaction<T>(work: (tx: any) => Promise<T>) {
    const tx = await pool.connect();
    try { await tx.query("BEGIN"); const result = await work(tx); await tx.query("COMMIT"); return result; }
    catch (error) { await tx.query("ROLLBACK"); throw error; }
    finally { tx.release(); }
  }
  await assert.rejects(transaction(tx => settleVerifiedBookingHold(tx, winner.leadId, "UNPAID")), /verified/);
  assert.equal((await publicBookingStatus(pool, winnerBody.requestKey))?.status, "awaiting_deposit");
  // The release/payment race must yield either confirmed (release loses), or
  // payment_review (release wins). Neither may confirm a released slot.
  const release = () => call(review, { decision: "release" }, { params: { id: winner.holdId }, user: { id: "fixture-owner", role: "business_owner" } });
  const payment = () => transaction(tx => settleVerifiedBookingHold(tx, winner.leadId, "PAID", winner.quoteRevisionId));
  if (realPostgres) {
    await Promise.all([release(), payment()]);
    assert.ok(["confirmed", "payment_review"].includes((await publicBookingStatus(pool, winnerBody.requestKey))!.status));
  } else { assert.equal((await release()).code, 200); assert.equal(await payment(), "payment_review"); }
  // Clear occupied capacity for deterministic expiry/review scenarios.
  await pool.query("UPDATE booking_slot_holds SET status='released'");
  const expiredInput = { ...body, requestKey: crypto.randomUUID() };
  const expiredHold = (await call(hold, expiredInput)).data;
  assert.ok(expiredHold.holdId, JSON.stringify(expiredHold));
  await pool.query("UPDATE booking_slot_holds SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expiredHold.holdId]);
  await transaction(expireBookingHolds);
  assert.equal((await publicBookingStatus(pool, expiredInput.requestKey))?.status, "expired");
  assert.equal(await transaction(tx => settleVerifiedBookingHold(tx, expiredHold.leadId, "PAID", expiredHold.quoteRevisionId)), "payment_review");
  assert.equal((await call(review, { decision: "approve" }, { params: { id: expiredHold.holdId }, user: { id: "fixture-owner", role: "business_owner" } })).code, 409);
  failQuote = true;
  const failureBody = { ...body, requestKey: crypto.randomUUID() };
  const failed = await call(hold, failureBody);
  assert.equal(failed.code, 201); assert.equal(failed.data.status, "pending_review");
  const beforeRetry = squareCalls;
  assert.equal((await call(hold, failureBody)).data.duplicate, true); assert.equal(squareCalls, beforeRetry);
  failQuote = false;
  const approved = await call(review, { decision: "approve", sendDepositLink: false }, { params: { id: failed.data.holdId }, user: { id: "fixture-owner", role: "business_owner" } });
  assert.equal(approved.code, 200, JSON.stringify(approved)); assert.equal(approved.data.status, "awaiting_deposit");
  assert.equal((await call(review, { decision: "approve", sendDepositLink: true }, { params: { id: failed.data.holdId }, user: { id: "fixture-owner", role: "business_owner" } })).data.duplicate, true);
  assert.equal(squareCalls, beforeRetry, "Approval retries do not initiate a second Square operation");

  await pool.query("UPDATE booking_slot_holds SET status='released'");
  await pool.query("INSERT INTO promo_codes(code,referral_user_id) VALUES('FIXTURE10','fixture-a')");
  const attributed = await call(hold, { ...body, requestKey: crypto.randomUUID(), promoCode: "fixture10", createdByUserId: "fixture-b", ownerProfit: 999 }, { session: { userId: "fixture-owner" } });
  assert.equal(attributed.code, 201, JSON.stringify(attributed));
  assert.equal((await pool.query("SELECT created_by_user_id FROM leads WHERE id=$1", [attributed.data.leadId])).rows[0].created_by_user_id, "fixture-owner");
  assert.equal((await pool.query("SELECT user_id FROM quote_attributions WHERE lead_id=$1", [attributed.data.leadId])).rows[0].user_id, "fixture-a");
  assert.equal(attributed.data.quote.ownerProfit, undefined);
  await pool.query("UPDATE booking_slot_holds SET status='released'");

  // Run the actual canonical callback handler against the same database and
  // identity registry. Switching paths/retrying never creates a second lead.
  const callbackSource = readFileSync("server/routes.ts", "utf8");
  const callbackAst = ts.createSourceFile("routes.ts", callbackSource, ts.ScriptTarget.Latest, true);
  let callbackText = "";
  function visit(n: ts.Node) { if (ts.isCallExpression(n) && n.expression.getText(callbackAst) === "app.post" && n.arguments[0]?.getText(callbackAst) === '"/api/leads/quick-request"') callbackText = n.arguments.at(-1)!.getText(callbackAst); ts.forEachChild(n, visit); }
  visit(callbackAst);
  Object.assign(deps, { quickRequestSchema, projectIntakeInput, projectIntakeSchema, projectScheduleLabel, projectServiceLabel,
    safeMarketingTracking: (v: any) => v, QUICK_REQUEST_SERVICE_MAP: { moving: { serviceType: "residential", label: "Moving" } },
    notifyAdminNewLead: async () => true, process: { env: {} }, respondLeadError: (res: any, error: any) => res.status(500).json({ error: error.message }),
  });
  const callback = compile("const handler=" + callbackText, "handler");
  const callbackBody = { requestKey: crypto.randomUUID(), requestType: "callback", firstName: "Synthetic", lastName: "Callback", phone: "2025550199", serviceCode: "moving", serviceAddress: "456 Fixture Ave MI 49938", callbackWhen: "Discuss timing", movePlan: { sizingBasis: "truck", truckSize: "15_ft", scope: "unload", inventory: "Boxes and sofa" } };
  const callbacks = realPostgres ? await Promise.all([call(callback, callbackBody), call(callback, callbackBody)]) : [await call(callback, callbackBody), await call(callback, callbackBody)];
  assert.deepEqual(callbacks.map(c => c.code).sort(), [200, 201], JSON.stringify(callbacks));
  const callbackState = await publicBookingStatus(pool, callbackBody.requestKey);
  assert.equal(callbackState?.kind, "callback"); assert.equal(callbackState?.bookingId, null); assert.equal(callbackState?.paymentUrl, null);
  const callbackLead = (await pool.query("SELECT * FROM leads WHERE id=$1", [callbackState!.leadId])).rows[0];
  assert.equal(callbackLead.deposit_required, false); assert.equal(callbackLead.move_date, "");
  assert.equal(callbackLead.from_address, callbackBody.serviceAddress);
  assert.equal(callbackLead.quote_snapshot.homepageBooking.recommendation.crewSize, 2);
  const count = Number((await pool.query("SELECT count(*) FROM leads")).rows[0].count);
  assert.equal((await call(hold, { ...body, requestKey: callbackBody.requestKey })).data.duplicate, true);
  assert.equal((await call(callback, { ...callbackBody, requestKey: winnerBody.requestKey })).data.duplicate, true);
  assert.equal(Number((await pool.query("SELECT count(*) FROM leads")).rows[0].count), count);
  console.log(`PASS: ${realPostgres ? "multi-session PostgreSQL" : "PGlite sequential"} homepage availability, hold retries, expiry, release, review, payment states, callback routing and cross-path identity; Square mocked (${squareCalls} synthetic calls)`);
} finally { await close(); }
