import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { pool } from '../server/db';
import { storage } from '../server/storage';
import { squareInvoiceService } from '../server/services/square-invoice';
import router from '../server/routes/regionalAutomation';

/** Run after quote approval fixture setup; only provider/lead lookup and the
 * unrelated regional migration are stubbed. Route, token SQL and attachment run. */
export async function checkCloseoutRequestRecovery(executeSql:(sql:string)=>Promise<unknown>) {
  const priorQuery=pool.query,priorLead=storage.getLead,priorInvoice=squareInvoiceService.createInvoiceForLead;
  await executeSql(`ALTER TABLE leads ADD COLUMN first_name text,ADD COLUMN last_name text,
    ADD COLUMN confirmed_date text,ADD COLUMN move_date text,ADD COLUMN from_address text,ADD COLUMN to_address text,
    ADD COLUMN final_invoice_url text,ADD COLUMN final_balance_amount numeric;
    ALTER TABLE job_closeouts ADD COLUMN customer_token_hash text,ADD COLUMN customer_token_expires_at timestamptz,
    ADD COLUMN square_invoice_id text;
    CREATE TABLE job_change_orders(id text,code text,description text,quantity numeric,unit_price numeric,total numeric,
      catalog_backed boolean,customer_acknowledged_at timestamptz,closeout_id text,created_at timestamptz);
    CREATE TABLE square_invoices(square_invoice_id text PRIMARY KEY,lead_id text,closeout_id text,quote_revision_id text,
      amount numeric,currency text,status text);`);
  const token='synthetic-closeout-recovery';
  await pool.query("UPDATE job_closeouts SET customer_token_hash=$1,customer_token_expires_at=NOW()+INTERVAL '1 hour' WHERE id='closeout'",[crypto.createHash('sha256').update(token).digest('hex')]);
  const original=(await pool.query("SELECT customer_approved_at,pricing_snapshot FROM job_closeouts WHERE id='closeout'")).rows[0];
  pool.query=((sql:string,args?:unknown[])=>sql.includes('service_area_capabilities')?Promise.resolve({rows:[]}):priorQuery.call(pool,sql,args)) as typeof pool.query;
  storage.getLead=(async()=>({id:'closeout-job',email:'synthetic@example.invalid',firstName:'Synthetic',lastName:'Customer'})) as typeof storage.getLead;
  const requests:unknown[][]=[];
  squareInvoiceService.createInvoiceForLead=(async(...args:unknown[])=>{
    requests.push(args);
    if(requests.length===1)throw new Error('Synthetic lost invoice response');
    const options=args[5] as {quoteRevisionId:string};
    await pool.query(`INSERT INTO square_invoices VALUES('recovery-invoice','closeout-job','closeout',$1,90,'USD','sent')`,[options.quoteRevisionId]);
    return {squareInvoiceId:'recovery-invoice',invoiceUrl:'https://example.invalid/recovery'};
  }) as typeof squareInvoiceService.createInvoiceForLead;
  const app=express();app.use(express.json());app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address || typeof address==='string')throw new Error('Missing test listener');
  const post=(value:string)=>fetch(`http://127.0.0.1:${address.port}/api/job-closeouts/${value}/approve`,{method:'POST'});
  try {
    assert.equal((await post('invalid-token')).status,409);assert.equal(requests.length,0);
    assert.equal((await post(token)).status,409);
    const afterFailure=(await pool.query("SELECT status,customer_approved_at,pricing_snapshot FROM job_closeouts WHERE id='closeout'")).rows[0];
    assert.equal(afterFailure.status,'approved');assert.deepEqual(afterFailure.customer_approved_at,original.customer_approved_at);
    assert.deepEqual(afterFailure.pricing_snapshot,original.pricing_snapshot);
    const retry=await post(token);assert.equal(retry.status,200);assert.equal((await retry.json()).status,'balance_due');
    assert.deepEqual(requests[1],requests[0],'retry must retain the provider request input');
    assert.equal((await pool.query("SELECT square_invoice_id FROM job_closeouts WHERE id='closeout'")).rows[0].square_invoice_id,'recovery-invoice');
    assert.equal((await pool.query("SELECT final_invoice_url FROM leads WHERE id='closeout-job'")).rows[0].final_invoice_url,'https://example.invalid/recovery');
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM job_financial_notifications WHERE lead_id='closeout-job'")).rows[0].n,1);
    console.log('PASS: real closeout HTTP route rejects invalid tokens, preserves approval after provider failure and retries through invoice attachment');
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    pool.query=priorQuery;storage.getLead=priorLead;squareInvoiceService.createInvoiceForLead=priorInvoice;
    await executeSql(`DELETE FROM job_financial_notifications; DROP TABLE square_invoices;
      ALTER TABLE leads DROP COLUMN from_address,DROP COLUMN to_address,DROP COLUMN confirmed_date,DROP COLUMN move_date;
      UPDATE job_closeouts SET status='approved',square_invoice_id=NULL WHERE id='closeout'`);
  }
}
