import assert from 'node:assert/strict';
import { pool } from '../../db';
import { storage } from '../../storage';
import { finalizeCommerceOrder } from '../ashleyShopCommerce';

const query = pool.query;
const credit = storage.creditWalletTokens;
const fetch = globalThis.fetch;
const order = { id: 'paid-fixture', status: 'paid', payment_rail: 'card', user_id: 'fixture-user', reward_moves: 1421, reward_issued_at: null as Date | null };
let attempts = 0;
let balance = 0;
(pool as any).query = async (sql: string) => {
  if (sql.startsWith('SELECT * FROM commerce_orders')) return { rows: [{ ...order }] };
  if (sql.startsWith('UPDATE commerce_orders SET reward_issued_at')) order.reward_issued_at = new Date();
  return { rows: [] };
};
storage.creditWalletTokens = async (_user, amount) => {
  attempts++;
  if (attempts === 1) throw new Error('fixture wallet unavailable');
  balance += Number(amount);
};
globalThis.fetch = async () => { throw new Error('No external requests permitted'); };
try {
  const failedReward = await finalizeCommerceOrder(order.id);
  assert.equal(failedReward.status, 'paid', 'a delayed reward must not turn a paid order into a checkout failure');
  assert.equal(failedReward.reward_issued_at, null);
  assert.equal(balance, 0);
  const retry = await finalizeCommerceOrder(order.id);
  assert.equal(retry.status, 'paid');
  assert.ok(retry.reward_issued_at);
  await finalizeCommerceOrder(order.id);
  assert.equal(attempts, 2, 'a recorded reward is not attempted again');
  assert.equal(balance, 1421);
  console.log('Paid shop status survives reward failure and retries issuance once without provider entry.');
} finally {
  pool.query = query;
  storage.creditWalletTokens = credit;
  globalThis.fetch = fetch;
}
