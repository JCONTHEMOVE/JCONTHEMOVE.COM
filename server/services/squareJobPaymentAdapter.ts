import { pool } from "../db";
import { confirmJobPayment } from "./jobPaymentLedger";
import { mapVerifiedSquareJobPayment } from "./squareJobPaymentPolicy";
import { getSquareAccessToken, getSquareEnvironment, getSquareLocationId } from "./squareConfig";

/** Disabled and not routed. Accept only an ID from a verified server event;
 * retrieve authoritative payment details before deriving any ledger fields. */
export async function confirmSquareJobPayment(paymentId: string) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true"
      || process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED !== "true") {
    throw new Error("Square canonical payment adapter is disabled");
  }
  if (!paymentId?.trim()) throw new Error("Square payment ID is required");
  const token = getSquareAccessToken();
  const locationId = getSquareLocationId();
  const environment = getSquareEnvironment();
  if (!token || !locationId) throw new Error("Square environment credentials and location are required");
  if (process.env.NODE_ENV === "production" && environment !== "production") {
    throw new Error("Sandbox payments cannot settle production jobs");
  }
  const { SquareClient, SquareEnvironment } = await import("square");
  const client = new SquareClient({ token, environment: environment === "production"
    ? SquareEnvironment.Production : SquareEnvironment.Sandbox });
  const { payment } = await client.payments.get({ paymentId });
  if (!payment?.orderId) throw new Error("Square payment has no verified order");
  const { rows: invoices } = await pool.query<{ lead_id: string; quote_revision_id: string }>(
    `SELECT DISTINCT lead_id,quote_revision_id FROM square_invoices
      WHERE square_order_id=$1 AND lead_id IS NOT NULL AND quote_revision_id IS NOT NULL`,
    [payment.orderId],
  );
  if (invoices.length !== 1) throw new Error("Square order must map to exactly one job and approved quote");
  return confirmJobPayment(mapVerifiedSquareJobPayment(payment, {
    paymentId, orderId: payment.orderId, locationId, environment,
    leadId: invoices[0].lead_id, quoteRevisionId: invoices[0].quote_revision_id,
  }));
}
