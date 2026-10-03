import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import { pricingTrainingScenarios as cases } from "../../../shared/pricingTrainingScenarios";
import { emptyTrainingAnswer, trainingAnswerSchema, trainingAnswerProblems, replayTrainingMinimums } from "../../../shared/pricingTraining";
import { createPricingTrainingRouter } from "../pricingTraining";

assert.equal(cases.length,500);
for(const field of ["id","request","fingerprint"] as const) assert.equal(new Set(cases.map(s=>s[field])).size,500);
for(const s of cases) assert.equal(s.fingerprint,createHash("sha256").update(JSON.stringify(s.features)).digest("hex"));
for(let batch=1;batch<=25;batch++) assert.equal(cases.filter(s=>s.batch===batch).length,20);
assert.equal(cases.filter(s=>s.features.depotToJobRoadMiles===null).length,50);
const answer={...emptyTrainingAnswer(),decision:"quote" as const,difficulty:"high" as const,minimumCrew:2,recommendedCrew:3,minimumScheduledHours:2,minimumBillableHours:3,expectedElapsedHours:4,price:500,reasons:["Heavy or awkward items" as const]};
assert.deepEqual(trainingAnswerProblems(answer),[]);
assert.ok(trainingAnswerProblems({...answer,recommendedCrew:1}).length);
assert.ok(trainingAnswerProblems({...answer,expectedElapsedHours:1}).length);
assert.equal(trainingAnswerSchema.safeParse({...answer,minimumCrew:1.5}).success,false);
assert.equal(trainingAnswerSchema.safeParse({...answer,price:Infinity}).success,false);
const saved={answer,status:"reviewed" as const,revision:1,updatedAt:new Date().toISOString()};
const gate=(crew:number,scheduledHours=4,billedHours=4,minCrew=1,minHours=1)=>replayTrainingMinimums(saved,{crew,scheduledHours,billedHours},{minimumCrew:minCrew,minimumHours:minHours}).decision;
assert.equal(gate(1,20,20),"block");
assert.equal(gate(3,1),"block");
assert.equal(gate(3,4,2),"block");
assert.equal(gate(3,4,4,4),"block");
assert.equal(gate(3,4,4,1,5),"block");
assert.equal(gate(4),"review");
assert.equal(gate(3),"meets_reviewed_minimums");
assert.equal(replayTrainingMinimums({...saved,status:"draft"},{crew:3,scheduledHours:4,billedHours:4},{minimumCrew:0,minimumHours:0}).decision,"review");

// An isolated transaction double: tests never import the production database.
const rows=new Map<string,any>(); const history:any[]=[];
let snapshot:any;let failHistory=false;
async function query(sql:string,p:any[]=[]):Promise<any>{
  if(sql.startsWith("CREATE"))return {rows:[]};
  if(sql==="BEGIN"){snapshot=structuredClone([...rows]);return {rows:[]};}
  if(sql==="ROLLBACK"){rows.clear();for(const [k,v] of snapshot)rows.set(k,v);return {rows:[]};}
  if(sql==="COMMIT")return {rows:[]};
  if(sql.startsWith("SELECT"))return {rows:[...rows.values()].filter(r=>r.owner_id===p[0])};
  if(sql.startsWith("INSERT INTO pricing_training_answer_history")){if(failHistory)throw Error("Simulated history write failure");history.push(p);return {rows:[]};}
  const key=p[0]+":"+p[1], old=rows.get(key);
  if(sql.startsWith("INSERT")&&old)return {rows:[]};
  if(sql.startsWith("UPDATE")&&(!old||old.revision!==p[5]))return {rows:[]};
  const row={owner_id:p[0],scenario_id:p[1],fingerprint:p[2],answer:JSON.parse(p[3]),status:p[4],revision:(old?.revision??0)+1,updated_at:new Date().toISOString()};
  rows.set(key,row);return {rows:[row]};
}
const pool={query,connect:async()=>({query,release(){}})};
const app=express();app.use(express.json());
app.use("/training",createPricingTrainingRouter((req:any,res,next)=>{if(!req.headers["x-user"])return res.sendStatus(401);req.user={id:req.headers["x-user"]};next();},(req,res,next)=>req.headers["x-role"]==="owner"?next():res.sendStatus(403),pool as any));
const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}/training`;
async function call(path="",body?:any,user="owner-a",role="owner") {return fetch(base+path,{method:body?"PUT":"GET",headers:{"content-type":"application/json",...(user?{"x-user":user}:{}),"x-role":role},body:body?JSON.stringify(body):undefined});}
const payload={answer,status:"reviewed",revision:0,fingerprint:cases[0].fingerprint};
try{
  assert.equal((await call("",undefined,"")).status,401);
  assert.equal((await call("",undefined,"crew","employee")).status,403);
  assert.equal((await (await call()).json()).scenarios.length,500);
  assert.equal((await call("/missing",payload)).status,404);
  assert.equal((await call("/"+cases[0].id,{...payload,fingerprint:"x".repeat(64)})).status,409);
  assert.equal((await call("/"+cases[0].id,{...payload,answer:emptyTrainingAnswer()})).status,400);
  assert.equal((await call("/"+cases[0].id,payload)).status,200);
  assert.equal((await call("/"+cases[0].id,payload)).status,409);
  assert.equal(history.length,1);
  assert.deepEqual((await (await call("",undefined,"owner-b")).json()).answers,{});
  assert.equal((await (await call()).json()).answers[cases[0].id].answer.price,500);
  failHistory=true;
  assert.equal((await call("/"+cases[0].id,{...payload,revision:1,answer:{...answer,price:600}})).status,503);
  failHistory=false;
  assert.equal((await (await call()).json()).answers[cases[0].id].answer.price,500);
  assert.equal((await call("/"+cases[0].id,{...payload,revision:1,status:"draft"})).status,200);
  const exported=await (await call("/export/answers")).json();
  assert.equal(exported.liveRulesChanged,false);assert.equal(exported.cases[0].proposedGate,null);
  // Updated scenario content requires a fresh review but remains saveable.
  rows.get("owner-a:"+cases[0].id).fingerprint="old";
  const stale=(await (await call()).json()).answers[cases[0].id];
  assert.equal(stale.status,"draft");assert.equal(stale.answer.decision,null);
  assert.equal((await call("/"+cases[0].id,{...payload,revision:stale.revision})).status,200);
  console.log("Pricing training: 500 cases, validation, replay floors, account isolation, revisions, rollback and export passed.");
}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
