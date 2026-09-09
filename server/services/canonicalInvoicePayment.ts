import { pool } from "../db";
import { getJobPaymentReconciliation } from "./jobPaymentReconciliation";
import { classifyJobInvoicePayment } from "./jobPaymentClassification";

/** Invoice events may arrive before their payment events. Keep them retryable
 * until the invoice's own stored order is represented in the verified ledger. */
export async function classifyCanonicalInvoicePayment(input: {
  leadId: string; orderId: string | null | undefined; invoiceAmount: number;
  depositRequired?: boolean | null; depositAmount?: unknown;
}) {
  if (!input.orderId || !Number.isFinite(input.invoiceAmount) || input.invoiceAmount <= 0) {
    throw new Error("Canonical invoice requires a stored order and positive amount");
  }
  const report = await getJobPaymentReconciliation(input.leadId);
  if (!report?.enabled || !report.totals || report.approvedTotalCents === null
      || report.reviewReasons.some(reason => ['missing_approved_usd_quote', 'quote_total_mismatch', 'refund_requires_review'].includes(reason))) {
    throw new Error("Canonical invoice requires payment reconciliation");
  }
  const { rows } = await pool.query<{ paid: string }>(
    `SELECT COALESCE(SUM(amount_cents),0)::text AS paid FROM job_confirmed_payments
     WHERE lead_id=$1 AND metadata->>'squareOrderId'=$2 AND provider IN ('square:production','square:sandbox')`,
    [input.leadId, input.orderId],
  );
  const orderPaid = Number(rows[0].paid);
  if (!Number.isSafeInteger(orderPaid) || orderPaid < Math.round(input.invoiceAmount * 100)) {
    throw new Error("Canonical invoice is waiting for verified order payments");
  }
  // Classify cumulative verified funding, never the invoice's paid label.
  const classification = classifyJobInvoicePayment({
    invoiceAmount: report.paidCents / 100, jobTotal: report.approvedTotalCents / 100,
    depositRequired: input.depositRequired, depositAmount: input.depositAmount,
    depositAlreadyPaid: false,
  });
  return { ...classification, invoiceAmount: input.invoiceAmount };
}
