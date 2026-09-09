import { pool } from "../db";
import { confirmJobPayment } from "./jobPaymentLedger";
import { verifyAndConfirmSquarePayment } from "./squareJobPaymentVerification";
import { verifyAndRecordSquareRefund } from "./squareJobRefundVerification";
import { recordConfirmedPaymentAndRefund } from "./jobPaymentRefunds";
import { resolveSquareJobEvent, type SquareOrderBinding } from "./squareJobEventRouting";
import { getSquareAccessToken, getSquareEnvironment, getSquareLocationId } from "./squareConfig";

/** Disabled and not routed. Accept only an ID from a verified server event;
 * retrieve authoritative payment details before deriving any ledger fields. */
async function getLedgerClient() {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== "true"
      || process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED !== "true") {
    throw new Error("Square canonical payment adapter is disabled");
  }
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
  return { client, locationId, environment };
}

async function findJobQuotes(orderId: string) {
  const { rows } = await pool.query<{ lead_id: string; quote_revision_id: string }>(
    `SELECT DISTINCT lead_id,quote_revision_id FROM square_invoices
      WHERE square_order_id=$1 AND lead_id IS NOT NULL AND quote_revision_id IS NOT NULL`, [orderId]);
  return rows;
}

/** Staged routing entrypoint, not yet registered in the shared webhook.
 * Unmapped events require a durable review/retry decision by that handler. */
export async function resolveCanonicalSquareEvent(eventType: string, objectId: string) {
  const { client } = await getLedgerClient();
  return resolveSquareJobEvent(eventType, objectId, {
    getPayment: async id => (await client.payments.get({ paymentId: id })).payment,
    getRefund: async id => (await client.refunds.get({ refundId: id })).refund,
    findOrderBindings: async orderId => (await pool.query<SquareOrderBinding>(
      'SELECT lead_id,quote_revision_id FROM square_invoices WHERE square_order_id=$1', [orderId])).rows,
  });
}

export async function confirmSquareJobPayment(paymentId: string) {
  const { client, locationId, environment } = await getLedgerClient();
  return verifyAndConfirmSquarePayment(paymentId, { locationId, environment }, {
    getPayment: async (id) => (await client.payments.get({ paymentId: id })).payment,
    findJobQuotes,
    confirm: confirmJobPayment,
  });
}

/** Disabled and unrouted, like the payment adapter. Never requests a refund. */
export async function recordSquareJobRefund(refundId: string) {
  const { client, locationId, environment } = await getLedgerClient();
  return verifyAndRecordSquareRefund(refundId, { locationId, environment }, {
    getRefund: async (id) => (await client.refunds.get({ refundId: id })).refund,
    getPayment: async (id) => (await client.payments.get({ paymentId: id })).payment,
    findJobQuotes,
    record: recordConfirmedPaymentAndRefund,
  });
}
