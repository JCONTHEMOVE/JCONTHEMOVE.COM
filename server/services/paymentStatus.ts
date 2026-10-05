// Shared payment-status policy stays independent of database access.
import { pool } from "../db";
import { derivePaymentStatusFromRecord, makeStatus, type PaymentStatus } from "./paymentStatusPolicy";
export { derivePaymentStatusFromRecord, makeStatus, type PaymentStatus, type PaymentStatusKey } from "./paymentStatusPolicy";

/** Loads the latest known payment status for a leads-row job. Wraps the
 *  raw DB shape so callers don't sprinkle column names everywhere. The
 *  payment_plan / payment_paid_at columns are added at boot via the
 *  self-healing migration in server/index.ts so a fresh deploy never
 *  500's on this query. */
export async function deriveLeadPaymentStatus(leadId: string): Promise<PaymentStatus> {
  try {
    const { rows } = await pool.query<{
      deposit_required: boolean | null;
      deposit_paid: boolean | null;
      payment_plan: string | null;
      payment_paid_at: Date | null;
      status: string | null;
    }>(
      `SELECT
          deposit_required,
          deposit_paid,
          payment_plan,
          payment_paid_at,
          status
         FROM leads
        WHERE id = $1
        LIMIT 1`,
      [leadId],
    );
    if (rows.length === 0) return makeStatus("unknown");
    const r = rows[0];

    return derivePaymentStatusFromRecord({
      depositRequired: r.deposit_required,
      depositPaid: r.deposit_paid,
      paymentPlan: r.payment_plan,
      paymentPaidAt: r.payment_paid_at,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[paymentStatus] derive failed:", e instanceof Error ? e.message : e);
    return makeStatus("unknown");
  }
}
