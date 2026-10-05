import { optionalPhoneNumberSchema } from "./schema";
import { z } from "zod";
import { CANONICAL_PRICING_2026_08, roundCurrency } from "./canonicalPricing";

export const COMMERCE_TERMS_VERSION = "2026.08.22";
export const COMMERCE_PERCENT_DISCOUNT_CAP = CANONICAL_PRICING_2026_08.offers.totalPercentageCap;
export const FULL_PREPAY_DISCOUNT_PERCENT = 5;
export const SCHEDULING_DEPOSIT_PERCENT = 30;
export const EARLY_CANCELLATION_FEE = 175;
export const CANCELLATION_CUTOFF_HOURS = 24;

export const commerceItemTypeSchema = z.enum(["service", "package", "supply", "fee"]);
export const commercePricingModeSchema = z.enum(["fixed", "hourly", "per_unit", "variable", "quote"]);
export const commercePurchaseModeSchema = z.enum(["direct", "quote"]);
export const commercePublicationStatusSchema = z.enum(["draft", "previewed", "publishing", "active", "failed", "superseded"]);
export const commercePaymentChoiceSchema = z.enum(["deposit", "full"]);
export const commerceAdjustmentTypeSchema = z.enum(["cancel", "reschedule", "job_switch"]);

export const commerceVariationSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  itemCode: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  pricingMode: commercePricingModeSchema,
  unit: z.string().trim().min(1).max(60),
  price: z.number().finite().nonnegative().nullable(),
  discountEligible: z.boolean(),
  publicVisible: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  metadata: z.record(z.unknown()).default({}),
});

export const commerceItemSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).nullable(),
  category: z.string().trim().min(1).max(80),
  itemType: commerceItemTypeSchema,
  pricingMode: commercePricingModeSchema,
  purchaseMode: commercePurchaseModeSchema,
  unit: z.string().trim().min(1).max(60),
  price: z.number().finite().nonnegative().nullable(),
  discountEligible: z.boolean(),
  publicVisible: z.boolean(),
  advertisingEnabled: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  sourceServiceCode: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  variations: z.array(commerceVariationSchema).default([]),
  squareStatus: z.enum(["unmapped", "synced", "drifted", "error"]).optional(),
  updatedAt: z.string().optional(),
});

export const commercePromotionSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(2).max(64).regex(/^[A-Z0-9][A-Z0-9_-]*$/),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1000).nullable().optional(),
  discountType: z.enum(["percent", "fixed"]),
  value: z.number().finite().positive(),
  maximumAmount: z.number().finite().positive().nullable().optional(),
  eligibleItemCodes: z.array(z.string()).default([]),
  eligibleCategories: z.array(z.string()).default([]),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  combinable: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  active: z.boolean().default(false),
});

export type CommerceItem = z.infer<typeof commerceItemSchema>;
export type CommerceVariation = z.infer<typeof commerceVariationSchema>;
export type CommercePromotion = z.infer<typeof commercePromotionSchema>;
export type CommercePaymentChoice = z.infer<typeof commercePaymentChoiceSchema>;
export type CommerceAdjustmentType = z.infer<typeof commerceAdjustmentTypeSchema>;

export const commerceCatalogItemUpdateSchema = commerceItemSchema.pick({
  name: true,
  description: true,
  category: true,
  itemType: true,
  pricingMode: true,
  purchaseMode: true,
  unit: true,
  price: true,
  discountEligible: true,
  publicVisible: true,
  advertisingEnabled: true,
  active: true,
  sortOrder: true,
  metadata: true,
}).partial();

export const commerceVariationUpdateSchema = commerceVariationSchema.pick({
  name: true,
  description: true,
  pricingMode: true,
  unit: true,
  price: true,
  discountEligible: true,
  publicVisible: true,
  active: true,
  sortOrder: true,
  metadata: true,
}).partial();

export const commerceCheckoutSchema = z.object({
  offerCode: z.string().trim().min(2).max(100),
  variationCode: z.string().trim().min(2).max(100).nullable().optional(),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  paymentChoice: commercePaymentChoiceSchema.default("deposit"),
  promoCode: z.string().trim().max(64).nullable().optional(),
  customer: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().email(),
    phone: optionalPhoneNumberSchema,
  }),
  serviceAddress: z.string().trim().max(500).nullable().optional(),
  serviceDate: z.string().trim().max(40).nullable().optional(),
  scopeNotes: z.string().trim().max(3000).nullable().optional(),
  termsVersion: z.literal(COMMERCE_TERMS_VERSION),
  acceptedTerms: z.literal(true),
  idempotencyKey: z.string().trim().min(12).max(120),
});

export const commerceAdjustmentRequestSchema = z.object({
  type: commerceAdjustmentTypeSchema,
  requestedServiceDate: z.string().trim().max(40).nullable().optional(),
  replacementOfferCode: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().min(3).max(2000),
  termsVersion: z.literal(COMMERCE_TERMS_VERSION),
  acceptedTerms: z.literal(true),
});

export type DiscountableCommerceLine = {
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountEligible: boolean;
  category?: string | null;
};

export type CommerceDiscountOffer = {
  code: string;
  name: string;
  discountType: "percent" | "fixed";
  value: number;
  maximumAmount?: number | null;
  priority?: number;
};

export function calculateCommerceDiscounts(
  lines: DiscountableCommerceLine[],
  offers: CommerceDiscountOffer[],
  capPercent = COMMERCE_PERCENT_DISCOUNT_CAP,
) {
  const normalizedLines = lines.map((line) => ({
    ...line,
    quantity: Math.max(1, Math.round(Number(line.quantity) || 1)),
    unitPrice: roundCurrency(Math.max(0, Number(line.unitPrice) || 0)),
  }));
  const subtotal = roundCurrency(normalizedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const eligibleSubtotal = roundCurrency(normalizedLines
    .filter((line) => line.discountEligible)
    .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const percentCapAmount = roundCurrency(eligibleSubtotal * Math.max(0, capPercent) / 100);
  let remainingPercentCap = percentCapAmount;

  const ordered = [...offers].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  const applied = ordered.map((offer) => {
    if (offer.discountType === "percent") {
      const raw = roundCurrency(eligibleSubtotal * Math.max(0, offer.value) / 100);
      const offerCapped = offer.maximumAmount == null ? raw : Math.min(raw, Math.max(0, offer.maximumAmount));
      const amount = roundCurrency(Math.min(offerCapped, remainingPercentCap));
      remainingPercentCap = roundCurrency(Math.max(0, remainingPercentCap - amount));
      return { ...offer, amount, capped: amount < raw };
    }
    return { ...offer, amount: roundCurrency(Math.min(eligibleSubtotal, Math.max(0, offer.value))), capped: false };
  }).filter((offer) => offer.amount > 0);

  const percentageDiscount = roundCurrency(applied
    .filter((offer) => offer.discountType === "percent")
    .reduce((sum, offer) => sum + offer.amount, 0));
  const maximumFixed = Math.max(0, eligibleSubtotal - percentageDiscount);
  const fixedDiscount = roundCurrency(Math.min(maximumFixed, applied
    .filter((offer) => offer.discountType === "fixed")
    .reduce((sum, offer) => sum + offer.amount, 0)));
  const discountTotal = roundCurrency(percentageDiscount + fixedDiscount);

  return {
    subtotal,
    eligibleSubtotal,
    percentCap: capPercent,
    percentCapAmount,
    percentageDiscount,
    fixedDiscount,
    discountTotal,
    total: roundCurrency(Math.max(0, subtotal - discountTotal)),
    applied,
  };
}

export function calculateCheckoutPayment(input: {
  total: number;
  paymentChoice: CommercePaymentChoice;
  itemType: CommerceItem["itemType"];
}) {
  const total = roundCurrency(Math.max(0, input.total));
  if (input.itemType === "supply") {
    return { paymentChoice: "full" as const, amountDue: total, depositPercent: 100 };
  }
  if (input.paymentChoice === "full") {
    return { paymentChoice: "full" as const, amountDue: total, depositPercent: 100 };
  }
  return {
    paymentChoice: "deposit" as const,
    amountDue: roundCurrency(total * SCHEDULING_DEPOSIT_PERCENT / 100),
    depositPercent: SCHEDULING_DEPOSIT_PERCENT,
  };
}

export type CancellationPolicyResult = {
  policy: "early_flat_fee" | "within_24h_deposit";
  fee: number;
  retained: number;
  refund: number;
  amountDue: number;
};

export function calculateCancellationPolicy(input: {
  hoursBeforeStart: number;
  jobTotal: number;
  amountPaid: number;
}): CancellationPolicyResult {
  const jobTotal = roundCurrency(Math.max(0, input.jobTotal));
  const amountPaid = roundCurrency(Math.max(0, input.amountPaid));
  const early = Number(input.hoursBeforeStart) > CANCELLATION_CUTOFF_HOURS;
  const fee = early
    ? EARLY_CANCELLATION_FEE
    : roundCurrency(jobTotal * SCHEDULING_DEPOSIT_PERCENT / 100);
  const retained = roundCurrency(Math.min(amountPaid, fee));
  return {
    policy: early ? "early_flat_fee" : "within_24h_deposit",
    fee,
    retained,
    refund: roundCurrency(Math.max(0, amountPaid - retained)),
    amountDue: roundCurrency(Math.max(0, fee - retained)),
  };
}

export function commerceTermsText(): string {
  return [
    "A 30% scheduling deposit confirms a service appointment unless full payment is selected.",
    "Full prepayment receives 5% off eligible service and labor charges, subject to the 15% percentage-discount cap.",
    "Cancellation more than 24 hours before the scheduled start carries a $175 fee.",
    "Cancellation within 24 hours retains the full 30% job-total deposit.",
    "One reschedule or job switch requested more than 24 hours ahead is free; paid funds transfer and remain attached to the replacement job.",
    "Later changes follow cancellation and rebooking terms. Refunds, supplements, and cancellation balances require owner review.",
  ].join(" ");
}
