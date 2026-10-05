import assert from 'node:assert/strict';
import { pool } from '../../db';
import { deliverCrewAnnouncementToWebhooks } from '../jobEventBus';

// Exercise the operational sender without live HTTP or a production database.
const keys=['JC_JOB_EVENT_WEBHOOK_URLS','JOB_EVENT_WEBHOOK_URLS','DISCORD_JOB_WEBHOOK_URL','DISCORD_WEBHOOK_URL'] as const;
const prior=keys.map(key=>process.env[key]),priorQuery=pool.query,priorFetch=globalThis.fetch;
let calls=0,alreadySent=false;
let responses:Array<number|Error>=[];
let audits:unknown[][]=[];
pool.query=(async(sql:string,args?:unknown[])=>{
  if(sql.startsWith('SELECT 1 FROM job_webhook_deliveries'))return {rows:alreadySent?[{one:1}]:[],rowCount:alreadySent?1:0};
  assert.match(sql,/INSERT INTO job_webhook_deliveries/);audits.push(args||[]);return {rows:[],rowCount:1};
}) as typeof pool.query;
globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://discord.com/api/webhooks/synthetic/test');calls++;
  assert.equal(options?.method,'POST');
  const body=JSON.parse(String(options?.body));assert.equal(body.username,'JC ON THE MOVE');
  const response=responses.shift();assert.notEqual(response,undefined,'unexpected extra HTTP request');
  if(response instanceof Error)throw response;
  return new Response(null,{status:response as number});
};
const send=()=>deliverCrewAnnouncementToWebhooks({title:'Synthetic test',message:'No external message is sent.'});
const reset=(sequence:Array<number|Error>)=>{calls=0;audits=[];alreadySent=false;responses=[...sequence];};
try {
  keys.forEach(key=>delete process.env[key]);
  assert.deepEqual(await send(),{configured:0,delivered:0});assert.equal(calls,0);assert.equal(audits.length,0);
  process.env.JC_JOB_EVENT_WEBHOOK_URLS='https://discord.com/api/webhooks/synthetic/test';
  reset([204]);assert.deepEqual(await send(),{configured:1,delivered:1});assert.equal(calls,1);
  assert.equal(audits[0][4],'sent');assert.equal(audits[0][5],204);assert.equal(audits[0][7],1);
  assert.match(String(audits[0][2]),/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(audits).includes('/webhooks/'));
  reset([429,204]);assert.equal((await send()).delivered,1);assert.equal(calls,2);assert.equal(audits[0][7],2);
  reset([500,502,503]);assert.equal((await send()).delivered,0);assert.equal(calls,3);
  assert.equal(audits[0][4],'failed');assert.equal(audits[0][5],503);assert.equal(audits[0][7],3);
  reset([401]);assert.equal((await send()).delivered,0);assert.equal(calls,1);assert.equal(audits[0][4],'failed');
  reset([new Error('Synthetic network failure'),204]);assert.equal((await send()).delivered,1);assert.equal(calls,2);
  reset([]);alreadySent=true;assert.equal((await send()).delivered,0);assert.equal(calls,0);assert.equal(audits.length,0);
  console.log('PASS: operational webhook sender handles missing config, 204, rate limits, bounded failures and confirmed-delivery suppression without live HTTP');
} finally {
  pool.query=priorQuery;globalThis.fetch=priorFetch;
  keys.forEach((key,index)=>{if(prior[index]===undefined)delete process.env[key];else process.env[key]=prior[index];});
}
