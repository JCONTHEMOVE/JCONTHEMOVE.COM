import { Router, type NextFunction, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db, pool } from "../db";
import { notifications, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendNotificationEmail } from "../services/email";
import { smsService } from "../services/sms";
import { getAppUrl } from "../appUrl";
import { ROUTE_DAY_SCHEDULE } from "@shared/routeDays";

const DISCORD_INVITE_URL = "https://discord.gg/8zVq5dxKQ";
const QUALIFYING_LEAD_STATUSES = ["booked", "confirmed", "assigned", "available", "in_progress", "completed"];
const QUALIFYING_BOOKING_STATUSES = ["booked", "in_progress", "completed"];

type MarketingActorRequest = Request & { marketingActor?: any };

async function loadActor(req: Request) {
  let user = (req as any).user || (req as any).currentUser || null;
  const sessionUserId = (req.session as any)?.userId;
  if (!user && sessionUserId) {
    user = (await db.select().from(users).where(eq(users.id, sessionUserId)).limit(1))[0] || null;
  }
  return user;
}

async function requireEmployee(req: MarketingActorRequest, res: Response, next: NextFunction) {
  try {
    const user = await loadActor(req);
    if (!user || !["employee", "admin", "business_owner"].includes(user.role || "")) {
      return res.status(403).json({ error: "Crew access required" });
    }
    req.marketingActor = user;
    return next();
  } catch (error) {
    return res.status(500).json({ error: "Unable to verify crew access" });
  }
}

async function requireOwner(req: MarketingActorRequest, res: Response, next: NextFunction) {
  try {
    const user = await loadActor(req);
    if (!user || !["admin", "business_owner"].includes(user.role || "")) {
      return res.status(403).json({ error: "Business owner access required" });
    }
    req.marketingActor = user;
    return next();
  } catch (error) {
    return res.status(500).json({ error: "Unable to verify owner access" });
  }
}

async function ensureMarketingExecutionSchema() {
  await pool.query(`
    ALTER TABLE marketing_reps ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS marketing_goal_cycles (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      label TEXT NOT NULL UNIQUE,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      target_revenue NUMERIC(12,2) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_goal_cycles_active ON marketing_goal_cycles(is_active, ends_on);

    CREATE TABLE IF NOT EXISTS marketing_action_assignments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      rep_id VARCHAR NOT NULL REFERENCES marketing_reps(id) ON DELETE CASCADE,
      goal_cycle_id VARCHAR REFERENCES marketing_goal_cycles(id) ON DELETE SET NULL,
      action_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      route_key TEXT,
      service_focus TEXT,
      status TEXT NOT NULL DEFAULT 'assigned',
      proof_url TEXT,
      proof_notes TEXT,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(rep_id, action_key)
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_action_rep_status ON marketing_action_assignments(rep_id, status);

    CREATE TABLE IF NOT EXISTS marketing_invites (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      rep_id VARCHAR REFERENCES marketing_reps(id) ON DELETE SET NULL,
      recipient_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      recipient_name TEXT NOT NULL DEFAULT 'Crew member',
      recipient_email TEXT,
      recipient_phone TEXT,
      invite_token VARCHAR NOT NULL UNIQUE,
      delivery_channel TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'draft',
      delivery_note TEXT,
      sent_at TIMESTAMP,
      opened_at TIMESTAMP,
      account_linked_at TIMESTAMP,
      tutorial_completed_at TIMESTAMP,
      launch_started_at TIMESTAMP,
      created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_invite_rep ON marketing_invites(rep_id, status);
    CREATE INDEX IF NOT EXISTS idx_marketing_invite_recipient ON marketing_invites(recipient_user_id, status);

    CREATE TABLE IF NOT EXISTS tutorial_step_completions (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tutorial_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      completed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, tutorial_id, step_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tutorial_completion_user ON tutorial_step_completions(user_id, completed_at);

    CREATE TABLE IF NOT EXISTS marketing_revenue_credits (
      source_key TEXT PRIMARY KEY,
      rep_id VARCHAR NOT NULL REFERENCES marketing_reps(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id VARCHAR NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      credited_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_revenue_credit_rep ON marketing_revenue_credits(rep_id, credited_at);
  `);

  await pool.query(`
    INSERT INTO marketing_goal_cycles (label, starts_on, ends_on, target_revenue, is_active)
    VALUES
      ('10 Bands by July 31', '2026-07-11', '2026-07-31', 10000.00, TRUE),
      ('50 Bands by September 30', '2026-07-11', '2026-09-30', 50000.00, TRUE),
      ('100 Bands by December 31', '2026-07-11', '2026-12-31', 100000.00, TRUE)
    ON CONFLICT (label) DO UPDATE
      SET starts_on = EXCLUDED.starts_on,
          ends_on = EXCLUDED.ends_on,
          target_revenue = EXCLUDED.target_revenue,
          is_active = TRUE,
          updated_at = NOW();
  `);

  await pool.query(`
    WITH july_goal AS (
      SELECT id FROM marketing_goal_cycles WHERE label = '10 Bands by July 31' LIMIT 1
    ), launch_actions(action_key, title, description, route_key) AS (
      VALUES
        ('launch-profile', 'Verify profile and promo ownership', 'Confirm the marketing profile, public rep page, phone, and promo code are ready for booking attribution.', NULL),
        ('launch-campaign', 'Create one tracked route-day ad', 'Use the in-app ad builder to create a campaign with a shared route, your service angle, promo code, and booking link.', NULL),
        ('launch-publish', 'Publish or share the campaign', 'Share the tracked campaign to an approved local group, personal network, listing, or partner channel and save the proof link or note.', NULL),
        ('launch-outreach', 'Complete direct outreach', 'Reach out to local contacts, partners, past customers, or property connections with the right rep page and booking path.', NULL),
        ('launch-followup', 'Log follow-up and proof', 'Record the post link, response, or next follow-up so the team can see what is working.', NULL)
    )
    INSERT INTO marketing_action_assignments (rep_id, goal_cycle_id, action_key, title, description, route_key, service_focus)
    SELECT mr.id, july_goal.id, launch_actions.action_key, launch_actions.title, launch_actions.description,
           launch_actions.route_key, COALESCE(mr.service_focus[1], 'Local marketing')
    FROM marketing_reps mr
    CROSS JOIN july_goal
    CROSS JOIN launch_actions
    WHERE mr.is_active = TRUE
    ON CONFLICT (rep_id, action_key) DO NOTHING;
  `);
}

async function syncRevenueCredits() {
  await pool.query(`
    INSERT INTO marketing_revenue_credits (source_key, rep_id, source_type, source_id, amount, credited_at, updated_at)
    SELECT 'lead:' || l.id, mr.id, 'lead', l.id, COALESCE(l.total_price::numeric, l.base_price::numeric, 0), NOW(), NOW()
    FROM leads l
    INNER JOIN marketing_reps mr ON UPPER(mr.promo_code) = UPPER(l.promo_code)
    WHERE l.promo_code IS NOT NULL
      AND l.status = ANY($1::text[])
    ON CONFLICT (source_key) DO UPDATE
      SET rep_id = EXCLUDED.rep_id,
          amount = EXCLUDED.amount,
          updated_at = NOW();
  `, [QUALIFYING_LEAD_STATUSES]);

  await pool.query(`
    INSERT INTO marketing_revenue_credits (source_key, rep_id, source_type, source_id, amount, credited_at, updated_at)
    SELECT 'booking:' || source.id, source.rep_id, 'booking', source.id, COALESCE(source.final_total::numeric, 0), NOW(), NOW()
    FROM (
      SELECT DISTINCT ON (b.id) b.id, b.final_total, mr.id AS rep_id
      FROM bookings b
      INNER JOIN quote_attributions qa ON qa.booking_id = b.id
      INNER JOIN marketing_reps mr ON UPPER(mr.promo_code) = UPPER(qa.promo_code)
      WHERE b.status = ANY($1::text[])
      ORDER BY b.id, qa.created_at DESC
    ) source
    ON CONFLICT (source_key) DO UPDATE
      SET rep_id = EXCLUDED.rep_id,
          amount = EXCLUDED.amount,
          updated_at = NOW();
  `, [QUALIFYING_BOOKING_STATUSES]);
}

function inviteMessage(input: { recipientName: string; repName?: string | null; token: string }) {
  const appUrl = getAppUrl();
  const onboarding = `${appUrl}/marketing-onboarding?invite=${encodeURIComponent(input.token)}`;
  const repPage = input.repName ? `${appUrl}/network/${input.repName}` : appUrl;
  return [
    `Hey ${input.recipientName}, JC ON THE MOVE is launching the crew marketing plan.`,
    "Start with the marketing tutorial, make a tracked post, and help turn local requests into booked work for the family.",
    `Onboarding: ${onboarding}`,
    `Your JC ON THE MOVE link: ${repPage}`,
    `Join the crew Discord: ${DISCORD_INVITE_URL}`,
  ].join("\n\n");
}

async function overviewPayload() {
  await syncRevenueCredits();
  const [reps, goals, actions, invites, crew, matchingAccounts] = await Promise.all([
    pool.query(`
      SELECT mr.id, mr.slug, mr.display_name, mr.brand_name, mr.tagline, mr.promo_code,
             mr.service_focus, mr.territory, mr.audience, mr.user_id, mr.is_active,
             u.first_name AS linked_first_name, u.last_name AS linked_last_name, u.role AS linked_role,
             pc.referral_user_id,
             COALESCE(SUM(rc.amount), 0)::float AS booked_revenue
      FROM marketing_reps mr
      LEFT JOIN users u ON u.id = mr.user_id
      LEFT JOIN promo_codes pc ON UPPER(pc.code) = UPPER(mr.promo_code)
      LEFT JOIN marketing_revenue_credits rc ON rc.rep_id = mr.id
      WHERE mr.is_active = TRUE
      GROUP BY mr.id, u.first_name, u.last_name, u.role, pc.referral_user_id
      ORDER BY mr.sort_order, mr.display_name
    `),
    pool.query(`
      SELECT g.*, COALESCE((SELECT SUM(amount) FROM marketing_revenue_credits), 0)::float AS credited_revenue
      FROM marketing_goal_cycles g
      WHERE g.is_active = TRUE
      ORDER BY g.ends_on ASC
    `),
    pool.query(`
      SELECT a.*, mr.slug, mr.display_name
      FROM marketing_action_assignments a
      INNER JOIN marketing_reps mr ON mr.id = a.rep_id
      WHERE mr.is_active = TRUE
      ORDER BY mr.sort_order, a.created_at, a.title
    `),
    pool.query(`
      SELECT i.id, i.rep_id, i.recipient_user_id, i.recipient_name, i.delivery_channel, i.status,
             i.delivery_note, i.sent_at, i.opened_at, i.account_linked_at, i.tutorial_completed_at,
             i.launch_started_at, i.created_at, mr.display_name AS rep_name
      FROM marketing_invites i
      LEFT JOIN marketing_reps mr ON mr.id = i.rep_id
      ORDER BY i.created_at DESC
      LIMIT 40
    `),
    pool.query(`
      SELECT id, first_name, last_name, email, phone_number, role, status
      FROM users
      WHERE role IN ('employee', 'admin', 'business_owner')
      ORDER BY first_name, last_name
    `),
    pool.query(`
      SELECT id, first_name, last_name, role, status
      FROM users
      WHERE LOWER(first_name) = ANY(ARRAY['matt', 'troy', 'evan', 'bill', 'darrell'])
      ORDER BY created_at ASC
    `),
  ]);

  const actionMap = new Map<string, any[]>();
  for (const action of actions.rows) {
    const rows = actionMap.get(action.rep_id) || [];
    rows.push(action);
    actionMap.set(action.rep_id, rows);
  }

  const accountsByFirstName = new Map<string, any[]>();
  for (const account of matchingAccounts.rows) {
    const key = String(account.first_name || "").toLowerCase();
    accountsByFirstName.set(key, [...(accountsByFirstName.get(key) || []), account]);
  }
  const eligibleRoles = new Set(["employee", "admin", "business_owner"]);
  const enrichedReps = reps.rows.map((rep) => {
    const accountLinked = Boolean(rep.user_id);
    const attributionLinked = Boolean(rep.referral_user_id && rep.user_id && rep.referral_user_id === rep.user_id);
    const name = String(rep.display_name || "rep");
    const matchingAccount = (accountsByFirstName.get(name.toLowerCase()) || [])[0];
    const onboardingTask = accountLinked && attributionLinked
      ? null
      : accountLinked
        ? `Finish ${name}'s promo attribution link.`
        : !matchingAccount
          ? `Create ${name}'s crew account, then link this profile.`
          : !eligibleRoles.has(matchingAccount.role || "")
            ? `Approve or upgrade ${name}'s crew access, then link this profile.`
            : `Link ${name}'s existing crew account and promo code.`;
    return {
      ...rep,
      accountLinked,
      attributionLinked,
      onboardingTask,
      actions: actionMap.get(rep.id) || [],
      profileUrl: `${getAppUrl()}/network/${rep.slug}`,
    };
  });

  const routes = [
    ...ROUTE_DAY_SCHEDULE.map((route) => ({ ...route, shared: true })),
    {
      key: "ironwood-any-day",
      label: "Ironwood / Hurley any day",
      day: "Any day",
      area: "Ironwood, MI / Hurley, WI / Northwoods",
      nearbyAreas: ["Bessemer", "Mercer", "Watersmeet", "Eagle River"],
      serviceKeywords: ["Ironwood movers", "Northwoods junk removal", "cabin hauling"],
      shared: true,
    },
  ];

  return {
    siteUrl: getAppUrl(),
    discordInviteUrl: DISCORD_INVITE_URL,
    reps: enrichedReps,
    goals: (() => {
      const dayMs = 86_400_000;
      const calendarDay = (value: unknown) => {
        const date = new Date(value as string | Date);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      };
      const today = calendarDay(new Date());
      let priorTarget = 0;
      let priorEnd: number | null = null;

      return goals.rows.map((goal) => {
        const targetRevenue = Number(goal.target_revenue);
        const creditedRevenue = Number(goal.credited_revenue);
        const phaseStart = priorEnd === null ? calendarDay(goal.starts_on) : priorEnd + dayMs;
        const phaseEnd = calendarDay(goal.ends_on);
        const phaseTarget = Math.max(0, targetRevenue - priorTarget);
        const phaseDays = Math.max(1, Math.floor((phaseEnd - phaseStart) / dayMs) + 1);
        const phaseCredited = Math.min(phaseTarget, Math.max(0, creditedRevenue - priorTarget));
        const phaseRemaining = Math.max(0, phaseTarget - phaseCredited);
        const phaseIsActive = today >= phaseStart && today <= phaseEnd;
        const daysRemaining = phaseIsActive
          ? Math.max(0, Math.floor((phaseEnd - today) / dayMs) + 1)
          : phaseDays;
        const dailyPace = phaseTarget / phaseDays;
        const currentRequiredDailyPace = phaseIsActive && daysRemaining > 0
          ? phaseRemaining / daysRemaining
          : dailyPace;
        const remaining = Math.max(0, targetRevenue - creditedRevenue);
        priorTarget = targetRevenue;
        priorEnd = phaseEnd;

        return {
          ...goal,
          progressPercent: targetRevenue > 0 ? Math.min(100, (creditedRevenue / targetRevenue) * 100) : 0,
          daysRemaining,
          remaining,
          dailyPace,
          currentRequiredDailyPace,
          phaseTarget,
          phaseCredited,
          phaseDays,
          suggestedRepShare: targetRevenue / Math.max(1, enrichedReps.length),
        };
      });
    })(),
    routes,
    invites: invites.rows,
    eligibleUsers: crew.rows.map((row) => ({
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Crew member",
      email: row.email || null,
      phone: row.phone_number || null,
      role: row.role,
      status: row.status,
    })),
    launch: {
      total: actions.rows.length,
      completed: actions.rows.filter((action) => {
        const rep = enrichedReps.find((candidate) => candidate.id === action.rep_id);
        return action.status === "completed" && rep?.attributionLinked;
      }).length,
      pendingAttribution: actions.rows.filter((action) => {
        const rep = enrichedReps.find((candidate) => candidate.id === action.rep_id);
        return action.status === "completed" && !rep?.attributionLinked;
      }).length,
    },
  };
}

const linkRepSchema = z.object({ repId: z.string().uuid(), userId: z.string().min(1) });
const actionUpdateSchema = z.object({ proofUrl: z.string().url().max(2000).optional().or(z.literal("")), proofNotes: z.string().trim().max(2000).optional() });
const inviteSchema = z.object({
  repId: z.string().uuid().optional().nullable(),
  recipientUserId: z.string().min(1).optional().nullable(),
  recipientName: z.string().trim().min(1).max(120),
  recipientEmail: z.string().email().optional().or(z.literal("")),
  recipientPhone: z.string().trim().max(40).optional().or(z.literal("")),
  deliveryChannel: z.enum(["in_app", "email", "sms", "manual"]).default("manual"),
  sendNow: z.boolean().default(false),
});

export async function createMarketingExecutionRouter() {
  await ensureMarketingExecutionSchema();
  const router = Router();

  router.get("/admin/marketing-execution/overview", requireOwner, async (_req, res) => {
    try {
      return res.json(await overviewPayload());
    } catch (error) {
      console.error("[marketing-execution] overview failed", error);
      return res.status(500).json({ error: "Could not load marketing execution data" });
    }
  });

  router.post("/admin/marketing-execution/link-rep", requireOwner, async (req: MarketingActorRequest, res) => {
    try {
      const { repId, userId } = linkRepSchema.parse(req.body);
      const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
      if (!user) return res.status(404).json({ error: "Crew account not found" });
      const linked = await pool.query(`
        UPDATE marketing_reps SET user_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id, promo_code, display_name
      `, [userId, repId]);
      if (!linked.rows[0]) return res.status(404).json({ error: "Marketing profile not found" });
      await pool.query(`
        UPDATE promo_codes SET referral_user_id = $1, updated_at = NOW() WHERE UPPER(code) = UPPER($2)
      `, [userId, linked.rows[0].promo_code]);
      await pool.query(`
        UPDATE marketing_invites
        SET recipient_user_id = $1, account_linked_at = COALESCE(account_linked_at, NOW()), status = CASE WHEN status = 'draft' THEN 'account_linked' ELSE status END, updated_at = NOW()
        WHERE rep_id = $2 AND recipient_user_id IS NULL
      `, [userId, repId]);
      return res.json({ success: true, rep: linked.rows[0] });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Could not link marketing profile" });
    }
  });

  router.post("/admin/marketing-execution/actions/:id/complete", requireOwner, async (req, res) => {
    try {
      const parsed = actionUpdateSchema.parse(req.body || {});
      const result = await pool.query(`
        UPDATE marketing_action_assignments
        SET status = 'completed', proof_url = NULLIF($1, ''), proof_notes = $2, completed_at = NOW(), updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `, [parsed.proofUrl || "", parsed.proofNotes || null, req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: "Marketing action not found" });
      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Could not complete marketing action" });
    }
  });

  router.post("/admin/marketing-execution/invites", requireOwner, async (req: MarketingActorRequest, res) => {
    try {
      const input = inviteSchema.parse(req.body || {});
      let linkedUser: any = null;
      if (input.recipientUserId) {
        linkedUser = (await db.select().from(users).where(eq(users.id, input.recipientUserId)).limit(1))[0] || null;
      }
      const token = crypto.randomUUID().replace(/-/g, "");
      const created = await pool.query(`
        INSERT INTO marketing_invites (rep_id, recipient_user_id, recipient_name, recipient_email, recipient_phone, invite_token, delivery_channel, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        input.repId || null,
        input.recipientUserId || null,
        input.recipientName,
        input.recipientEmail || linkedUser?.email || null,
        input.recipientPhone || linkedUser?.phoneNumber || null,
        token,
        input.deliveryChannel,
        req.marketingActor?.id || null,
      ]);
      const invite = created.rows[0];
      const rep = input.repId ? await pool.query("SELECT slug FROM marketing_reps WHERE id = $1", [input.repId]) : { rows: [] };
      const message = inviteMessage({ recipientName: invite.recipient_name, repName: rep.rows[0]?.slug || null, token });
      const inviteUrl = `${getAppUrl()}/marketing-onboarding?invite=${token}`;
      let deliveryNote = "Draft saved. Copy the invitation or send it when a delivery channel is ready.";
      let status = "draft";

      if (input.sendNow) {
        const failures: string[] = [];
        let delivered = false;
        if (input.deliveryChannel === "in_app" && input.recipientUserId) {
          await db.insert(notifications).values({
            userId: input.recipientUserId,
            type: "system_alert",
            title: "JC marketing launch invitation",
            message,
            data: { inviteUrl, discordInviteUrl: DISCORD_INVITE_URL, type: "marketing_invite" },
          });
          delivered = true;
        } else if (input.deliveryChannel === "email" && invite.recipient_email) {
          const sent = await sendNotificationEmail(invite.recipient_email, "JC ON THE MOVE marketing launch", message.replace(/\n/g, "<br />"), message);
          delivered = sent;
          if (!sent) failures.push("Email delivery is not configured or failed");
        } else if (input.deliveryChannel === "sms" && invite.recipient_phone) {
          const sent = await smsService.sendSMS(invite.recipient_phone, message);
          delivered = sent.success;
          if (!sent.success) failures.push(sent.error || "SMS delivery failed");
        } else {
          failures.push("The selected delivery channel needs a matching recipient contact");
        }
        status = delivered ? "sent" : "delivery_failed";
        deliveryNote = delivered ? `Invitation sent by ${input.deliveryChannel}.` : failures.join("; ");
        await pool.query(`
          UPDATE marketing_invites SET status = $1, delivery_note = $2, sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = $3
        `, [status, deliveryNote, invite.id]);
      }
      return res.json({ invite: { ...invite, status, delivery_note: deliveryNote }, inviteUrl, message, discordInviteUrl: DISCORD_INVITE_URL });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Could not create marketing invite" });
    }
  });

  router.get("/marketing-execution/my-launch", requireEmployee, async (req: MarketingActorRequest, res) => {
    try {
      const rep = (await pool.query(`
        SELECT id, slug, display_name, brand_name, promo_code, service_focus, territory, audience
        FROM marketing_reps WHERE user_id = $1 AND is_active = TRUE LIMIT 1
      `, [req.marketingActor?.id])).rows[0];
      const completedTutorial = await pool.query(`
        SELECT COUNT(*)::int AS count FROM tutorial_step_completions
        WHERE user_id = $1 AND tutorial_id = 'worker-marketing-launch'
      `, [req.marketingActor?.id]);
      if (!rep) return res.json({ rep: null, actions: [], tutorialStepsDone: Number(completedTutorial.rows[0]?.count || 0), discordInviteUrl: DISCORD_INVITE_URL });
      const actions = await pool.query(`
        SELECT * FROM marketing_action_assignments WHERE rep_id = $1 ORDER BY created_at, title
      `, [rep.id]);
      return res.json({
        rep: { ...rep, profileUrl: `${getAppUrl()}/network/${rep.slug}` },
        actions: actions.rows,
        tutorialStepsDone: Number(completedTutorial.rows[0]?.count || 0),
        discordInviteUrl: DISCORD_INVITE_URL,
      });
    } catch (error) {
      return res.status(500).json({ error: "Could not load your marketing launch" });
    }
  });

  router.post("/marketing-execution/my-actions/:id/complete", requireEmployee, async (req: MarketingActorRequest, res) => {
    try {
      const parsed = actionUpdateSchema.parse(req.body || {});
      const result = await pool.query(`
        UPDATE marketing_action_assignments a
        SET status = 'completed', proof_url = NULLIF($1, ''), proof_notes = $2, completed_at = NOW(), updated_at = NOW()
        FROM marketing_reps mr
        WHERE a.id = $3 AND a.rep_id = mr.id AND mr.user_id = $4
        RETURNING a.*
      `, [parsed.proofUrl || "", parsed.proofNotes || null, req.params.id, req.marketingActor?.id]);
      if (!result.rows[0]) return res.status(404).json({ error: "Marketing action not found for your profile" });
      await pool.query(`
        UPDATE marketing_invites SET launch_started_at = COALESCE(launch_started_at, NOW()), status = CASE WHEN status IN ('draft', 'sent', 'opened', 'account_linked') THEN 'launch_started' ELSE status END, updated_at = NOW()
        WHERE recipient_user_id = $1
      `, [req.marketingActor?.id]);
      return res.json(result.rows[0]);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Could not complete marketing action" });
    }
  });

  router.get("/tutorial-progress", requireEmployee, async (req: MarketingActorRequest, res) => {
    const result = await pool.query(`
      SELECT tutorial_id, step_id FROM tutorial_step_completions WHERE user_id = $1
    `, [req.marketingActor?.id]);
    return res.json({ completed: result.rows.map((row) => `${row.tutorial_id}:${row.step_id}`) });
  });

  router.put("/tutorial-progress/:tutorialId/:stepId", requireEmployee, async (req: MarketingActorRequest, res) => {
    const complete = Boolean(req.body?.complete);
    const tutorialId = String(req.params.tutorialId || "").slice(0, 100);
    const stepId = String(req.params.stepId || "").slice(0, 100);
    if (!tutorialId || !stepId) return res.status(400).json({ error: "Tutorial step is required" });
    if (complete) {
      await pool.query(`
        INSERT INTO tutorial_step_completions (user_id, tutorial_id, step_id) VALUES ($1, $2, $3)
        ON CONFLICT (user_id, tutorial_id, step_id) DO NOTHING
      `, [req.marketingActor?.id, tutorialId, stepId]);
      if (tutorialId === "worker-marketing-launch") {
        await pool.query(`
          UPDATE marketing_invites SET tutorial_completed_at = COALESCE(tutorial_completed_at, NOW()), status = CASE WHEN status IN ('draft', 'sent', 'opened', 'account_linked') THEN 'tutorial_completed' ELSE status END, updated_at = NOW()
          WHERE recipient_user_id = $1
        `, [req.marketingActor?.id]);
      }
    } else {
      await pool.query(`DELETE FROM tutorial_step_completions WHERE user_id = $1 AND tutorial_id = $2 AND step_id = $3`, [req.marketingActor?.id, tutorialId, stepId]);
    }
    return res.json({ success: true, complete });
  });

  router.delete("/tutorial-progress", requireEmployee, async (req: MarketingActorRequest, res) => {
    const raw = String(req.query.tutorialIds || "");
    const tutorialIds = raw.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 30);
    if (!tutorialIds.length) return res.status(400).json({ error: "Tutorial ids are required" });
    await pool.query(`DELETE FROM tutorial_step_completions WHERE user_id = $1 AND tutorial_id = ANY($2::text[])`, [req.marketingActor?.id, tutorialIds]);
    return res.json({ success: true });
  });

  router.get("/marketing-execution/invite/:token", async (req, res) => {
    const token = String(req.params.token || "").trim();
    const result = await pool.query(`
      SELECT i.recipient_name, i.status, mr.display_name, mr.brand_name, mr.slug, mr.promo_code
      FROM marketing_invites i LEFT JOIN marketing_reps mr ON mr.id = i.rep_id
      WHERE i.invite_token = $1
      LIMIT 1
    `, [token]);
    const invite = result.rows[0];
    if (!invite) return res.status(404).json({ error: "Marketing invite not found" });
    await pool.query(`
      UPDATE marketing_invites SET opened_at = COALESCE(opened_at, NOW()), status = CASE WHEN status IN ('draft', 'sent', 'delivery_failed') THEN 'opened' ELSE status END, updated_at = NOW()
      WHERE invite_token = $1
    `, [token]);
    return res.json({
      recipientName: invite.recipient_name,
      status: invite.status,
      rep: invite.slug ? { displayName: invite.display_name, brandName: invite.brand_name, slug: invite.slug, promoCode: invite.promo_code } : null,
      discordInviteUrl: DISCORD_INVITE_URL,
      siteUrl: getAppUrl(),
      tutorialUrl: `${getAppUrl()}/crew/tutorials`,
    });
  });

  return router;
}
