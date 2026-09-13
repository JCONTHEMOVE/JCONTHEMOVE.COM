import { pool } from '../db';
import { z } from 'zod';
import { marketingBotTerritorySchema } from '@shared/marketingBot';
import { GROWTH_PARTNERS, DEFAULT_GROWTH_GOALS, workerGrowthGoalsSchema, workerAvatarSchema, DEFAULT_WORKER_AVATAR } from '@shared/crewGrowth';

export const workerBotSetupSchema = z.object({
  territories: z.array(marketingBotTerritorySchema).min(1).max(6).transform(values => [...new Set(values)]),
  message: z.string().trim().min(30).max(1500),
  ideas: z.string().trim().max(1500),
  goals: workerGrowthGoalsSchema,
}).strict();

export async function ensureWorkerBotSetup() {
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_worker_bot_setup (
    rep_id VARCHAR PRIMARY KEY REFERENCES marketing_reps(id),
    territories JSONB NOT NULL DEFAULT '[]', message TEXT NOT NULL DEFAULT '',
    ideas TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); ALTER TABLE marketing_worker_bot_setup ADD COLUMN IF NOT EXISTS goals JSONB NOT NULL
    DEFAULT '{"outreach":3,"qualifiedInquiries":2,"bookings":1,"scenarios":5,"activeDays":3}'::jsonb;
    ALTER TABLE marketing_worker_bot_setup ADD COLUMN IF NOT EXISTS avatar JSONB NOT NULL
    DEFAULT '{"character":"mover","color":"cyan","accessory":"none"}'::jsonb`);
  // Stable notification IDs make boot/retry safe, including multiple application instances.
  await pool.query(`INSERT INTO notifications(id,user_id,type,title,message,data)
    SELECT 'marketing-bot-setup-v1:' || mr.id || ':' || mr.user_id, mr.user_id, 'system_alert',
      'Get your Marketing Bot ready',
      'Verify your promo code, choose your shared service areas, and personalize your first campaign. Open Crew Marketing to finish setup.',
      '{"url":"/crew/marketing","type":"marketing_bot_setup"}'::jsonb
    FROM marketing_reps mr JOIN users u ON u.id=mr.user_id
    WHERE mr.is_active=TRUE AND mr.slug=ANY($1::text[])
      AND u.role IN ('employee','admin','business_owner')
    ON CONFLICT(id) DO NOTHING`, [GROWTH_PARTNERS.map(partner => partner.slug)]);
}

export async function workerBotReadiness(userId: string) {
  const reps = (await pool.query(`SELECT mr.id,mr.slug,mr.display_name,mr.promo_code,
    EXISTS(SELECT 1 FROM promo_codes p WHERE UPPER(p.code)=UPPER(mr.promo_code)
      AND p.referral_user_id=mr.user_id AND p.is_active=TRUE
      AND (p.expires_at IS NULL OR p.expires_at>NOW())
      AND (p.max_uses IS NULL OR p.uses_count<p.max_uses)) AS promo_verified,
    COALESCE(s.territories,'[]'::jsonb) AS territories, COALESCE(s.message,'') AS message,
    COALESCE(s.ideas,'') AS ideas, s.goals, wa.preset AS avatar
    FROM marketing_reps mr LEFT JOIN marketing_worker_bot_setup s ON s.rep_id=mr.id
    LEFT JOIN worker_avatars wa ON wa.user_id=mr.user_id
    WHERE mr.user_id=$1 AND mr.is_active=TRUE`, [userId])).rows;
  if (reps.length !== 1) return { enrolled:false, reason:'Your owner needs to verify your single linked marketing profile.' };
  const rep = reps[0];
  const partner = GROWTH_PARTNERS.find(item => item.slug === rep.slug);
  if (!partner) return { enrolled:false, reason:'Your existing marketing profile is preserved; this campaign includes Matt, Troy, Bill and Evan.' };
  const campaigns = (await pool.query(`SELECT v.id,v.destination_url,c.headline,c.service,c.territory,c.status
    FROM marketing_bot_variants v JOIN marketing_bot_campaigns c ON c.id=v.campaign_id
    WHERE v.rep_id=$1 AND c.service=$2 AND c.territory=ANY($3::text[])
      AND c.approved_at IS NOT NULL AND c.status IN ('approved','published','partially_published')
      AND UPPER(v.promo_code)=UPPER($4)
    ORDER BY c.created_at DESC LIMIT 3`, [rep.id,partner.service,rep.territories,rep.promo_code])).rows;
  const steps = [
    {key:'promo',label:'Verified promo code and account',done:rep.promo_verified === true},
    {key:'areas',label:'Choose your shared service areas',done:rep.territories.length>0},
    {key:'message',label:'Save your personal message',done:rep.message.trim().length>=30},
    {key:'campaign',label:'Owner-approved campaign with your tracked link',done:campaigns.length>0},
  ];
  return { enrolled:true,rep,partner,campaigns,steps,ready:steps.every(step => step.done),
    goals:rep.goals || DEFAULT_GROWTH_GOALS,avatar:rep.avatar || DEFAULT_WORKER_AVATAR };
}
