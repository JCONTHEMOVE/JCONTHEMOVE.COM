import assert from 'node:assert/strict';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createPricingTrainingTeamRouter } from '../pricingTrainingTeam';
import { pricingTrainingScenarios as cases } from '../../../shared/pricingTrainingScenarios';
import { emptyTrainingAnswer } from '../../../shared/pricingTraining';
import { answerDistribution, TRAINING_REWARDS } from '../../../shared/pricingTrainingTeam';
import { createTrainingReward } from '../../services/pricingTrainingReward';
import { sql } from 'drizzle-orm';

// Real PostgreSQL engine, isolated in memory. No production data, tokens or webhooks.
const pg=new PGlite();
await pg.exec(`CREATE TABLE users(id text PRIMARY KEY,email text,role text,first_name text,username text);
  INSERT INTO users VALUES('owner','owner@example.test','business_owner','Owner','owner'),('legacy-owner','upmichiganstatemovers@gmail.com','admin','Legacy','legacy'),('crew','crew@example.test','employee','Crew','crew'),('crew2','crew2@example.test','employee','Crew2','crew2');
  CREATE TABLE wallet_accounts(user_id text PRIMARY KEY,token_balance numeric NOT NULL DEFAULT 0,total_earned numeric DEFAULT 0,last_activity timestamptz);
  CREATE TABLE rewards(user_id text,reward_type text,token_amount numeric,cash_value numeric,status text,reference_id text UNIQUE,metadata jsonb);
  CREATE TABLE test_reserve(amount int);INSERT INTO test_reserve VALUES(10000);`);
let lock=Promise.resolve();
let rewardFailure=false,thanks=0;
async function query(statement:any,args?:any[]){
  const text=typeof statement==='string'?statement:statement.text;
  if(rewardFailure&&text.startsWith('INSERT INTO rewards'))throw Error('Simulated ledger failure after wallet credit');
  const result=await pg.query(text,args);
  return statement.rowMode==='array'?{...result,rows:result.rows.map(r=>Object.values(r as object))}:result;
}
const pool={query,connect:async()=>{const previous=lock;let release!:()=>void;lock=new Promise<void>(resolve=>release=resolve);await previous;return {query,release};}};
const app=express();app.use(express.json());
const auth=(req:any,res:any,next:any)=>{const id=req.headers['x-user'];if(!id)return res.sendStatus(401);req.user={id,role:id==='owner'?'business_owner':id==='customer'?'customer':'employee',firstName:id};next();};
const staff=(req:any,res:any,next:any)=>req.user.role==='customer'?res.sendStatus(403):next();
const owner=(req:any,res:any,next:any)=>req.user.role==='business_owner'?next():res.sendStatus(403);
app.use('/team',createPricingTrainingTeamRouter(auth,staff,owner,pool as any,{
  reward:createTrainingReward(async(tx,amount)=>{
    await tx.execute(sql`UPDATE test_reserve SET amount=amount-${amount}`);
    return {cashValue:0,transactionId:'test-transaction'};
  }),thank:async()=>{thanks++;return 'sent';}
}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as any).port}/team`;
const call=(path='',method='GET',body?:any,user='crew')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},body:body?JSON.stringify(body):undefined});
const a={...emptyTrainingAnswer(),decision:'quote' as const,difficulty:'moderate' as const,minimumCrew:2,recommendedCrew:2,minimumScheduledHours:2,minimumBillableHours:2,expectedElapsedHours:3,price:500,notes:'Two trained workers needed for safe handling.'};
const payload=(i:number,revision=0)=>({answer:a,status:'reviewed',revision,fingerprint:cases[i].fingerprint});
try{
  assert.equal((await call('', 'GET',undefined,'')).status,401);
  assert.equal((await call('', 'GET',undefined,'customer')).status,403);
  assert.equal((await call()).status,200);
  // Existing owner progress is immediately shared, without data migration.
  await pg.query(`INSERT INTO pricing_training_answers(owner_id,scenario_id,fingerprint,answer,status) VALUES('owner',$1,$2,$3::jsonb,'reviewed')`,[cases[0].id,cases[0].fingerprint,JSON.stringify(a)]);
  assert.deepEqual((await (await call()).json()).completed,[cases[0].id]);
  assert.equal((await (await call()).json()).ownerId,'owner','existing answer set takes precedence over the legacy owner email');
  assert.equal((await call('/final/'+cases[1].id,'PUT',payload(1))).status,403);
  assert.equal((await call('/'+cases[1].id,'PUT',{...payload(1),answer:emptyTrainingAnswer()})).status,400);
  assert.equal((await call('/'+cases[1].id,'PUT',payload(1))).status,200);
  assert.equal((await call('/'+cases[1].id,'PUT',payload(1))).status,409);
  assert.equal((await call('/'+cases[1].id,'PUT',payload(1,1))).status,200);
  assert.equal((await call('/'+cases[1].id,'PUT',payload(1), 'crew2')).status,200);
  let detail=await (await call('/scenario/'+cases[1].id)).json();
  assert.equal(detail.responses.length,2);assert.equal(detail.final,null);
  assert.equal((await (await call()).json()).completed.length,1,'responses do not inflate completion');
  const c=detail.responses.find((r:any)=>r.userId==='crew');
  const rating={revision:c.revision,grade:'mostly_correct',note:'Good approach; add a little travel time.'};
  assert.equal((await call('/review/'+c.id,'POST',rating)).status,403);
  rewardFailure=true;
  assert.equal((await call('/review/'+c.id,'POST',rating,'owner')).status,503);
  assert.equal((await pg.query('SELECT * FROM wallet_accounts')).rows.length,0,'wallet rollback');
  assert.equal((await pg.query<any>('SELECT amount FROM test_reserve')).rows[0].amount,10000,'treasury rollback');
  assert.equal((await pg.query<any>('SELECT grade FROM pricing_training_contributions WHERE id=$1',[c.id])).rows[0].grade,null,'review rollback');
  rewardFailure=false;
  const reviews=await Promise.all([call('/review/'+c.id,'POST',rating,'owner'),call('/review/'+c.id,'POST',rating,'owner')]);
  assert.ok(reviews.every(r=>r.status===200));
  assert.equal(Number((await pg.query<any>('SELECT token_balance FROM wallet_accounts')).rows[0].token_balance),150);
  assert.equal((await pg.query('SELECT * FROM rewards')).rows.length,1,'one ledger entry under retries');
  assert.equal((await call('/review/'+c.id,'POST',{...rating,grade:'correct'},'owner')).status,409);
  assert.equal((await call('/'+cases[1].id,'PUT',payload(1,c.revision))).status,409,'reviewed answer locked');
  assert.equal((await call('/final/'+cases[1].id,'PUT',payload(1),'owner')).status,200);
  assert.equal((await call('/final/'+cases[1].id,'PUT',payload(1),'owner')).status,409);
  assert.equal((await call('/final/'+cases[1].id,'PUT',{...payload(1,1),answer:{...a,price:650}},'owner')).status,200);
  assert.equal((await (await call()).json()).completed.length,2);
  detail=await (await call('/scenario/'+cases[1].id)).json();assert.equal(detail.final.answer.price,650);assert.equal(detail.responses[0].answer.price,500,'override preserves input');
  assert.equal((await pg.query('SELECT * FROM pricing_training_answer_history')).rows.length,2);
  assert.equal((await pg.query('SELECT * FROM pricing_training_final_audit')).rows.length,2);
  assert.equal((await call('/'+cases[2].id,'PUT',payload(2),'owner')).status,200);
  const self=(await (await call('/scenario/'+cases[2].id)).json()).responses[0];
  assert.equal((await call('/review/'+self.id,'POST',{...rating,revision:1},'owner')).status,403);
  await new Promise(r=>setTimeout(r,50));assert.equal(thanks,3,'one thank-you for each contributor/request, not edits');
  for(const [i,grade,amount] of [[3,'contribution',100],[4,'correct',200],[5,'rejected',0]] as const){
    assert.equal((await call('/'+cases[i].id,'PUT',payload(i))).status,200);
    const r=(await (await call('/scenario/'+cases[i].id)).json()).responses[0];
    const reviewed=await call('/review/'+r.id,'POST',{revision:1,grade,note:'Owner assessment.'},'owner');
    assert.equal(reviewed.status,200);assert.equal((await reviewed.json()).rewardAmount,amount);
  }
  assert.equal(Number((await pg.query<any>("SELECT token_balance FROM wallet_accounts WHERE user_id='crew'")).rows[0].token_balance),450);
  assert.deepEqual(TRAINING_REWARDS,{contribution:100,mostly_correct:150,correct:200,rejected:0});
  assert.deepEqual(answerDistribution([a,{...a,price:100},{...a,price:null}], 'price'),[{label:'100',count:1},{label:'500',count:1}]);
  console.log('Team training PostgreSQL integration passed: access, shared progress, contributions, owner overrides, atomic reward rollback, retry deduplication, self-reward prevention, charts, thank-you deduplication.');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pg.close();}
