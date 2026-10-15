import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import { ipRateLimit } from "../lib/persistentRateLimit";
import { leadBotConfigSchema } from "@shared/leadBotPilot";
import { decideLeadBot, ensureLeadBotSchema, getLeadBotView, LeadBotError, leadBotOptions, recordLeadBotVisit, saveLeadBot } from "../services/leadBotPilot";

// Authentication is the existing marketing-module owner/admin middleware.
export function leadBotPilotRouter(requireMarketingAdmin: RequestHandler, dependencies = { db, ensureLeadBotSchema, ipRateLimit }) {
  const { db, ensureLeadBotSchema, ipRateLimit } = dependencies;
  const router = Router();
  const admin = Router();
  admin.use(requireMarketingAdmin);
  admin.use(async (_req, res, next) => {
    try { await ensureLeadBotSchema(); next(); }
    catch { res.status(503).json({ error: "The pilot could not be loaded. Please try again." }); }
  });
  admin.get("/", async (_req, res, next) => {
    try { res.json(await db.transaction(tx => leadBotOptions(tx))); } catch (error) { next(error); }
  });
  admin.post("/", async (req, res, next) => {
    try {
      const input = z.object({ id: z.string().uuid().optional(), revision: z.number().int().positive().optional(), config: leadBotConfigSchema }).strict().parse(req.body);
      res.status(input.id ? 200 : 201).json(await db.transaction(tx => saveLeadBot(tx, input, (req as any).marketingActor.id)));
    } catch (error) { next(error); }
  });
  admin.post("/:id/decision", async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const input = z.object({ revision: z.number().int().positive(), decision: z.enum(["approve", "pause"]) }).strict().parse(req.body);
      res.json(await db.transaction(tx => decideLeadBot(tx, id, input.revision, input.decision, (req as any).marketingActor.id)));
    } catch (error) { next(error); }
  });
  admin.get("/:id/preview", async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(await db.transaction(tx => getLeadBotView(tx, z.string().uuid().parse(req.params.id), true))); }
    catch (error) { next(error); }
  });
  router.use("/admin/marketing-bot/lead-bot-pilot", admin);
  router.use("/lead-bots", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (process.env.LEAD_BOT_PUBLIC_ENABLED !== "true") return res.status(404).json({ error: "This request link is not open yet." });
    next();
  }, ipRateLimit({ scope: "lead_bot_public", windowMs: 60_000, maxHits: 40, message: "Please wait a moment and try again." }));
  router.get("/lead-bots/:id", async (req, res, next) => {
    try { res.json(await db.transaction(tx => getLeadBotView(tx, z.string().uuid().parse(req.params.id)))); }
    catch (error) { next(error); }
  });
  router.post("/lead-bots/:id/visit", async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { visitorId } = z.object({ visitorId: z.string().uuid() }).strict().parse(req.body);
      await db.transaction(tx => recordLeadBotVisit(tx, id, visitorId));
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.use(((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || "Invalid pilot request" });
    if (error instanceof LeadBotError) return res.status(error.status).json({ error: error.message });
    console.error("[lead-bot] operation failed");
    res.status(503).json({ error: "The pilot could not be loaded. Please try again." });
  }) as import("express").ErrorRequestHandler);
  return router;
}
