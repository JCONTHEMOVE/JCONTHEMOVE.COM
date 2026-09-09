import assert from 'node:assert/strict';
import type { SquareClient } from 'square';
import type { Lead, SquareInvoice } from '@shared/schema';

// Import the real service against a disposable address; any accidental I/O fails.
process.env.DATABASE_URL = 'postgres://test:test@localhost:1/invoice_retry_test';
const { pool } = await import('../../db');
pool.query = (() => { throw new Error('Unexpected database query'); }) as typeof pool.query;
pool.connect = (() => { throw new Error('Unexpected database connection'); }) as typeof pool.connect;
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
const { SquareInvoiceService } = await import('../square-invoice');

type Phase = 'customer' | 'order' | 'invoice' | 'publish';
const phases: Phase[] = ['customer', 'order', 'invoice', 'publish'];
const lead = { id: '11111111-1111-4111-8111-111111111111', firstName: 'Retry',
  lastName: 'Customer', email: 'retry@example.com', phone: null, serviceType: 'moving' } as Lead;

function fixture(lostResponse?: Phase, localFailure?: 'before' | 'after') {
  const saved = new Map<string, SquareInvoice>();
  const cache = new Map<string, { payload: string; response: unknown }>();
  const creations = Object.fromEntries(phases.map(phase => [phase, 0])) as Record<Phase, number>;
  let inserts = 0;
  let failed = false;
  const operation = (phase: Phase, response: unknown) => async (request: { idempotencyKey: string }) => {
    const payload = JSON.stringify(request, (_key, value) => typeof value === 'bigint' ? `${value}n` : value);
    const prior = cache.get(request.idempotencyKey);
    if (prior) {
      assert.equal(prior.payload, payload, 'Provider idempotency payload conflict');
      return structuredClone(prior.response);
    }
    creations[phase]++;
    cache.set(request.idempotencyKey, { payload, response: structuredClone(response) });
    if (phase === lostResponse) throw new Error(`Lost ${phase} response`);
    return structuredClone(response);
  };
  const client = {
    customers: { search: async () => ({ customers: [] }),
      create: operation('customer', { customer: { id: 'customer-1' } }) },
    orders: { create: operation('order', { order: { id: 'order-1' } }) },
    invoices: {
      create: operation('invoice', { invoice: { id: 'invoice-1', version: 0 } }),
      publish: operation('publish', { invoice: { id: 'invoice-1', version: 1,
        publicUrl: 'https://example.com/invoice-1', invoiceNumber: '1' } }),
    },
  } as unknown as SquareClient;
  const service = new SquareInvoiceService({ getClient: async () => client,
    getLocationId: () => 'location-1', invoiceStore: {
      getSquareInvoiceBySquareId: async id => saved.get(id),
      createSquareInvoice: async input => {
        inserts++;
        if (!failed && localFailure === 'before') {
          failed = true;
          throw new Error('Insert unavailable');
        }
        const row = { ...input, id: 'local-1', status: localFailure === 'after' ? 'paid' : input.status } as SquareInvoice;
        saved.set(input.squareInvoiceId, row);
        if (!failed && localFailure === 'after') {
          failed = true;
          throw new Error('Lost insert response');
        }
        return row;
      },
    } });
  return { saved, creations, get inserts() { return inserts; },
    run: (amount = 90, description = 'Agreed moving balance') => service.createInvoiceForLead(
      lead, amount, description, '2030-09-15', 'none', {
        idempotencyKey: 'closeout-1:quote-1', quoteRevisionId: 'quote-1', closeoutId: 'closeout-1',
      }),
  };
}

for (const phase of phases) {
  const test = fixture(phase);
  await assert.rejects(test.run(), new RegExp(`Lost ${phase} response`));
  const result = await test.run();
  assert.deepEqual(result, { invoiceId: 'local-1', squareInvoiceId: 'invoice-1', invoiceUrl: 'https://example.com/invoice-1' });
  await test.run();
  assert.deepEqual(Object.values(test.creations), [1, 1, 1, 1]);
  assert.equal(test.inserts, 1);
  assert.equal(test.saved.size, 1);
}
const unavailable = fixture(undefined, 'before');
await assert.rejects(unavailable.run(), /Insert unavailable/);
await unavailable.run();
assert.deepEqual(Object.values(unavailable.creations), [1, 1, 1, 1]);
assert.equal(unavailable.inserts, 2);
assert.equal(unavailable.saved.size, 1);

const committed = fixture(undefined, 'after');
await committed.run();
await committed.run();
assert.equal(committed.saved.get('invoice-1')?.status, 'paid');
assert.equal(committed.inserts, 1);

for (const changed of [{ amount: 91, description: 'Agreed moving balance' }, { amount: 90, description: 'Changed balance' }]) {
  const conflict = fixture('order');
  await assert.rejects(conflict.run(), /Lost order response/);
  await assert.rejects(conflict.run(changed.amount, changed.description), /Provider idempotency payload conflict/);
  assert.equal(conflict.saved.size, 0);
  await conflict.run();
  assert.deepEqual(Object.values(conflict.creations), [1, 1, 1, 1]);
}
console.log('PASS: real invoice service reuses simulated provider resources after four lost responses, retries local persistence, preserves paid records and rejects changed retry payloads');
