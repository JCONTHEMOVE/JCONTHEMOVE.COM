import type { SquarePaymentSnapshot } from "./squareJobPaymentPolicy";
import type { SquareRefundSnapshot } from "./squareJobRefundVerification";

export type SquareOrderBinding = { lead_id: string | null; quote_revision_id: string | null };

/** Called only after webhook signature verification. IDs select provider
 * records; webhook amount/status/order fields never establish settlement. */
export async function resolveSquareJobEvent(eventType: string, objectId: string, dependencies: {
  getPayment(id: string): Promise<SquarePaymentSnapshot | undefined>;
  getRefund(id: string): Promise<SquareRefundSnapshot | undefined>;
  findOrderBindings(orderId: string): Promise<SquareOrderBinding[]>;
}) {
  const isRefund = eventType === 'refund.updated';
  if (!isRefund && !['payment.created', 'payment.updated'].includes(eventType)) return { status: 'unsupported' as const };
  if (!objectId.trim()) throw new Error('Square object ID is required');
  let paymentId = objectId;
  if (isRefund) {
    const refund = await dependencies.getRefund(objectId);
    if (!refund || refund.id !== objectId) throw new Error('Square refund retrieval mismatch');
    if (refund.status !== 'COMPLETED') return { status: 'not_completed' as const };
    if (refund.unlinked || !refund.paymentId) return { status: 'unmapped' as const, reason: 'unlinked_refund' };
    paymentId = refund.paymentId;
  }
  const payment = await dependencies.getPayment(paymentId);
  if (!payment || payment.id !== paymentId) throw new Error('Square payment retrieval mismatch');
  if (payment.status !== 'COMPLETED') return { status: 'not_completed' as const };
  if (!payment.orderId) return { status: 'unmapped' as const, reason: 'missing_order' };
  const bindings = await dependencies.findOrderBindings(payment.orderId);
  if (!bindings.length) return { status: 'unmapped' as const, reason: 'missing_stored_order' };
  const jobs = bindings.filter(binding => binding.lead_id !== null);
  if (!jobs.length) return { status: 'unrelated' as const };
  const identities = new Set(jobs.map(binding => JSON.stringify([binding.lead_id, binding.quote_revision_id])));
  if (jobs.length !== bindings.length || identities.size !== 1 || !jobs[0].quote_revision_id) {
    throw new Error('Square job order association requires reconciliation');
  }
  return { status: 'job' as const, kind: isRefund ? 'refund' as const : 'payment' as const,
    objectId, paymentId, orderId: payment.orderId, leadId: jobs[0].lead_id!, quoteRevisionId: jobs[0].quote_revision_id };
}
