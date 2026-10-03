import type {
  CommerceCartItem,
  CommercePriceSnapshot,
  CommercePricedLine,
  CommercePreviewInput,
} from "@shared/ashleyShop";
import { pool } from "../db";
import { ensureAshleyShopSchema } from "./ashleyShopSchema";
import { regularPaymentRewardBonus } from "@shared/paymentIncentives";
import { catalogPurchaseBonus } from "@shared/ashleyCopperPromotion";

const SHIPPING_CENTS = 1_000;
const JEWELRY_MOVES_PER_DOLLAR = 15;
const AUTO_DISCOUNT_CAP = 15;

type PricingIdentity = {
  userId?: string | null;
  email?: string | null;
  isAdmin?: boolean;
};

type CatalogItem = {
  id: string;
  sku?: string | null;
  title: string;
  priceCents: number;
  image: string;
  featuredToday: boolean;
};

function referenceId(item: CommerceCartItem): string {
  if (item.referenceId) return item.referenceId;
  if (item.type === "jewelry" && item.id.startsWith("jewelry-")) return item.id.slice("jewelry-".length);
  if (item.type === "shop" && item.id.startsWith("shop-")) return item.id.slice("shop-".length);
  return item.id;
}

function cents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function calculateJewelryDiscountPercent(input: {
  jewelryCount: number;
  hasServiceBooking: boolean;
  featuredToday: boolean;
  promoPercent: number;
}): { percent: number; reasons: string[] } {
  const reasons: string[] = [];
  const bundlePercent = input.jewelryCount >= 3 ? 10 : input.jewelryCount >= 2 ? 5 : 0;
  const servicePercent = input.hasServiceBooking ? 5 : 0;
  const featuredPercent = input.featuredToday ? 5 : 0;
  if (bundlePercent) reasons.push(`${input.jewelryCount}-piece bundle ${bundlePercent}%`);
  if (servicePercent) reasons.push("service-booking add-on 5%");
  if (featuredPercent) reasons.push("daily featured piece 5%");

  const automaticPercent = Math.min(AUTO_DISCOUNT_CAP, bundlePercent + servicePercent + featuredPercent);
  const promoPercent = Math.max(0, Math.min(100, Math.floor(input.promoPercent)));
  if (promoPercent > automaticPercent) {
    return { percent: promoPercent, reasons: [`promo code ${promoPercent}% (replaces automatic discount)`] };
  }
  return { percent: automaticPercent, reasons };
}

async function getPromoPercent(code?: string): Promise<{ code?: string; jewelryPercent: number }> {
  if (!code?.trim()) return { jewelryPercent: 0 };
  const normalized = code.trim().toUpperCase();
  const result = await pool.query<{
    code: string;
    discount_percent_jewelry: string;
  }>(
    `SELECT code, discount_percent_jewelry
       FROM promo_codes
      WHERE upper(code) = $1
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR uses_count < max_uses)
      LIMIT 1`,
    [normalized],
  );
  if (!result.rows[0]) throw new Error("Promo code is invalid, expired, or already used");
  return {
    code: result.rows[0].code,
    jewelryPercent: Math.max(0, Number(result.rows[0].discount_percent_jewelry || 0)),
  };
}

async function getJewelryCatalog(ids: string[]): Promise<Map<string, CatalogItem>> {
  if (!ids.length) return new Map();
  const result = await pool.query<{
    id: string;
    sku: string | null;
    title: string;
    price: string;
    image_url: string | null;
    featured_today: boolean;
  }>(
    `SELECT j.id, j.sku, j.title, j.price, j.image_url,
            EXISTS (
              SELECT 1 FROM ashley_shop_feature_schedule f
               WHERE f.item_id = j.id
                 AND f.local_date = (now() AT TIME ZONE 'America/Chicago')::date
            ) AS featured_today
       FROM jewelry_items j
      WHERE j.id = ANY($1::varchar[])
        AND j.status = 'active'
        AND j.in_stock = true
        AND j.approval_status = 'approved'
        AND (j.source_batch_id IS NULL OR (j.approved_at IS NOT NULL AND j.published_at IS NOT NULL))
        AND COALESCE(j.quantity, 1) > 0
        AND j.price IS NOT NULL
        AND j.price::numeric > 0`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, {
    id: row.id,
    sku: row.sku,
    title: row.title,
    priceCents: cents(row.price),
    image: row.image_url || "",
    featuredToday: row.featured_today,
  }]));
}

async function getShopCatalog(ids: string[]): Promise<Map<string, CatalogItem>> {
  if (!ids.length) return new Map();
  const result = await pool.query<{ id: string; title: string; price: string; photos: unknown }>(
    `SELECT id, title, price, photos
       FROM shop_items
      WHERE id = ANY($1::varchar[])
        AND status = 'active'
        AND price::numeric > 0`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, {
    id: row.id,
    title: row.title,
    priceCents: cents(row.price),
    image: Array.isArray(row.photos)
      ? (typeof row.photos[0] === "string" ? row.photos[0] : String((row.photos[0] as any)?.url || ""))
      : "",
    featuredToday: false,
  }]));
}

async function validateLinkedBookings(items: CommerceCartItem[], identity: PricingIdentity): Promise<Set<string>> {
  const bookingIds = Array.from(new Set(items
    .filter((item) => (item.type === "service" || item.type === "promo") && item.settlementMode === "linked_booking")
    .map((item) => item.bookingId || item.referenceId || "")
    .filter(Boolean)));
  if (!bookingIds.length) return new Set();
  const result = await pool.query<{ id: string; customer_email: string | null }>(
    `SELECT id, customer_email FROM bookings WHERE id = ANY($1::varchar[]) AND status <> 'cancelled'`,
    [bookingIds],
  );
  const allowed = new Set<string>();
  for (const row of result.rows) {
    const emailMatches = Boolean(identity.email && row.customer_email && identity.email.toLowerCase() === row.customer_email.toLowerCase());
    if (identity.isAdmin || emailMatches) allowed.add(row.id);
  }
  if (allowed.size !== bookingIds.length) throw new Error("One or more linked service bookings could not be verified");
  return allowed;
}

export async function priceCommerceCart(
  input: CommercePreviewInput,
  identity: PricingIdentity = {},
): Promise<CommercePriceSnapshot> {
  await ensureAshleyShopSchema();
  const jewelryIds = input.items.filter((item) => item.type === "jewelry").map(referenceId);
  const shopIds = input.items.filter((item) => item.type === "shop").map(referenceId);
  const [jewelry, shop, promo, bookings] = await Promise.all([
    getJewelryCatalog(jewelryIds),
    getShopCatalog(shopIds),
    getPromoPercent(input.promoCode),
    validateLinkedBookings(input.items, { ...identity, email: identity.email || input.customerEmail }),
  ]);

  if (jewelry.size !== new Set(jewelryIds).size) throw new Error("One or more jewelry pieces are sold, reserved, or unavailable");
  if (shop.size !== new Set(shopIds).size) throw new Error("One or more shop items are unavailable");

  const jewelryCount = input.items
    .filter((item) => item.type === "jewelry")
    .reduce((sum, item) => sum + item.quantity, 0);
  const hasServiceBooking = bookings.size > 0;
  let subtotalCents = 0;
  let discountCents = 0;
  let jewelryNetCents = 0;
  let hasFeaturedPurchase = false;

  const lines: CommercePricedLine[] = input.items.map((item) => {
    const ref = referenceId(item);
    const linked = (item.type === "service" || item.type === "promo") && item.settlementMode === "linked_booking";
    if ((item.type === "service" || item.type === "promo") && !linked) {
      throw new Error("Book service items first; the saved booking can then be combined with shop add-ons");
    }

    let catalog: CatalogItem | undefined;
    if (item.type === "jewelry") catalog = jewelry.get(ref);
    if (item.type === "shop") catalog = shop.get(ref);

    let unitPriceCents = catalog?.priceCents ?? 0;
    let name = catalog?.title ?? item.name;
    let image = catalog?.image ?? item.image;
    if (item.type === "sponsor") {
      const sponsorPrices: Record<string, number> = {
        "sponsor-starter": 5_000,
        "sponsor-growth": 10_000,
        "sponsor-power": 20_000,
        "sponsor-bronze": 5_000,
        "sponsor-silver": 10_000,
        "sponsor-gold": 20_000,
      };
      unitPriceCents = sponsorPrices[ref] || 0;
      if (!unitPriceCents) throw new Error("Unknown sponsorship tier");
    } else if (item.type === "tip") {
      unitPriceCents = Math.min(100_000, Math.max(100, Math.round(item.price * 100)));
    } else if (linked) {
      unitPriceCents = 0;
    } else if (!catalog) {
      throw new Error(`Unsupported cart item: ${item.name}`);
    }

    const lineSubtotalCents = unitPriceCents * item.quantity;
    let discountPercent = 0;
    let discountReasons: string[] = [];
    if (item.type === "jewelry") {
      const discount = calculateJewelryDiscountPercent({
        jewelryCount,
        hasServiceBooking,
        featuredToday: Boolean(catalog?.featuredToday),
        promoPercent: promo.jewelryPercent,
      });
      discountPercent = discount.percent;
      discountReasons = discount.reasons;
      hasFeaturedPurchase ||= Boolean(catalog?.featuredToday);
    }
    const lineDiscountCents = Math.round(lineSubtotalCents * discountPercent / 100);
    const lineTotalCents = linked ? 0 : lineSubtotalCents - lineDiscountCents;
    if (!linked) {
      subtotalCents += lineSubtotalCents;
      discountCents += lineDiscountCents;
    }
    if (item.type === "jewelry") jewelryNetCents += lineTotalCents;

    return {
      ...item,
      referenceId: ref,
      name,
      image,
      unitPriceCents,
      lineSubtotalCents,
      discountPercent,
      discountCents: lineDiscountCents,
      lineTotalCents,
      discountReasons,
      featuredToday: catalog?.featuredToday,
    };
  });

  const hasShippable = lines.some((line) => line.type === "jewelry" || line.type === "shop");
  const shippingCents = hasShippable && input.shippingMethod === "shipping" ? SHIPPING_CENTS : 0;
  const baseRewardMoves = Math.round((jewelryNetCents / 100) * JEWELRY_MOVES_PER_DOLLAR);
  const regularPaymentBonusMoves = regularPaymentRewardBonus(baseRewardMoves);
  const featuredBonusMoves = hasFeaturedPurchase ? 500 : 0;
  const itemBonusMoves = catalogPurchaseBonus(jewelry.values());
  const notices = [
    "Jewelry discounts are capped at 15% unless a better promo code replaces them.",
    "JC Moves are issued only after verified payment to an enrolled account.",
  ];
  if (hasServiceBooking) notices.unshift("Your saved service booking unlocked 5% off Ashley jewelry in this cart.");

  return {
    version: "ashley-shop-2026-08-22",
    currency: "USD",
    lines,
    subtotalCents,
    discountCents,
    shippingCents,
    dueNowCents: Math.max(0, subtotalCents - discountCents + shippingCents),
    jewelryCount,
    hasServiceBooking,
    baseRewardMoves,
    regularPaymentBonusMoves,
    featuredBonusMoves,
    itemBonusMoves,
    totalRewardMoves: baseRewardMoves + regularPaymentBonusMoves + featuredBonusMoves + itemBonusMoves,
    promoCode: promo.code,
    notices,
  };
}
