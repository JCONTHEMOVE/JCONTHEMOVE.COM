import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PushNotificationService } from '../notifications.ts';

// Synthetic public-key bytes only; no credentials or real push destinations.
const currentKey = new Uint8Array(65).fill(2);
currentKey[0] = 4;
const oldKey = new Uint8Array(65).fill(1);
oldKey[0] = 4;
const encodedKey = Buffer.from(currentKey).toString('base64url');

function setup(options: { existing?: Uint8Array; unknownKey?: boolean; permission?: string } = {}) {
  const calls: string[] = [];
  let active: any = options.existing || options.unknownKey ? subscription(options.existing) : null;
  let keyStatus = 200;
  let keyValue: unknown = encodedKey;
  let postStatus = 200;
  let failSubscribe = false;
  let unsubscribeSucceeds = true;
  let unsubscribeWait: Promise<void> | undefined;
  let signalUnsubscribeStarted: () => void;
  const unsubscribeStarted = new Promise<void>((resolve) => { signalUnsubscribeStarted = resolve; });
  function subscription(key?: Uint8Array): any {
    return {
      options: { applicationServerKey: key?.buffer },
      toJSON: () => ({ endpoint: 'https://push.invalid/test' }),
      unsubscribe: async () => {
        calls.push('unsubscribe');
        signalUnsubscribeStarted();
        await unsubscribeWait;
        if (unsubscribeSucceeds) active = null;
        return unsubscribeSucceeds;
      },
    };
  }
  const registration = { pushManager: {
    getSubscription: async () => active,
    subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      calls.push('subscribe');
      assert.deepEqual(applicationServerKey, currentKey);
      if (failSubscribe) throw new Error('simulated interruption');
      active = subscription(applicationServerKey);
      return active;
    },
  } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { Notification: {}, PushManager: {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { ready: Promise.resolve(registration) } } });
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: options.permission ?? 'granted' } });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith('vapid-public-key')) {
      calls.push('key');
      assert.equal(init.cache, 'no-store');
      return { ok: keyStatus === 200, json: async () => ({ publicKey: keyValue }) };
    }
    calls.push('post');
    assert.equal(url, '/api/notifications/subscribe');
    assert.equal(init.credentials, 'include');
    assert.equal(init.signal?.aborted, false);
    return { ok: postStatus === 200 };
  }) as typeof fetch;
  return {
    service: new PushNotificationService(), calls,
    setKey: (status: number, value: unknown = encodedKey) => { keyStatus = status; keyValue = value; },
    setPost: (status: number) => { postStatus = status; },
    setSubscribeFailure: (value: boolean) => { failSubscribe = value; },
    setUnsubscribeSuccess: (value: boolean) => { unsubscribeSucceeds = value; },
    setUnsubscribeWait: (value: Promise<void>) => { unsubscribeWait = value; },
    unsubscribeStarted,
  };
}

test('fresh enrollment uses the runtime key', async () => {
  const s = setup();
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'subscribe', 'post']);
});
test('matching subscription is retained and registered', async () => {
  const s = setup({ existing: currentKey });
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'post']);
});
test('old or unidentified subscription is recreated', async () => {
  for (const options of [{ existing: oldKey }, { unknownKey: true }]) {
    const s = setup(options);
    assert.equal(await s.service.subscribeToServerPush(), true);
    assert.deepEqual(s.calls, ['key', 'unsubscribe', 'subscribe', 'post']);
  }
});
test('missing or malformed server key preserves the old subscription', async () => {
  for (const [status, value] of [[503, encodedKey], [200, 'invalid'], [200, Buffer.alloc(65).toString('base64url')]] as const) {
    const s = setup({ existing: oldKey });
    s.setKey(status, value);
    assert.equal(await s.service.subscribeToServerPush(), false);
    assert.deepEqual(s.calls, ['key']);
  }
});
test('denied/default permission causes no enrollment or permission prompt', async () => {
  for (const permission of ['denied', 'default']) {
    const s = setup({ permission });
    assert.equal(await s.service.subscribeToServerPush(), false);
    assert.deepEqual(s.calls, []);
  }
});
test('concurrent calls share one migration', async () => {
  const s = setup({ existing: oldKey });
  assert.deepEqual(await Promise.all([s.service.subscribeToServerPush(), s.service.subscribeToServerPush()]), [true, true]);
  assert.deepEqual(s.calls, ['key', 'unsubscribe', 'subscribe', 'post']);
});
test('interruption after unsubscribe can enroll on retry', async () => {
  const s = setup({ existing: oldKey });
  s.setSubscribeFailure(true);
  assert.equal(await s.service.subscribeToServerPush(), false);
  s.setSubscribeFailure(false);
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'unsubscribe', 'subscribe', 'key', 'subscribe', 'post']);
});
test('failed server registration retries without recreating the new subscription', async () => {
  const s = setup({ existing: oldKey });
  s.setPost(500);
  assert.equal(await s.service.subscribeToServerPush(), false);
  s.setPost(200);
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'unsubscribe', 'subscribe', 'post', 'key', 'post']);
});
test('failed unsubscribe stops migration and allows retry', async () => {
  const s = setup({ existing: oldKey });
  s.setUnsubscribeSuccess(false);
  assert.equal(await s.service.subscribeToServerPush(), false);
  s.setUnsubscribeSuccess(true);
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'unsubscribe', 'key', 'unsubscribe', 'subscribe', 'post']);
});
test('key request timeout preserves subscription and releases retry lock', async (t) => {
  const s = setup({ existing: oldKey });
  const normalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = ((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('simulated timeout')), { once: true });
  })) as typeof fetch;
  const attempt = s.service.subscribeToServerPush();
  t.mock.timers.tick(15000);
  assert.equal(await attempt, false);
  assert.deepEqual(s.calls, []);
  globalThis.fetch = normalFetch;
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'unsubscribe', 'subscribe', 'post']);
});
test('unready service worker times out without changing subscription', async (t) => {
  const s = setup({ existing: oldKey });
  const serviceWorker = navigator.serviceWorker;
  const readyRegistration = serviceWorker.ready;
  Object.defineProperty(serviceWorker, 'ready', { configurable: true, value: new Promise(() => {}) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attempt = s.service.subscribeToServerPush();
  // Let the runtime key response be validated before expiring the ready wait.
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(15000);
  assert.equal(await attempt, false);
  assert.deepEqual(s.calls, ['key']);
  Object.defineProperty(serviceWorker, 'ready', { configurable: true, value: readyRegistration });
  assert.equal(await s.service.subscribeToServerPush(), true);
  assert.deepEqual(s.calls, ['key', 'key', 'unsubscribe', 'subscribe', 'post']);
});
test('slow unsubscribe finishes migration after the discovery deadline', async (t) => {
  const s = setup({ existing: oldKey });
  let finishUnsubscribe!: () => void;
  s.setUnsubscribeWait(new Promise<void>((resolve) => { finishUnsubscribe = resolve; }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attempt = s.service.subscribeToServerPush();
  await s.unsubscribeStarted;
  t.mock.timers.tick(15001);
  finishUnsubscribe();
  assert.equal(await attempt, true);
  assert.deepEqual(s.calls, ['key', 'unsubscribe', 'subscribe', 'post']);
});
