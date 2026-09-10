import assert from 'node:assert/strict';
import { resolveSquareJobEvent as resolve, type SquareOrderBinding } from '../squareJobEventRouting';
const calls: string[] = [];
let bindings: SquareOrderBinding[] = [{ lead_id: 'job', quote_revision_id: 'quote' }];
const dependencies = {
  getPayment: async (id: string) => { calls.push(`payment:${id}`); return { id, status: 'COMPLETED', orderId: 'verified-order' }; },
  getRefund: async (id: string) => { calls.push(`refund:${id}`); return { id, status: 'COMPLETED', paymentId: 'original', amountMoney: { amount: 100n, currency: 'USD' } }; },
  findOrderBindings: async (id: string) => { calls.push(`order:${id}`); return bindings; },
};
assert.equal((await resolve('payment.updated', 'payment', dependencies)).status, 'job');
assert.deepEqual(calls, ['payment:payment', 'order:verified-order']);
calls.length = 0;
const refund = await resolve('refund.updated', 'refund', dependencies);
assert.equal(refund.status, 'job');
assert.deepEqual(calls, ['refund:refund', 'payment:original', 'order:verified-order']);
bindings = [{ lead_id: null, quote_revision_id: null }];
assert.equal((await resolve('payment.updated', 'shop', dependencies)).status, 'unrelated');
bindings = [];
assert.equal((await resolve('payment.updated', 'unknown', dependencies)).status, 'unmapped');
for (const ambiguous of [[{ lead_id: 'job', quote_revision_id: null }],
  [{ lead_id: 'a', quote_revision_id: 'quote' }, { lead_id: 'b', quote_revision_id: 'quote' }],
  [{ lead_id: 'a', quote_revision_id: 'quote' }, { lead_id: null, quote_revision_id: null }]]) {
  bindings = ambiguous;
  await assert.rejects(resolve('payment.updated', 'payment', dependencies), /requires reconciliation/);
}
await assert.rejects(resolve('payment.updated', 'payment', { ...dependencies,
  getPayment: async () => ({ id: 'wrong' }) }), /retrieval mismatch/);
await assert.rejects(resolve('refund.updated', 'refund', { ...dependencies,
  getRefund: async () => { throw new Error('provider offline'); } }), /provider offline/);
assert.equal((await resolve('payment.updated', 'pending', { ...dependencies,
  getPayment: async id => ({ id, status: 'APPROVED' }) })).status, 'not_completed');
calls.length = 0;
assert.equal((await resolve('invoice.updated', 'invoice', dependencies)).status, 'unsupported');
assert.equal(calls.length, 0);
console.log('Square job routing: provider retrieval, unrelated/unmapped separation and ambiguous-order rejection passed');
