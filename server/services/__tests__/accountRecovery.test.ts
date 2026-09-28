import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import express from "express";
import bcrypt from "bcrypt";
import { createAccountRecovery, normalizeRecoveryContact, RECOVERY_SCHEMA, type RecoveryDatabase } from "../accountRecovery";
import { createAccountRecoveryRouter } from "../../routes/accountRecovery";

const pg = new PGlite();
await pg.exec(`CREATE TABLE users(id varchar PRIMARY KEY,email text,phone_number text,password_hash text,role text,status text,updated_at timestamptz);
  INSERT INTO users VALUES ('bill','bill@example.test',NULL,NULL,'employee','approved',now()),
  ('troy','troy@example.test','+1 (906) 555-0111',NULL,'employee','approved',now()),
  ('rewards','rewards@example.test','9065550222',NULL,'customer','rewards_only',now());`);
await pg.exec(RECOVERY_SCHEMA);
await pg.exec(RECOVERY_SCHEMA); // additive and safe across restarts
const adapt = (client: any): RecoveryDatabase => ({
  query: (sql, values) => client.query(sql, values),
  transaction: work => client.transaction((tx: any) => work(adapt(tx))),
});
const db = adapt(pg);
const deliveries: { email: string; code: string }[] = [];
let deliveryWorks = true;
const options = {
  secret: "isolated-recovery-test-secret",
  sendCode: async (email: string, code: string) => { deliveries.push({ email, code }); return deliveryWorks; },
  hashPassword: (password: string) => bcrypt.hash(password, 4),
};
const recovery = createAccountRecovery(db, options);
const clear = () => pg.exec("DELETE FROM account_recovery_challenges; DELETE FROM account_recovery_limits;");
const code = () => deliveries[deliveries.length - 1].code;
const rejects = (fn: () => Promise<unknown>, status: number) => assert.rejects(fn, (error: any) => error.status === status);

try {
  assert.equal(normalizeRecoveryContact(" BILL@EXAMPLE.TEST "), "email:bill@example.test");
  assert.equal(normalizeRecoveryContact("+1 (906) 555-0111"), normalizeRecoveryContact("9065550111"));
  assert.throws(() => normalizeRecoveryContact({}), /Enter/);
  const known = await recovery.request(" BILL@EXAMPLE.TEST ", "a");
  const unknown = await recovery.request("unknown@example.test", "a");
  assert.deepEqual(known, unknown);
  assert.deepEqual(await recovery.request("rewards@example.test", "a"), unknown);
  assert.deepEqual(await recovery.request("9065550222", "a"), unknown);
  assert.equal(deliveries.length, 1);
  assert.equal((await pg.query("SELECT id FROM account_recovery_challenges WHERE user_id='rewards'")).rows.length, 0,
    "rewards-only enrollment must not gain password access through recovery");
  const firstCode = code();
  const stored = (await pg.query<any>("SELECT * FROM account_recovery_challenges")).rows[0];
  assert.notEqual(stored.code_hash, firstCode);
  assert(!JSON.stringify(stored).includes("bill@example.test"));
  await rejects(() => recovery.verify("troy@example.test", firstCode, "a"), 400);
  const verified = await recovery.verify("bill@example.test", firstCode, "a");
  await rejects(() => recovery.verify("bill@example.test", firstCode, "a"), 400);
  await recovery.reset("my-test-password", verified.resetToken, "a");
  let user = (await pg.query<any>("SELECT * FROM users WHERE id='bill'")).rows[0];
  assert(await bcrypt.compare("my-test-password", user.password_hash));
  assert.equal(user.role, "employee");
  assert.equal(user.status, "approved");
  await rejects(() => recovery.reset("another-password", verified.resetToken, "a"), 401);

  await clear();
  await recovery.request("9065550111", "a");
  assert.equal(deliveries.at(-1)?.email, "troy@example.test");
  const phoneGrant = await recovery.verify("+1 (906) 555-0111", code(), "a");
  await recovery.reset("first-password", phoneGrant.resetToken, "a");
  assert(await bcrypt.compare("first-password", (await pg.query<any>("SELECT password_hash FROM users WHERE id='troy'")).rows[0].password_hash));

  await clear();
  deliveryWorks = false;
  await rejects(() => recovery.request("bill@example.test", "a"), 503);
  await rejects(() => recovery.verify("bill@example.test", code(), "a"), 400);
  deliveryWorks = true;
  await clear();
  await recovery.request("bill@example.test", "a");
  await pg.exec("UPDATE account_recovery_challenges SET expires_at=now()-interval '1 minute'");
  await rejects(() => recovery.verify("bill@example.test", code(), "a"), 400);

  await clear();
  await recovery.request("bill@example.test", "a");
  for (let i=0;i<5;i++) await rejects(() => recovery.verify("bill@example.test", "000000", "a"), 400);
  await rejects(() => recovery.verify("bill@example.test", code(), "a"), 400);
  await clear();
  await recovery.request("bill@example.test", "a");
  const oldCode = code();
  await recovery.request("bill@example.test", "a");
  if (oldCode !== code()) await rejects(() => recovery.verify("bill@example.test", oldCode, "a"), 400);
  const oneGrant = await recovery.verify("bill@example.test", code(), "a");
  await pg.exec("UPDATE account_recovery_challenges SET reset_expires_at=now()-interval '1 minute'");
  await rejects(() => recovery.reset("not-saved", oneGrant.resetToken, "a"), 401);
  await clear();
  for (let i=0;i<3;i++) await recovery.request("bill@example.test", "a");
  await rejects(() => recovery.request("bill@example.test", "b"), 429);
  await clear();
  await recovery.request("bill@example.test", "a");
  const race = await Promise.allSettled([recovery.verify("bill@example.test", code(), "a"),recovery.verify("bill@example.test", code(), "b")]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  const raceGrant = (race.find(r => r.status === "fulfilled") as PromiseFulfilledResult<any>).value;
  const resets = await Promise.allSettled([recovery.reset("race-password",raceGrant.resetToken,"a"),recovery.reset("race-password",raceGrant.resetToken,"b")]);
  assert.equal(resets.filter(r => r.status === "fulfilled").length, 1);

  // Real HTTP flow without a cookie jar: recovery survives missing/cleared login cookies.
  await clear();
  const app = express();
  app.use(express.json());
  app.use("/api/auth/recover", createAccountRecoveryRouter(db, options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const post = (route: string, body: object) => fetch(`http://127.0.0.1:${address.port}/api/auth/recover/${route}`, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body) });
  try {
    assert.equal((await post("request",{contact:"bill@example.test"})).status,200);
    const verification = await post("verify",{contact:"bill@example.test",token:code()});
    assert.equal(verification.headers.get("cache-control"), "no-store");
    const grant = await verification.json() as any;
    assert.equal((await post("reset",{newPassword:"http-password",resetToken:grant.resetToken})).status,200);
    assert.equal((await post("reset",{newPassword:"http-password",resetToken:grant.resetToken})).status,401);
    assert.equal((await post("request",{contact:{bad:true}})).status,400);
  } finally { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
  console.log("Account recovery integration passed: account binding, password setup/reset, email failure, expiry, throttling, concurrent single use, HTTP without cookies.");
} finally { await pg.close(); }
