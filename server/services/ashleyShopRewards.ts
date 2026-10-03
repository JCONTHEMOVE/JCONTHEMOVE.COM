export interface PaidShopRewardOrder {
  id: string;
  status: string;
  payment_rail?: string;
  user_id: string | null;
  reward_moves: number | string;
  reward_issued_at?: unknown;
}

// credit() must use the existing atomic wallet/ledger transaction and the
// unique ashley_shop_purchase reference_id index. Concurrent retries are safe.
export async function settlePaidShopRewards(order: PaidShopRewardOrder, deps: {
  credit: (userId: string, amount: number, orderId: string) => Promise<void>;
  markIssued: (orderId: string) => Promise<void>;
}): Promise<boolean> {
  const amount = Number(order.reward_moves);
  if (order.status !== "paid" || order.payment_rail === "crypto" || !order.user_id
      || order.reward_issued_at || !Number.isSafeInteger(amount) || amount <= 0) return false;
  try {
    await deps.credit(order.user_id, amount, order.id);
  } catch (error: any) {
    // Only this exact constraint proves the order's reward already exists.
    if (error?.code !== "23505" || error?.constraint !== "uq_rewards_ashley_order") throw error;
  }
  await deps.markIssued(order.id);
  return true;
}
