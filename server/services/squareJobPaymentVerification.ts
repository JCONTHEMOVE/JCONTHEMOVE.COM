import { mapVerifiedSquareJobPayment, type SquarePaymentSnapshot } from "./squareJobPaymentPolicy";
import type { ConfirmedJobPayment } from "./jobPaymentLedgerPolicy";

export interface SquareJobPaymentVerificationDependencies<Result> {
  getPayment(paymentId: string): Promise<SquarePaymentSnapshot | undefined>;
  findJobQuotes(orderId: string): Promise<Array<{ lead_id: string; quote_revision_id: string }>>;
  confirm(payment: ConfirmedJobPayment): Promise<Result>;
}

/** Shared orchestration for the production adapter and isolated verification.
 * Only the payment ID is accepted from the event; every settlement field is
 * obtained from GetPayment and the stored order/quote association. */
export async function verifyAndConfirmSquarePayment<Result>(
  paymentId: string,
  context: { locationId: string; environment: "sandbox" | "production" },
  dependencies: SquareJobPaymentVerificationDependencies<Result>,
): Promise<Result> {
  if (!paymentId?.trim() || !context.locationId?.trim()) throw new Error("Payment ID and configured location are required");
  const payment = await dependencies.getPayment(paymentId);
  if (!payment?.orderId) throw new Error("Square payment has no verified order");
  const invoices = await dependencies.findJobQuotes(payment.orderId);
  if (invoices.length !== 1) throw new Error("Square order must map to exactly one job and approved quote");
  const confirmed = mapVerifiedSquareJobPayment(payment, {
    paymentId, orderId: payment.orderId, ...context,
    leadId: invoices[0].lead_id, quoteRevisionId: invoices[0].quote_revision_id,
  });
  return dependencies.confirm(confirmed);
}
