// Synthetic SQL + HTTP acceptance. --postgres uses independent connections;
// default PGlite validates sequential behavior without a production database.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import express from "express";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import { projectIntakeSchema, projectScheduleLabel, projectServiceLabel } from "@shared/projectRequest";
import { quickRequestSchema, projectIntakeInput } from "../quickRequest";
import { LEAD_BOT_SCHEMA, commitLeadBotInquiry, prepareLeadBotSubmission, LeadBotError } from "../leadBotPilot";
import { leadBotPilotRouter } from "../../routes/leadBotPilot";

const realPostgres = process.argv.includes("--postgres");
let database: any, query: (text: string, params?: any[]) => Promise<any>, close: () => Promise<void>;
if (realPostgres) {
  const url = new URL(process.env.TEST_DATABASE_URL || "http://missing");
  if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/jc_ledger_test") throw Error("Use a local disposable jc_ledger_test database only");
  const { default: pg } = await import("pg");
  const admin = new pg.Pool({ connectionString: url.href });
  const namespace = `leadbot_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${namespace}`);
  const pool = new pg.Pool({ connectionString: url.href, options: `-c search_path=${namespace}`, statement_timeout: 15000, max: 12 });
  database = (await import("drizzle-orm/node-postgres")).drizzle(pool);
  query = (text, params) => pool.query(text, params);
  close = async () => { await pool.end(); await admin.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.end(); };
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  database = (await import("drizzle-orm/pglite")).drizzle(pg);
  query = (text, params) => params ? pg.query(text, params) : pg.exec(text).then(results => results[0] || { rows: [] });
  close = () => pg.close();
}
const oldEnabled = process.env.LEAD_BOT_PUBLIC_ENABLED;
const oldCampaign = process.env.LEAD_BOT_PUBLIC_CAMPAIGN_ID;
let httpServer: any;
try {
  const dialect = new PgDialect();
  const literal = (value: any) => value?.queryChunks ? dialect.sqlToQuery(value).sql : "'" + String(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''") + "'";
  for (const table of [schema.users, schema.leads, schema.quoteAttributions, schema.marketingReps, schema.promoCodes]) {
    const config = getTableConfig(table);
    await query(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.default !== undefined ? " DEFAULT " + literal(c.default) : ""}${c.notNull ? " NOT NULL" : ""}`).join(",")})`);
  }
  const marketingSource = readFileSync("server/services/marketingBot.ts", "utf8");
  for (const table of ["marketing_bot_campaigns", "marketing_bot_variants", "marketing_bot_events", "marketing_bot_audit_events"]) {
    const ddl = marketingSource.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\);`))?.[0];
    assert.ok(ddl, `Actual ${table} DDL exists`); await query(ddl);
  }
  await query(LEAD_BOT_SCHEMA);
  await query(LEAD_BOT_SCHEMA); // repeatable migration
  const repId = crypto.randomUUID(), promoId = crypto.randomUUID(), campaignId = crypto.randomUUID(), variantId = crypto.randomUUID();
  await query("INSERT INTO users(id,role,status) VALUES ('owner','business_owner','approved'),('rep','employee','approved'),('other','employee','approved')");
  await query("INSERT INTO marketing_reps(id,user_id,slug,display_name,brand_name,promo_code) VALUES ($1,'rep','fixture-rep','Synthetic Representative','JC ON THE MOVE LLC','FIXTURE10')", [repId]);
  await query("INSERT INTO promo_codes(id,code,description,discount_percent,referral_user_id) VALUES($1,'FIXTURE10','Synthetic promotion',10,'rep')", [promoId]);
  await query(`INSERT INTO marketing_bot_campaigns(id,run_key,campaign_code,local_date,source,service,territory,status,approved_at,headline,facebook_caption,instagram_caption,google_business_summary,short_caption,campaign_url)
    VALUES($1,'fixture','fixture',CURRENT_DATE,'synthetic','junk_removal','ironwood_hurley','approved',NOW(),'Synthetic cleanout campaign','','','','','https://example.test')`, [campaignId]);
  await query("INSERT INTO marketing_bot_variants(id,campaign_id,variant_code,channel,rep_id,rep_slug,promo_code,is_company,caption,destination_url,image_url) VALUES($1,$2,'fixture-rep-campaign','facebook',$3,'fixture-rep','FIXTURE10',false,'','','')", [variantId, campaignId, repId]);

  // Compile the real canonical handler and real marketing authorization function;
  // inject only the isolated database, rate limiter and no-send side-effect spies.
  const source = readFileSync("server/routes.ts", "utf8");
  const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
  let handlerSource = "";
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "app.post" && node.arguments[0]?.getText(ast) === '"/api/leads/quick-request"') handlerSource = node.arguments.at(-1)!.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(handlerSource);
  let forbiddenEffects = 0;
  const forbidden = async () => { forbiddenEffects++; throw new Error("Messaging / scheduling must not run"); };
  const dependencies: any = { crypto, db: database, ...schema, sql, and, desc, eq, gte, quickRequestSchema, projectIntakeInput,
    projectIntakeSchema, projectScheduleLabel, projectServiceLabel, commitLeadBotInquiry, LeadBotError,
    prepareLeadBotSubmission: (input: unknown) => database.transaction((tx: any) => prepareLeadBotSubmission(input, tx)),
    safeMarketingTracking: (value: any) => value,
    QUICK_REQUEST_SERVICE_MAP: { junk_removal: { serviceType: "junk", label: "Junk removal" } },
    notifyAdminNewLead: forbidden, smsService: { notifyNewLead: forbidden }, emitJobEvent: forbidden,
    respondLeadError: (res: any, error: any) => res.status(error instanceof z.ZodError ? 400 : 500).json({ error: error.message }), console, process,
  };
  const compile = (text: string, result: string) => new Function(...Object.keys(dependencies), ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText + `\nreturn ${result};`)(...Object.values(dependencies));
  const canonical = compile(`const handler=${handlerSource}`, "handler");
  const authSource = readFileSync("server/routes/marketingBot.ts", "utf8");
  const authAst = ts.createSourceFile("marketingBot.ts", authSource, ts.ScriptTarget.Latest, true);
  const authText = authAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "requireMarketingAdmin")!.getText(authAst);
  const auth = compile(authText, "requireMarketingAdmin");
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = req.headers["x-test-user"] ? { userId: req.headers["x-test-user"] } : {}; next(); });
  app.use("/api", leadBotPilotRouter(auth, { db: database, ensureLeadBotSchema: async () => {}, ipRateLimit: () => (_req: any, _res: any, next: any) => next() }));
  app.post("/api/leads/quick-request", canonical);
  httpServer = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => httpServer.once("listening", resolve));
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  const call = async (path: string, body?: unknown, user?: string) => {
    const response = await fetch(origin + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const adminPath = "/api/admin/marketing-bot/lead-bot-pilot";
  const config = { name: "Synthetic pilot", representativeId: repId, campaignId, variantId, service: "junk_removal", territory: "ironwood_hurley", towns: [{ city: "Ironwood", state: "MI" }], promotionId: promoId, questions: ["access", "items"] };
  assert.equal((await call(adminPath)).status, 403);
  assert.equal((await call(adminPath, { config }, "rep")).status, 403);
  const created = await call(adminPath, { config }, "owner"); assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.data.id;
  const publicPath = `/api/lead-bots/${id}`;
  assert.equal((await call(adminPath, { config }, "owner")).status, 409, "One controlled campaign only");
  assert.equal((await call(`${adminPath}/${id}/preview`)).status, 403);
  assert.equal((await call(`${adminPath}/${id}/preview`, undefined, "owner")).data.preview, true);
  assert.equal((await call(`${adminPath}/${id}/decision`, { revision: 1, decision: "approve" }, "rep")).status, 403);
  assert.equal((await call(`${adminPath}/${id}/decision`, { revision: 1, decision: "approve" }, "owner")).status, 200);
  delete process.env.LEAD_BOT_PUBLIC_ENABLED;
  assert.equal((await call(publicPath)).status, 404, "Approval alone cannot open public intake");
  const submission = { leadBotId: id, revision: 1, submissionKey: crypto.randomUUID(), visitorId: crypto.randomUUID(), inquiry: {
    serviceAddress: "123 Synthetic Ave", city: "Ironwood", state: "MI", zip: "49938", scope: "Remove two old desks from our garage", timing: "Next week, flexible", timeZone: "America/Chicago",
    firstName: "Synthetic", lastName: "Customer", email: "customer@example.test", phone: "202-555-0123", answers: { access: "No stairs", items: "Two desks" }, consent: true,
  } };
  assert.equal((await call("/api/leads/quick-request", submission)).status, 404);
  process.env.LEAD_BOT_PUBLIC_ENABLED = "true"; process.env.LEAD_BOT_PUBLIC_CAMPAIGN_ID = crypto.randomUUID();
  assert.equal((await call(publicPath)).status, 404, "Campaign allowlist required");
  process.env.LEAD_BOT_PUBLIC_CAMPAIGN_ID = campaignId;
  const view = await call(publicPath); assert.equal(view.status, 200); assert.equal(view.data.representative, "Synthetic Representative"); assert.equal(view.data.approval_hash, undefined);
  await call(`${publicPath}/visit`, { visitorId: submission.visitorId }); await call(`${publicPath}/visit`, { visitorId: submission.visitorId });
  assert.equal((await query("SELECT count(*)::int n FROM marketing_bot_events WHERE event_type='landing_view'")).rows[0].n, 1);
  assert.equal((await call("/api/leads/quick-request", { ...submission, promoCode: "ATTACKER" })).status, 400, "Client cannot override attribution");
  assert.equal((await call("/api/leads/quick-request", { ...submission, inquiry: { ...submission.inquiry, city: "Elsewhere" } })).status, 422);
  assert.equal((await call("/api/leads/quick-request", { ...submission, inquiry: { ...submission.inquiry, consent: false } })).status, 400);
  const responses = realPostgres ? await Promise.all([call("/api/leads/quick-request", submission), call("/api/leads/quick-request", submission)])
    : [await call("/api/leads/quick-request", submission), await call("/api/leads/quick-request", submission)];
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201], JSON.stringify(responses));
  assert.deepEqual(Object.keys(responses[0].data).sort(), ["duplicate", "submitted", "success"], "Public receipt contains no lead/contact data");
  assert.equal((await call("/api/leads/quick-request", { ...submission, inquiry: { ...submission.inquiry, scope: "Different project with the same key" } })).status, 409);
  const newKey = { ...submission, submissionKey: crypto.randomUUID(), inquiry: { ...submission.inquiry, phone: "+1 202 555 0123" } };
  assert.equal((await call("/api/leads/quick-request", newKey)).data.duplicate, true, "Same inquiry under a new key deduplicates");
  const savedLead = (await query("SELECT * FROM leads")).rows[0];
  assert.equal(savedLead.status, "quote_requested"); assert.equal(savedLead.move_date, ""); assert.equal(savedLead.crew_size, null);
  assert.equal(savedLead.email, submission.inquiry.email); assert.match(savedLead.from_address, /Ironwood/); assert.match(savedLead.details, /Next week, flexible/);
  const credit = (await query("SELECT * FROM quote_attributions")).rows[0];
  assert.equal(credit.user_id, "rep"); assert.equal(credit.promo_code, "FIXTURE10"); assert.equal(credit.metadata.representativeId, repId); assert.equal(credit.metadata.jc_campaign, "fixture-rep-campaign");
  assert.equal((await query("SELECT count(*)::int n FROM leads")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::int n FROM quote_attributions")).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::int n FROM marketing_bot_events WHERE event_type='lead'")).rows[0].n, 1);
  const dashboard = (await call(adminPath, undefined, "owner")).data;
  assert.equal(dashboard.publicEnabled, true); assert.equal(dashboard.reviewIssue, null);
  assert.deepEqual(dashboard.metrics, { views: 1, inquiries: 1 }); assert.equal(dashboard.messagingEnabled, false); assert.equal(dashboard.publishingEnabled, false);

  // A failed credit insert must roll back the lead and request key too.
  await query("ALTER TABLE quote_attributions ADD CONSTRAINT fail_synthetic_credit CHECK (user_id<>'rep') NOT VALID");
  const failure = { ...submission, submissionKey: crypto.randomUUID(), inquiry: { ...submission.inquiry, scope: "A second distinct project for rollback testing" } };
  assert.equal((await call("/api/leads/quick-request", failure)).status, 500);
  assert.equal((await query("SELECT count(*)::int n FROM leads")).rows[0].n, 1);
  await query("ALTER TABLE quote_attributions DROP CONSTRAINT fail_synthetic_credit");
  assert.equal((await call("/api/leads/quick-request", failure)).status, 201, "Retry recovers after rollback");
  await query("UPDATE promo_codes SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [promoId]);
  assert.equal((await call(publicPath)).status, 409, "Expired promotion fails closed");
  await query("UPDATE promo_codes SET expires_at=NULL,referral_user_id='other' WHERE id=$1", [promoId]);
  assert.equal((await call(publicPath)).status, 409, "Referral owner mismatch fails closed");
  await query("UPDATE promo_codes SET referral_user_id='rep',description='Changed terms' WHERE id=$1", [promoId]);
  assert.equal((await call(publicPath)).status, 409, "Changed terms invalidate approval");
  await call(`${adminPath}/${id}/decision`, { revision: 1, decision: "approve" }, "owner");
  await query("UPDATE marketing_bot_campaigns SET revision=revision+1 WHERE id=$1", [campaignId]);
  assert.equal((await call(publicPath)).status, 409, "Campaign edits invalidate approval");
  await call(`${adminPath}/${id}/decision`, { revision: 1, decision: "approve" }, "owner");
  const saved = await call(adminPath, { id, revision: 1, config: { ...config, questions: ["access"] } }, "owner");
  assert.equal(saved.status, 200); assert.equal(saved.data.status, "draft"); assert.equal(saved.data.approval_hash, null);
  assert.equal((await call(`${adminPath}/${id}/decision`, { revision: 1, decision: "approve" }, "owner")).status, 409, "Stale owner screen cannot approve");
  await call(`${adminPath}/${id}/decision`, { revision: 2, decision: "approve" }, "owner");
  assert.equal((await call("/api/leads/quick-request", submission)).status, 409, "Stale customer screen cannot submit");
  await call(`${adminPath}/${id}/decision`, { revision: 2, decision: "pause" }, "owner");
  assert.equal((await call(publicPath)).status, 404);
  if (process.argv.includes("--browser")) {
    await call(`${adminPath}/${id}/decision`, { revision: 2, decision: "approve" }, "owner");
    const before = (await query("SELECT count(*)::int n FROM leads")).rows[0].n;
    const { runLeadBotBrowser } = await import("../../../scripts/lead-bot-browser.mjs");
    await runLeadBotBrowser({ app, origin, botId: id });
    assert.equal((await query("SELECT count(*)::int n FROM leads")).rows[0].n, before + 1, "Browser lost-response retry created one lead");
    const browserCredit = (await query("SELECT * FROM quote_attributions ORDER BY created_at DESC LIMIT 1")).rows[0];
    assert.equal(browserCredit.user_id, "rep");
  }
  if (process.argv.includes("--dom")) {
    await call(`${adminPath}/${id}/decision`, { revision: 2, decision: "approve" }, "owner");
    const before = (await query("SELECT count(*)::int n FROM leads")).rows[0].n;
    const { runLeadBotDom } = await import("../../../scripts/lead-bot-dom.mjs");
    await runLeadBotDom({ origin, botId: id });
    assert.equal((await query("SELECT count(*)::int n FROM leads")).rows[0].n, before + 1);
  }
  assert.equal(forbiddenEffects, 0, "No email, SMS, scheduler, booking, reward or publication side effects");
  console.log(`PASS: lead-bot SQL/HTTP conversion, attribution, rollback, retry, approval, pause, qualification and disabled publication (${realPostgres ? "multi-connection PostgreSQL" : "sequential PGlite"})`);
} finally {
  if (oldEnabled === undefined) delete process.env.LEAD_BOT_PUBLIC_ENABLED; else process.env.LEAD_BOT_PUBLIC_ENABLED = oldEnabled;
  if (oldCampaign === undefined) delete process.env.LEAD_BOT_PUBLIC_CAMPAIGN_ID; else process.env.LEAD_BOT_PUBLIC_CAMPAIGN_ID = oldCampaign;
  if (httpServer) await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await close();
}
