import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { createPersonalPromoRouter } from "../personalPromoCodes";
import { PersonalPromoCodes, resolvePersonalPromoAttribution } from "../../services/personalPromoCodes";
import { personalPromoAdInput, personalPromoSnapshotMatches } from "../../services/personalPromoMarketing";
import { generateMarketingAdDraft } from "../../services/marketingAdGenerator";
import { buildMarketingOverlaySvg } from "../../services/marketingCreativeGenerator";
import { personalPromoCopy, personalPromoNameSchema, personalPromoReviewSchema, personalPromoSuggestions } from "../../../shared/personalPromo";

// Real SQL, unique indexes and rollback in a private PostgreSQL instance.
const db = new PGlite();
let failApproval = false;
let lease = Promise.resolve();
const query = async (sql: string, values: any[] = []): Promise<any> => {
  if (sql.includes("pg_advisory_xact_lock")) return { rows: [] }; // The pool lease below serializes this single-connection test database.
  if (failApproval && sql.startsWith("UPDATE personal_promo_requests SET status='approved'")) throw new Error("Injected approval failure");
  const result: any = !values.length && sql.split(";").filter(value => value.trim()).length > 1
    ? (await db.exec(sql)).at(-1) : await db.query(sql, values);
  return { rows: result?.rows || [], rowCount: result?.affectedRows ?? 0 };
};
const pool = { query, connect: async () => { const previous = lease; let release!: () => void; lease = new Promise<void>(resolve => release = resolve); await previous; return { query, release }; } };
await db.exec(`
  CREATE TABLE users(id varchar PRIMARY KEY,first_name text,last_name text,role text,status text,referral_code text);
  CREATE TABLE worker_profiles(user_id varchar PRIMARY KEY,promo_code varchar UNIQUE,updated_at timestamp DEFAULT now());
  CREATE TABLE marketing_reps(id varchar PRIMARY KEY,user_id varchar,slug text,promo_code text,is_active boolean DEFAULT true,updated_at timestamp DEFAULT now());
  CREATE TABLE promo_codes(id varchar PRIMARY KEY,code text UNIQUE,description text DEFAULT '',referral_user_id varchar,
    discount_percent numeric DEFAULT 0,discount_percent_jewelry numeric DEFAULT 0,reward_tokens numeric DEFAULT 0,
    referral_reward_tokens numeric DEFAULT 0,max_uses int,uses_count int DEFAULT 0,expires_at timestamp,is_active boolean DEFAULT true,job_offer jsonb);
  INSERT INTO users VALUES('tim','Tim','Mover','employee','approved','RANDOM99'),('bill','Bill','Worker','employee','active','OLD77'),
    ('owner','Owner','Test','business_owner','active','OWNEROLD'),('other','Tim','Other','employee','active','OTHER99'),
    ('customer','Customer','Test','customer','active','CUST99');
  INSERT INTO worker_profiles(user_id,promo_code) VALUES('tim','RANDOM99');
`);
const service = new PersonalPromoCodes(pool as any);
const app = express(); app.use(express.json());
app.use("/api", createPersonalPromoRouter(
  (req: any, res, next) => { if (!req.headers["x-user"]) return void res.sendStatus(401); req.currentUser = { id: req.headers["x-user"] }; next(); },
  (req, res, next) => req.headers["x-user"] !== "customer" ? next() : void res.sendStatus(403),
  (req, res, next) => req.headers["x-user"] === "owner" ? next() : void res.sendStatus(403), service,
));
app.get("/api/public/test", (_req, res) => res.json({ public: true }));
const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
async function call(path: string, user = "tim", body?: any) {
  return fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
const workerPath = "/crew/marketing/promo-code";
const adminPath = "/admin/promo-code-requests";
const terms = { description: "Owner-approved personal code", discountPercent: 5, discountPercentJewelry: 0, rewardTokens: 0, referralRewardTokens: 0, maxUses: null, expiresAt: null };
const reviewBody = (code: string) => ({ action: "approve", code, terms, feedback: "Approved" });
try {
  assert.equal((await call(workerPath, "")).status, 401);
  assert.equal((await call(workerPath, "customer")).status, 403);
  assert.equal((await call(adminPath)).status, 403);
  assert.equal((await call("/public/test", "")).status, 200, "unrelated public routes must remain public");
  const first = await (await call(workerPath)).json();
  assert.equal(first.status, "unassigned"); assert.equal(first.promo, null);
  assert.ok(first.suggestions.includes("TIMMOVES")); assert.equal(first.bookingPath, null);
  assert.equal(personalPromoNameSchema.parse(" timmoves "), "TIMMOVES");
  for (const invalid of ["AB", "A".repeat(21), "TIM MOVES", "TIM-MOVES", "<script>"]) assert.equal(personalPromoNameSchema.safeParse(invalid).success, false);
  assert.ok(personalPromoSuggestions("Tím", "Mover").includes("TIMMMOVES"));
  assert.deepEqual(personalPromoSuggestions("", ""), []);
  assert.equal((await call(workerPath + "/requests", "tim", { code: "TIMMOVES", discountPercent: 99 })).status, 400);
  const pending = await (await call(workerPath + "/requests", "tim", { code: "timmoves" })).json();
  assert.equal(pending.request.status, "pending");
  await assert.rejects(service.forAd("tim"), /approval/);
  const repeated = await (await call(workerPath + "/requests", "tim", { code: "TIMMOVES" })).json();
  assert.equal(repeated.request.id, pending.request.id);
  assert.equal((await call(workerPath + "/requests", "tim", { code: "TIMHELPS" })).status, 409);
  assert.equal((await call(workerPath + "/requests", "other", { code: "TIMMOVES" })).status, 409);
  assert.equal((await call(`${adminPath}/${pending.request.id}/review`, "tim", reviewBody("TIMMOVES"))).status, 403);
  failApproval = true;
  assert.equal((await call(`${adminPath}/${pending.request.id}/review`, "owner", reviewBody("TIMMOVES"))).status, 503);
  failApproval = false;
  assert.equal((await query("SELECT * FROM promo_codes")).rows.length, 0);
  assert.equal((await query("SELECT promo_code FROM worker_profiles WHERE user_id='tim'")).rows[0].promo_code, "RANDOM99");
  const approvals = await Promise.all([
    call(`${adminPath}/${pending.request.id}/review`, "owner", reviewBody("TIMMOVES")),
    call(`${adminPath}/${pending.request.id}/review`, "owner", reviewBody("TIMMOVES")),
  ]);
  assert.deepEqual(approvals.map(response => response.status), [200, 200]);
  assert.equal((await query("SELECT * FROM promo_codes")).rows.length, 1);
  assert.equal((await call(`${adminPath}/${pending.request.id}/review`, "owner", { ...reviewBody("TIMMOVES"), terms: { ...terms, discountPercent: 99 } })).status, 409);
  const approved = await service.forAd("tim");
  assert.equal(approved.promo.code, "TIMMOVES");
  assert.equal(approved.promo.discountPercent, "5.00");
  assert.equal((await query("SELECT referral_code FROM users WHERE id='tim'")).rows[0].referral_code, "RANDOM99");
  assert.deepEqual(await resolvePersonalPromoAttribution(query, " timmoves "), { code: "TIMMOVES", userId: "tim" });

  // Every public marketing surface uses the server-owned code, never supplied identity/links/discounts.
  const input = personalPromoAdInput({ area: "Ironwood", focus: "moving help", promoCode: "OTHER99", workerName: "Other worker", referralLink: "https://attacker.test/book?promo=OTHER99", personalOffer: { caption: "Save 99%" }, rawText: "Save 99% now" }, "Tim Mover", approved, "https://www.jconthemove.com");
  assert.equal(input.promoCode, "TIMMOVES"); assert.equal(input.workerName, "Tim Mover");
  assert.equal(input.referralLink, "https://www.jconthemove.com/book?promo=TIMMOVES");
  const draft = await generateMarketingAdDraft(input, approved.offer);
  for (const text of [draft.facebookPost, draft.shortText]) { assert.match(text, /TIMMOVES/); assert.doesNotMatch(text, /OTHER99|attacker|99%|IRONWOOD SAVES/); }
  for (const variant of ["feed", "og"] as const) {
    const image = (await buildMarketingOverlaySvg(variant, { ...input, ...approved.offer })).toString();
    assert.match(image, /CODE TIMMOVES/); assert.match(image, /SAVE 5% ON ELIGIBLE SERVICES/); assert.doesNotMatch(image, /RANDOM99|99%|IRONWOOD SAVES/);
  }
  assert.ok(personalPromoSnapshotMatches({ id: approved.promo.id, code: "TIMMOVES", offer: { caption: approved.offer.caption, secondaryLine: approved.offer.secondaryLine, offerLine: approved.offer.offerLine } }, approved), "jsonb key order does not change approved terms");
  assert.doesNotMatch(personalPromoCopy({ code: "BILLHELPS", discountPercent: "0", jobOffer: null }).caption, /Save|%/);
  assert.doesNotMatch(personalPromoCopy({ code: "BILLHELPS", discountPercent: "10", jobOffer: { kind: "fixed_moving_package" } }).caption, /10%/);
  await query("UPDATE users SET status='suspended' WHERE id='tim'");
  await assert.rejects(service.forAd("tim"), /active worker/);
  await query("UPDATE users SET status='approved' WHERE id='tim'");
  for (const [update, message] of [["is_active=false", /no longer active/], ["expires_at='2000-01-01'", /expired/], ["max_uses=1,uses_count=1", /usage limit/]] as const) {
    await query(`UPDATE promo_codes SET ${update} WHERE code='TIMMOVES'`);
    await assert.rejects(service.forAd("tim"), message);
    await query("UPDATE promo_codes SET is_active=true,expires_at=null,max_uses=null,uses_count=0 WHERE code='TIMMOVES'");
  }
  const replacement = await service.request("tim", "TIMHELPS");
  assert.equal(replacement.promo?.code, "TIMMOVES", "pending replacement preserves current code");
  await service.review(replacement.request!.id, "owner", personalPromoReviewSchema.parse({ action: "reject", feedback: "Please use TIMCREW instead." }));
  assert.equal((await service.state("tim")).request!.feedback, "Please use TIMCREW instead.");
  const retry = await service.request("tim", "TIMCREW");
  await service.review(retry.request!.id, "owner", personalPromoReviewSchema.parse(reviewBody("TIMCREW")));
  assert.equal((await service.forAd("tim")).promo.code, "TIMCREW");
  assert.ok(await resolvePersonalPromoAttribution(query, "TIMMOVES"), "old code remains valid and attributed");

  // Conflicting profiles require explicit selection, not name matching or an arbitrary first record.
  await query("INSERT INTO marketing_reps VALUES('tim-rep','tim','tim','TIMMOVES',true,now()),('name-only',null,'other-tim','UNLINKED',true,now())");
  assert.equal((await service.state("tim")).status, "conflict");
  const selected = await service.request("tim", "TIMMOVES");
  const old = (await service.state("tim")).candidates.find(promo => promo.code === "TIMMOVES")!;
  await service.review(selected.request!.id, "owner", personalPromoReviewSchema.parse({ action: "approve", code: "TIMMOVES", existingPromoId: old.id, feedback: "Keep the original" }));
  const resolved = await service.forAd("tim");
  assert.equal(resolved.repSlug, "tim"); assert.equal(resolved.promo.discountPercent, "5.00");
  assert.equal((await query("SELECT promo_code FROM marketing_reps WHERE id='name-only'")).rows[0].promo_code, "UNLINKED");
  const reservations = await Promise.allSettled([service.request("bill", "BILLMOVES"), service.request("other", "BILLMOVES")]);
  assert.equal(reservations.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await query("SELECT * FROM personal_promo_requests WHERE requested_code='BILLMOVES' AND status='pending'")).rows.length, 1);
  assert.equal((await service.state("customer")).request, null, "request state remains account scoped");
  await query("INSERT INTO promo_codes(id,code,discount_percent) VALUES('unowned','OLDCREW',7)");
  await query("INSERT INTO worker_profiles(user_id,promo_code) VALUES('other','OLDCREW')");
  assert.equal((await service.state("other")).status, "conflict", "a linked record without an owner requires review");
  const otherPending = (await service.state("other")).request;
  if (otherPending?.status === "pending") await service.review(otherPending.id, "owner", { action: "reject", feedback: "Use existing assignment" });
  const unowned = await service.request("other", "OLDCREW");
  await service.review(unowned.request!.id, "owner", { action: "approve", code: "OLDCREW", existingPromoId: "unowned", feedback: "Confirm verified profile" });
  assert.equal((await service.forAd("other")).promo.discountPercent, "7");
  assert.equal((await query("SELECT referral_user_id FROM promo_codes WHERE id='unowned'")).rows[0].referral_user_id, "other");
  await query("INSERT INTO marketing_reps VALUES('bad-pointer','tim','wrong','OLDCREW',true,now())");
  assert.equal((await service.state("tim")).status, "conflict", "a pointer to another worker's code must not be silently ignored");
  await query("DELETE FROM marketing_reps WHERE id='bad-pointer'");
  assert.equal(personalPromoReviewSchema.safeParse({ action: "approve", code: "LEGACY-CODE", existingPromoId: "legacy" }).success, true);
  assert.equal(personalPromoReviewSchema.safeParse(reviewBody("NEW-CODE")).success, false);
  await query("INSERT INTO promo_codes(id,code,discount_percent) VALUES('existing-library','LIBRARYCODE',3)");
  const libraryRequest = await service.request("tim", "TIMLOCAL");
  assert.ok((await service.reviewQueue()).find(item => item.id === libraryRequest.request!.id)!.candidates.some(promo => promo.code === "LIBRARYCODE"));
  await service.review(libraryRequest.request!.id, "owner", { action: "approve", code: "LIBRARYCODE", existingPromoId: "existing-library", feedback: "Use this existing offer" });
  assert.equal((await service.forAd("tim")).promo.discountPercent, "3");
  const restarted = new PersonalPromoCodes(pool as any);
  await restarted.ensureSchema();
  assert.equal((await restarted.forAd("tim")).promo.code, "LIBRARYCODE");
  const source = await readFile("server/routes.ts", "utf8");
  const seeds = source.slice(source.indexOf("async function seedMarketingNetwork()"), source.indexOf("async function generateBundleFollowupCode"));
  assert.doesNotMatch(seeds, /onConflictDoUpdate/);
  assert.doesNotMatch(source, /linkEmployeePromoCodes/);
  assert.match(source, /personalPromoAdInput\(req.body \|\| \{\}, workerName, approved, getAppUrl\(\)\)/);
  console.log("Personal promo workflow passed: real SQL, permissions, reservations, rollback, approval retries, conflicts, old codes, offer copy, image overlays, trusted links and attribution.");
} finally {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await db.close();
}
