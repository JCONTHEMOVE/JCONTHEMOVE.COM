import assert from 'node:assert/strict';
import type { SquareClient } from 'square';
import type { Lead, SquareInvoice } from '@shared/schema';
import { SquareInvoiceService } from '../server/services/square-invoice';

/** Invoked only by the disposable quote-approval harness's explicit diagnostic flag.
 * Success means the defect was reproduced. It does NOT mean invoices are safe to release.
 */
export async function reproduceLateFinalInvoice(input: {
  approval: { balanceDue: number; invoiceDueDate: string; invoiceRequestKey: string; quoteRevisionId: string };
  recordLatePayment: () => Promise<unknown>;
  paidCents: () => Promise<number>;
}) {
  let invoiceCents = 0;
  let published = false;
  let saved: Partial<SquareInvoice> | undefined;
  const client = {
    customers: { search: async () => ({ customers: [{ id: 'synthetic-customer' }] }) },
    orders: { create: async (request: { order: { lineItems: { basePriceMoney: { amount: bigint } }[] } }) => {
      invoiceCents = Number(request.order.lineItems[0].basePriceMoney.amount);
      return { order: { id: 'synthetic-order' } };
    } },
    invoices: {
      create: async () => {
        // A different invoice's payment commits after this order's amount was chosen.
        await input.recordLatePayment();
        return { invoice: { id: 'synthetic-final-invoice', version: 0 } };
      },
      publish: async () => {
        assert.equal(await input.paidCents(), 12000, 'job is fully funded before publication');
        published = true;
        return { invoice: { id: 'synthetic-final-invoice', version: 1, publicUrl: 'https://example.invalid/invoice' } };
      },
    },
  } as unknown as SquareClient;
  const service = new SquareInvoiceService({ getClient: async () => client,
    recordPublication: async () => {
      assert.ok(saved, 'provider identity must already be saved before publication acknowledgement');
      saved.status = 'sent';
    },
    getLocationId: () => 'synthetic-location', invoiceStore: {
      getSquareInvoiceBySquareId: async () => undefined,
      createSquareInvoice: async data => {
        saved = data;
        return { ...data, id: 'synthetic-local-invoice' } as SquareInvoice;
      },
    } });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Diagnostic must not contact a live provider'); };
  try {
    await service.createInvoiceForLead({ id: 'closeout-job', firstName: 'Synthetic', lastName: 'Customer',
      email: 'synthetic@example.invalid', phone: null, serviceType: 'moving' } as Lead,
    input.approval.balanceDue, 'Synthetic final balance', input.approval.invoiceDueDate, 'none',
    { purpose: 'final_balance', closeoutId: 'closeout', quoteRevisionId: input.approval.quoteRevisionId,
      idempotencyKey: input.approval.invoiceRequestKey });
    assert.equal(published, true);
    assert.equal(invoiceCents, 9000);
    assert.equal(Number(saved?.amount), 90);
    console.log('REPRODUCED OPEN RELEASE BLOCKER: $120 job fully funded before publication still publishes/persists a $90 final invoice. Simulated provider; no live invoice.');
  } finally { globalThis.fetch = previousFetch; }
}
