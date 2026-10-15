import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { leads, quoteAttributions, type InsertLead } from "@shared/schema";
import { leadBotConfigSchema, leadBotSubmissionSchema, inquiryQualification, LEAD_BOT_QUESTIONS, LEAD_BOT_SERVICES, type LeadBotConfig, type LeadBotPublic, type LeadBotSubmission } from "@shared/leadBotPilot";
import { db, type DbTransaction } from "../db";

type Store = Pick<DbTransaction, "execute" | "insert" | "select">;
export class LeadBotError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const LEAD_BOT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS marketing_lead_bots (
    id UUID PRIMARY KEY, pilot_key TEXT NOT NULL UNIQUE CHECK (pilot_key='representative-v1'),
    config JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paused')),
    approval_hash TEXT, approved_by VARCHAR REFERENCES users(id), approved_at TIMESTAMPTZ,
    created_by VARCHAR NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS marketing_lead_bot_submissions (
    key_hash TEXT PRIMARY KEY, bot_id UUID NOT NULL REFERENCES marketing_lead_bots(id),
    revision INTEGER NOT NULL, payload_hash TEXT NOT NULL, identity_hash TEXT NOT NULL,
    lead_id VARCHAR NOT NULL REFERENCES leads(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS marketing_lead_bot_identity ON marketing_lead_bot_submissions(identity_hash,created_at);
  CREATE TABLE IF NOT EXISTS marketing_lead_bot_visits (
    bot_id UUID NOT NULL REFERENCES marketing_lead_bots(id), visitor_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(bot_id,visitor_hash)
  );
`;
let ready: Promise<void> | undefined;
export function ensureLeadBotSchema() {
  return ready ??= import("./marketingBot").then(module => module.ensureMarketingBotSchema()).then(async () => { await db.execute(sql.raw(LEAD_BOT_SCHEMA)); }).catch(error => { ready = undefined; throw error; });
}
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rows = async (store: Store, query: ReturnType<typeof sql>) => (await store.execute(query)).rows as any[];
const row = async (store: Store, query: ReturnType<typeof sql>) => (await rows(store, query))[0];
export function publicLeadBotEnabled(campaignId: string) {
  return process.env.LEAD_BOT_PUBLIC_ENABLED === "true" && process.env.LEAD_BOT_PUBLIC_CAMPAIGN_ID === campaignId;
}

async function binding(store: Store, config: LeadBotConfig) {
  const campaign = await row(store, sql`SELECT id,revision,service,territory,status,approved_at,headline
    FROM marketing_bot_campaigns WHERE id=${config.campaignId} FOR SHARE`);
  if (!campaign?.approved_at || !["approved", "published", "partially_published"].includes(campaign.status)
    || campaign.service !== config.service || campaign.territory !== config.territory) throw new LeadBotError("Choose an approved campaign matching this service and territory.");
  const rep = await row(store, sql`SELECT id,user_id,slug,promo_code,display_name,is_active FROM marketing_reps WHERE id=${config.representativeId} FOR SHARE`);
  if (!rep?.is_active || !rep.user_id) throw new LeadBotError("The representative needs an active profile linked to a user before receiving credit.");
  const repUser = await row(store, sql`SELECT status FROM users WHERE id=${rep.user_id} FOR SHARE`);
  if (repUser?.status !== "approved") throw new LeadBotError("The representative's linked user must be approved.");
  const variant = await row(store, sql`SELECT id,variant_code,promo_code,rep_slug FROM marketing_bot_variants
    WHERE id=${config.variantId} AND campaign_id=${config.campaignId} AND rep_id=${rep.id} AND is_company=FALSE FOR SHARE`);
  if (!variant || variant.rep_slug !== rep.slug || variant.promo_code !== rep.promo_code) throw new LeadBotError("The campaign's representative mapping changed. Review its variant first.");
  const referralPromo = await row(store, sql`SELECT referral_user_id FROM promo_codes WHERE code=${rep.promo_code} FOR SHARE`);
  if (referralPromo?.referral_user_id && referralPromo.referral_user_id !== rep.user_id) throw new LeadBotError("The representative and referral-code owners disagree. Correct the registry first.");
  let promotion = null;
  if (config.promotionId) {
    promotion = await row(store, sql`SELECT id,code,description,discount_percent,job_offer,expires_at,max_uses,uses_count,is_active,referral_user_id
      FROM promo_codes WHERE id=${config.promotionId} FOR SHARE`);
    if (!promotion?.is_active || (promotion.expires_at && new Date(promotion.expires_at).getTime() <= Date.now())
      || (promotion.max_uses != null && promotion.uses_count >= promotion.max_uses)
      || (promotion.referral_user_id && promotion.referral_user_id !== rep.user_id)) throw new LeadBotError("This promotion is unavailable or belongs to another representative.");
    // A normal redemption does not invalidate approval; exhaustion still blocks.
    delete promotion.uses_count;
  }
  return { campaign, rep, variant, promotion };
}
type Binding = Awaited<ReturnType<typeof binding>>;
type Bot = { id: string; config: LeadBotConfig; revision: number; status: string; approval_hash: string | null; approved_at: string | null };
async function loadBot(store: Store, id: string, lock = false): Promise<Bot> {
  const bot = await row(store, sql`SELECT * FROM marketing_lead_bots WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!bot) throw new LeadBotError("This request link is unavailable.", 404);
  return { ...bot, config: leadBotConfigSchema.parse(bot.config) };
}
async function approvedBot(store: Store, id: string) {
  const bot = await loadBot(store, id, true);
  if (!publicLeadBotEnabled(bot.config.campaignId) || bot.status !== "approved") throw new LeadBotError("This request link is not open yet.", 404);
  const bound = await binding(store, bot.config);
  if (bot.approval_hash !== hash({ config: bot.config, bound })) throw new LeadBotError("This request link needs owner review.", 409);
  return { bot, bound };
}
function publicView(bot: Bot, bound: Binding, preview: boolean): LeadBotPublic {
  return { id: bot.id, revision: bot.revision, name: bot.config.name, representative: bound.rep.display_name,
    service: bot.config.service, territory: bot.config.territory, towns: bot.config.towns, questions: bot.config.questions,
    promotion: bound.promotion ? { code: bound.promotion.code, description: bound.promotion.description } : null,
    preview, sharePath: `/lead-bot/${bot.id}` };
}
async function audit(store: Store, actor: string, bot: Bot, action: string) {
  await store.execute(sql`INSERT INTO marketing_bot_audit_events(actor_user_id,rep_id,action,target_type,target_id,metadata)
    VALUES(${actor},${bot.config.representativeId},${action},'lead_bot',${bot.id},${JSON.stringify({ revision: bot.revision, config: bot.config, approvalHash: bot.approval_hash })}::jsonb)`);
}
export async function saveLeadBot(store: Store, input: { id?: string; revision?: number; config: LeadBotConfig }, actor: string) {
  const config = leadBotConfigSchema.parse(input.config);
  await store.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lead-bot-single-pilot'))`);
  // Consistent bot -> registry lock order, shared with approval and intake.
  const current = input.id ? await loadBot(store, input.id, true) : null;
  await binding(store, config);
  let bot: Bot;
  if (input.id) {
    if (current!.revision !== input.revision) throw new LeadBotError("The draft changed. Reload before saving.");
    bot = await row(store, sql`UPDATE marketing_lead_bots SET config=${JSON.stringify(config)}::jsonb,revision=revision+1,status='draft',
      approval_hash=NULL,approved_at=NULL,approved_by=NULL,updated_at=NOW() WHERE id=${input.id} RETURNING *`);
  } else {
    if (await row(store, sql`SELECT id FROM marketing_lead_bots LIMIT 1`)) throw new LeadBotError("This pilot supports one campaign. Edit the existing draft.");
    bot = await row(store, sql`INSERT INTO marketing_lead_bots(id,pilot_key,config,created_by)
      VALUES(${crypto.randomUUID()},'representative-v1',${JSON.stringify(config)}::jsonb,${actor}) RETURNING *`);
  }
  await audit(store, actor, bot, "lead_bot_draft_saved");
  return bot;
}
export async function decideLeadBot(store: Store, id: string, revision: number, decision: "approve" | "pause", actor: string) {
  const bot = await loadBot(store, id, true);
  if (bot.revision !== revision) throw new LeadBotError("The draft changed. Reload before reviewing.");
  const approvalHash = decision === "approve" ? hash({ config: bot.config, bound: await binding(store, bot.config) }) : null;
  const updated = await row(store, sql`UPDATE marketing_lead_bots SET status=${decision === "approve" ? "approved" : "paused"},
    approval_hash=${approvalHash},approved_by=${decision === "approve" ? actor : null},
    approved_at=${decision === "approve" ? sql`NOW()` : sql`NULL`},updated_at=NOW() WHERE id=${id} RETURNING *`);
  await audit(store, actor, updated, `lead_bot_${decision}`);
  return updated;
}
export async function leadBotOptions(store: Store) {
  const representatives = await rows(store, sql`SELECT id,user_id,display_name,slug,promo_code FROM marketing_reps WHERE is_active=TRUE ORDER BY sort_order,display_name`);
  const campaigns = await rows(store, sql`SELECT c.id,c.headline,c.service,c.territory,v.id AS variant_id,v.rep_id
    FROM marketing_bot_campaigns c JOIN marketing_bot_variants v ON v.campaign_id=c.id
    WHERE c.approved_at IS NOT NULL AND c.status IN ('approved','published','partially_published') AND v.is_company=FALSE ORDER BY c.created_at DESC LIMIT 200`);
  const promotions = await rows(store, sql`SELECT id,code,description,referral_user_id FROM promo_codes
    WHERE is_active=TRUE AND (expires_at IS NULL OR expires_at>NOW()) AND (max_uses IS NULL OR uses_count<max_uses) ORDER BY code`);
  const storedBot = await row(store, sql`SELECT * FROM marketing_lead_bots LIMIT 1`);
  const bot = storedBot ? { ...storedBot, config: leadBotConfigSchema.parse(storedBot.config) } : null;
  const metrics = bot ? await row(store, sql`SELECT
    (SELECT COUNT(*)::int FROM marketing_lead_bot_visits WHERE bot_id=${bot.id}) AS views,
    COUNT(DISTINCT lead_id)::int AS inquiries FROM marketing_lead_bot_submissions WHERE bot_id=${bot.id}`) : { views: 0, inquiries: 0 };
  let reviewIssue: string | null = null;
  if (bot?.status === "approved") {
    try { if (bot.approval_hash !== hash({ config: bot.config, bound: await binding(store, bot.config) })) reviewIssue = "Registry or campaign changed. Review and approve again."; }
    catch (error) { reviewIssue = error instanceof Error ? error.message : "Review required"; }
  }
  return { representatives, campaigns, promotions, bot, metrics, reviewIssue,
    publicEnabled: Boolean(bot && bot.status === "approved" && !reviewIssue && publicLeadBotEnabled(bot.config.campaignId)), publishingEnabled: false, messagingEnabled: false };
}
export async function getLeadBotView(store: Store, id: string, preview = false) {
  if (preview) { const bot = await loadBot(store, id); return publicView(bot, await binding(store, bot.config), true); }
  const { bot, bound } = await approvedBot(store, id);
  return publicView(bot, bound, false);
}
export async function recordLeadBotVisit(store: Store, id: string, visitorId: string) {
  const { bot, bound } = await approvedBot(store, id);
  const visitorHash = hash(visitorId);
  const inserted = await rows(store, sql`INSERT INTO marketing_lead_bot_visits(bot_id,visitor_hash) VALUES(${bot.id},${visitorHash}) ON CONFLICT DO NOTHING RETURNING bot_id`);
  if (inserted.length) await store.execute(sql`INSERT INTO marketing_bot_events(campaign_id,variant_id,event_type,visitor_id,metadata)
    VALUES(${bound.campaign.id},${bound.variant.id},'landing_view',${visitorHash},${JSON.stringify({ source: "lead_bot_pilot", botId: bot.id, revision: bot.revision })}::jsonb)`);
}

export async function prepareLeadBotSubmission(input: unknown, store: Store = db) {
  // Checked before any schema creation or DB access on disabled deployments.
  if (process.env.LEAD_BOT_PUBLIC_ENABLED !== "true") throw new LeadBotError("This request link is not open yet.", 404);
  const submission = leadBotSubmissionSchema.parse(input);
  const { bot, bound } = await approvedBot(store, submission.leadBotId);
  if (submission.revision !== bot.revision) throw new LeadBotError("The questions changed. Reopen the link before submitting.");
  const error = inquiryQualification(bot.config, submission.inquiry);
  if (error) throw new LeadBotError(error, 422);
  const inquiry = submission.inquiry;
  const notes = [
    `Project scope: ${inquiry.scope}`,
    `Preferred timing: ${inquiry.timing} (${inquiry.timeZone}) — not a reservation`,
    ...bot.config.questions.map(key => `${LEAD_BOT_QUESTIONS[key]} ${inquiry.answers[key]}`),
    `Lead-bot inquiry: ${bot.id} revision ${bot.revision}; owner review required.`,
  ].join("\n");
  return { submission, approvalHash: bot.approval_hash, canonicalInput: {
    requestType: "project", firstName: inquiry.firstName, lastName: inquiry.lastName, email: inquiry.email, phone: inquiry.phone,
    serviceCode: LEAD_BOT_SERVICES[bot.config.service].intake,
    serviceAddress: `${inquiry.serviceAddress}, ${inquiry.city}, ${inquiry.state} ${inquiry.zip}`,
    city: inquiry.city, state: inquiry.state, zip: inquiry.zip, destinationAddress: inquiry.answers.destination || "",
    schedulingPreference: "callback", notes, promoCode: bound.promotion?.code || "", referralSlug: bound.rep.slug,
    marketingCampaignId: bound.variant.variant_code,
    marketingTracking: { utmSource: "lead_bot", utmMedium: "representative", utmCampaign: bound.campaign.id, jcCampaign: bound.variant.variant_code, jcArea: bot.config.territory, jcFocus: bot.config.service },
  } };
}
export type LeadBotContext = Awaited<ReturnType<typeof prepareLeadBotSubmission>>;

// Called INSIDE the existing quick-request transaction with its validated
// canonical lead data. Failure rolls back the lead, credit and conversion.
export async function commitLeadBotInquiry(store: Store, context: LeadBotContext, leadData: InsertLead) {
  const { submission } = context;
  const { bot, bound } = await approvedBot(store, submission.leadBotId);
  if (submission.revision !== bot.revision || context.approvalHash !== bot.approval_hash) throw new LeadBotError("The campaign changed. Reopen the link.");
  const keyHash = hash(submission.submissionKey);
  const normalized = JSON.parse(JSON.stringify(submission.inquiry), (_key, value) => typeof value === "string" ? value.toLowerCase().replace(/\s+/g, " ").trim() : value);
  const payloadHash = hash({ botId: bot.id, revision: bot.revision, inquiry: normalized });
  // The same inquiry under a new request key is still one lead. Names/emails
  // are excluded from identity so correcting contact spelling cannot duplicate it.
  const { firstName: _first, lastName: _last, email: _email, ...identity } = normalized;
  const identityHash = hash({ service: bot.config.service, identity });
  await store.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead-bot-key:${keyHash}`}))`);
  const prior = await row(store, sql`SELECT * FROM marketing_lead_bot_submissions WHERE key_hash=${keyHash}`);
  if (prior) {
    if (prior.payload_hash !== payloadHash) throw new LeadBotError("This submission was already received with different answers. Start a new inquiry.");
    return { lead: (await store.select().from(leads).where(eq(leads.id, prior.lead_id)).limit(1))[0], duplicate: true };
  }
  await store.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead-bot-inquiry:${identityHash}`}))`);
  const recent = await row(store, sql`SELECT lead_id FROM marketing_lead_bot_submissions WHERE identity_hash=${identityHash}
    AND created_at>NOW()-INTERVAL '24 hours' ORDER BY created_at LIMIT 1`);
  const lead = recent ? (await store.select().from(leads).where(eq(leads.id, recent.lead_id)).limit(1))[0]
    : (await store.insert(leads).values({ ...leadData, status: "quote_requested", createdByUserId: null }).returning())[0];
  if (!lead) throw new Error("Canonical inquiry could not be saved");
  await store.execute(sql`INSERT INTO marketing_lead_bot_submissions(key_hash,bot_id,revision,payload_hash,identity_hash,lead_id)
    VALUES(${keyHash},${bot.id},${bot.revision},${payloadHash},${identityHash},${lead.id})`);
  if (!recent) {
    const metadata = { source: "lead_bot_pilot", botId: bot.id, revision: bot.revision, representativeId: bound.rep.id,
      referralSlug: bound.rep.slug, marketingCampaignId: bound.variant.variant_code, jc_campaign: bound.variant.variant_code,
      campaignId: bound.variant.variant_code, selectedPromotion: bound.promotion?.code || null, marketingTracking: context.canonicalInput.marketingTracking };
    await store.insert(quoteAttributions).values({ leadId: lead.id, userId: bound.rep.user_id, promoCode: bound.rep.promo_code, attributionType: "marketing_rep_quick_request", metadata });
    await store.execute(sql`INSERT INTO marketing_bot_events(campaign_id,variant_id,event_type,visitor_id,metadata)
      VALUES(${bound.campaign.id},${bound.variant.id},'lead',${hash(submission.visitorId)},${JSON.stringify({ ...metadata, leadId: lead.id })}::jsonb)`);
  }
  return { lead, duplicate: Boolean(recent) };
}
