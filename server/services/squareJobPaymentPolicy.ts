import { validateConfirmedJobPayment, type ConfirmedJobPayment } from "./jobPaymentLedgerPolicy";

// Shape returned by the installed Square SDK's GetPayment, not webhook JSON.
export interface SquarePaymentSnapshot {
  id?: string; status?: string; orderId?: string; locationId?: string; sourceType?: string;
  amountMoney?: { amount?: bigint | number | null; currency?: string };
  tipMoney?: { amount?: bigint | number | null; currency?: string };
  refundedMoney?: { amount?: bigint | number | null; currency?: string };
  refundIds?: string[];
  updatedAt?: string;
  cardDetails?: { card?: { cardBrand?: string }; cardPaymentTimeline?: { capturedAt?: string | null } };
}

export function mapVerifiedSquareJobPayment(payment: SquarePaymentSnapshot, context: {
  paymentId: string; orderId: string; locationId: string;
  leadId: string; quoteRevisionId: string; environment: "sandbox" | "production";
  refundCatchUp?: boolean;
}): ConfirmedJobPayment {
  if (payment.id !== context.paymentId || !context.paymentId) throw new Error("Square payment ID mismatch");
  if (payment.status !== "COMPLETED") throw new Error("Square payment is not completed");
  if (!context.orderId || payment.orderId !== context.orderId) throw new Error("Square order mismatch");
  if (!context.locationId || payment.locationId !== context.locationId) throw new Error("Square location mismatch");
  if (payment.sourceType !== "CARD") throw new Error("This adapter only supports verified Square card payments");
  const brand = payment.cardDetails?.card?.cardBrand;
  if (!brand || brand === "UNKNOWN") throw new Error("Square card funding type is unknown");
  if (!context.refundCatchUp && (Number(payment.refundedMoney?.amount || 0) !== 0 || payment.refundIds?.length)) {
    throw new Error("Refunded Square payment requires refund reconciliation");
  }
  if (context.refundCatchUp && (!payment.cardDetails?.cardPaymentTimeline?.capturedAt
      || Number(payment.tipMoney?.amount || 0) !== 0)) {
    throw new Error("Refund catch-up requires a capture timestamp and explicit tip allocation for tipped payments");
  }
  if (payment.amountMoney?.currency !== "USD") throw new Error("Square payment is not USD");
  const amountCents = Number(payment.amountMoney.amount);
  const result: ConfirmedJobPayment = {
    provider: `square:${context.environment}`,
    providerPaymentId: context.paymentId,
    leadId: context.leadId,
    quoteRevisionId: context.quoteRevisionId,
    amountCents,
    currency: "USD",
    tenderType: brand === "SQUARE_GIFT_CARD" ? "gift_card" : "card",
    giftFundedCents: brand === "SQUARE_GIFT_CARD" ? amountCents : 0,
    paidAt: payment.cardDetails?.cardPaymentTimeline?.capturedAt || payment.updatedAt || "",
    metadata: { squareOrderId: context.orderId, squareLocationId: context.locationId,
      environment: context.environment, verifiedBy: "Square GetPayment" },
  };
  validateConfirmedJobPayment(result);
  return result;
}
