import { pool } from '../db';
import { getAppUrl } from '../appUrl';
import { parseJobEventWebhookUrls } from './jobEventBus';
import { reviewCelebrationBody } from './reviewCelebrationPolicy';

export const REVIEW_CELEBRATION_SCHEMA=`
CREATE TABLE IF NOT EXISTS review_celebration_outbox (
  event_key TEXT PRIMARY KEY, review_id VARCHAR NOT NULL REFERENCES reviews(id),
  crew_ids TEXT[] NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS review_worker_thanks (
  review_id VARCHAR NOT NULL REFERENCES reviews(id), worker_id VARCHAR NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(review_id,worker_id)
);
CREATE TABLE IF NOT EXISTS review_celebration_audit (
  id BIGSERIAL PRIMARY KEY,event_key TEXT NOT NULL REFERENCES review_celebration_outbox(event_key),
  actor_id VARCHAR NOT NULL REFERENCES users(id),action TEXT NOT NULL,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION queue_review_celebration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO review_celebration_outbox(event_key,review_id,crew_ids)
  SELECT 'review:'||NEW.id,NEW.id,ARRAY(SELECT DISTINCT id FROM unnest(
    COALESCE(l.crew_members,ARRAY[]::text[]) || COALESCE(l.accepted_by_employees,ARRAY[]::text[]) || ARRAY[l.assigned_to_user_id]
  ) id WHERE id IS NOT NULL) FROM leads l WHERE l.id=NEW.lead_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_celebration_insert ON reviews;
CREATE TRIGGER review_celebration_insert AFTER INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION queue_review_celebration();
CREATE OR REPLACE FUNCTION queue_review_tip_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.payroll_paid_at IS DISTINCT FROM OLD.payroll_paid_at THEN
    INSERT INTO review_celebration_outbox(event_key,review_id,crew_ids)
    SELECT 'tip:'||NEW.id||':'||NEW.status||':'||COALESCE(NEW.payroll_paid_at::text,'unpaid'),NEW.review_id,crew_ids
    FROM review_celebration_outbox WHERE event_key='review:'||NEW.review_id ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_tip_celebration_update ON review_tip_allocations;
CREATE TRIGGER review_tip_celebration_update AFTER UPDATE ON review_tip_allocations FOR EACH ROW EXECUTE FUNCTION queue_review_tip_update();
`;

let timer:ReturnType<typeof setInterval>|undefined;
let busy=false;
export async function startReviewCelebrations() {
  await pool.query(REVIEW_CELEBRATION_SCHEMA);
  if(timer)return;
  timer=setInterval(()=>{void deliverReviewCelebrations().catch(()=>console.error('[review-celebrations] delivery check failed'));},60000);
  timer.unref();
}
export async function deliverReviewCelebrations() {
  if(busy)return;
  busy=true;
  try {
    await pool.query(`UPDATE review_celebration_outbox SET status='uncertain',error='Delivery interrupted; reconcile before resending',updated_at=NOW()
      WHERE status='sending' AND updated_at<NOW()-INTERVAL '5 minutes'`);
    const webhook=parseJobEventWebhookUrls().find(value=>{const url=new URL(value);return ['discord.com','discordapp.com'].includes(url.hostname)&&url.pathname.startsWith('/api/webhooks/');});
    if(!webhook)return;
    const claimed=(await pool.query(`UPDATE review_celebration_outbox SET status='sending',updated_at=NOW()
      WHERE event_key=(SELECT event_key FROM review_celebration_outbox WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0];
    if(!claimed)return;
    let attempted=false;
    try {
      const review=(await pool.query(`SELECT rating FROM reviews WHERE id=$1`,[claimed.review_id])).rows[0];
      const crew=(await pool.query(`SELECT id,COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',last_name)),''),'Crew member') AS name
        FROM users WHERE id=ANY($1::varchar[]) AND role IN ('employee','admin','business_owner') ORDER BY first_name,id`,[claimed.crew_ids])).rows;
      const tips=(await pool.query(`SELECT worker_id,amount_usd,token_amount,tip_method,status,payroll_paid_at FROM review_tip_allocations WHERE review_id=$1 ORDER BY worker_id`,[claimed.review_id])).rows;
      const thanks=(await pool.query(`SELECT worker_id FROM review_worker_thanks WHERE review_id=$1`,[claimed.review_id])).rows.map(row=>row.worker_id);
      const origin=getAppUrl().replace(/\/$/,'');
      const body=reviewCelebrationBody({reviewId:claimed.review_id,rating:review.rating,origin,
        crew:crew.map(worker=>({...worker,avatarUrl:`${origin}/api/public/worker-avatar/${encodeURIComponent(worker.id)}.png`})),tips:tips as any,thanks,tipUpdate:claimed.event_key.startsWith('tip:')});
      const url=new URL(webhook);url.searchParams.set('wait','true');
      attempted=true;
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      if(!response.ok){
        await pool.query(`UPDATE review_celebration_outbox SET status=$2,error=$3,updated_at=NOW() WHERE event_key=$1`,[claimed.event_key,response.status>=500?'uncertain':'failed',`Discord HTTP ${response.status}`]);return;
      }
      const result=await response.json() as {id?:string};
      if(!result.id)throw new Error('No Discord confirmation');
      await pool.query(`UPDATE review_celebration_outbox SET status='delivered',message_id=$2,error=NULL,updated_at=NOW() WHERE event_key=$1`,[claimed.event_key,result.id]);
    }catch{
      await pool.query(`UPDATE review_celebration_outbox SET status=$2,error=$3,updated_at=NOW() WHERE event_key=$1`,[claimed.event_key,attempted?'uncertain':'failed',attempted?'Reconcile Discord before retrying':'Unable to prepare review alert']);
    }
  }finally{busy=false;}
}
