import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Pool } from "@neondatabase/serverless";
import { pricingTrainingScenarios } from "@shared/pricingTrainingScenarios";
import { emptyTrainingAnswer, trainingAnswerSchema, trainingAnswerProblems, replayTrainingMinimums } from "@shared/pricingTraining";

const bodySchema=z.object({answer:trainingAnswerSchema,status:z.enum(["draft","reviewed"]),revision:z.number().int().nonnegative(),fingerprint:z.string().length(64)}).strict();
export function createPricingTrainingRouter(auth: RequestHandler, owner: RequestHandler, pool: Pick<Pool, "query" | "connect">) {
let schemaReady: Promise<unknown> | undefined;
function ensureSchema() {
  schemaReady ??= pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_answers (
    owner_id text NOT NULL, scenario_id text NOT NULL, fingerprint text NOT NULL,
    answer jsonb NOT NULL, status text NOT NULL CHECK (status IN ('draft','reviewed')),
    revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, scenario_id)
  )`).then(() => pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_answer_history (
    owner_id text NOT NULL, scenario_id text NOT NULL, fingerprint text NOT NULL,
    answer jsonb NOT NULL, status text NOT NULL, revision integer NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,scenario_id,revision)
  )`)).catch(error=>{schemaReady=undefined;throw error;});
  return schemaReady;
}
  const router=Router();
  router.use(auth,owner);
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
  router.get("/",async(req:any,res)=>{
    try{
      await ensureSchema();
      const ownerId=String((req.currentUser||req.user).id);
      const {rows}=await pool.query("SELECT scenario_id,fingerprint,answer,status,revision,updated_at FROM pricing_training_answers WHERE owner_id=$1",[ownerId]);
      const current=new Map(pricingTrainingScenarios.map(s=>[s.id,s.fingerprint]));
      const answers=Object.fromEntries(rows.filter(r=>current.has(r.scenario_id)).map(r=>[r.scenario_id,{answer:current.get(r.scenario_id)===r.fingerprint?r.answer:emptyTrainingAnswer(),status:current.get(r.scenario_id)===r.fingerprint?r.status:"draft",revision:r.revision,updatedAt:r.updated_at}]));
      res.json({ownerId,version:1,scenarios:pricingTrainingScenarios,answers});
    }catch(error){console.error("Pricing training load failed",error);res.status(503).json({error:"Your training answers could not be loaded. Please retry."});}
  });
  router.put("/:id",async(req:any,res)=>{
    const parsed=bodySchema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:"Check your answer values.",details:parsed.error.flatten()});
    const scenario=pricingTrainingScenarios.find(s=>s.id===req.params.id);
    if(!scenario)return res.status(404).json({error:"Scenario not found."});
    const input=parsed.data;
    if(input.fingerprint!==scenario.fingerprint)return res.status(409).json({error:"This scenario changed. Reload before answering."});
    const problems=input.status==="reviewed"?trainingAnswerProblems(input.answer):[];
    if(problems.length)return res.status(400).json({error:problems.join(" ")});
    const ownerId=String((req.currentUser||req.user).id);
    try{
      await ensureSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const result= input.revision===0
          ? await client.query(`INSERT INTO pricing_training_answers(owner_id,scenario_id,fingerprint,answer,status) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING RETURNING *`,[ownerId,scenario.id,scenario.fingerprint,JSON.stringify(input.answer),input.status])
          : await client.query(`UPDATE pricing_training_answers SET fingerprint=$3,answer=$4::jsonb,status=$5,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND scenario_id=$2 AND revision=$6 RETURNING *`,[ownerId,scenario.id,scenario.fingerprint,JSON.stringify(input.answer),input.status,input.revision]);
        const row=result.rows[0];
        if(!row){await client.query("ROLLBACK");return res.status(409).json({error:"A newer answer was saved on another device. Reload and review it before saving."});}
        await client.query("INSERT INTO pricing_training_answer_history(owner_id,scenario_id,fingerprint,answer,status,revision) VALUES($1,$2,$3,$4::jsonb,$5,$6)",[ownerId,scenario.id,scenario.fingerprint,JSON.stringify(input.answer),input.status,row.revision]);
        await client.query("COMMIT");
        res.json({answer:row.answer,status:row.status,revision:row.revision,updatedAt:row.updated_at});
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    }catch(error){console.error("Pricing training save failed",error);res.status(503).json({error:"Answer was not saved. Keep this page open and retry."});}
  });
  router.get("/export/answers",async(req:any,res)=>{
    try{
      await ensureSchema();
      const {rows}=await pool.query("SELECT scenario_id,fingerprint,answer,status,revision,updated_at FROM pricing_training_answers WHERE owner_id=$1 ORDER BY scenario_id",[String((req.currentUser||req.user).id)]);
      const cases=rows.map(row=>{
        const scenario=pricingTrainingScenarios.find(s=>s.id===row.scenario_id&&s.fingerprint===row.fingerprint);
        if(!scenario)return null;
        const answer=trainingAnswerSchema.safeParse(row.answer);
        if(!answer.success)return null;
        return {scenario,answer:answer.data,status:row.status,revision:row.revision,updatedAt:row.updated_at,proposedGate:row.status==="reviewed"?replayTrainingMinimums({answer:answer.data,status:row.status,revision:row.revision,updatedAt:row.updated_at},{crew:Number(scenario.features.requestedCrew),scheduledHours:Number(scenario.features.requestedHours),billedHours:Number(scenario.features.requestedHours)},{minimumCrew:0,minimumHours:0}):null};
      }).filter(Boolean);
      res.setHeader("Content-Disposition",'attachment; filename="jc-pricing-training-answers.json"');
      res.json({version:1,liveRulesChanged:false,cases});
    }catch(error){console.error("Pricing training export failed",error);res.status(503).json({error:"Export failed. Please retry."});}
  });
  return router;
}
