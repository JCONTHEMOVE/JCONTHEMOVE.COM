import assert from 'node:assert/strict';
import { notificationService } from '../../../client/src/lib/notifications';

const key = new Uint8Array(65); key[0] = 4;
const publicKey = Buffer.from(key).toString('base64url');
let unsubscribed = 0; let subscribed = 0; let saved = 0; let configReady = true; let saveOk = true;
let existing: any = { options: { applicationServerKey: new Uint8Array(65).buffer }, unsubscribe: async () => { unsubscribed++; return true; } };
Object.defineProperty(globalThis, 'window', { value: { Notification: {}, PushManager: {} }, configurable: true });
Object.defineProperty(globalThis, 'Notification', { value: { permission: 'granted' }, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { ready: Promise.resolve({ pushManager: {
  getSubscription: async () => existing,
  subscribe: async (options: any) => { subscribed++; assert.deepEqual(options.applicationServerKey, key); existing = { options: { applicationServerKey: key.buffer }, toJSON: () => ({ endpoint: 'https://example.invalid/push', keys: {} }) }; return existing; },
} }) } }, configurable: true });
globalThis.fetch = (async (url: string, options: any) => {
  if (url.endsWith('vapid-public-key')) { assert.equal(options.cache, 'no-store'); return { ok: configReady, json: async () => ({ publicKey }) }; }
  saved++; assert.equal(JSON.parse(options.body).applicationServerKey, publicKey);
  return { ok: saveOk, status: saveOk ? 200 : 409 };
}) as any;
assert.deepEqual(await Promise.all([notificationService.subscribeToServerPush(), notificationService.subscribeToServerPush()]), [true, true]);
assert.equal(unsubscribed, 1); assert.equal(subscribed, 1); assert.equal(saved, 1);
assert.equal(await notificationService.subscribeToServerPush(), true);
assert.equal(subscribed, 1, 'matching subscriptions are reused');
configReady = false;
assert.equal(await notificationService.subscribeToServerPush(), false);
assert.match(notificationService.lastPushError!, /configuration is not ready/);
assert.equal(unsubscribed, 1, 'missing config must not remove an existing subscription');
configReady = true; saveOk = false;
assert.equal(await notificationService.subscribeToServerPush(), false);
assert.match(notificationService.lastPushError!, /409/);
console.log('Browser key rotation, reuse, deduplication and failure diagnostics passed.');
