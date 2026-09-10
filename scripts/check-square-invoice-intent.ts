import assert from 'node:assert/strict';
import { pool } from '../server/db';
import { SQUARE_INVOICE_INTENT_SCHEMA, reserveSquareInvoiceIntent } from '../server/services/squareInvoiceIntent';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
import type { Lead } from '../shared/schema';

const database=await createDisposableLedgerDatabase(process.argv[2]);
const priorQuery=pool.query, priorFlag=process.env.JOB_PAYMENT_LEDGER_ENABLED, priorFetch=globalThis.fetch;
let failWrite=false,loseResponse=false;
pool.query=(async(sql:string,args?:unknown[])=>{
  if(failWrite&&sql.includes('INSERT INTO square_invoice_intents'))throw new Error('Intent storage unavailable');
  const result=await database.query(sql,args);
  if(loseResponse&&sql.includes('INSERT INTO square_invoice_intents')){loseResponse=false;throw new Error('Lost intent response');}
  return result;
}) as typeof pool.query;
process.env.JOB_PAYMENT_LEDGER_ENABLED='true';
globalThis.fetch=async()=>{throw new Error('No live provider calls');};
try{
  await database.exec("CREATE TABLE leads(id varchar PRIMARY KEY);INSERT INTO leads VALUES('job'),('other-job');");
  await database.exec(SQUARE_INVOICE_INTENT_SCHEMA);
  const payload={amountCents:9000,recipient:{email:'synthetic@example.invalid'},dueDate:'2030-01-01'};
  loseResponse=true;await assert.rejects(reserveSquareInvoiceIntent('key','job',payload),/Lost intent response/);
  await reserveSquareInvoiceIntent('key','job',payload);
  assert.equal((await database.query('SELECT * FROM square_invoice_intents')).rows.length,1);
  await assert.rejects(reserveSquareInvoiceIntent('key','other-job',payload),/request changed/);
  await assert.rejects(reserveSquareInvoiceIntent('key','job',{...payload,amountCents:9100}),/request changed/);
  assert.deepEqual((await database.query('SELECT request_payload FROM square_invoice_intents')).rows[0].request_payload,payload);

  const {SquareInvoiceService}=await import('../server/services/square-invoice');
  let providerEntries=0,location='location-1';
  const service=new SquareInvoiceService({getLocationId:()=> location,getClient:async()=>{
    providerEntries++;throw new Error('Provider boundary reached');
  }});
  const lead={id:'job',firstName:'Synthetic',lastName:'Customer',email:'synthetic@example.invalid',phone:null,serviceType:'moving'} as Lead;
  const options={idempotencyKey:'service-key',purpose:'final_balance' as const,quoteRevisionId:'quote',closeoutId:'closeout'};
  const run=(person=lead,amount=90,description='Approved balance',date='2030-01-01',method:'none'|'email'='none')=>
    service.createInvoiceForLead(person,amount,description,date,method,options);
  failWrite=true;await assert.rejects(run(),/Intent storage unavailable/);assert.equal(providerEntries,0);failWrite=false;
  loseResponse=true;await assert.rejects(run(),/Lost intent response/);assert.equal(providerEntries,0);
  await assert.rejects(run(),/Provider boundary reached/);assert.equal(providerEntries,1);
  for(const changed of [()=>run({...lead,email:'changed@example.invalid'}),()=>run(lead,91),()=>run(lead,90,'Changed description'),
    ()=>run(lead,90,'Approved balance','2030-01-02'),()=>run(lead,90,'Approved balance','2030-01-01','email')]){
    await assert.rejects(changed(),/request changed/);assert.equal(providerEntries,1);
  }
  await assert.rejects(run(),/Provider boundary reached/);assert.equal(providerEntries,2);
  location='location-2';await assert.rejects(run(),/request changed/);assert.equal(providerEntries,2);
  const row=(await database.query("SELECT request_payload FROM square_invoice_intents WHERE request_key='service-key'")).rows[0];
  assert.equal(row.request_payload.amountCents,9000);assert.equal(row.request_payload.locationId,'location-1');
  console.log('PASS: immutable intent survives lost responses and prevents provider entry on storage failure or changed financial/recipient inputs');
}finally{
  pool.query=priorQuery;globalThis.fetch=priorFetch;
  if(priorFlag===undefined)delete process.env.JOB_PAYMENT_LEDGER_ENABLED;else process.env.JOB_PAYMENT_LEDGER_ENABLED=priorFlag;
  await database.close();
}
