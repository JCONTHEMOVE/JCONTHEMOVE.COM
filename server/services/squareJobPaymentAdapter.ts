import { pool } from "../db";
import { confirmJobPayment } from "./jobPaymentLedger";
import { verifyAndConfirmSquarePayment } from "./squareJobPaymentVerification";
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
  return verifyAndConfirmSquarePayment(paymentId, { locationId, environment }, {
    getPayment: async (id) => (await client.payments.get({ paymentId: id })).payment,
    findJobQuotes: async (orderId) => {
      const { rows } = await pool.query<{ lead_id: string; quote_revision_id: string }>(
        `SELECT DISTINCT lead_id,quote_revision_id FROM square_invoices
          WHERE square_order_id=$1 AND lead_id IS NOT NULL AND quote_revision_id IS NOT NULL`, [orderId]);
      return rows;
    },
    confirm: confirmJobPayment,
  });
}
