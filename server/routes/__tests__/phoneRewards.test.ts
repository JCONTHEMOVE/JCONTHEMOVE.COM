import assert from "node:assert/strict";
import { pool } from "../../db";
import { smsService } from "../../services/sms";
import { phoneRewardsRouter } from "../phoneRewards";
import { rewardsPhone, verificationHash } from "../../services/phoneRewards";

assert.equal(rewardsPhone("906-285-9312"), "+19062859312");
assert.equal(rewardsPhone("+1 (906) 285-9312"), "+19062859312");
for (const value of [null, "906", "+44 2071234567", "9062859312ext5"]) assert.equal(rewardsPhone(value), null);

const id = "11111111-1111-4111-8111-111111111111";
let attempts = 0, used = false, match: any[] = [], membership = false, created = 0, sendCount = 0, limitHits = 1;
let signedInId: string | undefined, linkedUser: unknown;
let memberRole = "customer", memberStatus = "active";
const statements: string[] = [];
const query = async (sql: string, args?: unknown[]) => {
  statements.push(sql);
  if (sql.includes("RETURNING hits")) return { rows: [{ hits: limitHits }] };
  if (sql.includes("UPDATE phone_rewards_challenges SET attempts")) return { rows: used || attempts >= 5 ? [] : [{ phone: "+19062859312", code_hash: verificationHash(id, "123456"), attempts: ++attempts }] };
  if (sql.includes("SELECT m.user_id,u.role,u.status FROM phone_rewards_members")) return { rows: membership ? [{ user_id: "customer", role: memberRole, status: memberStatus }] : [] };
  if (sql.includes("SELECT id, role FROM users WHERE id=")) return { rows: signedInId ? [{ id: signedInId, role: "customer" }] : [] };
  if (sql.includes("SELECT id,role,status FROM users")) return { rows: match };
  if (sql.includes("INSERT INTO users")) { created++; return { rows: [{ id: "customer" }] }; }
  if (sql.includes("INSERT INTO phone_rewards_members")) { membership = true; linkedUser = args?.[1]; }
  if (sql.includes("SET used=true")) used = true;
  return { rows: [] };
};
const originalQuery = pool.query, originalConnect = pool.connect, originalSMS = smsService.sendSMS;
(pool as any).query = query;
(pool as any).connect = async () => ({ query, release() {} });
smsService.sendSMS = async () => { sendCount++; return { success: false }; };
async function call(path: string, body: unknown) {
  const layer = (phoneRewardsRouter as any).stack.find((item: any) => item.route?.path === path);
  let status = 200, response: any;
  const res = { status(n: number) { status = n; return this; }, json(value: unknown) { response = value; return this; } };
  await layer.route.stack[0].handle({ body, ip: "local-test", session: { userId: signedInId } }, res);
  return { status, response };
}
try {
  assert.equal((await call("/code", { phone: "9062859312", consent: false })).status, 400);
  assert.equal(sendCount, 0);
  assert.equal((await call("/code", { phone: "9062859312", consent: true })).status, 503);
  assert.equal(sendCount, 1);
  assert(statements.some(sql => sql.startsWith("DELETE FROM phone_rewards_challenges")));
  limitHits = 11;
  assert.equal((await call("/code", { phone: "9062859312", consent: true })).status, 429);
  assert.equal(sendCount, 1);
  assert.equal((await call("/verify", { challengeId: id, code: "000000" })).status, 400);
  assert.equal(created, 0);
  assert.equal(attempts, 1);
  match = [{ id: "a", role: "customer" }, { id: "b", role: "customer" }];
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 409);
  assert.equal(created, 0);
  match = [{ id: "admin", role: "admin" }];
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 409);
  match = [{ id: "inactive", role: "customer", status: "inactive" }];
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 409);
  attempts = 0;
  match = [];
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).response.enrolled, true);
  assert.equal(created, 1);
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 400);
  used = false; attempts = 0; membership = false; signedInId = "existing-customer";
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 200);
  assert.equal(created, 1, "Signed-in customers reuse their existing rewards account");
  assert.equal(linkedUser, "existing-customer");
  used = false; attempts = 0;
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 409, "Do not silently move another profile's rewards");
  signedInId = undefined;
  used = false; attempts = 0;
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 200);
  assert.equal(created, 1, "Repeated enrollment must reuse membership");
  for (const [role, status] of [["admin", "active"], ["customer", "inactive"]]) {
    used = false; attempts = 0; memberRole = role; memberStatus = status;
    assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 409, "Existing membership must respect current account access");
    assert.equal(used, false);
  }
  memberRole = "customer"; memberStatus = "active";
  used = false; attempts = 5;
  assert.equal((await call("/verify", { challengeId: id, code: "123456" })).status, 400);
  assert(!statements.some(sql => /INSERT INTO (rewards|wallet)|UPDATE leads/i.test(sql)), "Enrollment must not issue value or change payment state");
  console.log("Phone rewards: consent, SMS failure, throttling, invalid code, duplicates, privileged profiles, replay and retry checks passed");
} finally {
  pool.query = originalQuery; pool.connect = originalConnect; smsService.sendSMS = originalSMS;
}
