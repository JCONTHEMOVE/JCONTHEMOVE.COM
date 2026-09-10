import assert from 'node:assert/strict';
import { processCanonicalSquareWebhook as processEvent } from '../canonicalSquareWebhook';
const flags = [process.env.JOB_PAYMENT_LEDGER_ENABLED, process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED];
const calls: string[] = [];
let resolution: any = { status: 'unrelated' };
const dependencies: any = {
  resolve: async () => { calls.push('resolve'); return resolution; },
  confirm: async (id: string) => { calls.push(`payment:${id}`); },
  refund: async (id: string) => { calls.push(`refund:${id}`); },
};
try {
  delete process.env.JOB_PAYMENT_LEDGER_ENABLED;
  process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED = 'true';
  await processEvent('payment.updated', 'payment', dependencies);
  assert.equal(calls.length, 0);
  process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
  await processEvent('invoice.paid', 'invoice', dependencies);
  assert.equal(calls.length, 0);
  await processEvent('payment.updated', 'shop-payment', dependencies);
  assert.deepEqual(calls, ['resolve']);
  resolution = { status: 'unmapped', reason: 'missing_stored_order' };
  await assert.rejects(processEvent('payment.updated', 'payment', dependencies), /requires reconciliation/);
  resolution = { status: 'job', kind: 'payment', paymentId: 'verified-payment' };
  await processEvent('payment.updated', 'event-object', dependencies);
  assert.equal(calls.at(-1), 'payment:verified-payment');
  resolution = { status: 'job', kind: 'refund', objectId: 'verified-refund' };
  await processEvent('refund.updated', 'event-object', dependencies);
  assert.equal(calls.at(-1), 'refund:verified-refund');
  await assert.rejects(processEvent('refund.updated', 'refund', { ...dependencies,
    refund: async () => { throw new Error('ledger unavailable'); } }), /ledger unavailable/);
  console.log('PASS: canonical webhook flags, unrelated events, unmapped retry and adapter error propagation');
} finally {
  for (const [index, name] of ['JOB_PAYMENT_LEDGER_ENABLED', 'SQUARE_JOB_PAYMENT_LEDGER_ENABLED'].entries()) {
    if (flags[index] === undefined) delete process.env[name]; else process.env[name] = flags[index];
  }
}
