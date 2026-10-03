import { Router, type RequestHandler } from 'express';
import type { Pool } from '@neondatabase/serverless';
import { z } from 'zod';
import { pricingTrainingScenarios } from '@shared/pricingTrainingScenarios';
import { CREW_CAMPAIGN_START, CREW_CAMPAIGN_END, DAILY_ACTION_PREFIX } from '@shared/crewDailyHome';

type Database = Pick<Pool, 'query' | 'connect'>;
export const dailyHomeMigration = `
  ALTER TABLE marketing_action_assignments ADD COLUMN IF NOT EXISTS due_on DATE;
  ALTER TABLE marketing_action_assignments ADD COLUMN IF NOT EXISTS campaign_variant_id UUID;
  ALTER TABLE marketing_action_assignments ADD COLUMN IF NOT EXISTS campaign_revision INTEGER;
  ALTER TABLE marketing_action_assignments ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS idx_marketing_action_due ON marketing_action_assignments(rep_id, due_on) WHERE status='assigned';
`;
export function chicagoDay(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const proofUrl = z.string().trim().max(2000).url().refine(s => ['http:', 'https:'].includes(new URL(s).protocol));
const reachSchema = z.object({ variantId: z.string().uuid(), revision: z.number().int().positive(), destination: z.string().trim().min(3).max(200), proofUrl: proofUrl.optional().or(z.literal('')), proofNotes: z.string().trim().max(2000), nextDate: date }).strict()
  .refine(s => Boolean(s.proofUrl) || s.proofNotes.length >= 10, 'Add a public post URL or an outreach note of at least 10 characters.');
const followSchema = z.object({ outcome: z.string().trim().min(10).max(2000), nextDate: date.optional() }).strict();
class DailyError extends Error { constructor(public status: number, message: string) { super(message); } }

// Only the original owner-approved variant is used, never a worker's later caption edit.
export function validDailyVariant(row: any, rep: any, appUrl: string) {
  try {
    const expected = new URL(`/api/public/marketing-bot/campaign/${encodeURIComponent(row.variant_code)}`, appUrl).href;
    return row.destination_url === expected && row.caption.includes(expected)
      && row.promo_code === rep.promo_code && row.rep_slug === rep.slug;
  } catch { return false; }
}

export function createCrewDailyHomeRouter(staff: RequestHandler, db: Database, appUrl: string, now = () => new Date()) {
  const router = Router();
  let ready: Promise<unknown> | undefined;
  const route = (fn: (req: any, res: any) => Promise<any>): RequestHandler => async (req, res) => {
    try {
      ready ??= db.query(dailyHomeMigration).catch(e => { ready = undefined; throw e; });
      await ready;
      await fn(req, res);
    } catch (e) {
      if (e instanceof z.ZodError) return void res.status(400).json({ error: e.issues[0].message });
      if (e instanceof DailyError) return void res.status(e.status).json({ error: e.message });
      console.error('[crew-daily-home]', e);
      res.status(503).json({ error: 'Could not save or load your missions. Please retry.' });
    }
  };
  const actor = (req: any) => String(req.marketingActor.id);
  async function repFor(userId: string) {
    const { rows } = await db.query(`SELECT id, slug, display_name, promo_code, territory,
      EXISTS(SELECT 1 FROM promo_codes p WHERE UPPER(p.code)=UPPER(marketing_reps.promo_code)
        AND p.referral_user_id=marketing_reps.user_id AND p.is_active=TRUE
        AND (p.expires_at IS NULL OR p.expires_at>$2)
        AND (p.max_uses IS NULL OR p.uses_count<p.max_uses)) AS attribution_linked FROM marketing_reps
      WHERE user_id=$1 AND is_active=TRUE ORDER BY id`, [userId, now()]);
    // Ambiguous links must be corrected by the owner, not chosen arbitrarily.
    return rows.length === 1 && rows[0].attribution_linked && ['matt', 'troy', 'bill', 'evan'].includes(rows[0].slug) ? rows[0] : null;
  }
  function futureDate(value: string, day: string) {
    if (value <= day || value > '2026-11-30') throw new DailyError(400, 'Choose a future follow-up date through November 30.');
  }
  async function lockRep(query: Database['query'], rep: any, userId: string) {
    const { rows } = await query(`SELECT mr.id FROM marketing_reps mr JOIN promo_codes p ON UPPER(p.code)=UPPER(mr.promo_code)
      WHERE mr.id=$1 AND mr.user_id=$2 AND mr.is_active=TRUE AND p.referral_user_id=$2 AND p.is_active=TRUE
        AND (p.expires_at IS NULL OR p.expires_at>$3)
        AND (p.max_uses IS NULL OR p.uses_count<p.max_uses) FOR SHARE OF mr,p`, [rep.id, userId, now()]);
    if (!rows.length) throw new DailyError(409, 'Your profile changed. Reload your missions.');
  }
  async function variants(query: Database['query'], rep: any, day: string, lock = false) {
    return (await query(`SELECT v.*, c.revision, c.headline, c.service FROM marketing_bot_variants v
      JOIN marketing_bot_campaigns c ON c.id=v.campaign_id
      WHERE v.rep_id=$1 AND v.is_company=FALSE AND v.channel='facebook'
        AND c.local_date=$2::date AND c.approved_at IS NOT NULL AND c.approved_by_user_id IS NOT NULL
        AND c.status IN ('approved','publishing','partially_published','published','failed')
        AND c.safety->>'passed'='true'
      ORDER BY c.approved_at DESC, v.id ${lock ? 'FOR SHARE OF c, v' : ''}`, [rep.id, day])).rows
      .filter(row => validDailyVariant(row, rep, appUrl));
  }
  router.use(staff, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/', route(async (req, res) => {
    const day = chicagoDay(now()), active = day >= CREW_CAMPAIGN_START && day <= CREW_CAMPAIGN_END;
    const rep = await repFor(actor(req));
    if (!rep) return res.json({ day, active, rep: null, scenario: null, outreach: null, followup: null, followupSubmitted: false });
    const [approved, actions, trainingExists] = await Promise.all([
      active ? variants(db.query.bind(db), rep, day) : Promise.resolve([]),
      db.query(`SELECT id,title,status,proof_notes,due_on::text,action_key,submitted_at FROM marketing_action_assignments
        WHERE rep_id=$1 AND action_key LIKE $2 ORDER BY due_on NULLS LAST, created_at, id`, [rep.id, `${DAILY_ACTION_PREFIX}%`]),
      db.query(`SELECT to_regclass('pricing_training_contributions') AS present`),
    ]);
    const lane = approved[0]?.service || ({ matt: 'load_only', troy: 'junk_removal', bill: 'moving', evan: 'packing' } as Record<string, string>)[rep.slug];
    const relevant = pricingTrainingScenarios.filter(s => s.service === lane);
    const index = Math.max(0, Math.floor((Date.parse(day) - Date.parse(CREW_CAMPAIGN_START)) / 86400000));
    const scenario = (relevant.length ? relevant : pricingTrainingScenarios)[index % (relevant.length || pricingTrainingScenarios.length)];
    const submitted = trainingExists.rows[0]?.present ? (await db.query(`SELECT 1 FROM pricing_training_contributions
      WHERE user_id=$1 AND scenario_id=$2 AND fingerprint=$3 AND status='reviewed'`, [actor(req), scenario.id, scenario.fingerprint])).rows.length > 0 : false;
    const outreach = approved[0];
    const reach = actions.rows.find(a => a.action_key === `${DAILY_ACTION_PREFIX}${day}:reach`);
    const followupSubmitted = actions.rows.some(a => a.due_on && a.submitted_at && chicagoDay(new Date(a.submitted_at)) === day);
    const followup = followupSubmitted ? null : actions.rows.find(a => a.status === 'assigned' && a.due_on && a.due_on <= day) || null;
    res.json({ day, active, rep: { displayName: rep.display_name, territory: rep.territory, promoCode: rep.promo_code },
      scenario: { id: scenario.id, title: scenario.title, submitted },
      outreach: outreach ? { variantId: outreach.id, revision: outreach.revision, headline: outreach.headline, caption: outreach.caption,
        destinationUrl: outreach.destination_url, promoCode: outreach.promo_code, status: reach?.status || 'assigned' } : null,
      followup, followupSubmitted });
  }));
  router.post('/reach', route(async (req, res) => {
    const input = reachSchema.parse(req.body), day = chicagoDay(now());
    if (day < CREW_CAMPAIGN_START || day > CREW_CAMPAIGN_END) throw new DailyError(409, 'The outreach campaign is not active.');
    futureDate(input.nextDate, day);
    const rep = await repFor(actor(req));
    if (!rep) throw new DailyError(403, 'A unique active pilot profile is required.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await lockRep(client.query.bind(client), rep, actor(req));
      const variant = (await variants(client.query.bind(client), rep, day, true)).find(v => v.id === input.variantId && v.revision === input.revision);
      if (!variant) throw new DailyError(409, 'This copy is no longer approved for your profile today. Reload your missions.');
      const key = `${DAILY_ACTION_PREFIX}${day}:reach`;
      const result = await client.query(`INSERT INTO marketing_action_assignments
        (rep_id, action_key, title, description, status, proof_url, proof_notes, campaign_variant_id, campaign_revision, submitted_at)
        VALUES ($1,$2,'Share approved campaign',$3,'submitted',NULLIF($4,''),$5,$6,$7,$8)
        ON CONFLICT (rep_id,action_key) DO NOTHING RETURNING id`,
      [rep.id, key, variant.caption, input.proofUrl || '', `${input.destination}\n${input.proofNotes}`, variant.id, variant.revision, now()]);
      if (result.rows.length) await client.query(`INSERT INTO marketing_action_assignments
        (rep_id,action_key,title,description,due_on,campaign_variant_id,campaign_revision)
        VALUES ($1,$2,$3,'Follow up only with contacts who agreed to hear from you. Save the outcome here.',$4,$5,$6)
        ON CONFLICT (rep_id,action_key) DO NOTHING`,
      [rep.id, `${key}:followup`, `Follow up: ${input.destination}`, input.nextDate, variant.id, variant.revision]);
      await client.query('COMMIT');
      res.json({ status: 'submitted' });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }));
  router.post('/followups/:id', route(async (req, res) => {
    const input = followSchema.parse(req.body), day = chicagoDay(now());
    if (input.nextDate) futureDate(input.nextDate, day);
    const rep = await repFor(actor(req));
    if (!rep) throw new DailyError(403, 'A unique active pilot profile is required.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await lockRep(client.query.bind(client), rep, actor(req));
      const { rows } = await client.query(`SELECT * FROM marketing_action_assignments WHERE id=$1 AND rep_id=$2
        AND action_key LIKE $3 AND due_on <= $4::date FOR UPDATE`, [req.params.id, rep.id, `${DAILY_ACTION_PREFIX}%`, day]);
      const action = rows[0];
      if (!action) throw new DailyError(404, 'Due follow-up not found for your profile.');
      if (action.status === 'assigned') {
        await client.query(`UPDATE marketing_action_assignments SET status='submitted',proof_notes=$2,submitted_at=$3,updated_at=NOW() WHERE id=$1`, [action.id, input.outcome, now()]);
        if (input.nextDate) await client.query(`INSERT INTO marketing_action_assignments
          (rep_id,action_key,title,description,due_on,campaign_variant_id,campaign_revision)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (rep_id,action_key) DO NOTHING`,
        [rep.id, `${DAILY_ACTION_PREFIX}followup:${action.id}`, action.title, input.outcome, input.nextDate, action.campaign_variant_id, action.campaign_revision]);
      }
      await client.query('COMMIT'); res.json({ status: 'submitted' });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }));
  return router;
}
