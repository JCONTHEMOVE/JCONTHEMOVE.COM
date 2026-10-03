// A stable catalog SKU binds the offer to this single bracelet, never a cart title.
export const COPPER_CUFF_SKU = "ASHLEY-DOUBLE-RAIL-COPPER-20260917";
export const COPPER_CUFF_BONUS_MOVES = 555;
export const COPPER_CUFF_IMAGE = "/shop/ashley/double-rail-copper-featured.jpg";
export const COPPER_CUFF_PHOTOS = [
  COPPER_CUFF_IMAGE,
  "/shop/ashley/double-rail-copper-original.jpg",
  "/shop/ashley/double-rail-copper-detail.jpg",
];
export const COPPER_CUFF_LISTING = {
  title: "Double-Rail Copper Cuff Bracelet",
  shortDescription: "Handmade copper wire cuff. One available. +555 JCMOVES with eligible purchase.",
  description: "Handmade copper wire cuff with two parallel rails and repeating wrapped-wire details. Sold individually. One available. The featured image is an AI-rendered product visualization; see the original photographs for the handmade piece. Earn an additional 555 JCMOVES after verified regular payment to an enrolled account. Crypto and shop-credit purchases are excluded from this bonus.",
  price: "55.00",
  category: "bracelets",
  materials: "Copper wire",
  imageUrl: COPPER_CUFF_IMAGE,
};

export function copperCuffBonus(sku: unknown): number {
  return sku === COPPER_CUFF_SKU ? COPPER_CUFF_BONUS_MOVES : 0;
}

// One bonus per distinct purchased piece, even if a cart repeats its line.
// Call with server-loaded catalog rows, never customer-supplied metadata.
export function catalogPurchaseBonus(items: Iterable<{ id: string; sku?: unknown }>): number {
  const seen = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    total += copperCuffBonus(item.sku);
  }
  return total;
}
