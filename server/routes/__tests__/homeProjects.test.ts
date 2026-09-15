import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { createHomeProjectRouter, homeProjectStatsHandler } from "../homeProjects";
import { HOME_PROJECT_CAMPAIGN, captureHomeProjectReferral, homeProjectLink } from "@shared/homeProjectCampaign";

const pg = new PGlite();
await pg.exec([
  "CREATE TABLE users(id text PRIMARY KEY); INSERT INTO users VALUES ('evan-user'),('owner-user');",
  "CREATE TABLE marketing_reps(id text PRIMARY KEY,slug text UNIQUE,display_name text,promo_code text,user_id text,is_active boolean);",
  "INSERT INTO marketing_reps VALUES ('evan-rep','evan','Evan','EVAN10','evan-user',true),('darrell-rep','darrell','Darrell','DARRELL10','owner-user',true),('inactive','inactive','Inactive','OLD10',NULL,false);",
  "CREATE TABLE promo_codes(code text,referral_user_id text); CREATE TABLE worker_profiles(user_id text,promo_code text);",
  "CREATE TABLE leads(id text PRIMARY KEY,order_number serial,first_name text NOT NULL,last_name text NOT NULL,email text NOT NULL,phone text NOT NULL,service_type text NOT NULL,from_address text NOT NULL,to_address text,move_date text,property_size text,details text,source text,status text,truck_config text,is_quote_only boolean,photos jsonb,quote_snapshot jsonb,promo_code text,quote_sent_at timestamp,created_at timestamp DEFAULT now(),base_price numeric,total_price numeric,financial_status text DEFAULT 'quote');",
  "CREATE TABLE quote_attributions(id text PRIMARY KEY,lead_id text REFERENCES leads(id),user_id text REFERENCES users(id),attribution_type text,promo_code text,metadata jsonb,created_at timestamp DEFAULT now());",
].join("\n"));
let attributionFails = false;
let lock = Promise.resolve();
const query = async (sql: string, values?: any[]) => {
  if (attributionFails && /INSERT INTO quote_attributions/.test(sql)) throw new Error("Test attribution failure");
  return pg.query(sql, values);
};
const pool = { query, connect: async () => {
  const previous = lock; let release!: () => void;
  lock = new Promise<void>(resolve => { release = resolve; }); await previous;
  return { query, release };
} };
let notifications = 0;
let notificationsFail = false;
const app = express(); app.use(express.json({ limit: "16mb" }));
app.use("/projects", createHomeProjectRouter(pool, async () => {
  notifications++;
  if (notificationsFail) throw new Error("Test notification outage");
}));
app.get("/stats", (req, res, next) => req.headers["x-owner"] === "yes" ? next() : res.sendStatus(403), homeProjectStatsHandler(pool));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as any).port;
const payload = (repSlug?: string) => ({
  requestId: randomUUID(), firstName: "Test", lastName: "Project", email: "project@example.test", phone: "9065550100",
  projectType: "carpet_removal", address: "Ironwood", zip: "49938", scope: "Remove old carpet and padding from two rooms.",
  squareFootage: 350, preferredDeadline: "2026-11-20", haulAway: true, furnitureHelp: true, repSlug, tracking: { utmSource: "facebook" },
  photos: [{ name: "room.png", mimeType: "image/png", size: 68, url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7r0AAAAASUVORK5CYII=" }],
});
const send = (body: unknown) => fetch(base + "/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const counts = async () => ({ leads: (await pg.query("SELECT * FROM leads")).rows.length, attributions: (await pg.query("SELECT * FROM quote_attributions")).rows.length });
try {
  for (const slug of ["darrell", "evan", "matt", "troy", "bill"]) {
    const link = new URL(homeProjectLink(slug, "partner_website"));
    assert.equal(link.origin, "https://www.jconthemove.com"); assert.equal(link.pathname, "/carpet-removal");
    assert.equal(link.searchParams.get("rep"), slug); assert.equal(link.searchParams.get("jc_campaign"), HOME_PROJECT_CAMPAIGN.id);
  }
  assert.throws(() => homeProjectLink("../evan"));
  const first = captureHomeProjectReferral("?rep=evan&utm_source=facebook", null, 1000);
  assert.equal(captureHomeProjectReferral("?rep=darrell", first, 2000).repSlug, "evan", "the first campaign referral wins");
  assert.equal(captureHomeProjectReferral("", first, 2000).repSlug, "evan", "credit survives homepage navigation");
  assert.equal(captureHomeProjectReferral("?rep=darrell", first, 91 * 86400000).repSlug, "darrell", "expired referral is replaced");
  assert.equal(captureHomeProjectReferral("?rep=evan", captureHomeProjectReferral("", null, 1000), 2000).repSlug, "evan", "direct visit does not block the first rep");
  assert.equal(captureHomeProjectReferral("?rep=evan", { ...first, tracking: { utmSource: 123 } }, 2000).tracking.utmSource, undefined);

  const evan = payload("evan");
  const created = await send(evan); assert.equal(created.status, 201);
  const confirmation = await created.json(); assert.equal(confirmation.lead.repName, "Evan"); assert.equal(confirmation.lead.photoCount, 1);
  const row: any = (await pg.query("SELECT * FROM leads")).rows[0];
  assert.equal(row.from_address, "Ironwood, 49938"); assert.equal(row.email, evan.email);
  assert.equal(row.quote_snapshot.project.preferredDeadline, "2026-11-20");
  assert.equal(row.photos[0].url, evan.photos[0].url, "photo bytes reach the lead");
  assert.equal(row.service_type, "flooring"); assert.equal(row.status, "quote_requested");
  assert.equal(row.base_price, null); assert.equal(row.total_price, null); assert.equal(row.financial_status, "quote");
  assert.equal(row.move_date, "", "a deadline is not a confirmed calendar booking");
  const attribution: any = (await pg.query("SELECT * FROM quote_attributions")).rows[0];
  assert.equal(attribution.user_id, "evan-user"); assert.equal(attribution.promo_code, "EVAN10");
  assert.equal((await send(evan)).status, 200); assert.deepEqual(await counts(), { leads: 1, attributions: 1 }); assert.equal(notifications, 1);
  assert.equal((await send({ ...evan, repSlug: "darrell" })).status, 409, "replay cannot transfer credit");
  for (const body of [
    { ...payload("evan"), projectType: "moving" }, payload("missing"), payload("inactive"),
    { ...payload(), preferredDeadline: "2026-02-30" },
    { ...payload(), photos: [{ ...evan.photos[0], url: "data:image/svg+xml;base64,AAA=" }] },
    { ...payload(), promoCode: "DARRELL10" },
    { ...payload(), firstName: "<img src=x>" },
  ]) assert.equal((await send(body)).status, 400);
  assert.deepEqual(await counts(), { leads: 1, attributions: 1 });
  attributionFails = true;
  const retry = payload("darrell"); assert.equal((await send(retry)).status, 503);
  assert.deepEqual(await counts(), { leads: 1, attributions: 1 }, "credit failure rolls back the lead");
  attributionFails = false; assert.equal((await send(retry)).status, 201);
  const concurrent = payload("evan");
  const responses = await Promise.all([send(concurrent), send(concurrent)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  assert.deepEqual(await counts(), { leads: 3, attributions: 3 }); assert.equal(notifications, 3);
  assert.equal((await send(payload())).status, 201, "direct requests remain unassigned");
  assert.equal((await fetch(base + "/stats")).status, 403);
  await pg.query("UPDATE leads SET status='completed',quote_sent_at=now(),quote_snapshot='{}' WHERE id=$1", [evan.requestId]);
  assert.equal((await send(evan)).status, 200, "quote revisions preserve original request identity");
  await pg.query("INSERT INTO quote_attributions SELECT $1,lead_id,user_id,attribution_type,promo_code,metadata,now() FROM quote_attributions WHERE lead_id=$2 LIMIT 1", [randomUUID(), evan.requestId]);
  const stats = await (await fetch(base + "/stats", { headers: { "x-owner": "yes" } })).json();
  assert.equal(stats.totals.requests, 4, "quote revisions never inflate counts");
  assert.equal(stats.totals.booked, 1); assert.equal(stats.totals.completed, 1);
  assert.equal(stats.reps.find((r: any) => r.slug === "evan").booked, 1);
  assert.equal(stats.reps.find((r: any) => r.slug === "direct").requests, 1);
  assert.equal(stats.recent.find((l: any) => l.id === evan.requestId).deadline, "2026-11-20");
  notificationsFail = true;
  const afterNotificationOutage = payload("evan");
  const beforeNotifications = notifications;
  assert.equal((await send(afterNotificationOutage)).status, 201, "an alert outage must not hide a committed request");
  assert.equal((await send(afterNotificationOutage)).status, 200, "a retry returns the committed confirmation");
  assert.deepEqual(await counts(), { leads: 5, attributions: 6 }, "an alert outage and retry must not duplicate a lead or its original referral");
  assert.equal(notifications, beforeNotifications + 1, "a retry must not fan out another notification");
  console.log("Home projects: durable HTTP intake/photos, atomic original credit, retries, cross-site links and private unique totals passed.");
} finally { await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
