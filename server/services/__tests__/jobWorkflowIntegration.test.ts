import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { build } from "esbuild";
import express from "express";

// Actual PostgreSQL queries and transactions, isolated from production and all
// outbound providers. The provider mocks deliberately exercise partial success.
const db = new PGlite();
const directory = await mkdtemp(path.join(process.cwd(), ".workflow-test-"));
const originalEnv = { ...process.env };
const state = { emails: 0, texts: 0, invoices: 0, crew: 0, emailOk: true, smsOk: true, invoiceOk: true, emailThrows: false, failAudit: false, pushes: [] as any[], pushStatus: "sent" };
let httpServer: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
let lease = Promise.resolve();
const query = async (text: string, values: any[] = []) => {
  if (state.failAudit && text.startsWith("INSERT INTO lead_history")) throw new Error("Injected audit failure");
  const result: any = values.length === 0 && text.split(";").filter(s => s.trim()).length > 1 ? (await db.exec(text)).at(-1) : await db.query(text, values);
  return { rows: result?.rows || [], rowCount: result?.affectedRows ?? result?.rows?.length ?? 0 };
};
const pool = { query, connect: async () => { const prior = lease; let release!: () => void; lease = new Promise<void>(resolve => release = resolve); await prior; return { query, release }; } };
(globalThis as any).__jobWorkflowTest = { pool, state };
try {
  process.env.NODE_ENV = "test";
  process.env.SQUARE_LOCATION_ID = "test-location";
  process.env.SQUARE_ACCESS_TOKEN = "test-token";
  process.env.TWILIO_ACCOUNT_SID = "test";
  process.env.TWILIO_AUTH_TOKEN = "test";
  process.env.TWILIO_FROM_NUMBER = "+12025550135";
  await db.exec(`
    CREATE TABLE users(id varchar PRIMARY KEY, first_name text, last_name text, role text, email text, status text, is_approved boolean);
    CREATE TABLE worker_profiles(user_id varchar, authority_tier text);
    CREATE TABLE leads(id varchar PRIMARY KEY,order_number serial,booking_id varchar,status text DEFAULT 'quote_requested',
      first_name text,last_name text,email text,phone text,service_type text,from_address text,to_address text,
      confirmed_from_address text,confirmed_to_address text,confirmed_date text,move_date text,arrival_window text,
      crew_size int,confirmed_hours int,crew_members text[],accepted_by_employees text[],truck_config text,trailer_requested boolean,
      base_price numeric,total_price numeric,total_special_items_fee numeric,bundle_discount_amount numeric,
      order_line_items jsonb,quote_snapshot jsonb,zone_snapshot jsonb,quote_notes text,job_plan_details jsonb DEFAULT '{}',
      quote_sent_at timestamp,last_quote_updated_at timestamp,created_at timestamp DEFAULT now(),
      deposit_required boolean DEFAULT false,deposit_paid boolean DEFAULT false,payment_paid_at timestamp,payment_plan text,
      dispatch_override_reason text,sms_consent boolean DEFAULT false,sms_consent_recorded_at timestamp,sms_consent_source text,sms_consent_recorded_by varchar,
      square_payment_url text,dispatch_sent_at timestamp,archived_at timestamp,assigned_to_user_id varchar);
    CREATE TABLE notifications(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),user_id varchar,type text,title text,message text,data jsonb,read boolean DEFAULT false,created_at timestamp DEFAULT now());
    CREATE TABLE quote_approvals(id serial PRIMARY KEY,lead_id varchar,booking_id varchar,submitted_by_user_id varchar,approved_by_user_id varchar,approval_role text,status text,notes text,created_at timestamp DEFAULT now());
    CREATE TABLE lead_history(id serial,lead_id varchar,from_status text,to_status text,changed_by_user_id varchar,note text);
    CREATE TABLE customer_job_events(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),lead_id varchar,event_type text,event_key text UNIQUE,title text,message text,payload jsonb);
    CREATE TABLE customer_notification_deliveries(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),event_id varchar,channel text,destination_hash text,status text,provider_reference text,error text,attempts int,updated_at timestamp,UNIQUE(event_id,channel,destination_hash));
    CREATE TABLE idempotency_keys(key text PRIMARY KEY,scope text);
    CREATE TABLE wallet_credit_grants(id varchar PRIMARY KEY,source_type text,source_id varchar,status text,amount_usd numeric,metadata jsonb,square_invoice_id text);
    INSERT INTO users(id,role,email,status,is_approved) VALUES('owner','business_owner','upmichiganstatemovers@gmail.com','active',true),('worker','employee','worker@example.test','active',true);
    INSERT INTO users(id,role,email,status,is_approved) VALUES('customer','customer','customer@example.test','active',true),('bronze','employee','bronze@example.test','active',true);
    INSERT INTO worker_profiles VALUES('worker','silver'),('bronze','worker');
  `);
  const outfile = path.join(directory, "workflow.mjs");
  await build({ stdin: { contents: 'export * from "./server/services/jobWorkflow"; export {default as workflowRouter} from "./server/routes/jobWorkflow";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", packages: "external", outfile,
    plugins: [{ name: "workflow-fixtures", setup(builder) {
      builder.onResolve({ filter: /^(\.\.\/db|\.\.\/auth|\.\/notification|\.\/pricingVersions|\.\/quoteGeography|\.\/regionalAutomationMigration|\.\/square-invoice|\.\/email|\.\/sms|\.\/jobEventBus)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        const pre = 'const {pool,state}=globalThis.__jobWorkflowTest;';
        const sources: Record<string,string> = {
          "../db": pre + 'export {pool};',
          "../auth": 'export const isAuthenticated=(req,res,next)=>{const id=req.headers["x-test-user"];if(!id)return res.status(401).json({error:"Login required"});req.currentUser={id};next()};',
          "./notification": pre + 'export const notificationService={sendPushNotification:async(userId,notification)=>{state.pushes.push({userId,...notification});return {status:state.pushStatus}}};',
          "./pricingVersions": 'export async function getActivePricingSnapshot(){return {versionId:null,snapshot:{version:"test_legacy",currency:"USD",offers:{totalPercentageCap:100}}}}',
          "./quoteGeography": 'export async function resolveQuoteRouteEvidence(){return {verified:true,stopCoordinates:[],oneWayMinutes:5,oneWayMiles:2}}',
          "./regionalAutomationMigration": 'export async function ensureRegionalAutomationSchema(){}',
          "./square-invoice": pre + 'export const squareInvoiceService={isConfigured:()=>true,createItemizedInvoiceForLead:async(lead,lines,contact,delivery,options)=>{if(delivery!=="none" || options.expectedTotal!==Math.round((lines.reduce((sum,l)=>sum+l.total,0)-options.discounts.reduce((sum,d)=>sum+d.amount,0))*100)/100 || !options.idempotencyKey)throw Error("Wrong invoice arguments");state.invoices++;if(!state.invoiceOk)throw Error("provider timeout");return {invoiceUrl:"https://square.example.test/pay",squareInvoiceId:"invoice-test"}}};',
          "./email": pre + 'export async function sendWorkflowEmail(){state.emails++;if(state.emailThrows)throw Error("timeout");return state.emailOk;}',
          "./sms": pre + 'export const smsService={sendSMS:async()=>{state.texts++;return {success:state.smsOk,messageSid:"sms-test",error:state.smsOk?undefined:"Invalid destination"}}};',
          "./jobEventBus": pre + 'export async function emitJobEvent(){state.crew++;}',
        };
        return { contents: sources[args.path], loader: "js" };
      });
    } }],
  });
  const workflow = await import(pathToFileURL(outfile).href);
  const actor = { userId: "owner", isOwner: true, manage: true, canApproveStandard: true };
  // First read creates only the established quote infrastructure.
  await assert.rejects(workflow.getJobWorkflow("missing", actor));
  const seed = async (id: string) => query(`INSERT INTO leads(id,first_name,last_name,email,phone,service_type,from_address,confirmed_date,arrival_window,crew_size,confirmed_hours,crew_members,base_price,total_price,order_line_items,quote_snapshot,job_plan_details) VALUES($1,'Test','Customer','test@example.test','2025550135','labor','213 S Marquette St','2099-10-02','9:00 AM – 10:00 AM',3,2,ARRAY['a','b','c'],525,472.5,$2::jsonb,$3::jsonb,'{"workScope":"load_only","keep":"original intake"}')`, [id, JSON.stringify([{ name: "Labor", qty: 1, unitPrice: 525, total: 525 }]), JSON.stringify({ rateCardAutoQuote: { discountAmount: 52.5 } })]);
  const prepare = async (id: string, method = "both") => { const r = await workflow.reviewJobQuote(id, actor, method); assert.deepEqual(r.blockers, []); return { version: r.version, reviewHash: r.reviewHash, idempotencyKey: randomUUID(), deliveryMethod: method, recordSmsConsent: true }; };

  await seed("one");
  const request = await prepare("one");
  state.smsOk = false;
  const first = await workflow.approveAndSend("one", actor, request);
  assert.equal(first.saved, true); assert.equal(first.approved, true);
  assert.equal(first.delivery.email.status, "sent"); assert.equal(first.delivery.sms.status, "failed");
  assert.equal(first.workflow.quote.total, 472.5); assert.equal(first.workflow.quote.discount, 52.5);
  state.smsOk = true;
  const retried = await workflow.approveAndSend("one", actor, request);
  assert.equal(retried.delivery.sms.status, "sent");
  assert.deepEqual([state.emails,state.texts,state.invoices], [1,2,1], "Only the failed channel is retried");
  assert.equal((await query("SELECT count(*) FROM quote_approvals WHERE lead_id='one'")).rows[0].count, 1);
  const again = await prepare("one");
  await workflow.approveAndSend("one", actor, again);
  assert.deepEqual([state.emails,state.texts,state.invoices], [1,2,1], "A refreshed request cannot duplicate successful deliveries");

  let flow = await workflow.getJobWorkflow("one", actor);
  assert.equal(flow.nextAction.key, "confirm");
  await workflow.confirmCustomer("one", actor, { version: flow.version, method: "phone", attested: true });
  const plan = (await query("SELECT job_plan_details FROM leads WHERE id='one'")).rows[0].job_plan_details;
  assert.equal(plan.keep, "original intake"); assert.equal(plan.customerConfirmation.method, "phone");
  flow = await workflow.getJobWorkflow("one", actor);
  assert.equal(flow.confirmation.current, true);
  // Drizzle's raw transaction adapter returns timestamp strings, while the
  // pool returns Date objects. Both readers must identify the same saved job.
  const rawTimestampAdapter = { query: async (sql: string, values: any[] = []) => {
    const result = await query(sql, values);
    return { ...result, rows: result.rows.map((row: any) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "") : value]))) };
  } };
  assert.equal((await workflow.loadWorkflowState("one", rawTimestampAdapter)).version, flow.version, "Setup and workflow reads must agree after quote approval and confirmation");
  await assert.rejects(workflow.executeCrewAction("one", actor, { version: flow.version, action: "dispatch", idempotencyKey: randomUUID() }), /setup/);
  assert.equal(state.crew, 0);
  const paymentRequest = { version: flow.version, method: "cash", attested: true };
  const payments = await Promise.all([workflow.recordWorkflowPayment("one", actor, paymentRequest), workflow.recordWorkflowPayment("one", actor, paymentRequest)]);
  assert.equal(payments.filter(p => !p.alreadyRecorded).length, 1);
  assert.equal((await query("SELECT status FROM leads WHERE id='one'")).rows[0].status, "quoted", "Recording payment preserves the operational status");
  flow = await workflow.getJobWorkflow("one", actor);
  assert.equal((await workflow.loadWorkflowState("one", rawTimestampAdapter)).version, flow.version, "Payment timestamps must not depend on the database reader");
  const dispatch = { version: flow.version, action: "dispatch", idempotencyKey: randomUUID() };
  await workflow.executeCrewAction("one", actor, dispatch);
  await workflow.executeCrewAction("one", actor, { ...dispatch, idempotencyKey: randomUUID() });
  await workflow.executeCrewAction("one", actor, dispatch);
  assert.equal(state.crew, 1);
  assert.equal((await query("SELECT status FROM leads WHERE id='one'")).rows[0].status, "dispatched");
  await query("UPDATE leads SET confirmed_date='2099-10-03' WHERE id='one'");
  assert.equal((await workflow.getJobWorkflow("one", actor)).confirmation.current, false);

  await seed("copy");
  const copy = await workflow.approveAndSend("copy", actor, await prepare("copy", "copy"));
  assert.equal(copy.delivery.email.status, "not_requested");
  const copiedRow = (await query("SELECT quote_sent_at FROM leads WHERE id='copy'")).rows[0];
  assert.equal(copiedRow.quote_sent_at, null);
  assert.equal(workflow.readWorkflowQuoteToken(new URL(copy.delivery.quoteAccessUrl).searchParams.get("token")).quoteId, copy.quoteRevisionId);
  assert.equal(workflow.readWorkflowQuoteToken("tampered"), null);

  await seed("stale");
  const stale = await prepare("stale", "email");
  await query("UPDATE leads SET total_price=480 WHERE id='stale'");
  await assert.rejects(workflow.approveAndSend("stale", actor, stale), /changed/);
  assert.equal((await query("SELECT count(*) FROM quote_approvals WHERE lead_id='stale'")).rows[0].count, 0);
  assert.ok((await workflow.reviewJobQuote("stale", actor, "email")).blockers.some((b:any)=>b.code==='quote_reconcile'));

  await seed("unknown"); state.emailThrows = true;
  const uncertainRequest = await prepare("unknown", "email");
  const uncertain = await workflow.approveAndSend("unknown", actor, uncertainRequest);
  assert.equal(uncertain.saved, true); assert.equal(uncertain.delivery.email.status, "unknown");
  const emailsAfterTimeout = state.emails;
  await workflow.approveAndSend("unknown", actor, uncertainRequest);
  assert.equal(state.emails, emailsAfterTimeout, "Unknown delivery is not blindly resent");
  state.emailThrows = false;

  await seed("bundled");
  await query("INSERT INTO wallet_credit_grants VALUES('grant-one','lead','bundled','pending',50,'{\"name\":\"Shop Card\"}',null)");
  const bundledRequest = await prepare("bundled", "copy");
  const bundled = await workflow.approveAndSend("bundled", actor, bundledRequest);
  assert.equal(bundled.workflow.quote.invoiceTotal, 522.5);
  assert.equal(bundled.workflow.quote.total, 472.5);
  assert.equal((await query("SELECT square_invoice_id FROM wallet_credit_grants WHERE id='grant-one'")).rows[0].square_invoice_id, "invoice-test");

  await seed("rollback");
  const rollback = await prepare("rollback", "copy");
  state.failAudit = true;
  await assert.rejects(workflow.approveAndSend("rollback", actor, rollback), /Injected audit failure/);
  state.failAudit = false;
  assert.equal((await query("SELECT count(*) FROM quote_approvals WHERE lead_id='rollback'")).rows[0].count, 0);
  assert.equal((await query("SELECT count(*) FROM quote_revisions WHERE lead_id='rollback'")).rows[0].count, 0);
  await workflow.approveAndSend("rollback", actor, rollback);

  await seed("concurrent");
  const concurrent = await prepare("concurrent", "email");
  const simultaneous = await Promise.allSettled([workflow.approveAndSend("concurrent", actor, concurrent),workflow.approveAndSend("concurrent", actor, concurrent)]);
  assert.ok(simultaneous.some(result => result.status === "fulfilled"));
  assert.equal((await query("SELECT count(*) FROM quote_approvals WHERE lead_id='concurrent'")).rows[0].count, 1);
  assert.equal((await query("SELECT count(*) FROM quote_revisions WHERE lead_id='concurrent'")).rows[0].count, 1);
  assert.equal(await workflow.workflowActor("missing"), null);
  assert.equal((await workflow.workflowActor("worker")).canApproveStandard, false);
  // Real HTTP authorization + service + PostgreSQL request and approval flow.
  const app = express(); app.use(express.json()); app.use("/api", workflow.workflowRouter);
  httpServer = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => httpServer!.once("listening", resolve));
  const address = httpServer.address() as { port: number };
  const call = async (user: string | null, id: string, action: string, body?: any) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/leads/${id}/${action}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() as any };
  };
  await seed("remote");
  const workerFlow = await call("worker", "remote", "workflow");
  assert.equal(workerFlow.status, 200); assert.equal(workerFlow.data.capabilities.requestApproval, true);
  const remoteVersion = workerFlow.data.version;
  for (const user of [null, "customer", "bronze"]) {
    const denied = await call(user, "remote", "request-owner-approval", { version: remoteVersion });
    assert.equal(denied.status, user ? 403 : 401);
  }
  assert.equal((await call("worker", "one", "request-owner-approval", { version: remoteVersion })).status, 403, "Employees cannot request approval outside the existing job access rules");
  const requested = await call("worker", "remote", "request-owner-approval", { version: remoteVersion });
  assert.equal(requested.status, 200); assert.equal(requested.data.inApp, "sent");
  const notificationRows = (await query("SELECT * FROM notifications WHERE data->>'leadId'='remote'")).rows;
  assert.equal(notificationRows.length, 1); assert.equal(notificationRows[0].user_id, "owner");
  assert.match(notificationRows[0].message, /\$472\.50.*3 movers.*2 hours.*2099-10-02/);
  assert.equal(notificationRows[0].data.url, `/lead/remote?approvalRequest=${requested.data.requestId}`);
  assert.equal(state.pushes.length, 1); assert.equal(state.pushes[0].userId, "owner");
  assert.equal((await workflow.getJobWorkflow("remote", actor)).approvalRequest.current, true);
  assert.equal((await call("worker", "remote", "request-owner-approval", { version: remoteVersion })).data.alreadyRequested, true);
  assert.equal(state.pushes.length, 1, "Lost-response retries do not repeat notifications");
  const ownerReview = await call("owner", "remote", "quote-review", { deliveryMethod: "none" });
  const approveInput = { version: ownerReview.data.version, reviewHash: ownerReview.data.reviewHash, idempotencyKey: randomUUID(), deliveryMethod: "none" };
  assert.equal((await call("worker", "remote", "approve-and-send", approveInput)).status, 403);
  const beforeProviders = [state.emails, state.texts, state.invoices, state.crew];
  const approvalOnly = await call("owner", "remote", "approve-and-send", approveInput);
  assert.equal(approvalOnly.status, 200); assert.equal(approvalOnly.data.workflow.quote.status, "approved");
  assert.equal(approvalOnly.data.workflow.quote.total, 472.5);
  assert.equal(approvalOnly.data.workflow.confirmation.current, false);
  assert.equal(approvalOnly.data.workflow.approvalRequest.current, false);
  assert.equal((await call("owner", "remote", "approve-and-send", { ...approveInput, deliveryMethod: "email" })).status, 200);
  assert.deepEqual([state.emails, state.texts, state.invoices, state.crew], beforeProviders, "Approval-only and its retries do not send messages, create invoices, or dispatch");
  assert.equal((await call("worker", "remote", "customer-confirmation", { version: approvalOnly.data.workflow.version, method: "phone", attested: true })).status, 403);
  assert.equal((await call("worker", "remote", "request-owner-approval", { version: approvalOnly.data.workflow.version })).status, 409);

  await seed("request-race");
  const raceVersion = (await workflow.getJobWorkflow("request-race", actor)).version;
  // PGlite serializes the transactions; these callers still exercise duplicate locking paths.
  const worker = { userId: "worker", isOwner: false, manage: false, canApproveStandard: false, tier: "silver" };
  const race = await Promise.all([workflow.requestOwnerApproval("request-race", worker, raceVersion), workflow.requestOwnerApproval("request-race", worker, raceVersion)]);
  assert.equal(race[0].requestId, race[1].requestId);
  assert.equal((await query("SELECT count(*) FROM notifications WHERE data->>'leadId'='request-race'")).rows[0].count, 1);
  const staleOwnerReview = await prepare("request-race", "none");
  await query("UPDATE leads SET confirmed_date='2099-10-03' WHERE id='request-race'");
  assert.equal((await workflow.getJobWorkflow("request-race", actor)).approvalRequest.current, false);
  await assert.rejects(workflow.approveAndSend("request-race", actor, staleOwnerReview), /changed/);
  await assert.rejects(workflow.requestOwnerApproval("request-race", worker, raceVersion), /changed/);

  await seed("request-rollback");
  const rollbackVersion = (await workflow.getJobWorkflow("request-rollback", actor)).version;
  state.failAudit = true;
  await assert.rejects(workflow.requestOwnerApproval("request-rollback", worker, rollbackVersion), /Injected audit failure/);
  state.failAudit = false;
  assert.equal((await query("SELECT count(*) FROM notifications WHERE data->>'leadId'='request-rollback'")).rows[0].count, 0);
  assert.equal((await workflow.getJobWorkflow("request-rollback", actor)).approvalRequest, undefined);
  state.pushStatus = "failed";
  const pushFailure = await workflow.requestOwnerApproval("request-rollback", worker, rollbackVersion);
  assert.equal(pushFailure.inApp, "sent"); assert.equal(pushFailure.pushStatus, "failed");
  assert.equal((await query("SELECT count(*) FROM notifications WHERE data->>'leadId'='request-rollback'")).rows[0].count, 1);
  await seed("restricted-worker");
  await query("UPDATE leads SET crew_members=ARRAY['bronze'] WHERE id='restricted-worker'");
  assert.equal((await call("bronze", "restricted-worker", "workflow")).status, 403, "Request permission does not grant quote-viewing permission");
  const restrictedStatus = await call("bronze", "restricted-worker", "owner-approval-request");
  assert.equal(restrictedStatus.status, 200);
  assert.deepEqual(Object.keys(restrictedStatus.data).sort(), ["approved", "canRequest", "current", "version"]);
  const restrictedRequest = await call("bronze", "restricted-worker", "request-owner-approval", { version: restrictedStatus.data.version });
  assert.equal(restrictedRequest.status, 200);
  for (const secret of ["472.5", "Test Customer", "test@example.test", "workflow", "phone", "crewMembers"]) assert.equal(JSON.stringify(restrictedRequest.data).includes(secret), false, `Request result leaked ${secret}`);
  assert.equal((await call("bronze", "restricted-worker", "approve-and-send", approveInput)).status, 403);
  assert.equal((await call("bronze", "remote", "owner-approval-request")).status, 403, "An unassigned worker cannot inspect another request");
  await query("UPDATE leads SET confirmed_date='2099-10-04' WHERE id='remote'");
  const staleReplay = await call("owner", "remote", "approve-and-send", approveInput);
  assert.equal(staleReplay.data.approved, false);
  assert.match(staleReplay.data.warning, /job has changed/);
  console.log("Remote approval HTTP/SQL passed: owner-only notifications, role checks, retry deduplication, rollback, stale requests, and approval without external side effects.");
  console.log("Workflow database integration passed: approval, discounts, stale writes, copy links, confirmation, dispatch, concurrent retries and partial/unknown delivery.");
} finally {
  if (httpServer) await new Promise<void>((resolve, reject) => httpServer!.close(error => error ? reject(error) : resolve()));
  process.env = originalEnv;
  delete (globalThis as any).__jobWorkflowTest;
  await db.close();
  assert.ok(path.resolve(directory).startsWith(path.resolve(process.cwd()) + path.sep + ".workflow-test-"));
  await rm(directory, { recursive: true, force: true });
}
