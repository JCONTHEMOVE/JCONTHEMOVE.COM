import { mapVerifiedSquareJobPayment, type SquarePaymentSnapshot } from "./squareJobPaymentPolicy";
import type { ConfirmedJobPayment } from "./jobPaymentLedgerPolicy";
import type { ConfirmedJobRefund } from "./jobPaymentRefunds";

export interface SquareRefundSnapshot {
  id: string; status?: string | null; paymentId?: string | null;
  locationId?: string | null; unlinked?: boolean; updatedAt?: string;
  amountMoney: { amount?: bigint | number | null; currency?: string };
}

/** Event payload supplies only an ID. Verify both provider records before
 * atomically recording the original payment and completed refund. */
export async function verifyAndRecordSquareRefund<Result>(refundId: string,
  context: { locationId: string; environment: "sandbox" | "production" },
  dependencies: {
    getRefund(id: string): Promise<SquareRefundSnapshot | undefined>;
    getPayment(id: string): Promise<SquarePaymentSnapshot | undefined>;
    findJobQuotes(orderId: string): Promise<Array<{ lead_id: string; quote_revision_id: string }>>;
    record(payment: ConfirmedJobPayment, refund: ConfirmedJobRefund): Promise<Result>;
  }): Promise<Result> {
  if (!refundId?.trim() || !context.locationId?.trim()) throw new Error("Refund ID and configured location are required");
  const refund = await dependencies.getRefund(refundId);
  if (!refund || refund.id !== refundId || refund.status !== "COMPLETED"
      || refund.unlinked || !refund.paymentId || refund.locationId !== context.locationId) {
    throw new Error("Square refund must be completed and linked at the configured location");
  }
  const amountCents = Number(refund.amountMoney?.amount);
  if (refund.amountMoney?.currency !== "USD" || !Number.isSafeInteger(amountCents) || amountCents <= 0
      || !refund.updatedAt || !Number.isFinite(Date.parse(refund.updatedAt))) {
    throw new Error("Invalid Square refund amount, currency or timestamp");
  }
  const payment = await dependencies.getPayment(refund.paymentId);
  if (!payment?.orderId) throw new Error("Square payment has no verified order");
  const bindings = await dependencies.findJobQuotes(payment.orderId);
  if (bindings.length !== 1) throw new Error("Square order must map to exactly one job and approved quote");
  const original = mapVerifiedSquareJobPayment(payment, { ...context, paymentId: refund.paymentId,
    orderId: payment.orderId, leadId: bindings[0].lead_id, quoteRevisionId: bindings[0].quote_revision_id,
    refundCatchUp: true });
  if (amountCents > original.amountCents) throw new Error("Refund exceeds original principal");
  return dependencies.record(original, { provider: original.provider, providerPaymentId: original.providerPaymentId,
    providerRefundId: refundId, amountCents, currency: "USD", refundedAt: refund.updatedAt,
    // Refund destination can differ from the original funding source.
    giftFundedCents: original.tenderType === "gift_card" ? amountCents : 0 });
}
