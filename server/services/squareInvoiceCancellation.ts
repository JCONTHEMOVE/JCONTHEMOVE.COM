import { pool } from '../db';

type InvoiceState = { id?: string | null; status?: string | null; version?: number | null };

export async function recordSquareInvoiceCancellation(squareInvoiceId: string) {
  const result = await pool.query(`UPDATE square_invoices SET status='canceled',updated_at=NOW()
    WHERE square_invoice_id=$1 AND status IN ('draft','sent','canceled') RETURNING id`, [squareInvoiceId]);
  if (result.rows.length !== 1) {
    throw new Error('Invoice cancellation requires local payment-state reconciliation');
  }
}

/** Re-read ambiguous provider results; never interpret a timeout as cancellation.
 * This cancels collection only. It does not refund any recorded payment. */
export async function cancelSquareInvoiceWithRecovery(id: string, dependencies: {
  get(): Promise<InvoiceState | null | undefined>;
  cancel(version: number): Promise<InvoiceState | null | undefined>;
  recordCanceled(): Promise<void>;
}) {
  const invoice = await dependencies.get();
  if (invoice?.id !== id) throw new Error('Square invoice identity requires reconciliation');
  if (invoice.status !== 'CANCELED') {
    if (!['SCHEDULED', 'UNPAID', 'PARTIALLY_PAID'].includes(invoice.status || '')) {
      throw new Error('Square invoice cannot be canceled in its current state; reconciliation required');
    }
    const version = invoice.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 2147483647) {
      throw new Error('Square invoice version is invalid');
    }
    try {
      const canceled = await dependencies.cancel(version);
      if (canceled?.id !== id || canceled.status !== 'CANCELED') throw new Error('Unconfirmed cancellation response');
    } catch {
      const recovered = await dependencies.get().catch(() => undefined);
      if (recovered?.id !== id || recovered.status !== 'CANCELED') {
        throw new Error('Square invoice cancellation could not be confirmed; retry reconciliation');
      }
    }
  }
  // A local failure is retried independently: the next provider read may already
  // be CANCELED. The local write must not overwrite a racing paid/refunded row.
  await dependencies.recordCanceled();
}
