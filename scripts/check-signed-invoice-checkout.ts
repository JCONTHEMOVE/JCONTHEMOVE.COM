import assert from 'node:assert/strict';
import { storage } from '../server/storage';

/** Real signed handler, event/invoice claims and checkout SQL. Invoice storage is
 * a fixture adapter; no lead, wallet grant or provider mutation is configured. */
export async function checkSignedInvoiceCheckout(database: {
  exec(sql: string): Promise<unknown>;
  query(sql: string, args?: unknown[]): Promise<{ rows: any[] }>;
}, send: (body: string, signature?: string) => Promise<Response>) {
  const original = { getSquareInvoiceBySquareId: storage.getSquareInvoiceBySquareId,
    updateSquareInvoiceStatus: storage.updateSquareInvoiceStatus };
  let lookups = 0, updates = 0;
  try {
    await database.exec(`CREATE TABLE square_invoice_payment_effects(square_invoice_id text PRIMARY KEY,
      event_id text,status text,claim_token uuid,started_at timestamptz DEFAULT NOW(),completed_at timestamptz,last_error text);
      CREATE TABLE wallet_credit_grants(square_invoice_id text,source_type text,source_id text);
      ALTER TABLE square_invoices ADD COLUMN paid_at timestamptz;
      INSERT INTO commerce_checkout_intents VALUES('checkout-invoice','pending',NULL,NULL);`);
    storage.getSquareInvoiceBySquareId = (async (id: string) => {
      lookups++;
      const row = (await database.query('SELECT * FROM square_invoices WHERE square_invoice_id=$1', [id])).rows[0];
      return row ? { squareInvoiceId: row.square_invoice_id, status: row.status,
        leadId: row.lead_id, squareOrderId: row.square_order_id } : undefined;
    }) as typeof storage.getSquareInvoiceBySquareId;
    storage.updateSquareInvoiceStatus = (async (id: string, status: string, paidAt?: Date) => {
      updates++;
      await database.query('UPDATE square_invoices SET status=$2,paid_at=COALESCE($3,paid_at) WHERE square_invoice_id=$1',
        [id, status, paidAt]);
      return storage.getSquareInvoiceBySquareId(id);
    }) as typeof storage.updateSquareInvoiceStatus;
    const event = (id: string, type: string, status: string) => JSON.stringify({ event_id: id, type,
      data: { object: { invoice: { id: 'checkout-invoice', status } } } });
    const checkout = async () => (await database.query("SELECT * FROM commerce_checkout_intents WHERE square_invoice_id='checkout-invoice'")).rows;
    const funding = async () => ({
      payments: (await database.query('SELECT * FROM job_confirmed_payments')).rows,
      wallets: (await database.query('SELECT * FROM wallet_accounts ORDER BY user_id')).rows,
      lead: (await database.query('SELECT * FROM leads')).rows,
    });
    const before = await funding();
    const partial = event('invoice-partial', 'invoice.payment_made', 'PARTIALLY_PAID');
    assert.equal((await send(partial, 'invalid')).status, 401);
    assert.equal((await send(partial)).status, 200);
    assert.equal(lookups, 0);
    assert.equal(updates, 0);
    assert.equal((await checkout())[0].status, 'pending');
    assert.equal((await database.query('SELECT * FROM square_invoice_payment_effects')).rows.length, 0);
    const paid = event('invoice-paid', 'invoice.payment_made', 'PAID');
    assert.equal((await send(paid)).status, 500, 'missing local invoice must remain retryable');
    assert.equal((await database.query("SELECT status FROM square_webhook_events WHERE event_id='invoice-paid'")).rows[0].status, 'failed');
    assert.equal((await database.query('SELECT status FROM square_invoice_payment_effects')).rows[0].status, 'failed');
    assert.equal((await checkout())[0].status, 'pending');
    await database.exec("INSERT INTO square_invoices(square_invoice_id,status) VALUES('checkout-invoice','sent')");
    assert.equal((await send(paid)).status, 200);
    assert.equal((await checkout())[0].status, 'paid');
    assert.equal((await database.query('SELECT status FROM square_invoice_payment_effects')).rows[0].status, 'processed');
    const saved = await checkout();
    const paidAt = (await database.query("SELECT paid_at FROM square_invoices WHERE square_invoice_id='checkout-invoice'")).rows;
    const calls = { lookups, updates };
    const replay = await send(paid);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).duplicate, true);
    const another = await send(event('invoice-paid-again', 'invoice.paid', 'PAID'));
    assert.equal(another.status, 200);
    assert.equal((await another.json()).duplicateInvoicePayment, true);
    assert.deepEqual({ lookups, updates }, calls);
    assert.deepEqual(await checkout(), saved);
    assert.deepEqual((await database.query("SELECT paid_at FROM square_invoices WHERE square_invoice_id='checkout-invoice'")).rows, paidAt);
    assert.deepEqual(await funding(), before);
    console.log('PASS: signed invoice partial gate, missing-invoice recovery, checkout completion and same/different-event replay without job funding or wallet effects');
  } finally {
    Object.assign(storage, original);
  }
}
