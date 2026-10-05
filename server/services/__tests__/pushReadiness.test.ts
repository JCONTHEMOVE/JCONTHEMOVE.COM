import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { inspectPushConfig } from '../pushConfig';
import { createOwnerPushTestHandlers, OWNER_PUSH_TEST_ID } from '../ownerPushTest';

const pair = createECDH('prime256v1'); pair.generateKeys();
const env = { VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url') };
assert.equal(inspectPushConfig({}).ready, false);
assert.equal(inspectPushConfig({ VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY }).ready, false);
assert.equal(inspectPushConfig(env).ready, true);
assert.equal(JSON.stringify(inspectPushConfig(env)).includes(env.VAPID_PRIVATE_KEY), false);
const other = createECDH('prime256v1'); other.generateKeys();
assert.match(inspectPushConfig({ ...env, VAPID_PUBLIC_KEY: other.getPublicKey().toString('base64url') }).blockers.join(), /do not match/);
assert.equal(inspectPushConfig({ ...env, VAPID_PRIVATE_KEY: 'invalid' }).ready, false);
assert.equal(inspectPushConfig({ ...env, VAPID_EMAIL: 'bad-contact' }).ready, false);
assert.equal(inspectPushConfig({ ...env, VITE_VAPID_PUBLIC_KEY: 'obsolete' }).warnings.length, 1);

let role = 'business_owner'; let subscription: unknown = {}; let ready = true;
let claimed = false; let sends = 0; let records = 0;
const handlers = createOwnerPushTestHandlers({
  getUser: async id => ({ id, role, pushSubscription: subscription }),
  readiness: () => inspectPushConfig(ready ? env : {}),
  claim: async () => { if (claimed) return false; claimed = true; return true; },
  send: async (id, payload) => { assert.equal(id, 'owner'); assert.equal(payload.tag, OWNER_PUSH_TEST_ID); sends++; return { status: 'sent' }; },
  record: async () => { records++; },
});
async function call(method: 'send' | 'readiness', body: any = { confirmation: OWNER_PUSH_TEST_ID }, authenticated = true) {
  let status = 200; let data: any;
  const res: any = { setHeader() {}, status(n: number) { status = n; return res; }, json(value: any) { data = value; return res; } };
  await handlers[method]({ user: authenticated ? { id: 'owner' } : undefined, body } as any, res);
  return { status, data };
}
assert.equal((await call('readiness')).data.canAttemptOwnerTest, true);
assert.equal(sends, 0, 'readiness never sends');
assert.equal((await call('send', undefined, false)).status, 401);
for (const denied of ['customer', 'employee', 'admin']) { role = denied; assert.equal((await call('send')).status, 403); }
role = 'business_owner';
assert.equal((await call('send', { confirmation: OWNER_PUSH_TEST_ID, userId: 'customer' })).status, 400);
assert.equal((await call('send', {})).status, 400);
ready = false; assert.equal((await call('send')).status, 503); ready = true;
subscription = null; assert.equal((await call('send')).status, 409); subscription = {};
assert.equal(sends, 0);
const concurrent = await Promise.all([call('send'), call('send')]);
assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
assert.equal(sends, 1); assert.equal(records, 1);
assert.equal((await call('send')).status, 409);
console.log('Push configuration and owner-only test safeguards passed. No network sends performed.');
