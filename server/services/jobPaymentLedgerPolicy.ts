export interface ConfirmedJobPayment {
  provider: string;
  providerPaymentId: string;
  leadId: string;
  quoteRevisionId: string;
  amountCents: number;
  currency: "USD";
  tenderType: string;
  giftFundedCents: number;
  paidAt: string;
  metadata?: Record<string, unknown>;
}

export function validateConfirmedJobPayment(payment: ConfirmedJobPayment): void {
  for (const key of ["provider", "providerPaymentId", "leadId", "quoteRevisionId", "tenderType"] as const) {
    if (typeof payment[key] !== "string" || !payment[key].trim() || payment[key].length > 255) {
      throw new Error(`Invalid payment ${key}`);
    }
  }
  if (payment.currency !== "USD") throw new Error("Only USD job settlement is supported");
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
    throw new Error("Payment amount must be positive integer cents");
  }
  if (!Number.isSafeInteger(payment.giftFundedCents) || payment.giftFundedCents < 0
      || payment.giftFundedCents > payment.amountCents) throw new Error("Invalid gift-funded amount");
  if (typeof payment.paidAt !== "string" || !Number.isFinite(Date.parse(payment.paidAt))) {
    throw new Error("A verified payment timestamp is required");
  }
  if (payment.metadata !== undefined && (payment.metadata === null || Array.isArray(payment.metadata)
      || typeof payment.metadata !== "object" || Buffer.byteLength(JSON.stringify(payment.metadata), "utf8") > 8192)) {
    throw new Error("Payment metadata must be an object no larger than 8 KB");
  }
}

export function reconcileJobPaymentTotals(totalCents: number, paidCents: number, giftCents: number) {
  if (![totalCents, paidCents, giftCents].every(Number.isSafeInteger)
      || totalCents <= 0 || paidCents < 0 || giftCents < 0 || giftCents > paidCents) {
    throw new Error("Invalid job settlement totals");
  }
  return {
    paidInFull: paidCents >= totalCents,
    outstandingCents: Math.max(0, totalCents - paidCents),
    overpaidCents: Math.max(0, paidCents - totalCents),
    // Exclude gift-funded dollars without converting overpayment into rewards.
    customerEligibleCents: Math.max(0, Math.min(totalCents, paidCents) - Math.min(totalCents, giftCents)),
  };
}
