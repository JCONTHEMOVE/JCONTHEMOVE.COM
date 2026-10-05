import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/db';
import { JOB_FINANCIAL_NOTIFICATIONS_SCHEMA } from '../server/services/jobFinancialNotifications';
import { getFinancialNoticeReview, resolveFinancialNotice, type FinancialNoticeResolution } from '../server/services/jobFinancialNoticeReview';
import { acknowledgeFinancialNoticeAttempt } from '../server/services/jobFinancialNoticeDelivery';
import { createDisposableLedgerDatabase } from './disposable-ledger-database';

const database=await createDisposableLedgerDatabase(process.argv[2]);
const priorQuery=pool.query,priorConnect=pool.connect,priorFlag=process.env.JOB_PAYMENT_LEDGER_ENABLED;
let failAudit=false,loseCommit=false;
pool.query=(async(sql:string,args?:unknown[])=>{
  if(failAudit&&sql.includes('INSERT INTO job_financial_notice_reviews'))throw new Error('Audit write failed');
  const result=await database.query(sql,args);
  if(loseCommit&&sql==='COMMIT'){loseCommit=false;throw new Error('Lost commit response');}
  return result;
}) as typeof pool.query;
pool.connect=(async()=>({query:pool.query,release(){}})) as typeof pool.connect;
const token=randomUUID();
const confirm=():FinancialNoticeResolution=>({requestId:randomUUID(),eventKey:'event',action:'confirm_sent',channel:'email',
  attemptToken:token,providerReference:'receipt-1',evidence:'Confirmed receipt in provider history.'});
async function reset(){
  await database.exec(`DELETE FROM job_financial_notice_reviews;DELETE FROM job_financial_notice_attempts;DELETE FROM job_financial_notifications;
    INSERT INTO job_financial_notifications(event_key,lead_id,closeout_id,kind,payload,status) VALUES('event','job','closeout','final_invoice_sent','{}','review');`);
  await database.query(`INSERT INTO job_financial_notice_attempts(event_key,channel,destination_hash,attempt_token,status)
    VALUES('event','email','hash',$1,'review')`,[token]);
}
try{
  await database.exec("CREATE TABLE leads(id varchar PRIMARY KEY);INSERT INTO leads VALUES('job'),('other-job');");
  await database.exec(JOB_FINANCIAL_NOTIFICATIONS_SCHEMA);
  process.env.JOB_PAYMENT_LEDGER_ENABLED='false';assert.deepEqual(await getFinancialNoticeReview('job'),{enabled:false});
  await assert.rejects(resolveFinancialNotice('job','owner',confirm()),/disabled/);
  process.env.JOB_PAYMENT_LEDGER_ENABLED='true';await reset();
  const input=confirm();failAudit=true;
  await assert.rejects(resolveFinancialNotice('job','owner',input),/Audit write failed/);failAudit=false;
  assert.equal((await database.query('SELECT status FROM job_financial_notice_attempts')).rows[0].status,'review');
  assert.equal((await database.query('SELECT status FROM job_financial_notifications')).rows[0].status,'review');
  loseCommit=true;await assert.rejects(resolveFinancialNotice('job','owner',input),/Lost commit response/);
  assert.deepEqual(await resolveFinancialNotice('job','owner',input),{status:'pending',replayed:true});
  assert.equal((await database.query('SELECT * FROM job_financial_notice_reviews')).rows.length,1);
  await assert.rejects(resolveFinancialNotice('job','other-owner',input),/different evidence/);
  await assert.rejects(resolveFinancialNotice('job','owner',{...input,evidence:'Changed evidence after retry.'}),/different evidence/);
  assert.equal(await acknowledgeFinancialNoticeAttempt({eventKey:'event',channel:'email',token},{sent:false}),false);
  const report=await getFinancialNoticeReview('job');assert.ok(report.enabled);
  assert.equal(report.notices[0].deliveries[0].provider_reference,'receipt-1');assert.equal(report.notices[0].reviews[0].actor_id,'owner');
  assert.equal(JSON.stringify(report).includes('destination_hash'),false);

  await reset();await assert.rejects(resolveFinancialNotice('other-job','owner',confirm()),/unavailable/);
  await assert.rejects(resolveFinancialNotice('job','owner',{...confirm(),attemptToken:randomUUID()}),/attempt changed/);
  await database.exec("UPDATE job_financial_notifications SET status='processing'");
  await assert.rejects(resolveFinancialNotice('job','owner',confirm()),/Notice changed/);
  await reset();
  await database.query(`INSERT INTO job_financial_notice_attempts(event_key,channel,destination_hash,attempt_token,status)
    VALUES('event','sms','hash-sms',$1,'review')`,[randomUUID()]);
  assert.equal((await resolveFinancialNotice('job','owner',confirm())).status,'review','unresolved SMS stays held');
  const suppress:FinancialNoticeResolution={requestId:randomUUID(),eventKey:'event',action:'suppress',evidence:'Owner closes notice without more delivery.'};
  assert.equal((await resolveFinancialNotice('job','owner',suppress)).status,'suppressed');
  assert.equal((await database.query('SELECT * FROM job_financial_notice_attempts')).rows.length,2,'suppression keeps every send barrier');
  assert.equal((await database.query('SELECT * FROM job_financial_notice_reviews')).rows.length,2);
  await assert.rejects(resolveFinancialNotice('job','owner',confirm()),/Notice changed/);
  console.log('PASS: review audit and resolution commit atomically, replay safely, reject stale/cross-job requests and preserve uncertain channel history');
}finally{
  pool.query=priorQuery;pool.connect=priorConnect;
  if(priorFlag===undefined)delete process.env.JOB_PAYMENT_LEDGER_ENABLED;else process.env.JOB_PAYMENT_LEDGER_ENABLED=priorFlag;
  await database.close();
}
