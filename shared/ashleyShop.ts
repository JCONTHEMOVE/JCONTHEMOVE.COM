import { leadPhoneNumberSchema } from "./schema";
import { z } from "zod";

export const cartItemTypeSchema = z.enum([
  "service",
  "jewelry",
  "promo",
  "sponsor",
  "shop",
  "tip",
]);

export const cartSettlementModeSchema = z.enum([
  "pay_now",
  "linked_booking",
  "quote_later",
]);

export const commerceCartItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  referenceId: z.string().trim().max(200).optional(),
  bookingId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1).max(240),
  price: z.number().finite().nonnegative(),
  image: z.string().max(2_000).default(""),
  type: cartItemTypeSchema,
  quantity: z.number().int().min(1).max(25).default(1),
  settlementMode: cartSettlementModeSchema.default("pay_now"),
  bookNow: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const commerceCartSchema = z.object({
  guestCartId: z.string().uuid().optional(),
  items: z.array(commerceCartItemSchema).max(100),
});

export const shippingMethodSchema = z.enum(["pickup", "shipping"]);

export const commercePreviewSchema = commerceCartSchema.extend({
  promoCode: z.string().trim().max(80).optional(),
  shippingMethod: shippingMethodSchema.optional(),
  customerEmail: z.string().trim().email().optional(),
});

export const commerceCheckoutSchema = commercePreviewSchema.extend({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  phone: leadPhoneNumberSchema,
  shippingAddress: z.string().trim().max(1_000).optional(),
  fromAddress: z.string().trim().max(1_000).optional(),
  toAddress: z.string().trim().max(1_000).optional(),
  moveDate: z.string().trim().max(40).optional(),
  details: z.string().trim().max(5_000).optional(),
  enrollRewards: z.boolean().optional(),
});

export type CommerceCartItem = z.infer<typeof commerceCartItemSchema>;
export type CommercePreviewInput = z.infer<typeof commercePreviewSchema>;
export type CommerceCheckoutInput = z.infer<typeof commerceCheckoutSchema>;

export interface CommercePricedLine extends CommerceCartItem {
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPercent: number;
  discountCents: number;
  lineTotalCents: number;
  discountReasons: string[];
  featuredToday?: boolean;
}

export interface CommercePriceSnapshot {
  version: "ashley-shop-2026-08-22";
  currency: "USD";
  lines: CommercePricedLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  dueNowCents: number;
  jewelryCount: number;
  hasServiceBooking: boolean;
  baseRewardMoves: number;
  regularPaymentBonusMoves: number;
  featuredBonusMoves: number;
  totalRewardMoves: number;
  promoCode?: string;
  notices: string[];
}

export const ashleyDraftPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4_000).optional(),
  shortDescription: z.string().trim().max(500).optional(),
  category: z.string().trim().max(100).optional(),
  materials: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  finalPrice: z.number().finite().positive().max(100_000).optional(),
});

export const ashleyBatchApprovalSchema = z.object({
  draftIds: z.array(z.string().uuid()).min(1).max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Draft IDs must be unique"),
});
