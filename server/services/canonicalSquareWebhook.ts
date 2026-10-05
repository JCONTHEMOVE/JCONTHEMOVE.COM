import { resolveCanonicalSquareEvent, confirmSquareJobPayment, recordSquareJobRefund } from "./squareJobPaymentAdapter";

export async function processCanonicalSquareWebhook(eventType: string, objectId: string | null, dependencies = {
  resolve: resolveCanonicalSquareEvent, confirm: confirmSquareJobPayment, refund: recordSquareJobRefund,
}) {
  if (process.env.JOB_PAYMENT_LEDGER_ENABLED !== 'true'
      || process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED !== 'true'
      || !['payment.created', 'payment.updated', 'refund.updated'].includes(eventType)) return;
  if (!objectId) throw new Error('Canonical Square event requires an object ID');
  const resolved = await dependencies.resolve(eventType, objectId);
  if (resolved.status === 'unmapped') throw new Error(`Canonical Square event requires reconciliation: ${resolved.reason}`);
  if (resolved.status !== 'job') return;
  if (resolved.kind === 'refund') await dependencies.refund(resolved.objectId);
  else await dependencies.confirm(resolved.paymentId);
}
