import crypto from "crypto";
import { leadBotPilotRouter } from "./leadBotPilot";
import { Router, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  marketingBotChannelSchema,
  marketingBotEditSchema,
  marketingBotServiceSchema,
  marketingBotTerritorySchema,
} from "@shared/marketingBot";
import { users } from "@shared/schema";
import { db } from "../db";
import { escapeMarketingCampaignHtml } from "../services/marketingCampaignPolicy";
import {
  disconnectCompanyMetaConnection,
  importCompanyMetaConnections,
  listCompanyMetaConnections,
  verifyCompanyMetaConnection,
} from "../services/marketingCompanyMeta";
import { companyMetaPageCredentialsSchema } from "../services/marketingCompanyMetaPolicy";
import { getMarketingMetaPilotAdminState } from "../services/marketingMetaPilotPolicy";
import { ipRateLimit } from "../lib/persistentRateLimit";
import {
  generateMarketingBotCampaign,
  generateMarketingWeeklyReport,
  getMarketingBotCampaign,
  getPublicMarketingVariant,
  listMarketingBotDashboard,
  logMarketingBotEvent,
  publishMarketingBotCampaign,
  setMarketingCampaignDecision,
  startMarketingBotScheduler,
  updateMarketingBotCampaign,
} from "../services/marketingBot";
import {
  MarketingRepAccessError,
  beginMetaOAuth,
  completeMetaOAuthCallback,
  disconnectMetaPage,
  getMetaPilotAdminSetup,
  getRepMarketingBotDashboard,
  listMetaManagedPages,
  listOwnerRepPublishingOverview,
  marketingCrewRedirect,
  publishRepVariant,
  repCaptionInputSchema,
  saveRepVariantCaption,
  selectMetaManagedPage,
  selectMetaPageInputSchema,
  verifyMetaPageConnection,
} from "../services/marketingRepMeta";

const router = Router();

async function requireMarketingAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionUser = (req as any).user || (req as any).currentUser;
    const sessionUserId = (req.session as any)?.userId;
    const user = sessionUser || (sessionUserId
      ? (await db.select().from(users).where(eq(users.id, sessionUserId)).limit(1))[0]
      : null);
    if (!user || !["admin", "business_owner"].includes(user.role || "")) {
      return res.status(403).json({ error: "Owner or admin access required" });
    }
    (req as any).marketingActor = user;
    return next();
  } catch (error) {
    console.error("[marketing-bot] auth failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to verify access" });
  }
}

async function requireMarketingEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionUser = (req as any).user || (req as any).currentUser;
    const sessionUserId = (req.session as any)?.userId;
    const user = sessionUser || (sessionUserId
      ? (await db.select().from(users).where(eq(users.id, sessionUserId)).limit(1))[0]
      : null);
    if (!user || !["employee", "admin", "business_owner"].includes(user.role || "")) {
      return res.status(403).json({ error: "Crew access required" });
    }
    (req as any).marketingActor = user;
    return next();
  } catch (error) {
    console.error("[marketing-bot] crew auth failed:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Unable to verify crew access" });
  }
}

function actorId(req: Request) {
  return String((req as any).marketingActor?.id || "");
}

router.use(leadBotPilotRouter(requireMarketingAdmin));

function repError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: fallback, issues: error.issues });
  const status = error instanceof MarketingRepAccessError ? error.status : 409;
  return res.status(status).json({ error: error instanceof Error ? error.message : fallback });
}

const oauthRateLimit = ipRateLimit({
  scope: "marketing-meta-oauth",
  windowMs: 60 * 60 * 1000,
  maxHits: 12,
  message: "Too many Facebook connection attempts. Try again later.",
  identifier: (req) => actorId(req) || req.ip || "unknown",
});

const publishRateLimit = ipRateLimit({
  scope: "marketing-meta-publish",
  windowMs: 10 * 60 * 1000,
  maxHits: 12,
  message: "Too many Facebook publishing attempts. Try again shortly.",
  identifier: (req) => actorId(req) || req.ip || "unknown",
});

router.get("/admin/marketing-bot/dashboard", requireMarketingAdmin, async (_req, res) => {
  try {
    const [dashboard, representatives, companyConnections] = await Promise.all([
      listMarketingBotDashboard(),
      listOwnerRepPublishingOverview(),
      listCompanyMetaConnections(),
    ]);
    const connectedPages = companyConnections.filter((connection) => connection.status === "connected");
    const readiness = dashboard.readiness.map((entry) => entry.channel === "facebook"
      ? {
          ...entry,
          ready: connectedPages.length > 0,
          missing: connectedPages.length > 0 ? [] : ["JC Facebook Page connection"],
          note: connectedPages.length > 0
            ? `${connectedPages.length} JC Facebook Page${connectedPages.length === 1 ? " is" : "s are"} connected for explicit owner publishing.`
            : "Connect at least one approved JC Facebook Page before publishing.",
        }
      : entry);
    const metaPilot = getMetaPilotAdminSetup();
    const matt = representatives.find((representative) => representative.pilotAllowed);
    const metaPilotState = getMarketingMetaPilotAdminState({
      configured: metaPilot.configured,
      connectionStatus: matt?.connection?.status,
      connectionAuthorized: matt?.connection?.authorizedForPilot,
    });
    res.json({ ...dashboard, readiness, representatives, companyConnections, metaPilot: { ...metaPilot, state: metaPilotState } });
  } catch (error) {
    console.error("[marketing-bot] dashboard failed:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Failed to load Marketing Bot" });
  }
});

router.get("/admin/marketing-bot/campaigns/:id", requireMarketingAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const campaign = await getMarketingBotCampaign(id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid campaign" });
    res.status(500).json({ error: "Failed to load campaign" });
  }
});

router.post("/admin/marketing-bot/generate", requireMarketingAdmin, async (req, res) => {
  try {
    const input = z.object({
      service: marketingBotServiceSchema.optional(),
      territory: marketingBotTerritorySchema.optional(),
    }).parse(req.body || {});
    const campaign = await generateMarketingBotCampaign({
      source: "manual",
      actorId: actorId(req),
      forcedService: input.service,
      forcedTerritory: input.territory,
    });
    res.status(201).json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid campaign request", issues: error.issues });
    console.error("[marketing-bot] generation failed:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Campaign generation failed" });
  }
});

router.patch("/admin/marketing-bot/campaigns/:id", requireMarketingAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const draft = marketingBotEditSchema.parse(req.body || {});
    const campaign = await updateMarketingBotCampaign(id, draft, actorId(req));
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid campaign copy", issues: error.issues });
    res.status(409).json({ error: error instanceof Error ? error.message : "Campaign could not be updated" });
  }
});

router.post("/admin/marketing-bot/campaigns/:id/approve", requireMarketingAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const campaign = await setMarketingCampaignDecision(id, "approve", actorId(req));
    if (!campaign) return res.status(409).json({ error: "Campaign is not awaiting approval" });
    res.json({ campaign: await getMarketingBotCampaign(id) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid campaign" });
    res.status(500).json({ error: "Approval failed" });
  }
});

router.post("/admin/marketing-bot/campaigns/:id/skip", requireMarketingAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body || {});
    const campaign = await setMarketingCampaignDecision(id, "skip", actorId(req), reason);
    if (!campaign) return res.status(409).json({ error: "Campaign cannot be skipped now" });
    res.json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid skip request" });
    res.status(500).json({ error: "Skip failed" });
  }
});

router.post("/admin/marketing-bot/campaigns/:id/publish", requireMarketingAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({
      channels: z.array(marketingBotChannelSchema).min(1).max(3).default(["facebook"]),
      facebookConnectionIds: z.array(z.string().uuid()).max(10).default([]),
    }).parse(req.body || {});
    const campaign = await publishMarketingBotCampaign(id, actorId(req), false, input.channels, input.facebookConnectionIds);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid campaign" });
    res.status(409).json({ error: error instanceof Error ? error.message : "Publishing failed" });
  }
});

router.post("/admin/marketing-bot/campaigns/:id/retry", requireMarketingAdmin, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({
      channels: z.array(marketingBotChannelSchema).min(1).max(3).default(["facebook"]),
      facebookConnectionIds: z.array(z.string().uuid()).max(10).default([]),
    }).parse(req.body || {});
    const campaign = await publishMarketingBotCampaign(id, actorId(req), true, input.channels, input.facebookConnectionIds);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid campaign" });
    res.status(409).json({ error: error instanceof Error ? error.message : "Retry failed" });
  }
});

router.post("/admin/marketing-bot/meta/connections/import", requireMarketingAdmin, oauthRateLimit, async (req, res) => {
  try {
    const input = companyMetaPageCredentialsSchema.parse(req.body || {});
    res.status(201).json({ connections: await importCompanyMetaConnections(actorId(req), input.pages) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid Facebook Page credentials", issues: error.issues });
    res.status(409).json({ error: error instanceof Error ? error.message : "Facebook Pages could not be connected" });
  }
});

router.post("/admin/marketing-bot/meta/connections/:id/verify", requireMarketingAdmin, oauthRateLimit, async (req, res) => {
  try {
    const connectionId = z.string().uuid().parse(req.params.id);
    res.json({ connection: await verifyCompanyMetaConnection(actorId(req), connectionId) });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid Facebook Page connection" });
    res.status(409).json({ error: error instanceof Error ? error.message : "Facebook Page verification failed" });
  }
});

router.delete("/admin/marketing-bot/meta/connections/:id", requireMarketingAdmin, oauthRateLimit, async (req, res) => {
  try {
    const connectionId = z.string().uuid().parse(req.params.id);
    res.json(await disconnectCompanyMetaConnection(actorId(req), connectionId));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid Facebook Page connection" });
    res.status(409).json({ error: error instanceof Error ? error.message : "Facebook Page could not be disconnected" });
  }
});

router.get("/crew/marketing-bot/dashboard", requireMarketingEmployee, async (req, res) => {
  try {
    res.json(await getRepMarketingBotDashboard(actorId(req)));
  } catch (error) {
    repError(res, error, "Could not load your Marketing Bot campaigns");
  }
});

router.get("/crew/marketing-bot/meta/connect", requireMarketingEmployee, oauthRateLimit, async (req, res) => {
  try {
    res.json(await beginMetaOAuth(actorId(req)));
  } catch (error) {
    repError(res, error, "Could not start the Facebook connection");
  }
});

router.get("/crew/marketing-bot/meta/callback", requireMarketingEmployee, oauthRateLimit, async (req, res) => {
  try {
    const denied = z.string().max(100).optional().parse(req.query.error);
    if (denied) return res.redirect(302, marketingCrewRedirect({ meta_error: "Facebook access was not granted" }));
    const input = z.object({
      state: z.string().min(20).max(500),
      code: z.string().min(5).max(2000),
    }).parse(req.query);
    await completeMetaOAuthCallback(actorId(req), input.state, input.code);
    return res.redirect(302, marketingCrewRedirect({ meta: "choose" }));
  } catch (error) {
    console.error("[marketing-bot] Meta OAuth callback failed:", error instanceof Error ? error.message : error);
    return res.redirect(302, marketingCrewRedirect({ meta_error: "Facebook connection could not be completed. Please try again." }));
  }
});

router.get("/crew/marketing-bot/meta/pages", requireMarketingEmployee, oauthRateLimit, async (req, res) => {
  try {
    res.json({ pages: await listMetaManagedPages(actorId(req)) });
  } catch (error) {
    repError(res, error, "Could not load Facebook Pages");
  }
});

router.post("/crew/marketing-bot/meta/select-page", requireMarketingEmployee, oauthRateLimit, async (req, res) => {
  try {
    const input = selectMetaPageInputSchema.parse(req.body || {});
    res.json({ connection: await selectMetaManagedPage(actorId(req), input.pageId) });
  } catch (error) {
    repError(res, error, "Could not connect that Facebook Page");
  }
});

router.post("/crew/marketing-bot/meta/verify", requireMarketingEmployee, oauthRateLimit, async (req, res) => {
  try {
    res.json({ connection: await verifyMetaPageConnection(actorId(req)) });
  } catch (error) {
    repError(res, error, "Could not verify the Facebook Page connection");
  }
});

router.delete("/crew/marketing-bot/meta/connection", requireMarketingEmployee, oauthRateLimit, async (req, res) => {
  try {
    res.json(await disconnectMetaPage(actorId(req)));
  } catch (error) {
    repError(res, error, "Could not disconnect the Facebook Page");
  }
});

router.patch("/crew/marketing-bot/variants/:id", requireMarketingEmployee, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const input = repCaptionInputSchema.parse(req.body || {});
    res.json({ revision: await saveRepVariantCaption(actorId(req), id, input.caption) });
  } catch (error) {
    repError(res, error, "Could not save campaign copy");
  }
});

router.post("/crew/marketing-bot/variants/:id/publish", requireMarketingEmployee, publishRateLimit, async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({ retry: z.boolean().default(false) }).parse(req.body || {});
    res.json({ publication: await publishRepVariant(actorId(req), id, input.retry) });
  } catch (error) {
    repError(res, error, "Facebook Page publishing failed");
  }
});

router.post("/admin/marketing-bot/reports/generate", requireMarketingAdmin, async (_req, res) => {
  try {
    res.status(201).json({ report: await generateMarketingWeeklyReport() });
  } catch (error) {
    console.error("[marketing-bot] report failed:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Weekly report generation failed" });
  }
});

router.post("/admin/marketing-bot/events", requireMarketingAdmin, async (req, res) => {
  try {
    const input = z.object({
      variantCode: z.string().trim().min(5).max(160),
      eventType: z.enum(["lead", "booking"]),
      sourceNote: z.string().trim().max(300).optional(),
    }).parse(req.body || {});
    await logMarketingBotEvent({ variantCode: input.variantCode, eventType: input.eventType, metadata: { source: "staff_tag", note: input.sourceNote, actorId: actorId(req) } });
    res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid attribution event", issues: error.issues });
    res.status(500).json({ error: "Attribution could not be recorded" });
  }
});

function visitorId(req: Request, res: Response) {
  const cookieValue = String(req.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name === "jc_mb_visitor")?.[1];
  const existing = String((req as any).cookies?.jc_mb_visitor || cookieValue || "").replace(/[^a-z0-9-]/gi, "").slice(0, 80);
  if (existing) return existing;
  const next = crypto.randomUUID();
  res.cookie("jc_mb_visitor", next, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 365 * 24 * 60 * 60 * 1000 });
  return next;
}

function phoneDigits() {
  const digits = (process.env.COMPANY_PHONE || "906-285-9312").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits : `1${digits.slice(-10)}`;
}

router.get("/public/marketing-bot/click/:variantCode/:intent", async (req, res) => {
  try {
    const variantCode = z.string().trim().min(5).max(160).parse(req.params.variantCode);
    const intent = z.enum(["book", "call", "message"]).parse(req.params.intent);
    const variant = await getPublicMarketingVariant(variantCode);
    if (!variant) return res.status(404).send("Campaign not found");
    const eventType = intent === "book" ? "booking_click" : intent === "call" ? "call_click" : "message_click";
    await logMarketingBotEvent({ variantCode, eventType, visitorId: visitorId(req, res), metadata: { referrer: req.get("referer") || "", userAgent: req.get("user-agent") || "" } });
    if (intent === "call") return res.redirect(302, `tel:+${phoneDigits()}`);
    if (intent === "message") return res.redirect(302, `sms:+${phoneDigits()}?body=${encodeURIComponent(`I'm contacting JC ON THE MOVE about ${variant.variant_code}.`)}`);
    const catalogOffer = variant.facts && typeof variant.facts === "object" ? variant.facts.offer : null;
    const offerCode = typeof catalogOffer?.offerCode === "string" ? catalogOffer.offerCode : null;
    const destination = new URL(offerCode ? `/offers/${encodeURIComponent(offerCode)}` : "/book", `${req.protocol}://${req.get("host")}`);
    destination.searchParams.set("utm_source", variant.channel);
    destination.searchParams.set("utm_medium", "organic");
    destination.searchParams.set("utm_campaign", variant.campaign_code);
    destination.searchParams.set("utm_content", variant.variant_code);
    destination.searchParams.set("jc_campaign", variant.variant_code);
    destination.searchParams.set("jc_area", variant.territory);
    destination.searchParams.set("jc_focus", variant.service);
    if (variant.promo_code) destination.searchParams.set("promo", variant.promo_code);
    return res.redirect(302, destination.pathname + destination.search);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).send("Invalid campaign action");
    res.status(500).send("Campaign action failed");
  }
});

router.get("/public/marketing-bot/campaign/:variantCode", async (req, res) => {
  try {
    const variantCode = z.string().trim().min(5).max(160).parse(req.params.variantCode);
    const variant = await getPublicMarketingVariant(variantCode);
    if (!variant || variant.campaign_status === "skipped") return res.status(404).send("Campaign not found");
    await logMarketingBotEvent({ variantCode, eventType: "landing_view", visitorId: visitorId(req, res), metadata: { referrer: req.get("referer") || "" } });
    const title = escapeMarketingCampaignHtml(variant.headline);
    const description = escapeMarketingCampaignHtml(variant.short_caption);
    const image = escapeMarketingCampaignHtml(variant.og_image_url || variant.feed_image_url || variant.image_url);
    const book = `/api/public/marketing-bot/click/${encodeURIComponent(variantCode)}/book`;
    const call = `/api/public/marketing-bot/click/${encodeURIComponent(variantCode)}/call`;
    const message = `/api/public/marketing-bot/click/${encodeURIComponent(variantCode)}/message`;
    res.set("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | JC ON THE MOVE</title><meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${image}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"><style>body{margin:0;background:#020617;color:#fff;font:16px Arial,sans-serif}.wrap{max-width:760px;margin:auto;padding:28px}.card{overflow:hidden;border:1px solid #1e3a8a;border-radius:24px;background:#0f172a;box-shadow:0 24px 80px #0008}img{width:100%;display:block}main{padding:28px}h1{font-size:clamp(30px,7vw,54px);margin:0 0 12px}.brand{color:#60a5fa;font-weight:800;letter-spacing:.12em}.buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:24px}a{padding:14px 10px;border-radius:12px;text-align:center;text-decoration:none;font-weight:800;background:#2563eb;color:white}a:nth-child(2){background:#f97316}@media(max-width:560px){.buttons{grid-template-columns:1fr}}</style></head><body><div class="wrap"><div class="card"><img src="${image}" alt="${title}"><main><div class="brand">JC ON THE MOVE</div><h1>${title}</h1><p>${description}</p><div class="buttons"><a href="${book}">Book / Quote</a><a href="${call}">Call</a><a href="${message}">Message</a></div></main></div></div></body></html>`);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).send("Invalid campaign");
    res.status(500).send("Campaign could not be opened");
  }
});

startMarketingBotScheduler();

export default router;
