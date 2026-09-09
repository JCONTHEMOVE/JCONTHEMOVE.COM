import { createHash, randomUUID } from 'node:crypto';
import type { InsertSquareInvoice, SquareInvoice } from '@shared/schema';

export function squareInvoiceRequestKeys(key: string = randomUUID()) {
  const digest = createHash('sha256').update(key).digest('hex');
  return { customer: `customer-${digest}`, order: `order-${digest}`, invoice: `invoice-${digest}`, publish: `publish-${digest}` };
}

/** A provider success can precede local persistence or response failure.
 * Reuse the unique provider invoice record without resetting paid status. */
export async function persistSquareInvoiceOnce(input: InsertSquareInvoice, dependencies: {
  find(id: string): Promise<SquareInvoice | undefined>;
  create(input: InsertSquareInvoice): Promise<SquareInvoice>;
}) {
  if (!input.squareInvoiceId) throw new Error('Provider invoice ID is required');
  const validate = (existing: SquareInvoice) => {
    for (const field of ['leadId', 'squareOrderId', 'currency', 'quoteRevisionId', 'closeoutId'] as const) {
      if ((existing[field] ?? null) !== (input[field] ?? null)) throw new Error('Square invoice retry binding requires reconciliation');
    }
    if (Number(existing.amount) !== Number(input.amount)) throw new Error('Square invoice retry amount requires reconciliation');
    return existing;
  };
  const existing = await dependencies.find(input.squareInvoiceId);
  if (existing) return validate(existing);
  try { return await dependencies.create(input); }
  catch (error) {
    const concurrent = await dependencies.find(input.squareInvoiceId);
    if (concurrent) return validate(concurrent);
    throw error;
  }
}
