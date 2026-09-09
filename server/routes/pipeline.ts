import { leadPhoneNumberSchema } from "@shared/schema";
// POST /api/pipeline/run — unified orchestrator endpoint (Task #170).
//
// Accepts the same booking shape as /api/bookings/quote but returns the
// full pipeline decision (priced, surged, dispatched, scheduled, rewarded).
// Shadow mode is live: /api/bookings/quote continues to serve production
// traffic; this endpoint runs in parallel for observability.

import { Router, Request, Response } from "express";
import { z, ZodError } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serviceCatalog } from "@shared/schema";
import { runPipeline } from "../pipeline";

const router = Router();

// Input contract mirrors /api/bookings/quote: `label` and `unitPrice` are
// optional and resolved from the active service catalog so callers can
// post a minimal { serviceCode, quantity } item and let the engine fill
// the rest (exactly what the legacy quote route does).
const itemSchema = z.object({
  serviceCode: z.string(),
  label: z.string().optional(),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0).optional(),
  priceMode: z.enum(["fixed", "hourly", "per_unit", "quote"]).optional(),
  discountEligible: z.boolean().optional(),
  details: z.record(z.unknown()).optional(),
});

const inputSchema = z.object({
  items: z.array(itemSchema).min(1),
  customerName: z.string().optional(),
  customerEmail: z.string().optional(),
  customerPhone: z.union([z.literal(""), leadPhoneNumberSchema]).optional(),
  serviceAddress: z.string().optional(),
  requestedDate: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
  persist: z.boolean().optional(),
  // Task #174 — optional service coordinates used by demand/surge steps
  // to resolve the zone and apply the proper multiplier.
  serviceLat: z.number().optional(),
  serviceLng: z.number().optional(),
});

router.post("/pipeline/run", async (req: Request, res: Response) => {
  try {
    const parsed = inputSchema.parse(req.body);
    // Resolve catalog defaults for any item missing label/unitPrice so the
    // pipeline always receives fully-shaped BookingPricingItemInput rows.
    const codes = Array.from(new Set(parsed.items.map((i) => i.serviceCode)));
    const catalogRows = codes.length
      ? await db
          .select()
          .from(serviceCatalog)
          .where(eq(serviceCatalog.isActive, true))
      : [];
    const catalog = new Map(catalogRows.map((r) => [r.code, r]));
    // Match /api/bookings/quote validation: unknown service codes are
    // rejected rather than silently priced as zero.
    for (const i of parsed.items) {
      if (!catalog.has(i.serviceCode)) {
        return res.status(400).json({ error: `Unknown serviceCode: ${i.serviceCode}` });
      }
    }
    const resolvedItems = parsed.items.map((i) => {
      const cat = catalog.get(i.serviceCode);
      const unitPrice =
        i.unitPrice != null
          ? i.unitPrice
          : cat?.defaultPrice != null
            ? parseFloat(cat.defaultPrice)
            : 0;
      const priceMode = (i.priceMode || cat?.defaultPriceMode || "fixed") as
        | "fixed"
        | "hourly"
        | "per_unit"
        | "quote";
      return {
        serviceCode: i.serviceCode,
        label: i.label || cat?.name || i.serviceCode,
        quantity: i.quantity,
        unitPrice,
        priceMode,
        discountEligible: i.discountEligible ?? cat?.discountEligible ?? true,
        details: (i.details as Record<string, unknown> | undefined) || {},
      };
    });
    const input = { ...parsed, items: resolvedItems };
    const result = await runPipeline(input);
    const ctx = result.context;
    return res.json({
      ok: result.ok,
      runId: result.runId,
      elapsedMs: result.elapsedMs,
      quote: ctx.quote ?? null,
      surge: {
        multiplier: ctx.surgeMultiplier ?? 1,
        reason: ctx.surgeReason ?? null,
        surgedTotal: ctx.surgedTotal ?? null,
      },
      demand: { score: ctx.demandScore ?? null, reason: ctx.demandReason ?? null },
      crew: ctx.crew ?? null,
      schedule: ctx.schedule ?? null,
      incentives: ctx.incentives ?? null,
      upsell: ctx.upsellChips ?? [],
      rewards: ctx.rewards ?? null,
      notifications: ctx.notifications ?? null,
      steps: result.steps,
      error: result.error,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }
    // eslint-disable-next-line no-console
    console.error("[pipeline/run] error:", err);
    return res.status(500).json({ error: "Pipeline failed", message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
