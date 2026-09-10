import assert from 'node:assert/strict';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import { pool } from '../server/db';
import { confirmJobPayment, JOB_PAYMENT_LEDGER_SCHEMA } from '../server/services/jobPaymentLedger';
import { recordConfirmedJobRefund } from '../server/services/jobPaymentRefunds';
import { recordSquareInvoiceCancellation } from '../server/services/squareInvoiceCancellation';
import { enqueueInvoiceReconciliationBacklog } from '../server/services/jobInvoiceReconciliationQueue';
import { attachCanonicalFinalInvoice } from '../server/services/reconciledCloseout';
import { processOneJobInvoiceReconciliation, type InvoiceReconciliationProvider } from '../server/services/jobInvoiceReconciliationWorker';

const database = await createDisposableLedgerDatabase(process.argv[2]);
const priorQuery = pool.query, priorConnect = pool.connect;
const flags = ['JOB_PAYMENT_LEDGER_ENABLED','JOB_INVOICE_RECONCILIATION_ENABLED','JOB_PAYMENT_REWARDS_ENABLED',
  'SQUARE_JOB_PAYMENT_LEDGER_ENABLED','SQUARE_ENVIRONMENT','SQUARE_PRODUCTION_ACCESS_TOKEN','SQUARE_PRODUCTION_LOCATION_ID','NODE_ENV'] as const;
const previous = flags.map(flag => process.env[flag]);
let failFinalization = false;
let failNotification = false;
pool.query = ((sql: string, args?: unknown[]) => {
  if (failFinalization && sql.includes('UPDATE leads SET closeout_status')) throw new Error('Injected financial closeout failure');
  if (failNotification && sql.includes('INSERT INTO job_financial_notifications')) throw new Error('Injected notification persistence failure');
  return database.query(sql, args);
}) as typeof pool.query;
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
    INSERT INTO job_closeouts VALUES('closeout','job','approved',NOW(),'{"finalQuoteRevisionId":"quote","invoiceDueDate":"2026-09-24"}');
    INSERT INTO square_invoices VALUES('invoice','job','final-order',90,'USD','quote','closeout','sent','final_balance',NOW());
    ALTER TABLE square_invoices ADD COLUMN id varchar DEFAULT 'local';
    ALTER TABLE leads ADD COLUMN closeout_status text DEFAULT 'balance_due',ADD COLUMN financial_status text DEFAULT 'balance_due',
      ADD COLUMN final_balance_amount numeric DEFAULT 90,ADD COLUMN final_invoice_url text DEFAULT 'https://example.invalid/invoice';
    ALTER TABLE job_closeouts ADD COLUMN calculated_final_total numeric DEFAULT 120,ADD COLUMN balance_due numeric DEFAULT 90,
      ADD COLUMN updated_at timestamptz,ADD COLUMN square_invoice_id varchar DEFAULT 'invoice';`);
  await database.exec(JOB_PAYMENT_LEDGER_SCHEMA);
  const pay = (id: string, amount: number, order = 'other-order') => confirmJobPayment({
    provider:'square:production',providerPaymentId:id,leadId:'job',quoteRevisionId:'quote',amountCents:amount,
    currency:'USD',tenderType:'card',giftFundedCents:0,paidAt:'2026-09-09T12:00:00Z',metadata:{squareOrderId:order},
  });
  let status = 'UNPAID', cancels = 0, inspectHook: (() => Promise<void>) | undefined, cancelHook: (()=>Promise<void>) | undefined;
  const api: InvoiceReconciliationProvider = {
    inspect: async () => {
      const hook = inspectHook; inspectHook = undefined; await hook?.();
      return { id:'invoice',orderId:'final-order',amountCents:9000,currency:'USD',status };
    },
    cancel: async id => {
      cancels++; status='CANCELED'; await recordSquareInvoiceCancellation(id);
      const hook=cancelHook; cancelHook=undefined; await hook?.();
    },
  };
  const reset = async () => {
    await database.exec(`DELETE FROM job_invoice_replacements; DELETE FROM job_financial_notifications; DELETE FROM job_confirmed_refunds; DELETE FROM job_confirmed_payments;
      DELETE FROM job_invoice_reconciliation_queue; UPDATE leads SET payment_paid_at=NULL,closeout_status='balance_due',
        financial_status='balance_due',final_balance_amount=90,final_invoice_url='https://example.invalid/invoice';
      UPDATE job_closeouts SET status='approved',balance_due=90;
      DELETE FROM square_invoices WHERE square_invoice_id<>'invoice'; UPDATE square_invoices SET status='sent';`);
    status='UNPAID'; cancels=0; inspectHook=undefined; cancelHook=undefined;
    await pay('deposit',3000);
  };
  await reset();
  const attachment={leadId:'job',closeoutId:'closeout',quoteId:'quote',invoiceId:'invoice',invoiceUrl:'https://example.invalid/invoice',balanceDue:90};
  await pay('before-attachment',1000);
  await assert.rejects(attachCanonicalFinalInvoice(attachment),/funding requires reconciliation/);
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,0);
  await reset();
  await pay('same-invoice-partial',2000,'final-order');
  assert.equal((await attachCanonicalFinalInvoice(attachment)).status,'balance_due');
  await reset();
  await recordConfirmedJobRefund({provider:'square:production',providerPaymentId:'deposit',providerRefundId:'attachment-refund',
    amountCents:100,giftFundedCents:0,currency:'USD',refundedAt:'2026-09-09T13:00:00Z'});
  await assert.rejects(attachCanonicalFinalInvoice(attachment),/funding requires reconciliation/);
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,0);
  await reset();
  console.log('PASS: attachment rechecks current funding, permits own-invoice partial payments and rejects other payments/refunds without notices');
  failFinalization=true;
  await assert.rejects(attachCanonicalFinalInvoice(attachment),/Injected financial closeout failure/);
  failFinalization=false;
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  failNotification=true;
  await assert.rejects(attachCanonicalFinalInvoice(attachment),/notification persistence failure/);
  failNotification=false;
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,0);
  assert.equal((await attachCanonicalFinalInvoice(attachment)).status,'balance_due');
  await database.exec('DELETE FROM job_invoice_reconciliation_queue');
  assert.equal(await enqueueInvoiceReconciliationBacklog(),1);
  assert.equal(await enqueueInvoiceReconciliationBacklog(),0);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,0);
  assert.equal(await enqueueInvoiceReconciliationBacklog(),1, 'periodic scan revisits a still-collectible invoice');
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done');
  await pay('late-payment',9000);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,1);
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status,'canceled');
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'paid');
  assert.equal(Number((await database.query('SELECT balance_due FROM job_closeouts')).rows[0].balance_due),0);
  const attached=await attachCanonicalFinalInvoice({leadId:'job',closeoutId:'closeout',quoteId:'quote',invoiceId:'invoice',
    invoiceUrl:'https://example.invalid/old-invoice',balanceDue:90});
  assert.equal(attached.status,'paid','late HTTP completion cannot restore balance due');
  assert.equal((await database.query('SELECT financial_status,final_invoice_url FROM leads')).rows[0].financial_status,'paid');
  assert.equal((await database.query('SELECT final_invoice_url FROM leads')).rows[0].final_invoice_url,null);
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,2);
  await database.exec("UPDATE job_financial_notifications SET status='sent' WHERE kind='final_payment_received'; UPDATE job_invoice_reconciliation_queue SET status='pending',next_attempt_at=NOW()");
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done');
  assert.equal((await database.query("SELECT status FROM job_financial_notifications WHERE kind='final_payment_received'")).rows[0].status,'sent');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,2,'financial retry does not duplicate notices');
  await reset(); await pay('notice-rollback',9000); failNotification=true;
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  failNotification=false;
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,0);
  await database.exec("UPDATE job_invoice_reconciliation_queue SET next_attempt_at=NOW()-INTERVAL '1 minute'");
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,1);
  assert.equal(cancels,1);
  console.log('PASS: financial notices commit with closeout/invoice attachment, roll back on persistence failure, and preserve sent state on retry');
  await reset(); await pay('closeout-rollback',9000); failFinalization=true;
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  failFinalization=false;
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  assert.equal((await database.query('SELECT financial_status FROM leads')).rows[0].financial_status,'balance_due');
  await database.exec("UPDATE job_invoice_reconciliation_queue SET next_attempt_at=NOW()-INTERVAL '1 minute'");
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done');
  assert.equal(cancels,1,'closeout retry does not repeat provider cancellation');
  await reset(); await pay('before-finalization',9000);
  cancelHook=async()=>{ await pay('during-finalization',1); };
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  await reset(); await pay('before-new-invoice',9000);
  cancelHook=async()=>{ await database.exec(`INSERT INTO square_invoices(square_invoice_id,lead_id,square_order_id,amount,currency,
    quote_revision_id,closeout_id,status,purpose) VALUES('new-invoice','job','new-order',90,'USD','quote','closeout','draft','final_balance')`); };
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved');
  console.log('PASS: financial closeout/queue completion is atomic; late attachments, new payments and new invoices cannot regress or falsely complete it');
  await reset(); await pay('own-payment',9000,'final-order'); status='PAID';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,0);
  await reset(); await pay('own-partial',2000,'final-order'); status='PARTIALLY_PAID';
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'done'); assert.equal(cancels,0);
  await pay('other-partial',1000);
  failFinalization=true;
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry'); assert.equal(cancels,1);
  failFinalization=false;
  assert.equal(Number((await database.query('SELECT balance_due FROM job_closeouts')).rows[0].balance_due),90,'partial closeout update rolls back with lead failure');
  assert.equal((await database.query('SELECT * FROM job_invoice_replacements')).rows.length,0,'replacement request rolls back with the balance');
  await database.exec("UPDATE job_invoice_reconciliation_queue SET next_attempt_at=NOW()-INTERVAL '1 minute'");
  const replacement=await processOneJobInvoiceReconciliation(api);
  assert.equal(replacement.status,'retry'); assert.equal('needsReplacement' in replacement && replacement.needsReplacement,true);
  assert.equal(cancels,1,'replacement recovery does not cancel twice');
  const remaining=(await database.query('SELECT final_balance_amount,final_invoice_url,payment_paid_at FROM leads')).rows[0];
  assert.equal(Number(remaining.final_balance_amount),60); assert.equal(remaining.final_invoice_url,null); assert.equal(remaining.payment_paid_at,null);
  const partialCloseout=(await database.query('SELECT status,balance_due,square_invoice_id FROM job_closeouts')).rows[0];
  assert.equal(partialCloseout.status,'balance_due'); assert.equal(Number(partialCloseout.balance_due),60); assert.equal(partialCloseout.square_invoice_id,'invoice');
  assert.equal((await database.query('SELECT status FROM job_invoice_reconciliation_queue')).rows[0].status,'retry');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,0,'no replacement or paid message before a replacement exists');
  await assert.rejects(attachCanonicalFinalInvoice(attachment),/balance requires reconciliation/);
  const reserved=(await database.query('SELECT * FROM job_invoice_replacements')).rows;
  assert.equal(reserved.length,1);
  assert.equal(reserved[0].request_payload.amountCents,6000);
  assert.equal(reserved[0].request_payload.previousInvoiceId,'invoice');
  assert.deepEqual(reserved[0].request_payload.predecessorInvoiceIds,['invoice']);
  assert.equal(reserved[0].request_payload.dueDate,'2026-09-24');
  await database.exec("UPDATE job_invoice_reconciliation_queue SET next_attempt_at=NOW()-INTERVAL '1 minute'");
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  assert.deepEqual((await database.query('SELECT * FROM job_invoice_replacements')).rows,reserved,'replay preserves request identity and payload');
  await pay('after-replacement-reservation',1);
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  assert.deepEqual((await database.query('SELECT * FROM job_invoice_replacements')).rows,reserved,'changed funding cannot allocate a second replacement for the same predecessors');
  assert.equal(Number((await database.query('SELECT balance_due FROM job_closeouts')).rows[0].balance_due),60,'conflicting replacement leaves balance transaction unchanged');
  console.log('PASS: canceled partial invoice preserves its audit binding, corrects the remainder atomically and retains replacement work');
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
  assert.equal((await processOneJobInvoiceReconciliation(api)).status,'retry');
  assert.equal((await database.query('SELECT status FROM square_invoices')).rows[0].status,'canceled');
  await reset();
  const savedInvoice=(await database.query('SELECT * FROM square_invoices')).rows[0];
  await database.exec('DELETE FROM square_invoices; DELETE FROM job_invoice_reconciliation_queue');
  assert.equal(await enqueueInvoiceReconciliationBacklog(),1,'approved closeout without an invoice must be discovered');
  assert.equal(await enqueueInvoiceReconciliationBacklog(),0,'pending recovery must retain its generation');
  const missingInvoice=await processOneJobInvoiceReconciliation({
    inspect:async()=>{throw new Error('No invoice should be inspected');},
    cancel:async()=>{throw new Error('No invoice should be canceled');},
  });
  assert.equal(missingInvoice.status,'retry');
  assert.equal('needsReplacement' in missingInvoice && missingInvoice.needsReplacement,true);
  assert.equal((await database.query('SELECT status FROM job_closeouts')).rows[0].status,'approved','preserve customer retry');
  assert.equal((await database.query('SELECT final_invoice_url FROM leads')).rows[0].final_invoice_url,null);
  assert.equal((await database.query('SELECT status FROM job_invoice_reconciliation_queue')).rows[0].status,'retry');
  assert.equal((await database.query('SELECT * FROM job_financial_notifications')).rows.length,0);
  assert.equal(await enqueueInvoiceReconciliationBacklog(),0,'scan must not bypass retry backoff');
  await database.query('INSERT INTO square_invoices SELECT * FROM jsonb_populate_record(NULL::square_invoices,$1::jsonb)',[JSON.stringify(savedInvoice)]);
  console.log('PASS: invoice-free approved closeouts are discovered and remain queued without losing customer retry or sending notices');
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
