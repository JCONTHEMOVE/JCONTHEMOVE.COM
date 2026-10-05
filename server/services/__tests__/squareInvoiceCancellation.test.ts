import assert from 'node:assert/strict';
import type { SquareClient } from 'square';
process.env.DATABASE_URL = 'postgres://test:test@localhost:1/cancellation_test';
const { pool } = await import('../../db');
pool.query = (() => { throw new Error('Unexpected database call'); }) as typeof pool.query;
globalThis.fetch = async () => { throw new Error('Unexpected network call'); };
const { SquareInvoiceService } = await import('../square-invoice');

function fixture(options: { status?: string; version?: number | null; failure?: 'response' | 'request' | 'local' | 'race' | 'identity' } = {}) {
  let status = options.status || 'UNPAID', calls = 0, writes = 0, gets = 0, failed = false;
  const client = { invoices: {
    get: async (request: { invoiceId: string }) => {
      assert.equal(request.invoiceId, 'invoice'); gets++;
      return { invoice: { id: 'invoice', status, version: options.version === undefined ? 0 : options.version } };
    },
    cancel: async (request: { invoiceId: string; version: number }) => {
      assert.deepEqual(request, { invoiceId: 'invoice', version: options.version ?? 0 }); calls++;
      if (options.failure === 'request') throw new Error('synthetic private provider response');
      if (options.failure === 'race') { status = 'PAID'; throw new Error('version conflict'); }
      if (options.failure === 'identity') return { invoice: { id: 'other-invoice', status: 'CANCELED' } };
      status = 'CANCELED';
      if (options.failure === 'response') throw new Error('Lost successful cancel response');
      return { invoice: { id: 'invoice', status } };
    },
  } } as unknown as SquareClient;
  const service = new SquareInvoiceService({ getClient: async () => client,
    recordCancellation: async id => {
      assert.equal(id, 'invoice');
      if (!failed && options.failure === 'local') { failed = true; throw new Error('Local acknowledgement failed'); }
      writes++;
    } });
  return { run: () => service.cancelInvoice('invoice'), stats: () => ({ calls, writes, gets, status }) };
}
for (const status of ['UNPAID', 'SCHEDULED', 'PARTIALLY_PAID']) {
  const test = fixture({ status });
  await test.run(); await test.run();
  assert.deepEqual(test.stats(), { calls: 1, writes: 2, gets: 2, status: 'CANCELED' });
}
const lost = fixture({ failure: 'response' });
await lost.run();
assert.deepEqual(lost.stats(), { calls: 1, writes: 1, gets: 2, status: 'CANCELED' });
const local = fixture({ failure: 'local' });
await assert.rejects(local.run(), /Local acknowledgement/);
await local.run();
assert.equal(local.stats().calls, 1);
assert.equal(local.stats().writes, 1);
for (const failure of ['request', 'race', 'identity'] as const) {
  const test = fixture({ failure });
  await assert.rejects(test.run(), error => {
    assert.equal((error as Error).message, 'Square invoice cancellation could not be confirmed; retry reconciliation');
    return true;
  });
  assert.equal(test.stats().writes, 0);
}
for (const status of ['DRAFT', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED', 'PAYMENT_PENDING', 'UNKNOWN']) {
  const test = fixture({ status });
  await assert.rejects(test.run(), /cannot be canceled/);
  assert.equal(test.stats().calls, 0); assert.equal(test.stats().writes, 0);
}
for (const version of [null, -1, 0.5, NaN, 2147483648]) {
  const test = fixture({ version });
  await assert.rejects(test.run(), /version is invalid/);
  assert.equal(test.stats().calls, 0);
}
console.log('PASS: actual cancellation service recovers lost provider/local acknowledgements, checks version/state/identity, and refuses unconfirmed or paid-race results');
