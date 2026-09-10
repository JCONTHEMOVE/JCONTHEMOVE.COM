import assert from 'node:assert/strict';
import { persistSquareInvoiceOnce, squareInvoiceRequestKeys } from '../squareInvoiceRetry';
const first = squareInvoiceRequestKeys('closeout:one:quote');
assert.deepEqual(squareInvoiceRequestKeys('closeout:one:quote'), first);
assert.notDeepEqual(squareInvoiceRequestKeys('closeout:two:quote'), first);
assert.notDeepEqual(squareInvoiceRequestKeys(), squareInvoiceRequestKeys());
assert.equal(new Set(Object.values(first)).size, 4);
assert.ok(Object.values(first).every(key => key.length < 100));
const input: any = { leadId: 'job', squareInvoiceId: 'square', squareOrderId: 'order', currency: 'USD',
  quoteRevisionId: 'quote', closeoutId: 'closeout', amount: '90.00', status: 'sent' };
const paid: any = { ...input, id: 'local', amount: '90', status: 'paid' };
assert.equal((await persistSquareInvoiceOnce(input, { find: async () => paid,
  create: async () => { throw new Error('must not insert again'); } })).status, 'paid');
let lookups = 0;
assert.equal((await persistSquareInvoiceOnce(input, { find: async () => ++lookups === 1 ? undefined : paid,
  create: async () => { throw new Error('unique provider invoice conflict'); } })).id, 'local');
await assert.rejects(persistSquareInvoiceOnce(input, { find: async () => undefined,
  create: async () => { throw new Error('database offline'); } }), /database offline/);
for (const changed of [{ amount: '91' }, { leadId: 'other' }, { quoteRevisionId: 'other' }, { closeoutId: 'other' }]) {
  await assert.rejects(persistSquareInvoiceOnce(input, { find: async () => ({ ...paid, ...changed }),
    create: async () => paid }), /requires reconciliation/);
}
console.log('PASS: stable phase keys, paid invoice replay, concurrent insert recovery and immutable binding checks');
