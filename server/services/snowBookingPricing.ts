import {
  buildSnowQuoteDetails, calculateSnowQuote, SNOW_PRICING_VERSION,
  SnowPricingValidationError,
} from "../../shared/snowPricing";
import type { BookingPricingItemInput, BookingPricingResult } from "./bookingPricing";

type IntakeItem = { serviceCode: string; quantity: number; details?: Record<string, unknown> | null };

/** Presence, not validity, selects the new intake. Malformed markers fail closed. */
export function isSnowCalculatorItem(item: Pick<IntakeItem, "serviceCode" | "details">): boolean {
  return item.serviceCode === "snow_removal" && !!item.details
    && Object.prototype.hasOwnProperty.call(item.details, "snowQuote");
}

export function resolveSnowBookingItem(item: IntakeItem): {
  line: BookingPricingItemInput; reviewReasons: string[];
} | null {
  if (!isSnowCalculatorItem(item)) return null;
  if (item.quantity !== 1) throw new SnowPricingValidationError("Submit one snow plan per quote request.");
  const estimate = calculateSnowQuote(item.details!.snowQuote as Parameters<typeof calculateSnowQuote>[0]);
  const input = estimate.input;
  const allowance = input.plan === "single" ? "1 visit"
    : input.plan === "monthly" ? `${input.visitsPerMonth} visits in one month`
      : `${input.visitsPerMonth} visits/month for ${input.seasonMonths} months (${estimate.selected.seasonVisits} total visits)`;
  const scope = String(buildSnowQuoteDetails(input).scope);
  const label = `Snow ${input.plan} estimate — ${scope}; ${input.widthFeet} × ${input.lengthFeet} ft; ${input.depthInches} in; ${allowance}`;
  const paymentPreference = input.plan === "seasonal" && input.seasonalPayment === "installment"
    ? `Requested ${input.installments} installments: ${input.installments - 1} × $${estimate.selected.installment.toFixed(2)} and final $${estimate.selected.finalInstallment.toFixed(2)}. Staff must arrange the schedule; this request does not create automatic charges.`
    : "One approved invoice for the selected service period; no automatic renewal.";
  const terms = `${allowance} at the selected snow depth. Extra visits, deeper/compacted snow, hauling and off-site disposal require a separate approved quote. Staff must confirm service dates, storm trigger, response window, equipment and scope. Close this plan only after its entire service period is fulfilled. ${paymentPreference}`;
  const details: Record<string, unknown> = {
    ...buildSnowQuoteDetails(input),
    // Keep only non-pricing intake context. Never carry forged labor or totals.
    ...Object.fromEntries(["serviceAddress", "requestedDate", "date", "arrivalWindow"].flatMap(key => {
      const value = item.details?.[key];
      return typeof value === "string" ? [[key, value]] : [];
    })),
    packageLabel: terms,
    pricingRateSource: "snow_calculator",
    snowPricingVersion: SNOW_PRICING_VERSION,
    snowEstimateSnapshot: {
      version: SNOW_PRICING_VERSION,
      input, areaSqFt: estimate.areaSqFt, depthFactor: estimate.depthFactor,
      selected: estimate.selected, contractTotal: estimate.total,
      installmentPreferenceAmount: estimate.amount,
      manualQuoteRequired: estimate.manualQuoteRequired,
      reviewRequired: true, reviewReasons: estimate.reviewReasons,
      allowance, terms,
    },
  };
  return {
    line: {
      serviceCode: "snow_removal", label, quantity: 1,
      // Bill the full contract, never just the displayed installment. Partial
      // payment of a plan must not appear to settle its entire obligation.
      unitPrice: estimate.total, priceMode: "quote", discountEligible: false,
      minimumLineSubtotal: 0, details,
    },
    reviewReasons: estimate.reviewReasons,
  };
}

export function assertSnowDraftPaymentAllowed(
  items: Array<Pick<IntakeItem, "serviceCode" | "details">>,
  payment: { applyTokens?: number; payFromWallet?: boolean },
): void {
  if (items.some(isSnowCalculatorItem) && (payment.payFromWallet || (payment.applyTokens ?? 0) > 0)) {
    throw new SnowPricingValidationError("Snow estimates need staff approval before payment or reward redemption. Request the quote first; pay through the approved Square invoice.");
  }
}

/** Match quote-revision lines so the guided workflow keeps their scope and
 * adds saved geographic adjustments once, without treating the adjusted
 * contract total as a new base line. The discount remains separate evidence. */
export function snowWorkflowLeadFields(quote: Pick<BookingPricingResult, "items" | "discountTotal">) {
  return {
    orderLineItems: quote.items.map(item => ({
      name: item.label.slice(0, 160),
      serviceCode: item.serviceCode,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.lineSubtotal,
      discountEligible: item.discountEligible !== false,
      metadata: { details: item.details || {}, laborMeta: item.laborMeta || null },
    })),
    bundleDiscountAmount: quote.discountTotal.toFixed(2),
  };
}
