import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createFinancialNoticeReviewHandler } from '../financialNoticeReviewHandler';
import { FinancialNoticeReviewConflict } from '../financialNoticeReviewPolicy';

let reads=0, writes=0;
const app=express(); app.use(express.json());
app.use((req,_res,next)=>{
  if(req.headers['x-test-role']) (req as any).currentUser={id:'authenticated-reviewer',role:req.headers['x-test-role']};
  next();
});
const handler=createFinancialNoticeReviewHandler({
  async read(){reads++;return {enabled:false};},
  async resolve(leadId,actor,input){
    writes++;assert.equal(actor,'authenticated-reviewer');
    if(leadId==='conflict')throw new FinancialNoticeReviewConflict('Notice changed; refresh before reviewing');
    if(leadId==='failure')throw new Error('private database error');
    return {status:input.action==='suppress'?'suppressed':'pending',replayed:false};
  },
});
app.get('/notices/:leadId',handler); app.post('/notices/:leadId/review',handler);
const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
const address=server.address(); assert.ok(address&&typeof address!=='string');
const body={requestId:randomUUID(),eventKey:'event',action:'suppress',evidence:'Provider history reviewed; no further messages.'};
const request=(role?:string,payload:unknown=body,leadId='job')=>fetch(`http://127.0.0.1:${address.port}/notices/${leadId}/review`,{
  method:'POST',headers:{'content-type':'application/json',...(role?{'x-test-role':role}:{})},body:JSON.stringify(payload),
});
try{
  assert.equal((await request()).status,401);
  for(const role of ['customer','employee','owner','unknown'])assert.equal((await request(role)).status,403);
  assert.equal(writes,0);
  for(const role of ['admin','business_owner'])assert.equal((await request(role)).status,200);
  assert.equal(writes,2);
  for(const invalid of [{...body,actorId:'forged'}, {...body,action:'retry'}, {...body,evidence:'short'},
    {...body,requestId:'not-a-uuid'}, {...body,action:'confirm_sent'}, {...body,channel:'sms'},
    {...body,evidence:'x'.repeat(2001)}])assert.equal((await request('admin',invalid)).status,400);
  assert.equal(writes,2);
  const receipt={...body,action:'confirm_sent',channel:'email',attemptToken:randomUUID(),providerReference:'receipt-1'};
  assert.equal((await request('admin',receipt)).status,200);
  assert.equal((await request('admin',body,'conflict')).status,409);
  const failure=await request('admin',body,'failure');assert.equal(failure.status,500);
  assert.deepEqual(await failure.json(),{error:'Financial notice review is unavailable'});
  const read=await fetch(`http://127.0.0.1:${address.port}/notices/job`,{headers:{'x-test-role':'admin'}});
  assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.equal(reads,1);
  console.log('PASS: financial notice review authentication, role gates, evidence validation, identity binding and safe errors');
}finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
