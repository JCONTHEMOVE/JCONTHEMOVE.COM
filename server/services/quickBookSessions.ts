import { and, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { quickBookingSessions } from "@shared/schema";
import {
  EMPTY_QUICK_BOOK_DRAFT,
  quickBookDraftSchema,
  type QuickBookDraft,
  type QuickBookExtraction,
  type QuickBookFieldMeta,
} from "@shared/quickBook";
import { decryptJobAccessDetails, encryptJobAccessDetails } from "./job-access";

type QuickBookSessionRow = typeof quickBookingSessions.$inferSelect;

let schemaReady: Promise<void> | null = null;

export function ensureQuickBookingSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS quick_booking_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        created_by_user_id VARCHAR NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'draft',
        revision INTEGER NOT NULL DEFAULT 1,
        transcript_text TEXT,
        structured_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
        field_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        pricing_preview JSONB,
        suggested_crew JSONB NOT NULL DEFAULT '[]'::jsonb,
        assistant_message TEXT,
        next_question TEXT,
        suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
        agent_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        booking_id VARCHAR REFERENCES bookings(id),
        lead_id VARCHAR REFERENCES leads(id),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT quick_booking_sessions_status_check CHECK (status IN ('draft','ready','booked','abandoned'))
      );
      CREATE INDEX IF NOT EXISTS idx_quick_booking_sessions_creator
        ON quick_booking_sessions(created_by_user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_quick_booking_sessions_status
        ON quick_booking_sessions(status, updated_at DESC);
      ALTER TABLE job_agreements
        ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
        ADD COLUMN IF NOT EXISTS acceptance_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE quick_booking_sessions
        ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;
      UPDATE quick_booking_sessions
         SET transcript_text = NULL,
             updated_at = updated_at
       WHERE status IN ('draft','abandoned')
         AND transcript_text IS NOT NULL
         AND updated_at < NOW() - INTERVAL '30 days';
    `).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export async function createQuickBookSession(createdByUserId: string) {
  await ensureQuickBookingSchema();
  const [row] = await db.insert(quickBookingSessions).values({
    createdByUserId,
    status: "draft",
    structuredDraft: EMPTY_QUICK_BOOK_DRAFT,
    missingFields: [],
    reviewReasons: [],
    suggestedCrew: [],
    assistantMessage: "Tell me the customer, addresses, schedule, crew size, hours, and truck plan.",
    nextQuestion: "Who is the customer and what moving help do they need?",
    suggestions: ["3 movers for 2 hours", "Customer truck", "No stairs or special items"],
    agentMetadata: { provider: "deterministic", model: "not-run", fallbackUsed: false },
    metrics: { messageCount: 0, clarificationCount: 0, staffCorrectionCount: 0, fallbackUseCount: 0, totalAiLatencyMs: 0 },
  }).returning();
  return row;
}

export async function getQuickBookSession(id: string) {
  await ensureQuickBookingSchema();
  const [row] = await db.select().from(quickBookingSessions).where(eq(quickBookingSessions.id, id)).limit(1);
  return row || null;
}

function normalizedInteger(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function mergeQuickBookDraft(args: {
  current: QuickBookDraft;
  patch: Partial<QuickBookExtraction["patch"]> & Record<string, unknown>;
  source: "voice" | "typed" | "tap" | "server";
  currentMeta?: QuickBookFieldMeta;
}) {
  const next: Record<string, unknown> = {
    ...args.current,
    specialItems: { ...args.current.specialItems },
    inventory: { ...args.current.inventory },
  };
  const meta: QuickBookFieldMeta = { ...(args.currentMeta || {}) };
  const timestamp = new Date().toISOString();
  const confidenceByKey = (args.patch as any).__confidence as Record<string, "high" | "medium" | "low"> | undefined;

  for (const [key, rawValue] of Object.entries(args.patch)) {
    if (key === "__confidence" || rawValue === null || rawValue === undefined) continue;
    // Consent and named crew require an explicit staff tap. Conversational AI
    // may recognize those words but cannot cross either operational gate.
    if (key === "smsConsent" && args.source !== "tap") continue;
    if (["crewMemberIds", "crewLeadUserId", "crewConfirmed"].includes(key) && args.source !== "tap") continue;

    if (key === "specialItems" && typeof rawValue === "object" && rawValue) {
      const special = { ...(next.specialItems as Record<string, unknown>) };
      for (const [childKey, childValue] of Object.entries(rawValue as Record<string, unknown>)) {
        if (childValue !== null && childValue !== undefined) special[childKey] = childValue;
      }
      next.specialItems = special;
    } else if (key === "inventory" && typeof rawValue === "object" && rawValue) {
      const inventory = { ...(next.inventory as Record<string, unknown>) };
      for (const [childKey, childValue] of Object.entries(rawValue as Record<string, unknown>)) {
        if (childValue !== null && childValue !== undefined) inventory[childKey] = childValue;
      }
      next.inventory = inventory;
    } else if (["crewSize", "estimatedHours", "bedrooms", "stairsFlights"].includes(key)) {
      const limits: Record<string, [number, number]> = {
        crewSize: [1, 12], estimatedHours: [1, 24], bedrooms: [0, 20], stairsFlights: [0, 50],
      };
      const [min, max] = limits[key];
      next[key] = normalizedInteger(rawValue, min, max);
    } else {
      next[key] = rawValue;
    }
    meta[key] = {
      confidence: args.source === "tap" ? "high" : (confidenceByKey?.[key] || "medium"),
      source: args.source,
      updatedAt: timestamp,
    };
  }

  const crewPlanKeys = ["crewSize", "estimatedHours", "confirmedDate", "arrivalWindow"];
  if (crewPlanKeys.some((key) => Object.prototype.hasOwnProperty.call(args.patch, key))
      && args.patch.crewConfirmed !== true) {
    next.crewConfirmed = false;
  }
  if (args.source === "tap" && Object.prototype.hasOwnProperty.call(args.patch, "crewMemberIds")
      && !Object.prototype.hasOwnProperty.call(args.patch, "crewConfirmed")) {
    next.crewConfirmed = false;
  }

  return { draft: quickBookDraftSchema.parse(next), fieldMeta: meta };
}

export async function updateQuickBookSession(args: {
  id: string;
  expectedRevision: number;
  values: Partial<typeof quickBookingSessions.$inferInsert>;
}) {
  await ensureQuickBookingSchema();
  const values = { ...args.values };
  if (values.structuredDraft) values.structuredDraft = sealQuickBookDraft(values.structuredDraft) as any;
  const [row] = await db.update(quickBookingSessions).set({
    ...values,
    revision: args.expectedRevision + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(quickBookingSessions.id, args.id),
    eq(quickBookingSessions.revision, args.expectedRevision),
  )).returning();
  return row || null;
}

export function sessionDraft(row: QuickBookSessionRow) {
  const stored = (row.structuredDraft || {}) as Record<string, unknown>;
  const parsed = quickBookDraftSchema.parse(stored);
  const encrypted = decryptJobAccessDetails(typeof stored.__accessCiphertext === "string" ? stored.__accessCiphertext : null);
  if (!encrypted) return parsed;
  try {
    const codes = JSON.parse(encrypted.accessCode || "{}") as { pickup?: string; destination?: string };
    const instructions = JSON.parse(encrypted.entryInstructions || "{}") as { pickup?: string; destination?: string };
    return quickBookDraftSchema.parse({
      ...parsed,
      pickupAccessCode: codes.pickup || "",
      destinationAccessCode: codes.destination || "",
      pickupInstructions: instructions.pickup || "",
      destinationInstructions: instructions.destination || "",
    });
  } catch {
    return parsed;
  }
}

export function sealQuickBookDraft(draftInput: unknown) {
  const draft = quickBookDraftSchema.parse(draftInput || {});
  const __accessCiphertext = encryptJobAccessDetails({
    accessCode: JSON.stringify({ pickup: draft.pickupAccessCode, destination: draft.destinationAccessCode }),
    entryInstructions: JSON.stringify({ pickup: draft.pickupInstructions, destination: draft.destinationInstructions }),
  });
  return {
    ...draft,
    pickupAccessCode: "",
    destinationAccessCode: "",
    pickupInstructions: "",
    destinationInstructions: "",
    ...(__accessCiphertext ? { __accessCiphertext } : {}),
  };
}

export function appendQuickBookTranscript(current: string | null, message: string, source: string) {
  const redacted = message.trim().replace(
    /\b(?:gate|door|access|lockbox)\s+code\s*(?:is|:|=)?\s*[a-z0-9#*-]+/gi,
    "[ACCESS DETAIL REDACTED]",
  );
  const entry = `[${new Date().toISOString()} ${source}] ${redacted}`;
  return [current || "", entry].filter(Boolean).join("\n").slice(-12000);
}
