import assert from 'node:assert/strict';
import { pool } from '../server/db';
import { recordJobWebhookDelivery,hasSuccessfulJobWebhookDelivery } from '../server/services/jobAlertDelivery';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';
const database=await createDisposableLedgerDatabase(process.argv[2]);
const priorQuery=pool.query;
pool.query=((sql:string,args?:unknown[])=>database.query(sql,args)) as typeof pool.query;
try {
  await database.exec(`CREATE TABLE job_webhook_deliveries(event_id text,lead_id varchar,webhook_url_hash text,provider text,
    status text CHECK(status IN ('sent','failed')),response_status integer,error_message text,attempts integer,
    metadata jsonb,updated_at timestamptz,UNIQUE(event_id,webhook_url_hash))`);
  const base={eventId:'event',leadId:'job',webhookUrlHash:'synthetic-hash',provider:'discord',attempts:1};
  await recordJobWebhookDelivery({...base,status:'failed',responseStatus:503,errorMessage:'Unavailable'});
  assert.equal(await hasSuccessfulJobWebhookDelivery('event','synthetic-hash'),false);
  await recordJobWebhookDelivery({...base,status:'sent',responseStatus:204,metadata:{receipt:'confirmed'}});
  await recordJobWebhookDelivery({...base,status:'failed',responseStatus:500,errorMessage:'Late failure',metadata:{receipt:'unconfirmed'}});
  const row=(await database.query('SELECT * FROM job_webhook_deliveries')).rows[0];
  assert.equal(row.status,'sent');assert.equal(row.response_status,204);assert.equal(row.error_message,null);
  assert.deepEqual(row.metadata,{receipt:'confirmed'});assert.equal(row.attempts,3);
  assert.equal(await hasSuccessfulJobWebhookDelivery('event','synthetic-hash'),true);
  assert.equal(await hasSuccessfulJobWebhookDelivery('event','other-target'),false);
  await recordJobWebhookDelivery({...base,webhookUrlHash:'other-target',status:'failed',responseStatus:401});
  assert.equal(await hasSuccessfulJobWebhookDelivery('event','other-target'),false);
  console.log('PASS: actual webhook audit SQL preserves confirmed delivery across late failures while accumulating attempts and isolating targets');
} finally {pool.query=priorQuery;await database.close();}
