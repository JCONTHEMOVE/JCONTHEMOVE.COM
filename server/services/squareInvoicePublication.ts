import { pool } from '../db';
import { enqueueJobInvoiceReconciliation } from './jobInvoiceReconciliationQueue';

// A payment/cancellation webhook may commit between provider publication and
// this acknowledgement. Only advance a draft; never regress a newer status.
export const SQUARE_INVOICE_PUBLICATION_SQL = `UPDATE square_invoices SET
  status=CASE WHEN status='draft' THEN 'sent' ELSE status END,
  invoice_url=COALESCE($2,invoice_url),
  square_invoice_number=COALESCE($3,square_invoice_number),
  sent_at=COALESCE(sent_at,NOW()),updated_at=NOW()
  WHERE square_invoice_id=$1 RETURNING id,lead_id,purpose`;

export async function recordSquareInvoicePublication(input: {
  squareInvoiceId: string;
  invoiceUrl?: string | null;
  invoiceNumber?: string | null;
}) {
  const transaction = process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true' ? await pool.connect() : null;
  try {
    if (transaction) await transaction.query('BEGIN');
    const result = await (transaction || pool).query(SQUARE_INVOICE_PUBLICATION_SQL,
      [input.squareInvoiceId, input.invoiceUrl || null, input.invoiceNumber || null]);
    if (result.rows.length !== 1) throw new Error('Published Square invoice is missing its local recovery record');
    const invoice = result.rows[0];
    if (transaction && invoice.lead_id && invoice.purpose === 'final_balance') {
      await enqueueJobInvoiceReconciliation(transaction, invoice.lead_id);
    }
    if (transaction) await transaction.query('COMMIT');
  } catch (error) {
    if (transaction) await transaction.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { transaction?.release(); }
}
