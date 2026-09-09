import assert from 'node:assert/strict';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { pool } from '../server/db';
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from '../server/services/jobPaymentLedger';
import { recordConfirmedJobRefund } from '../server/services/jobPaymentRefunds';
import { recordSquareInvoiceCancellation } from '../server/services/squareInvoiceCancellation';
import { enqueueInvoiceReconciliationBacklog } from '../server/services/jobInvoiceReconciliationQueue';
import { processOneJobInvoiceReconciliation, type InvoiceReconciliationProvider } from '../server/services/jobInvoiceReconciliationWorker';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const priorQuery = pool.query, priorConnect = pool.connect;
const flags = ['JOB_PAYMENT_LEDGER_ENABLED','JOB_INVOICE_RECONCILIATION_ENABLED','JOB_PAYMENT_REWARDS_ENABLED',
  'SQUARE_JOB_PAYMENT_LEDGER_ENABLED','SQUARE_ENVIRONMENT','SQUARE_PRODUCTION_ACCESS_TOKEN','SQUARE_PRODUCTION_LOCATION_ID','NODE_ENV'] as const;
const previous = flags.map(flag => process.env[flag]);
pool.query = ((sql: string, args?: unknown[]) => database.query(sql, args)) as typeof pool.query;
pool.connect = (async () => ({ query: pool.query, release() {} })) as typeof pool.connect;
process.env.JOB_PAYMENT_LEDGER_ENABLED = 'true';
process.env.JOB_INVOICE_RECONCILIATION_ENABLED = 'true';
process.env.JOB_PAYMENT_REWARDS_ENABLED = 'false';
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Worker test must not contact a provider'); };
try {
  await database.exec(`CREATE TABLE leads(id varchar PRIMARY KEY,total_price numeric,status text,payment_paid_at timestamptz);
    CREATE TABLE quote_revisions(id varchar PRIMARY KEY,lead_id varchar,revision int,status text,approved_at timestamptz,customer_total numeric,currency text);
    CREATE TABLE job_closeouts(id varchar PRIMARY KEY,lead_id varchar,status text,customer_approved_at timestamptz,pricing_snapshot jsonb);
    CREATE TABLE square_invoices(square_invoice_id varchar PRIMARY KEY,lead_id varchar,square_order_id varchar,amount numeric,currency text,
      quote_revision_id varchar,closeout_id varchar,status text,purpose text,updated_at timestamptz);
    INSERT INTO leads VALUES('job',120,'completed',NULL);
    INSERT INTO quote_revisions VALUES('quote','job',1,'approved',NOW(),120,'USD');
    INSERT INTO job_closeouts VALUES('closeout','job','approved',NOW(),'{"finalQuoteRevisionId":"quote"}');
    INSERT INTO square_invoices VALUES('invoice','job','final-order',90,'USD','quote','closeout','sent','final_balance',NOW());
    ALTER TABLE square_invoices ADD COLUMN id varchar DEFAULT 'local';`);
  await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  const pay = (id: string, amount: number, order = 'other-order') => confirmJobPayment({
    provider:'square:production',providerPaymentId:id,leadId:'job',quoteRevisionId:'quote',amountCents:amount,
    currency:'USD',tenderType:'card',giftFundedCents:0,paidAt:'2026-09-09T12:00:00Z',metadata:{squareOrderId:order},
  });
  let status = 'UNPAID', cancels = 0, inspectHook: (() => Promise<void>) | undefined;
  const api: InvoiceReconciliationProvider = {
    inspect: async () => {
      const hook = inspectHook; inspectHook = undefined; await hook?.();
      return { id:'invoice',orderId:'final-order',amountCents:9000,currency:'USD',status };
    },
    cancel: async id => { cancels++; status='CANCELED'; await recordSquareInvoiceCancellation(id); },
  };
  const reset = async () => {
    await database.exec(`DELETE FROM job_confirmed_refunds; DELETE FROM job_confirmed_payments;
      DELETE FROM job_invoice_reconciliation_queue; UPDATE leads SET payment_paid_at=NULL;
      UPDATE square_invoices SET status='sent';`);
    status='UNPAID'; cancels=0; inspectHook=undefined;
    await pay('deposit',3000);
  };
  await reset();
  await database.exec('DELETE FROM job_invoice_reconciliation_queue');
  assert.equal(await enqueueInvoiceReconciliationBacklog(),1);
  assert.equal(await enqueueInvoiceReconciliationBacklog(),0);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,0);
  assert.equal(await enqueueInvoiceReconciliationBacklog(),1, 'periodic scan revisits a still-collectible invoice');
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done');
  await pay('late-payment',9000);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,1);
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status,'canceled');
  await reset(); await pay('own-payment',9000,'final-order'); status='PAID';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,0);
  await reset(); await pay('own-partial',2000,'final-order'); status='PARTIALLY_PAID';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,0);
  await pay('other-partial',1000);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,1);
  await reset(); inspectHook=async () => { await pay('during-inspection',9000); };
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry'); assert.equal(cancels,0);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,1);
  await reset(); status='PAID';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry'); assert.equal(cancels,0);
  await reset();
  await recordConfirmedJobRefund({provider:'square:production',providerPaymentId:'deposit',providerRefundId:'refund',
    amountCents:100,giftFundedCents:0,currency:'USD',refundedAt:'2026-09-09T13:00:00Z'});
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry'); assert.equal(cancels,0);
  await reset(); status='CANCELED';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done');
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status,'canceled');
  // Run the default provider adapter and actual installed SDK with intercepted
  // HTTP, including identity/location checks and the real cancellation helper.
  process.env.SQUARE_JOB_PAYMENT_LEDGER_ENABLED='true'; process.env.SQUARE_ENVIRONMENT='production';
  process.env.SQUARE_PRODUCTION_ACCESS_TOKEN='synthetic-worker-token';
  process.env.SQUARE_PRODUCTION_LOCATION_ID='location'; process.env.NODE_ENV='production';
  let remoteStatus='UNPAID', remoteLocation='location';
  let requests: string[]=[];
  globalThis.fetch=async (input,init) => {
    const url=input instanceof Request ? input.url : String(input);
    const method=init?.method || (input instanceof Request ? input.method : 'GET');
    const headers=new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    assert.equal(headers.get('authorization'),'Bearer synthetic-worker-token');
    requests.push(`${method} ${url}`);
    let body: unknown;
    if(method==='GET' && url==='https://connect.squareup.com/v2/invoices/invoice') {
      body={invoice:{id:'invoice',order_id:'final-order',location_id:remoteLocation,status:remoteStatus,version:1}};
    } else if(method==='GET' && url==='https://connect.squareup.com/v2/orders/final-order') {
      body={order:{id:'final-order',location_id:'location',total_money:{amount:9000,currency:'USD'},total_tip_money:{amount:0,currency:'USD'}}};
    } else if(method==='POST' && url==='https://connect.squareup.com/v2/invoices/invoice/cancel') {
      assert.equal(JSON.parse(String(init?.body)).version,1); remoteStatus='CANCELED';
      body={invoice:{id:'invoice',status:remoteStatus,version:2}};
    } else throw new Error('Unexpected SDK request');
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  await reset(); await pay('sdk-late',9000);
  assert.equal((await processOneJobInvoiceReconciliation()).status,'done');
  assert.ok(requests.includes('POST https://connect.squareup.com/v2/invoices/invoice/cancel'));
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status,'canceled');
  await reset(); await pay('sdk-wrong-location',9000); remoteStatus='UNPAID'; remoteLocation='other-location'; requests=[];
  assert.equal((await processOneJobInvoiceReconciliation()).status,'retry');
  assert.ok(requests.every(request=>request.startsWith('GET ')));
  console.log('PASS: default worker uses the actual Square SDK with intercepted invoice/order/cancel HTTP and rejects another location');
  process.env.JOB_INVOICE_RECONCILIATION_ENABLED='false';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'disabled');
  console.log('PASS: actual worker cancels excess invoices, distinguishes own-order payments, retains changes during inspection and retries unverified paid/refunded cases');
} finally {
  pool.query=priorQuery; pool.connect=priorConnect; globalThis.fetch=previousFetch;
  flags.forEach((flag,index) => { if(previous[index]===undefined) delete process.env[flag]; else process.env[flag]=previous[index]; });
  await database.close();
}
