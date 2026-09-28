import assert from "node:assert/strict";
import { COPPER_CUFF_SKU, catalogPurchaseBonus, copperCuffBonus } from "@shared/ashleyCopperPromotion";
import { settlePaidShopRewards } from "../ashleyShopRewards";
import { pool } from "../../db";
import { priceCommerceCart } from "../ashleyShopPricing";

assert.equal(copperCuffBonus(COPPER_CUFF_SKU), 555);
assert.equal(copperCuffBonus("Double-Rail Copper Cuff Bracelet"), 0);
assert.equal(copperCuffBonus(null), 0);
assert.equal(catalogPurchaseBonus([{ id: "a", sku: COPPER_CUFF_SKU }, { id: "a", sku: COPPER_CUFF_SKU }]), 555);

const originalQuery = pool.query;
let featuredToday = false;
let actualSku: string | null = COPPER_CUFF_SKU;
let available = true;
(pool as any).query = async (sql: string) => {
  if (sql.includes("SELECT j.id, j.sku")) return { rows: available ? [{ id: "cuff", sku: actualSku, title: "Copper cuff", price: "55.00", image_url: "/cuff.jpg", featured_today: featuredToday }] : [] };
  return { rows: [] };
};
try {
  const input = { shippingMethod: "pickup" as const, items: [{ id: "jewelry-cuff", referenceId: "cuff", name: "spoofed", image: "", type: "jewelry" as const, price: 0.01, quantity: 1, settlementMode: "pay_now" as const, metadata: { bonusMoves: 999999 } }] };
  const priced = await priceCommerceCart(input);
  assert.equal(priced.dueNowCents, 5500, "client price is ignored");
  assert.equal(priced.itemBonusMoves, 555, "server catalog controls the bonus");
  assert.equal(priced.totalRewardMoves, 825 + 41 + 555, "555 stacks after normal rewards and regular payment bonus");
  featuredToday = true;
  const daily = await priceCommerceCart(input);
  assert.equal(daily.featuredBonusMoves, 500);
  assert.equal(daily.itemBonusMoves, 555);
  assert.equal(daily.totalRewardMoves, daily.baseRewardMoves + daily.regularPaymentBonusMoves + 1055);
  const repeated = await priceCommerceCart({ ...input, items: [...input.items, ...input.items] });
  assert.equal(repeated.itemBonusMoves, 555, "duplicate lines do not multiply the promotional bonus");
  actualSku = null;
  assert.equal((await priceCommerceCart(input)).itemBonusMoves, 0, "customer metadata cannot claim the campaign");
  available = false;
  await assert.rejects(priceCommerceCart(input), /unavailable/);
} finally {
  pool.query = originalQuery;
}

const paid = { id: "order-1", status: "paid", payment_rail: "square", user_id: "buyer", reward_moves: 1421, reward_issued_at: null };
const ledger = new Set<string>();
let balance = 0;
let issued = 0;
let failCredit = false;
let failMark = false;
const deps = {
  credit: async (_user: string, amount: number, id: string) => {
    if (failCredit) throw new Error("temporary wallet failure");
    if (ledger.has(id)) throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "uq_rewards_ashley_order" });
    ledger.add(id);
    balance += amount;
  },
  markIssued: async () => { if (failMark) throw new Error("temporary mark failure"); issued++; },
};
for (const change of [{ status: "pending_payment" }, { status: "expired" }, { payment_rail: "crypto" }, { user_id: null }, { reward_moves: 0 }, { reward_issued_at: new Date() }]) {
  assert.equal(await settlePaidShopRewards({ ...paid, ...change }, deps), false);
}
assert.equal(balance, 0, "unpaid, crypto and unenrolled orders receive no reward");
failCredit = true;
await assert.rejects(settlePaidShopRewards(paid, deps), /wallet failure/);
assert.equal(issued, 0);
failCredit = false;
failMark = true;
await assert.rejects(settlePaidShopRewards(paid, deps), /mark failure/);
assert.equal(balance, 1421);
failMark = false;
await Promise.all([settlePaidShopRewards(paid, deps), settlePaidShopRewards(paid, deps)]);
assert.equal(balance, 1421, "concurrent/repeated completion credits once after a failed mark");
await assert.rejects(settlePaidShopRewards({ ...paid, id: "order-2" }, { ...deps, credit: async () => { throw Object.assign(new Error("unrelated duplicate"), { code: "23505", constraint: "other_index" }); } }), /unrelated duplicate/);
console.log("Copper cuff bonus pricing, eligibility, stacking, and reward retry tests passed");
