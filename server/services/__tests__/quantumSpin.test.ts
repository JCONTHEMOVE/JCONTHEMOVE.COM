import assert from 'node:assert/strict';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createQuantumSpinHandler } from '../quantumSpin';
const pg=new PGlite();
await pg.exec(`CREATE TABLE users(id VARCHAR PRIMARY KEY,first_name TEXT,last_name TEXT,username TEXT);INSERT INTO users VALUES('crew','Crew','','crew');
CREATE TABLE spin_config(setting_key TEXT,setting_value TEXT);INSERT INTO spin_config VALUES('spin_wheel_enabled','true'),('spin_cost_tokens','100');
CREATE TABLE reward_entitlements(id SERIAL PRIMARY KEY,user_id VARCHAR,entitlement_type TEXT,value_json JSONB,status TEXT,expires_at TIMESTAMPTZ,consumed_at TIMESTAMPTZ,redemption_id INTEGER);
INSERT INTO reward_entitlements(user_id,entitlement_type,value_json,status,expires_at) VALUES('crew','spin_credit','{"spins":1}','active',NOW()+INTERVAL '1 day');
CREATE TABLE reward_redemptions(id INTEGER PRIMARY KEY,user_id VARCHAR,status TEXT,fulfilled_at TIMESTAMP,admin_notes TEXT);
CREATE TABLE wallet_accounts(user_id VARCHAR PRIMARY KEY,token_balance NUMERIC DEFAULT 0,total_earned NUMERIC DEFAULT 0,last_activity TIMESTAMP);
CREATE TABLE jackpots(type TEXT,current_value NUMERIC,contribution_per_spin NUMERIC,win_probability_pct NUMERIC);
CREATE TABLE spin_results(id SERIAL PRIMARY KEY,user_id VARCHAR,redemption_id INTEGER,prize_index INTEGER,prize_label TEXT,prize_tokens NUMERIC,prize_type TEXT,jackpot_type_won TEXT,jackpot_amount_won NUMERIC,coupon_code TEXT,fulfillment_status TEXT);
CREATE TABLE rewards(id VARCHAR DEFAULT gen_random_uuid(),user_id VARCHAR,reward_type TEXT,token_amount NUMERIC,cash_value NUMERIC,status TEXT,earned_date TIMESTAMP DEFAULT NOW(),redeemed_date TIMESTAMP,reference_id VARCHAR,metadata JSONB);
CREATE TABLE activity_feed_events(user_id VARCHAR,event_type TEXT,message TEXT,metadata JSONB);`);
let failure=true;let lock=Promise.resolve();
async function query(statement:any,args?:any[]){const text=typeof statement==='string'?statement:statement.text;if(failure&&text.includes('insert into "rewards"'))throw Error('Synthetic ledger failure');const result=await pg.query(text,args);return statement.rowMode==='array'?{...result,rows:result.rows.map(row=>Object.values(row as object))}:result;}
const pool={query,connect:async()=>{const prior=lock;let release!:()=>void;lock=new Promise<void>(resolve=>release=resolve);await prior;return {query,release};}};
const app=express();app.use(express.json());app.post('/spin',(req:any,_res,next)=>{req.session={userId:'crew'};next();},createQuantumSpinHandler(pool as any,()=>0.3));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/spin`;
const spin=(payload:object={useFreeSpinEntitlementId:1})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
try {
  assert.equal((await spin()).status,500);
  assert.equal((await pg.query('SELECT * FROM wallet_accounts')).rows.length,0);
  assert.equal((await pg.query('SELECT * FROM spin_results')).rows.length,0);
  assert.equal((await pg.query<{status:string}>('SELECT status FROM reward_entitlements')).rows[0].status,'active');
  failure=false;
  const outcomes=await Promise.all([spin(),spin()]);assert.deepEqual(outcomes.map(response=>response.status).sort(),[200,409]);
  assert.equal((await pg.query('SELECT * FROM spin_results')).rows.length,1);
  assert.equal(Number((await pg.query<{token_balance:string}>('SELECT token_balance FROM wallet_accounts')).rows[0].token_balance),10,'free spin credits winnings with no spin charge');
  assert.equal((await pg.query('SELECT * FROM rewards')).rows.length,1);
  await pg.exec(`INSERT INTO reward_redemptions(id,user_id,status) VALUES(7,'crew','pending'),(8,'someone-else','pending');
    INSERT INTO reward_entitlements(user_id,entitlement_type,value_json,status,expires_at,redemption_id)
    VALUES('crew','spin_credit','{"spins":1}','active',NOW()+INTERVAL '1 day',7);`);
  assert.equal((await spin({redemptionId:8})).status,400,'another account cannot use a redemption');
  assert.equal((await spin({redemptionId:7})).status,200,'a purchased credit can be consumed and fulfilled');
  assert.equal((await spin({redemptionId:7})).status,400,'fulfilled redemption cannot bypass payment');
  assert.equal((await pg.query<{status:string}>('SELECT status FROM reward_redemptions WHERE id=7')).rows[0].status,'completed');
  console.log('Quantum spin transaction rollback, concurrent free-credit use and wallet payout tests passed');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();}
