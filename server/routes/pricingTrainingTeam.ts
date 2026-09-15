import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Pool, PoolClient } from '@neondatabase/serverless';
import { pricingTrainingScenarios as scenarios } from '@shared/pricingTrainingScenarios';
import { trainingAnswerSchema, trainingAnswerProblems, emptyTrainingAnswer } from '@shared/pricingTraining';
import { TRAINING_REWARDS } from '@shared/pricingTrainingTeam';

type Database = Pick<Pool,'query'|'connect'>;
type Dependencies = {
  reward: (client: PoolClient, userId: string, amount: number, reference: string, reviewerId: string) => Promise<void>;
  thank: (displayName: string, scenarioId: string, verifiedAmount?: number) => Promise<'sent'|'unconfigured'|'failed'|'uncertain'>;
};
const inputSchema=z.object({answer:trainingAnswerSchema,status:z.enum(['draft','reviewed']),revision:z.number().int().nonnegative(),fingerprint:z.string().length(64)}).strict();
const reviewSchema=z.object({revision:z.number().int().positive(),grade:z.enum(['contribution','mostly_correct','correct','rejected']),note:z.string().trim().min(1).max(2000)}).strict();
const userId=(req:any)=>String((req.currentUser||req.user).id);
const isOwner=(req:any)=>['admin','business_owner'].includes((req.currentUser||req.user).role);
const saved=(r:any)=>r?{answer:r.answer,status:r.status,revision:r.revision,updatedAt:r.updated_at}:undefined;
class RequestError extends Error { constructor(public status:number,message:string){super(message);} }

export function createPricingTrainingTeamRouter(auth:RequestHandler,staff:RequestHandler,owner:RequestHandler,pool:Database,deps:Dependencies){
  const router=Router(); let ready:Promise<void>|undefined;
  async function schema(){
    ready??=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_contributions (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id text NOT NULL REFERENCES users(id),
        scenario_id text NOT NULL, fingerprint text NOT NULL, answer jsonb NOT NULL,
        status text NOT NULL CHECK(status IN ('draft','reviewed')), revision integer NOT NULL DEFAULT 1,
        grade text CHECK(grade IN ('contribution','mostly_correct','correct','rejected')),
        review_note text, reviewer_id text, reviewed_revision integer, reward_amount integer NOT NULL DEFAULT 0,
        submitted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id,scenario_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_thanks (
        contribution_id text PRIMARY KEY REFERENCES pricing_training_contributions(id),
        display_name text NOT NULL, scenario_id text NOT NULL,
        status text NOT NULL DEFAULT 'pending', updated_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_verified_thanks (
        contribution_id text PRIMARY KEY REFERENCES pricing_training_contributions(id),
        display_name text NOT NULL, scenario_id text NOT NULL, reward_amount integer NOT NULL,
        status text NOT NULL DEFAULT 'pending', updated_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_final_audit (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text, owner_id text NOT NULL, scenario_id text NOT NULL,
        revision integer NOT NULL, actor_id text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_daily_prizes (
        day date PRIMARY KEY, awards jsonb NOT NULL DEFAULT '[]', awarded_at timestamptz NOT NULL DEFAULT now())`);
      // Same tables as the personal editor; never copy, clear or replace existing owner answers.
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_answers (owner_id text NOT NULL,scenario_id text NOT NULL,
        fingerprint text NOT NULL,answer jsonb NOT NULL,status text NOT NULL CHECK(status IN ('draft','reviewed')),
        revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,scenario_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS pricing_training_answer_history (owner_id text NOT NULL,scenario_id text NOT NULL,
        fingerprint text NOT NULL,answer jsonb NOT NULL,status text NOT NULL,revision integer NOT NULL,
        saved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,scenario_id,revision))`);
    })().catch(e=>{ready=undefined;throw e;}); await ready;
  }
  async function primaryOwner(){
    // Continue the owner's established answer set, including owners who sign
    // in with an account other than the legacy business email.
    const {rows}=await pool.query(`SELECT u.id FROM users u
      LEFT JOIN pricing_training_answers a ON a.owner_id=u.id
      WHERE u.role IN ('admin','business_owner')
      GROUP BY u.id,u.email,u.role
      ORDER BY count(a.scenario_id) DESC,
        (lower(u.email)=$1) DESC, (u.role='business_owner') DESC, u.id
      LIMIT 1`,['upmichiganstatemovers@gmail.com']);
    if(!rows[0])throw new RequestError(503,'The business owner account must be configured before team training starts.');
    return String(rows[0].id);
  }
  const route=(fn:(req:any,res:any)=>Promise<any>):RequestHandler=>async(req,res)=>{try{await schema();await fn(req,res);}catch(e){
    if(e instanceof RequestError)return res.status(e.status).json({error:e.message});
    console.error('[pricing-training-team]',e);res.status(503).json({error:'Could not complete this action. Your previous saved data is unchanged. Please retry.'});
  }};
  async function transaction<T>(fn:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function deliverThanks(id:string,verified=false){
    const table=verified?'pricing_training_verified_thanks':'pricing_training_thanks';
    const {rows}=await pool.query(`UPDATE ${table} SET status='sending',updated_at=now() WHERE contribution_id=$1 AND status IN ('pending','unconfigured') RETURNING *`,[id]);
    if(!rows[0])return;
    let result='uncertain';try{result=await deps.thank(rows[0].display_name,rows[0].scenario_id,verified?rows[0].reward_amount:undefined);}catch{}
    await pool.query(`UPDATE ${table} SET status=$2,updated_at=now() WHERE contribution_id=$1`,[id,result]);
    // Unknown outcomes are never automatically resent: Discord has no idempotency key.
  }
  // Recover submissions committed just before a process restart. A claimed or
  // uncertain delivery is not resent automatically, to avoid duplicate thanks.
  const thanksTimer=setInterval(()=>{if(!ready)return;void ready.then(async()=>{
    const {rows}=await pool.query("SELECT contribution_id FROM pricing_training_thanks WHERE status IN ('pending','unconfigured') ORDER BY updated_at LIMIT 5");
    for(const row of rows)await deliverThanks(row.contribution_id);
    const verified=await pool.query("SELECT contribution_id FROM pricing_training_verified_thanks WHERE status IN ('pending','unconfigured') ORDER BY updated_at LIMIT 5");
    for(const row of verified.rows)await deliverThanks(row.contribution_id,true);
  }).catch(()=>{});},30000);
  thanksTimer.unref();
  router.use(auth,staff,(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.get('/',route(async(req,res)=>{
    const ownerId=await primaryOwner();
    const [finals,mine,counts,scores]=await Promise.all([
      pool.query('SELECT scenario_id,fingerprint,status FROM pricing_training_answers WHERE owner_id=$1',[ownerId]),
      pool.query('SELECT * FROM pricing_training_contributions WHERE user_id=$1',[userId(req)]),
      pool.query(`SELECT scenario_id,count(*)::int AS responses,count(*) FILTER(WHERE grade IS NULL)::int AS pending FROM pricing_training_contributions WHERE status='reviewed' GROUP BY scenario_id`),
      // Aggregate only current scenarios. Never expose answers, notes, or scenario-level grades here.
      pool.query(`SELECT c.user_id AS "userId",COALESCE(NULLIF(u.first_name,''),NULLIF(u.username,''),'Coworker') AS "displayName",
        count(*) FILTER(WHERE c.status='reviewed')::int AS submitted,
        count(*) FILTER(WHERE c.status='draft')::int AS drafts,
        count(*) FILTER(WHERE c.status='reviewed' AND c.grade IS NOT NULL)::int AS reviewed,
        count(*) FILTER(WHERE c.status='reviewed' AND c.grade IS NULL)::int AS pending,
        count(*) FILTER(WHERE c.status='reviewed' AND c.grade='correct')::int AS correct,
        count(*) FILTER(WHERE c.status='reviewed' AND c.grade='mostly_correct')::int AS "mostlyCorrect",
        COALESCE(sum(c.reward_amount) FILTER(WHERE c.status='reviewed' AND c.grade IS NOT NULL),0)::int AS rewards,
        COALESCE(sum(c.reward_amount) FILTER(WHERE c.status='reviewed' AND c.grade IS NOT NULL AND (c.updated_at AT TIME ZONE 'America/Chicago')::date=(now() AT TIME ZONE 'America/Chicago')::date),0)::int AS "todayPoints",
        COALESCE(sum(GREATEST(c.reward_amount-100,0)) FILTER(WHERE c.status='reviewed' AND c.grade IS NOT NULL),0)::int AS bonus
        FROM pricing_training_contributions c JOIN users u ON u.id=c.user_id
        JOIN jsonb_to_recordset($1::jsonb) AS current(id text,fingerprint text) ON current.id=c.scenario_id AND current.fingerprint=c.fingerprint
        GROUP BY c.user_id,u.first_name,u.username`,[JSON.stringify(scenarios.map(s=>({id:s.id,fingerprint:s.fingerprint})))])
    ]);
    const current=new Map(scenarios.map(s=>[s.id,s.fingerprint]));
    const completed=finals.rows.filter(r=>r.status==='reviewed'&&current.get(r.scenario_id)===r.fingerprint).map(r=>r.scenario_id);
    const myScore=scores.rows.find(r=>r.userId===userId(req))??{userId:userId(req),displayName:'You',submitted:0,drafts:0,reviewed:0,pending:0,correct:0,mostlyCorrect:0,rewards:0,bonus:0,todayPoints:0};
    const leaderboard=scores.rows.filter(r=>r.submitted>0).map(({drafts,...r})=>r);
    res.json({ownerId,userId:userId(req),canReview:isOwner(req),scenarios,completed,counts:counts.rows,myScore,leaderboard,
      answers:Object.fromEntries(mine.rows.map(r=>[r.scenario_id,{...saved(r),grade:r.grade,rewardAmount:r.reward_amount,reviewNote:r.review_note}])),rewards:TRAINING_REWARDS});
  }));
  router.post('/daily-prize',owner,route(async(req,res)=>{
    const result=await transaction(async c=>{
      const date=await c.query(`SELECT to_char((now() AT TIME ZONE 'America/Chicago')::date-1,'YYYY-MM-DD') AS day`);
      const day=date.rows[0].day;
      const claim=await c.query(`INSERT INTO pricing_training_daily_prizes(day) VALUES($1) ON CONFLICT DO NOTHING RETURNING day`,[day]);
      if(!claim.rows.length){const previous=await c.query('SELECT awards FROM pricing_training_daily_prizes WHERE day=$1',[day]);return {day,awards:previous.rows[0].awards,alreadyAwarded:true};}
      const scores=await c.query(`SELECT c.user_id AS "userId",COALESCE(NULLIF(u.first_name,''),NULLIF(u.username,''),'Coworker') AS "displayName",sum(c.reward_amount)::int AS points
        FROM pricing_training_contributions c JOIN users u ON u.id=c.user_id
        JOIN jsonb_to_recordset($2::jsonb) AS current(id text,fingerprint text) ON current.id=c.scenario_id AND current.fingerprint=c.fingerprint
        WHERE c.status='reviewed' AND c.grade IS NOT NULL AND c.reward_amount>0
        AND (c.updated_at AT TIME ZONE 'America/Chicago')::date=$1::date
        GROUP BY c.user_id,u.first_name,u.username ORDER BY points DESC,c.user_id`,[day,JSON.stringify(scenarios.map(s=>({id:s.id,fingerprint:s.fingerprint})))]);
      const leaders=scores.rows.filter(r=>r.points===scores.rows[0]?.points);
      const awards=[];
      for(const [i,leader] of leaders.entries()){
        const amount=Math.floor(1000/leaders.length)+(i<1000%leaders.length?1:0);
        if(!amount)continue;
        await deps.reward(c,leader.userId,amount,`pricing-training-daily:${day}:${leader.userId}`,userId(req));
        await c.query(`INSERT INTO notifications(id,user_id,type,title,message,data) VALUES($1,$2,'reward_available',$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING`,
          [`training-daily:${day}:${leader.userId}`,leader.userId,`Daily leaderboard · +${amount} JCMOVES`,`${day}: ${leader.points} owner-verified points. ${leaders.length>1?'The 1,000 JCMOVES prize was split among tied leaders.':'You earned the 1,000 JCMOVES daily prize.'}`,JSON.stringify({type:'training_daily_prize',url:'/crew/pricing-training',amount,day})]);
        awards.push({...leader,amount});
      }
      await c.query('UPDATE pricing_training_daily_prizes SET awards=$2::jsonb WHERE day=$1',[day,JSON.stringify(awards)]);
      return {day,awards,alreadyAwarded:false};
    });res.json(result);
  }));
  router.get('/scenario/:id',route(async(req,res)=>{
    const scenario=scenarios.find(s=>s.id===req.params.id);if(!scenario)throw new RequestError(404,'Request not found.');
    if(!isOwner(req)){
      const mine=await pool.query('SELECT status,fingerprint FROM pricing_training_contributions WHERE user_id=$1 AND scenario_id=$2',[userId(req),scenario.id]);
      if(mine.rows[0]?.status!=='reviewed'||mine.rows[0]?.fingerprint!==scenario.fingerprint){
        return res.json({canCompare:false,responses:[],final:null});
      }
    }
    const ownerId=await primaryOwner();
    const [responses,final]=await Promise.all([
      pool.query(`SELECT c.*,COALESCE(NULLIF(u.first_name,''),NULLIF(u.username,''),'Coworker') AS display_name,t.status AS thanks_status,v.status AS verified_thanks_status
        FROM pricing_training_contributions c JOIN users u ON u.id=c.user_id LEFT JOIN pricing_training_thanks t ON t.contribution_id=c.id LEFT JOIN pricing_training_verified_thanks v ON v.contribution_id=c.id
        WHERE c.scenario_id=$1 AND c.status='reviewed' AND c.fingerprint=$2 ORDER BY c.submitted_at,c.id`,[scenario.id,scenario.fingerprint]),
      pool.query('SELECT * FROM pricing_training_answers WHERE owner_id=$1 AND scenario_id=$2',[ownerId,scenario.id])
    ]);
    const r=final.rows[0];
    const visibleFinal=r&&(isOwner(req)||(r.status==='reviewed'&&r.fingerprint===scenario.fingerprint));
    res.json({canCompare:true,responses:responses.rows.map(c=>({id:c.id,userId:c.user_id,displayName:c.display_name,answer:c.answer,revision:c.revision,grade:c.grade,rewardAmount:c.reward_amount,reviewNote:c.review_note,thanksStatus:isOwner(req)?(c.grade?c.verified_thanks_status:c.thanks_status):undefined})),
      final:visibleFinal?{...saved(r),...(r.fingerprint!==scenario.fingerprint?{answer:emptyTrainingAnswer(),status:'draft'}:{})}:null});
  }));
  router.put('/:id',route(async(req,res)=>{
    const parsed=inputSchema.safeParse(req.body);if(!parsed.success)throw new RequestError(400,'Check your answer values.');
    const s=scenarios.find(s=>s.id===req.params.id);if(!s)throw new RequestError(404,'Request not found.');
    const p=parsed.data;if(p.fingerprint!==s.fingerprint)throw new RequestError(409,'This request changed. Reload first.');
    if(p.status==='reviewed'){const errors=trainingAnswerProblems(p.answer);if(errors.length)throw new RequestError(400,errors.join(' '));}
    const row=await transaction(async c=>{
      const {rows}=p.revision===0?await c.query(`INSERT INTO pricing_training_contributions(user_id,scenario_id,fingerprint,answer,status,submitted_at)
        VALUES($1,$2,$3,$4::jsonb,$5,CASE WHEN $5='reviewed' THEN now() ELSE NULL END) ON CONFLICT DO NOTHING RETURNING *`,[userId(req),s.id,s.fingerprint,JSON.stringify(p.answer),p.status]):
        await c.query(`UPDATE pricing_training_contributions SET fingerprint=$3,answer=$4::jsonb,status=$5,revision=revision+1,updated_at=now(),
          submitted_at=CASE WHEN $5='reviewed' THEN COALESCE(submitted_at,now()) ELSE submitted_at END
          WHERE user_id=$1 AND scenario_id=$2 AND revision=$6 AND grade IS NULL RETURNING *`,[userId(req),s.id,s.fingerprint,JSON.stringify(p.answer),p.status,p.revision]);
      if(!rows[0])throw new RequestError(409,'This contribution was updated or reviewed. Reload before continuing.');
      if(p.status==='reviewed')await c.query(`INSERT INTO notifications(id,user_id,type,title,message,data)
        VALUES($1,$2,'jcmoves_pending','Answer submitted · JCMOVES pending',$3,$4::jsonb) ON CONFLICT(id) DO NOTHING`,
        [`training-submit:${rows[0].id}`,userId(req),`${s.id}: your answer is saved. Owner approval can award 100 JCMOVES for contribution, 150 mostly correct, or 200 correct. No credit has been issued yet.`,JSON.stringify({url:`/crew/pricing-training?scenario=${s.id}`,type:'training_submitted',scenarioId:s.id})]);
      if(p.status==='reviewed')await c.query(`INSERT INTO pricing_training_thanks(contribution_id,display_name,scenario_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[rows[0].id,String((req.currentUser||req.user).firstName||(req.currentUser||req.user).username||'A coworker').slice(0,80),s.id]);
      return rows[0];
    });
    if(p.status==='reviewed')void deliverThanks(row.id).catch(()=>{});
    res.json(saved(row));
  }));
  router.post('/review/:id',owner,route(async(req,res)=>{
    const parsed=reviewSchema.safeParse(req.body);if(!parsed.success)throw new RequestError(400,'Choose a rating and add a review note.');
    const p=parsed.data;
    const result=await transaction(async c=>{
      const {rows}=await c.query('SELECT * FROM pricing_training_contributions WHERE id=$1 FOR UPDATE',[req.params.id]);const row=rows[0];
      if(!row||row.status!=='reviewed')throw new RequestError(404,'Submitted contribution not found.');
      if(row.user_id===userId(req))throw new RequestError(403,'You cannot reward your own contribution.');
      if(row.grade){if(row.reviewed_revision===p.revision&&row.grade===p.grade)return {grade:row.grade,rewardAmount:row.reward_amount,alreadyReviewed:true};throw new RequestError(409,'This contribution has already been rated and rewarded.');}
      if(row.revision!==p.revision||!scenarios.some(s=>s.id===row.scenario_id&&s.fingerprint===row.fingerprint))throw new RequestError(409,'The contribution changed. Reload before reviewing.');
      const amount=TRAINING_REWARDS[p.grade];
      if(amount)await deps.reward(c,row.user_id,amount,`pricing-training:${row.id}`,userId(req));
      await c.query('UPDATE pricing_training_contributions SET grade=$2,review_note=$3,reviewer_id=$4,reviewed_revision=revision,reward_amount=$5,updated_at=now() WHERE id=$1',[row.id,p.grade,p.note,userId(req),amount]);
      await c.query(`INSERT INTO notifications(id,user_id,type,title,message,data)
        VALUES($1,$2,'reward_available',$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING`,
        [`training-review:${row.id}`,row.user_id,amount?`Owner verified · +${amount} JCMOVES`:'Owner review complete',`${row.scenario_id}: ${p.note}${amount?` ${amount} JCMOVES credited (${Math.min(100,amount)} contribution + ${Math.max(0,amount-100)} bonus).`:' No JCMOVES credited.'}`,JSON.stringify({url:`/crew/pricing-training?scenario=${row.scenario_id}`,type:'training_verified',scenarioId:row.scenario_id,amount,grade:p.grade})]);
      await c.query(`INSERT INTO pricing_training_verified_thanks(contribution_id,display_name,scenario_id,reward_amount)
        SELECT $1,COALESCE(NULLIF(first_name,''),NULLIF(username,''),'A coworker'),$3,$4 FROM users WHERE id=$2 ON CONFLICT DO NOTHING`,[row.id,row.user_id,row.scenario_id,amount]);
      return {grade:p.grade,rewardAmount:amount};
    });void deliverThanks(String(req.params.id),true).catch(()=>{});res.json(result);
  }));
  router.post('/thanks/:id/retry',owner,route(async(req,res)=>{
    await pool.query("UPDATE pricing_training_thanks SET status='pending' WHERE contribution_id=$1 AND status='failed'",[req.params.id]);
    await deliverThanks(String(req.params.id));
    await pool.query("UPDATE pricing_training_verified_thanks SET status='pending' WHERE contribution_id=$1 AND status='failed'",[req.params.id]);
    await deliverThanks(String(req.params.id),true);
    res.json({ok:true});
  }));
  router.put('/final/:id',owner,route(async(req,res)=>{
    const parsed=inputSchema.safeParse(req.body);if(!parsed.success)throw new RequestError(400,'Check the final answer.');
    const p=parsed.data,s=scenarios.find(s=>s.id===req.params.id);if(!s)throw new RequestError(404,'Request not found.');
    if(p.fingerprint!==s.fingerprint)throw new RequestError(409,'This request changed. Reload first.');
    if(p.status==='reviewed'){const errors=trainingAnswerProblems(p.answer);if(errors.length)throw new RequestError(400,errors.join(' '));}
    const ownerId=await primaryOwner();
    const row=await transaction(async c=>{
      const args=[ownerId,s.id,s.fingerprint,JSON.stringify(p.answer),p.status];
      const {rows}=p.revision===0?await c.query(`INSERT INTO pricing_training_answers(owner_id,scenario_id,fingerprint,answer,status) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING RETURNING *`,args):
        await c.query(`UPDATE pricing_training_answers SET fingerprint=$3,answer=$4::jsonb,status=$5,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND scenario_id=$2 AND revision=$6 RETURNING *`,[...args,p.revision]);
      if(!rows[0])throw new RequestError(409,'A newer final answer exists. Reload before saving.');
      await c.query('INSERT INTO pricing_training_answer_history(owner_id,scenario_id,fingerprint,answer,status,revision) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[...args,rows[0].revision]);
      await c.query('INSERT INTO pricing_training_final_audit(owner_id,scenario_id,revision,actor_id) VALUES($1,$2,$3,$4)',[ownerId,s.id,rows[0].revision,userId(req)]);
      return rows[0];
    });res.json(saved(row));
  }));
  return router;
}
