/** Presentation hint only; the approval transaction revalidates all evidence. */
export function canRetryCloseoutInvoice(closeout: { status?: unknown; customer_approved_at?: unknown }) {
  return process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true'
    && closeout.status === 'approved' && Boolean(closeout.customer_approved_at);
}
