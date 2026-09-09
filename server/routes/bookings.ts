import { leadPhoneNumberSchema } from "@shared/schema";
// Multi-Service Booking endpoints (Task #128).
//
//   POST /api/bookings/quote      → live quote, no persistence
//   POST /api/bookings            → persist parent + children (uses same engine)
//   GET  /api/bundles/featured    → featured bundles grouped by merch slot
//   GET  /api/service-catalog     → active services for the upcoming /book selector
//
// All input is validated by Zod schemas declared in shared/schema.ts so the
// upcoming frontend can import the same types.

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { eq, and, asc, desc, or, inArray, ilike, gte, lte, sql } from "drizzle-orm";
import { disburseBookingTokens, loadBookingRewardSettings } from "../services/disburseBookingTokens";
import { computeBookingReward } from "../services/bookingPricing";
import { notifyAdminNewQuote, notifyCustomerBookingRequestReceived } from "../services/email";
import { smsService } from "../services/sms";
import { ZodError, z } from "zod";
import { db, pool } from "../db";
import { storage } from "../storage";
import { isAuthenticated, isAuthenticatedAllowPending } from "../auth";
import { emitJobEvent } from "../services/jobEventBus";

/** Typed error class so route handlers can signal "this is a 400, not a 500"
 *  without resorting to `any` casts on plain Error objects. */
class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}
import {
  bookings,
  bookingServiceItems,
  bookingDiscountAuditLog,
  bundleDefinitions,
  bundleSettingsAuditLog,
  serviceCatalog,
  users,
  leads,
  notifications,
  workerProfiles,
  promoCodes,
  marketingReps,
  quoteApprovals,
  quoteAttributions,
  bookingQuoteRequestSchema,
  bookingCreateRequestSchema,
  type ServiceCatalogEntry,
  type BundleDefinition,
  type Booking,
  type BookingServiceItem,
  normalizeLeadPhoneNumber,
} from "@shared/schema";
import {
  computeBookingQuote,
  quoteBundle,
  estimatePainting,
  estimateFlooring,
  type BookingPricingItemInput,
  type BundleDefinitionLike,
  type BookingPricingResult,
  type PaintingAnswers,
  type FlooringAnswers,
} from "../services/pricingEngine";
import { quoteByLaborHours, LABOR_RATE_PER_HOUR, quoteMovingFromTable } from "@shared/pricingTables";
import { jobScheduleLabelForStart, quoteLocalCrewPackage } from "@shared/jcOperations";
import {
  getMarketplaceRequestShape,
  getMarketplaceShapeForServiceCode,
  getMarketplaceSourceFlowsForContext,
  type MarketplaceRequestShapeId,
} from "@shared/marketplaceShapes";
import { getRouteDayDiscountEligibility } from "@shared/routeDays";
import { previewZoneQuote } from "../marketplace/zonePricing";
import {
  applyGeographicQuotePolicy,
  calculateMarketplaceFlatRate,
  calculateMovingLabor,
  calculateRateCardLine,
  catalogPriceSummary,
  marketplaceRateCardApplies,
  type CanonicalPricingSnapshot,
  type MarketplaceHourlyServiceCode,
  type PricingRateSource,
} from "@shared/canonicalPricing";
import { getActivePricingSnapshot, getPricingSnapshotByCode } from "../services/pricingVersions";
import { resolveQuoteRouteEvidence } from "../services/quoteGeography";
import { evaluateOperatingEligibility } from "../services/serviceAreaEligibility";
import {
  approveQuoteRevision,
  getLatestQuoteRevision,
  markQuoteRevisionSent,
  saveQuoteDraft,
} from "../services/quoteRevisions";

// Canonical two-person, two-hour moving labor: 2 × 2 × $95.
const SMALL_MOVE_SPECIAL_PRICE = 380;

const router = Router();

// ── Instant booking holds ──────────────────────────────────────────────────
// This is deliberately separate from the legacy date-only calendar rows.
// A customer may see an exact two-hour start only when enough approved crew
// capacity remains after both legacy work and other active holds are counted.

const INSTANT_BOOKING_TIME_ZONE = "America/Chicago";
const INSTANT_BOOKING_START_HOURS = [8, 10, 12, 14, 16] as const;
const HOLD_LIFETIME_MS = 24 * 60 * 60 * 1000;

const instantBookingRequestSchema = z.object({
  service: z.enum(["moving", "labor", "junk"]),
  customerName: z.string().trim().min(2, "Enter your name").max(120),
  customerEmail: z.union([z.string().trim().email(), z.literal("")]).optional().transform((value) => value || ""),
  customerPhone: leadPhoneNumberSchema,
  serviceAddress: z.string().trim().min(5, "Enter the service address").max(350),
  destinationAddress: z.string().trim().max(350).optional().transform((value) => value || ""),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, "Enter a 5-digit ZIP code"),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  startTime: z.string().regex(/^\d{2}:00$/, "Choose an available start time").optional(),
  requestedHours: z.coerce.number().min(1).max(12),
  truckSource: z.enum(["jc_on_the_move", "customer", "rental", "none"]).default("none"),
  truckSize: z.enum(["none", "cargo_van", "15_ft", "20_ft", "26_ft", "other"]).default("none"),
  difficulty: z.enum(["standard", "moderate", "difficult"]).default("standard"),
  stairsFlights: z.coerce.number().int().min(0).max(20).default(0),
  heavyItems: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    pounds: z.coerce.number().int().min(1).max(5000),
  })).max(3).default([]),
  junkVolume: z.enum(["quarter", "half", "three_quarter", "full"]).optional(),
  distanceMiles: z.coerce.number().min(0).max(500).default(0),
  notes: z.string().trim().max(2500).optional().transform((value) => value || ""),
  smsConsent: z.boolean().default(false),
  termsAccepted: z.boolean().default(false),
  termsVersion: z.string().trim().min(1).max(80).default("2026-08-regional-v1"),
}).superRefine((value, ctx) => {
  if (value.service === "moving" && !value.destinationAddress) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationAddress"], message: "Enter the moving destination" });
  }
});

type InstantBookingRequest = z.infer<typeof instantBookingRequestSchema>;
type SqlClient = { query: (text: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type InstantBookingTransactionClient = SqlClient & { release: () => void };

let instantBookingTablesReady: Promise<void> | null = null;

function ensureInstantBookingTables(): Promise<void> {
  if (!instantBookingTablesReady) {
    instantBookingTablesReady = pool.query(`
      CREATE TABLE IF NOT EXISTS booking_slot_holds (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id VARCHAR NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        service_date DATE NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        crew_size INTEGER NOT NULL CHECK (crew_size > 0),
        status TEXT NOT NULL DEFAULT 'pending_review',
        expires_at TIMESTAMPTZ,
        review_required BOOLEAN NOT NULL DEFAULT false,
        zone_code TEXT,
        quote_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        admin_notes TEXT,
        reviewed_by_user_id VARCHAR REFERENCES users(id),
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_booking_slot_holds_window
        ON booking_slot_holds (service_date, start_at, status);
      CREATE INDEX IF NOT EXISTS idx_booking_slot_holds_lead
        ON booking_slot_holds (lead_id);
    `).then(() => undefined).catch((error) => {
      instantBookingTablesReady = null;
      throw error;
    });
  }
  return instantBookingTablesReady;
}

function centralDateTimeToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wantedWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wantedWallTime;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: INSTANT_BOOKING_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  // Two passes correctly resolve either CST or CDT without assuming a fixed
  // offset. Booking slots are daytime, so the DST transition hour is avoided.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
    const renderedWallTime = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), 0);
    instant += wantedWallTime - renderedWallTime;
  }
  return new Date(instant);
}

function centralDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INSTANT_BOOKING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timeLabel(time: string) {
  const hour = Number(time.slice(0, 2));
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

async function expireInstantBookingHolds() {
  await ensureInstantBookingTables();
  const expired = await pool.query<{ lead_id: string; booking_id: string; previous_status: string }>(`
    WITH due AS (
      SELECT id, lead_id, booking_id, status AS previous_status
        FROM booking_slot_holds
       WHERE status IN ('pending_review','awaiting_deposit')
         AND expires_at IS NOT NULL AND expires_at <= NOW()
       FOR UPDATE SKIP LOCKED
    )
    UPDATE booking_slot_holds h
       SET status='expired', updated_at=NOW()
      FROM due
     WHERE h.id=due.id
    RETURNING h.lead_id, h.booking_id, due.previous_status
  `);
  if (!expired.rows.length) return 0;
  const bookingIds = expired.rows.map((row) => row.booking_id);
  const leadIds = expired.rows.map((row) => row.lead_id);
  await pool.query(`UPDATE bookings SET status='expired' WHERE id=ANY($1::varchar[]) AND status IN ('pending_review','awaiting_deposit')`, [bookingIds]);
  await pool.query(
    `UPDATE leads SET status=CASE WHEN status='awaiting_deposit' THEN 'quote_requested' ELSE status END,
                      financial_status=CASE WHEN financial_status='awaiting_deposit' THEN 'deposit_expired' ELSE financial_status END
      WHERE id=ANY($1::varchar[])`,
    [leadIds],
  );
  const invoices = await pool.query<{ square_invoice_id: string }>(
    `SELECT square_invoice_id FROM square_invoices
      WHERE lead_id=ANY($1::varchar[]) AND purpose='deposit'
        AND status NOT IN ('paid','canceled','refunded')`,
    [leadIds],
  );
  if (invoices.rows.length) {
    const { squareInvoiceService } = await import("../services/square-invoice");
    for (const invoice of invoices.rows) {
      await squareInvoiceService.cancelInvoice(invoice.square_invoice_id).catch((error) => {
        console.warn(`[instant-booking] could not cancel expired deposit invoice ${invoice.square_invoice_id}:`, error instanceof Error ? error.message : error);
      });
    }
  }
  return expired.rows.length;
}

function profileForInstantBooking(input: InstantBookingRequest) {
  const junkDefaults = {
    quarter: { crewSize: 2, hours: 2 },
    half: { crewSize: 2, hours: 2.5 },
    three_quarter: { crewSize: 3, hours: 3 },
    full: { crewSize: 4, hours: 4 },
  } as const;
  const junk = input.service === "junk" ? junkDefaults[input.junkVolume || "half"] : null;
  const heavyCrew = input.heavyItems.reduce((highest, item) => {
    if (item.pounds >= 400) return Math.max(highest, 4);
    if (item.pounds >= 300) return Math.max(highest, 3);
    if (item.pounds >= 200) return Math.max(highest, 2);
    return highest;
  }, 1);
  const baseCrew = junk?.crewSize || 2;
  const requestedHours = junk?.hours || input.requestedHours;
  const crewSize = Math.max(baseCrew, heavyCrew);
  const difficultyMultiplier = input.difficulty === "difficult" ? 1.3 : input.difficulty === "moderate" ? 1.15 : 1;
  const stairsMultiplier = input.stairsFlights > 0 ? 1.5 : 1;
  return {
    crewSize,
    requestedHours,
    durationMinutes: Math.ceil(requestedHours * 60),
    difficultyMultiplier,
    stairsMultiplier,
    reviewRequired: input.difficulty === "difficult",
    serviceCode: "load_unload",
  };
}

async function attachOperatingEligibility(input: InstantBookingRequest, quote: any) {
  const routeEvidence = quote.routeEvidence
    && Array.isArray(quote.routeEvidence.stops)
    && Array.isArray(quote.routeEvidence.stopCoordinates)
    ? quote.routeEvidence
    : await resolveQuoteRouteEvidence({
        addresses: [input.serviceAddress, input.destinationAddress],
        snapshot: (await getActivePricingSnapshot()).snapshot,
      });
  const operatingEligibility = await evaluateOperatingEligibility({
    service: input.service,
    truckSource: input.truckSource,
    routeEvidence,
    zoneCode: quote.zoneCode,
    travelEligibility: quote.travelEligibility,
    reviewRequired: quote.reviewRequired,
    hasSpecialItems: input.heavyItems.length > 0,
  });
  return {
    ...quote,
    routeEvidence,
    operatingEligibility,
    autoBookEligible: operatingEligibility.decision === "eligible",
    eligibleForHold: quote.eligibleForHold !== false && operatingEligibility.decision !== "blocked",
    reviewRequired: quote.reviewRequired || operatingEligibility.decision !== "eligible",
    conditionalHold: quote.conditionalHold || operatingEligibility.decision !== "eligible",
  };
}

async function instantBookingQuote(input: InstantBookingRequest) {
  const profile = profileForInstantBooking(input);
  const activePricing = await getActivePricingSnapshot();
  const routeEvidence = await resolveQuoteRouteEvidence({
    addresses: [input.serviceAddress, input.destinationAddress],
    snapshot: activePricing.snapshot,
  });
  const routeClassification = applyGeographicQuotePolicy({
    baseSubtotal: 0,
    serviceDate: input.requestedDate,
    stopCoordinates: routeEvidence.stopCoordinates,
    routeVerified: routeEvidence.verified,
    oneWayMiles: routeEvidence.oneWayMiles,
    oneWayMinutes: routeEvidence.oneWayMinutes,
    snapshot: activePricing.snapshot,
  });
  const rateCardEnabled = marketplaceRateCardApplies(
    activePricing.snapshot,
    routeClassification?.pricingAdjustments.insideBubble ?? null,
  );
  const rateSource: PricingRateSource = rateCardEnabled
    ? "movinghelper_special"
    : "local_canonical";

  // Once the owner publishes the geographic pricing version, instant
  // booking uses the same deterministic rate card and route evidence as
  // every other quote channel. The legacy zone preview remains available
  // only while an older pricing version is active.
  if (activePricing.snapshot.geographicPolicy) {
    const rateLine = rateCardEnabled && input.service !== "junk"
      ? calculateRateCardLine({
          serviceCode: "load_unload",
          crewSize: profile.crewSize,
          hours: profile.requestedHours,
          snapshot: activePricing.snapshot,
        })
      : null;
    const junkTier = input.junkVolume === "quarter"
      ? "small"
      : input.junkVolume === "three_quarter"
        ? "large"
        : input.junkVolume === "full"
          ? "xlarge"
          : "medium";
    const localLabor = calculateMovingLabor({
      workers: profile.crewSize,
      hours: profile.requestedHours,
      snapshot: activePricing.snapshot,
    });
    const standardLaborSubtotal = input.service === "junk"
      ? activePricing.snapshot.services.junkRemoval.tiers[junkTier]
      : rateLine?.subtotal ?? localLabor.total;
    const companyTruck = input.truckSource === "jc_on_the_move";
    const truckAmount = !companyTruck
      ? 0
      : ["20_ft", "26_ft"].includes(input.truckSize)
        ? activePricing.snapshot.equipment.truck26Ft
        : activePricing.snapshot.equipment.truck15Ft;
    const packageQuote = activePricing.snapshot.operationsPolicy
      ? quoteLocalCrewPackage({
          serviceCode: input.service,
          crewSize: profile.crewSize,
          plannedHours: profile.requestedHours,
          oneWayRoadMiles: routeEvidence.oneWayMiles,
          oneWayRoadMinutes: routeEvidence.oneWayMinutes,
          oversized: input.heavyItems.some((item) => item.pounds >= 200),
          unsafe: input.difficulty === "difficult",
        })
      : null;
    const serviceFloor = input.service === "junk"
      ? activePricing.snapshot.operationsPolicy?.serviceMinimums.junkRemoval
      : input.service === "labor"
        ? activePricing.snapshot.operationsPolicy?.serviceMinimums.labor
        : activePricing.snapshot.operationsPolicy?.serviceMinimums.moving;
    const jobFactor = profile.difficultyMultiplier * profile.stairsMultiplier;
    const adjustedLabor = packageQuote?.eligible
      ? packageQuote.serviceSubtotal
      : rateLine
        ? rateLine.subtotal
        : Math.round(Math.max(serviceFloor || 0, standardLaborSubtotal * jobFactor) * 100) / 100;
    const baseSubtotal = Math.round((adjustedLabor + truckAmount) * 100) / 100;
    if (packageQuote?.eligible) {
      const lineItems = [{
        name: profile.crewSize === 2 ? "2 movers / 3-hour local package" : "3 movers / 2-hour local package",
        serviceCode: input.service === "junk" ? "junk_removal" : "load_unload",
        quantity: 1,
        unitPrice: adjustedLabor,
        total: adjustedLabor,
        discountEligible: false,
        metadata: {
          packageCode: packageQuote.packageCode,
          includedHours: packageQuote.includedHours,
          overtimeAmount: packageQuote.overtimeAmount,
          travelAmount: packageQuote.travelAmount,
          clockPolicy: "Arrival at first customer address through completion, including travel between customer locations.",
          weekendPriceUnchanged: true,
        },
      }, ...(truckAmount > 0 ? [{
        name: `JC ON THE MOVE truck — ${input.truckSize.replace("_", " ")}`,
        serviceCode: "truck",
        quantity: 1,
        unitPrice: truckAmount,
        total: truckAmount,
        discountEligible: false,
        metadata: { truckSource: input.truckSource, truckSize: input.truckSize, passThrough: true },
      }] : [])];
      return attachOperatingEligibility(input, {
        service: input.service,
        zoneMatched: true,
        zoneCode: "IRONWOOD_30_MILE_PACKAGE",
        zoneName: "Ironwood 30-mile local package area",
        travelFallback: false,
        conditionalHold: profile.reviewRequired,
        eligibleForHold: true,
        minEstimate: baseSubtotal,
        maxEstimate: baseSubtotal,
        estimateLabel: `$${baseSubtotal.toLocaleString()} package estimate`,
        subjectToReview: true,
        crewSize: profile.crewSize,
        requestedHours: profile.requestedHours,
        durationMinutes: profile.durationMinutes,
        reviewRequired: profile.reviewRequired,
        difficultyMultiplier: 1,
        stairsMultiplier: 1,
        travelEstimate: packageQuote.travelAmount,
        baseSubtotal,
        lineItems,
        pricingAdjustments: {
          packageCode: packageQuote.packageCode,
          rateSource: "local_canonical",
          percentageDiscountEligible: false,
          weekendMultiplier: 1,
          truckEquipmentDisposalAndSpecialtySeparate: true,
        },
        travelEligibility: {
          status: "local",
          routeVerified: routeEvidence.verified,
          oneWayMinutes: routeEvidence.oneWayMinutes,
          oneWayMiles: routeEvidence.oneWayMiles,
          requiresOwner: false,
          canApprove: true,
          reasons: ["Verified inside the 30-mile local package radius."],
        },
        routeEvidence,
        pricingVersion: activePricing.snapshot.version,
        pricingVersionId: activePricing.versionId,
      });
    }
    const policy = applyGeographicQuotePolicy({
      baseSubtotal,
      automaticDiscountTotal: 0,
      serviceDate: input.requestedDate,
      stopCoordinates: routeEvidence.stopCoordinates,
      routeVerified: routeEvidence.verified,
      oneWayMiles: routeEvidence.oneWayMiles,
      oneWayMinutes: routeEvidence.oneWayMinutes,
      snapshot: activePricing.snapshot,
    });
    if (policy) {
      const total = policy.finalPreTaxTotal;
      const insideBubble = policy.pricingAdjustments.insideBubble;
      const lineItems = [
        {
          name: input.service === "junk"
            ? `Junk removal — ${String(input.junkVolume || "half").replace("_", " ")} load`
            : `Load/Unload — ${profile.crewSize} helper${profile.crewSize === 1 ? "" : "s"}`,
          serviceCode: input.service === "junk" ? "junk_removal" : "load_unload",
          quantity: 1,
          unitPrice: adjustedLabor,
          total: adjustedLabor,
          discountEligible: true,
          metadata: {
            rateCard: rateLine,
            rateSource,
            junkVolume: input.junkVolume || null,
            difficulty: input.difficulty,
            difficultyMultiplier: profile.difficultyMultiplier,
            stairsFlights: input.stairsFlights,
            stairsMultiplier: profile.stairsMultiplier,
            heavyItems: input.heavyItems,
          },
        },
        ...(truckAmount > 0 ? [{
          name: `JC ON THE MOVE truck — ${input.truckSize.replace("_", " ")}`,
          serviceCode: "truck",
          quantity: 1,
          unitPrice: truckAmount,
          total: truckAmount,
          discountEligible: true,
          metadata: { truckSource: input.truckSource, truckSize: input.truckSize },
        }] : []),
      ];
      return attachOperatingEligibility(input, {
        service: input.service,
        zoneMatched: insideBubble === true,
        zoneCode: insideBubble === true ? "IRONWOOD_50_MILE" : insideBubble === false ? "EXTENDED_SERVICE" : null,
        zoneName: insideBubble === true ? "Ironwood 50-mile service bubble" : insideBubble === false ? "Extended service area" : null,
        travelFallback: insideBubble !== true,
        conditionalHold: profile.reviewRequired || policy.travelEligibility.requiresOwner,
        eligibleForHold: policy.travelEligibility.canApprove,
        minEstimate: total,
        maxEstimate: total,
        estimateLabel: `$${total.toLocaleString()} estimate`,
        subjectToReview: true,
        crewSize: profile.crewSize,
        requestedHours: profile.requestedHours,
        durationMinutes: profile.durationMinutes,
        reviewRequired: profile.reviewRequired || policy.travelEligibility.requiresOwner,
        difficultyMultiplier: profile.difficultyMultiplier,
        stairsMultiplier: profile.stairsMultiplier,
        travelEstimate: policy.pricingAdjustments.geographicAmount,
        baseSubtotal,
        lineItems,
        pricingAdjustments: { ...policy.pricingAdjustments, rateSource },
        travelEligibility: policy.travelEligibility,
        routeEvidence,
        pricingVersion: activePricing.snapshot.version,
        pricingVersionId: activePricing.versionId,
      });
    }
  }

  const zonePreview = await previewZoneQuote({
    zip: input.zip,
    serviceCode: profile.serviceCode,
    crewSize: profile.crewSize,
    hours: profile.requestedHours,
    distanceMiles: input.distanceMiles,
    moveDate: input.requestedDate,
    workScope: input.service === "junk" ? "junk" : "moving",
    oversized: input.heavyItems.some((item) => item.pounds >= 200),
  });
  const rawQuote = zonePreview.quote;
  const structuredRawQuote = rawQuote as typeof rawQuote & {
    pricingAdjustments?: Record<string, unknown> | null;
    travelEligibility?: { canApprove?: boolean } & Record<string, unknown>;
    routeEvidence?: Record<string, unknown> | null;
    pricingVersion?: string;
  };
  const multiplier = profile.difficultyMultiplier * profile.stairsMultiplier;
  const minEstimate = Math.round(Number(rawQuote.minEstimate || 0) * multiplier);
  const maxEstimate = Math.max(minEstimate, Math.round(Number(rawQuote.maxEstimate || 0) * multiplier));
  return attachOperatingEligibility(input, {
    service: input.service,
    zoneMatched: zonePreview.matched,
    zoneCode: zonePreview.quote.zone?.code || null,
    zoneName: zonePreview.quote.zone?.name || null,
    travelFallback: !zonePreview.matched,
    conditionalHold: !zonePreview.matched,
    minEstimate,
    maxEstimate,
    estimateLabel: `$${minEstimate.toLocaleString()}–$${maxEstimate.toLocaleString()} estimate`,
    subjectToReview: true,
    crewSize: profile.crewSize,
    requestedHours: profile.requestedHours,
    durationMinutes: profile.durationMinutes,
    reviewRequired: profile.reviewRequired || !zonePreview.matched,
    difficultyMultiplier: profile.difficultyMultiplier,
    stairsMultiplier: profile.stairsMultiplier,
    travelEstimate: Math.round(Number(rawQuote.travel || 0)),
    baseSubtotal: minEstimate,
    lineItems: [{
      name: input.service === "moving" ? "Moving" : input.service === "labor" ? "Labor" : "Junk Removal",
      serviceCode: input.service === "junk" ? "junk_removal" : "load_unload",
      quantity: 1,
      unitPrice: minEstimate,
      total: minEstimate,
      discountEligible: true,
      metadata: { legacyZonePricing: true },
    }],
    pricingAdjustments: structuredRawQuote.pricingAdjustments || null,
    travelEligibility: structuredRawQuote.travelEligibility || null,
    routeEvidence: structuredRawQuote.routeEvidence || null,
    pricingVersion: structuredRawQuote.pricingVersion || activePricing.snapshot.version,
    pricingVersionId: activePricing.versionId,
    eligibleForHold: structuredRawQuote.travelEligibility?.canApprove !== false,
  });
}

async function capacityForInstantBooking(
  input: InstantBookingRequest,
  startTime: string,
  client: SqlClient = pool,
  quoteOverride?: Awaited<ReturnType<typeof instantBookingQuote>>,
) {
  await ensureInstantBookingTables();
  const quote = quoteOverride || await instantBookingQuote(input);
  const startAt = centralDateTimeToUtc(input.requestedDate, startTime);
  const endAt = new Date(startAt.getTime() + quote.durationMinutes * 60_000);
  await client.query(`
    UPDATE booking_slot_holds
    SET status = 'expired', updated_at = NOW()
    WHERE status IN ('pending_review','awaiting_deposit') AND expires_at IS NOT NULL AND expires_at <= NOW()
  `);

  const [employees, legacyResult, holdResult] = await Promise.all([
    storage.getEmployees(),
    client.query(`
      SELECT COALESCE(SUM(COALESCE(crew_size, 2)), 0)::int AS reserved_crew
      FROM leads
      WHERE (confirmed_date = $1 OR move_date = $1)
        AND COALESCE(source, '') <> 'instant_booking_hold'
        AND COALESCE(status, '') NOT IN ('cancelled', 'completed', 'archived')
        AND archived_at IS NULL
    `, [input.requestedDate]),
    client.query(`
      SELECT COALESCE(SUM(crew_size), 0)::int AS reserved_crew
      FROM booking_slot_holds
      WHERE service_date = $1::date
        AND status IN ('pending_review', 'awaiting_deposit', 'confirmed')
        AND (expires_at IS NULL OR expires_at > NOW() OR status <> 'pending_review')
        AND start_at < $3::timestamptz
        AND start_at + (duration_minutes * INTERVAL '1 minute') > $2::timestamptz
    `, [input.requestedDate, startAt.toISOString(), endAt.toISOString()]),
  ]);
  const capacity = employees.length;
  const legacyReserved = Number(legacyResult.rows[0]?.reserved_crew || 0);
  const heldReserved = Number(holdResult.rows[0]?.reserved_crew || 0);
  const availableCrew = Math.max(0, capacity - legacyReserved - heldReserved);
  return {
    quote,
    startAt,
    endAt,
    capacity,
    legacyReserved,
    heldReserved,
    availableCrew,
    available: quote.eligibleForHold !== false && capacity > 0 && availableCrew >= quote.crewSize,
  };
}

async function availableInstantBookingSlots(input: InstantBookingRequest) {
  const today = centralDateKey();
  const quote = await instantBookingQuote(input);
  if (input.requestedDate < today) return { quote, slots: [] };
  const slots = [] as Array<{ time: string; label: string; availableCrew: number }>;
  for (const hour of INSTANT_BOOKING_START_HOURS) {
    const time = `${String(hour).padStart(2, "0")}:00`;
    const startAt = centralDateTimeToUtc(input.requestedDate, time);
    if (startAt.getTime() < Date.now() + 60 * 60_000) continue;
    const capacity = await capacityForInstantBooking(input, time, pool, quote);
    if (capacity.available) slots.push({ time, label: timeLabel(time), availableCrew: capacity.availableCrew });
  }
  return { quote, slots };
}

type ServiceAddressDiscount = {
  code: string;
  label: string;
  reason: string;
  discountPercent: number;
  amount: number;
};

type ServiceAddressPricingAdjustment = {
  type: "out_of_town" | "non_discount_day";
  label: string;
  reason: string;
  multiplier: number;
  surchargePercent: number;
  amount: number;
};

type BookingPricingWithAddressDiscount = BookingPricingResult & {
  serviceAddressDiscount?: ServiceAddressDiscount;
  serviceAddressPricingAdjustment?: ServiceAddressPricingAdjustment;
  serviceAddressDiscountHint?: ReturnType<typeof getRouteDayDiscountEligibility>;
  pricingAdjustments?: NonNullable<ReturnType<typeof applyGeographicQuotePolicy>>["pricingAdjustments"] & {
    rateSource: PricingRateSource;
  };
  travelEligibility?: NonNullable<ReturnType<typeof applyGeographicQuotePolicy>>["travelEligibility"];
  routeEvidence?: Awaited<ReturnType<typeof resolveQuoteRouteEvidence>>;
  serviceabilityTotal?: number;
};

const WORKER_TIERS = ["worker", "bronze", "silver", "gold", "platinum"] as const;
type WorkerTier = typeof WORKER_TIERS[number];
const tierRank: Record<WorkerTier, number> = { worker: 0, bronze: 1, silver: 2, gold: 3, platinum: 4 };
type PersistedBookingInput = BookingPricingItemInput & { serviceLabel: string };

function safeMarketingTracking(raw: unknown) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const picked: Record<string, string> = {};
  for (const key of [
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "utmContent",
    "jcCampaign",
    "jcArea",
    "jcFocus",
    "jcRouteCity",
    "jcRouteState",
    "jcRouteZip",
    "jcRouteDay",
    "jcRouteKey",
    "jcPromoType",
    "jcPackage",
    "jcCrewTarget",
    "jcHoursTarget",
    "jcPriceBand",
    "fbclid",
    "referrer",
  ]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) picked[key] = value.trim().slice(0, 500);
  }
  return picked;
}

function normalizeWorkerTier(value: unknown, role?: string | null): WorkerTier {
  const raw = String(value || "").toLowerCase();
  if (WORKER_TIERS.includes(raw as WorkerTier)) return raw as WorkerTier;
  if (role === "admin" || role === "business_owner") return "platinum";
  return "worker";
}

async function getRequestUser(req: Request) {
  const userId = (req as any).user?.id || (req.session as any)?.userId || null;
  if (!userId) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user || null;
}

async function getAuthorityForUser(user: any) {
  if (!user) return { tier: "worker" as WorkerTier, rank: 0 };
  const [profile] = await db.select().from(workerProfiles).where(eq(workerProfiles.userId, user.id)).limit(1);
  const tier = normalizeWorkerTier(profile?.authorityTier, user.role);
  return { tier, rank: tierRank[tier], profile };
}

function splitCustomerName(name: string): { firstName: string; lastName: string } {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Customer", lastName: "Request" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "Request" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function serviceTypeForLead(items: PersistedBookingInput[]): string {
  const first = items[0]?.serviceCode || "moving";
  if (first === "junk_removal") return "Junk Removal";
  if (first === "cleaning" || first === "move_cleaning" || first === "deep_clean_turnover") return "Cleaning";
  if (first === "delivery") return "Delivery";
  if (first === "labor") return "Labor";
  if (first === "moving") return "Residential Move";
  return items[0]?.serviceLabel || first.replace(/_/g, " ");
}

function firstDetailValue(
  items: Array<{ details?: Record<string, unknown> | null }>,
  keys: string[],
): string | null {
  for (const item of items) {
    const details = (item.details || {}) as Record<string, unknown>;
    for (const key of keys) {
      const value = details[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function applyServiceAddressDiscount(
  quote: BookingPricingWithAddressDiscount,
  input: {
    serviceAddress?: string | null;
    requestedDate?: string | null;
    flatBonus: number;
    earnRate: number;
    pricing: CanonicalPricingSnapshot;
  },
): BookingPricingWithAddressDiscount {
  const eligibility = getRouteDayDiscountEligibility({
    serviceAddress: input.serviceAddress,
    requestedDate: input.requestedDate,
  });

  const roundMoney = (value: number) => Math.round(value * 100) / 100;
  if (!eligibility.eligible || !eligibility.code || eligibility.discountPercent <= 0 || quote.finalTotal <= 0) {
    return { ...quote, serviceAddressDiscountHint: eligibility };
  }

  // Route days are a 5% offer, but percentage savings may never exceed the
  // canonical 15% order cap. Out-of-area and non-route-day addresses no
  // longer receive whole-invoice multipliers; actual travel is a separate
  // line item in the canonical travel policy.
  const capAmount = roundMoney(quote.subtotal * (input.pricing.offers.totalPercentageCap / 100));
  const remainingCap = roundMoney(Math.max(0, capAmount - quote.discountTotal));
  const amount = Math.min(
    roundMoney(quote.finalTotal * (eligibility.discountPercent / 100)),
    remainingCap,
  );
  if (amount <= 0) return quote;

  const finalTotal = roundMoney(Math.max(0, quote.finalTotal - amount));
  const reward = computeBookingReward({
    finalTotal,
    flatBonus: input.flatBonus,
    earnRate: input.earnRate,
    bonusMultiplier: quote.bundleApplied?.bonusMultiplier ?? 1,
    hasOverride: false,
  });

  const travelEligibility = quote.travelEligibility && quote.pricingAdjustments?.insideBubble === false
    && finalTotal < quote.travelEligibility.minimumPreTax
    && quote.travelEligibility.status !== "out_of_range"
    && quote.travelEligibility.status !== "unverified"
    ? {
        ...quote.travelEligibility,
        status: "owner_review" as const,
        minimumSatisfied: false,
        requiresOwner: true,
        reasons: [
          ...quote.travelEligibility.reasons.filter((reason: string) => !reason.toLowerCase().includes("minimum")),
          `Outside-bubble total is below the $${quote.travelEligibility.minimumPreTax.toLocaleString()} minimum.`,
        ],
      }
    : quote.travelEligibility;

  return {
    ...quote,
    discountTotal: roundMoney(quote.discountTotal + amount),
    finalTotal,
    serviceabilityTotal: finalTotal,
    travelEligibility,
    tokenEstimate: reward.totalAward,
    serviceAddressDiscount: {
      code: eligibility.code,
      label: eligibility.label || eligibility.code,
      reason: eligibility.reason,
      discountPercent: eligibility.discountPercent,
      amount,
    },
    serviceAddressDiscountHint: eligibility,
  };
}

function serviceStopsForQuote(
  body: { serviceAddress?: string; serviceStops?: string[] },
  items: Array<{ details?: Record<string, unknown> | null }>,
): string[] {
  return [
    ...(body.serviceStops || []),
    body.serviceAddress || "",
    firstDetailValue(items, ["serviceAddress", "fromAddress", "pickupAddress", "address"]) || "",
    firstDetailValue(items, ["toAddress", "dropoffAddress", "destinationAddress"]) || "",
  ].filter((address) => address.trim().length >= 4);
}

async function resolveBookingRateContext(
  body: { serviceAddress?: string; serviceStops?: string[] },
  items: Array<{ details?: Record<string, unknown> | null }>,
  pricing: CanonicalPricingSnapshot,
) {
  const routeEvidence = await resolveQuoteRouteEvidence({
    addresses: serviceStopsForQuote(body, items),
    snapshot: pricing,
  });
  const classification = applyGeographicQuotePolicy({
    baseSubtotal: 0,
    automaticDiscountTotal: 0,
    stopCoordinates: routeEvidence.stopCoordinates,
    routeVerified: routeEvidence.verified,
    oneWayMiles: routeEvidence.oneWayMiles,
    oneWayMinutes: routeEvidence.oneWayMinutes,
    snapshot: pricing,
  });
  const insideBubble = classification?.pricingAdjustments.insideBubble ?? null;
  const rateCardEnabled = marketplaceRateCardApplies(pricing, insideBubble);
  const rateSource: PricingRateSource = rateCardEnabled
    ? "movinghelper_special"
    : "local_canonical";
  return {
    routeEvidence,
    context: {
      rateCardEnabled,
      routeVerified: routeEvidence.verified,
      routeMiles: routeEvidence.oneWayMiles,
      rateSource,
    } satisfies BookingRateContext,
  };
}

async function applyBookingGeographicPricing(input: {
  quote: BookingPricingResult;
  body: { serviceAddress?: string; serviceStops?: string[] };
  items: PersistedBookingInput[];
  requestedDate?: string | null;
  pricing: CanonicalPricingSnapshot;
  flatBonus: number;
  earnRate: number;
  routeEvidence?: Awaited<ReturnType<typeof resolveQuoteRouteEvidence>>;
  rateSource?: PricingRateSource;
  pricingReviewReasons?: string[];
}): Promise<BookingPricingWithAddressDiscount> {
  const routeEvidence = input.routeEvidence ?? await resolveQuoteRouteEvidence({
      addresses: serviceStopsForQuote(input.body, input.items),
      snapshot: input.pricing,
    });
  const rateSource = input.rateSource ?? "local_canonical";
  const preliminary = applyGeographicQuotePolicy({
    baseSubtotal: input.quote.subtotal,
    automaticDiscountTotal: 0,
    serviceDate: input.requestedDate || undefined,
    stopCoordinates: routeEvidence.stopCoordinates,
    routeVerified: routeEvidence.verified,
    oneWayMiles: routeEvidence.oneWayMiles,
    oneWayMinutes: routeEvidence.oneWayMinutes,
    snapshot: input.pricing,
  });
  if (!preliminary) {
    return { ...input.quote, routeEvidence, serviceabilityTotal: input.quote.finalTotal };
  }

  // Promotions are evaluated after the geographic and weekend premiums.
  // Existing bundle eligibility and caps remain authoritative.
  let automaticDiscountTotal = input.quote.discountTotal;
  if (input.quote.bundleApplied) {
    const eligibleSubtotal = input.quote.items
      .filter((item) => item.discountEligible !== false)
      .reduce((sum, item) => sum + item.lineSubtotal, 0);
    const adjustedEligibleSubtotal = eligibleSubtotal * preliminary.pricingAdjustments.compoundedMultiplier;
    const requestedDiscount = adjustedEligibleSubtotal * (input.quote.bundleApplied.discountValue / 100);
    automaticDiscountTotal = Math.round(Math.min(
      requestedDiscount,
      input.pricing.offers.bundleMaximumDollars,
      preliminary.adjustedSubtotal * (input.pricing.offers.totalPercentageCap / 100),
    ) * 100) / 100;
  }

  const evaluated = applyGeographicQuotePolicy({
    baseSubtotal: input.quote.subtotal,
    automaticDiscountTotal,
    serviceDate: input.requestedDate || undefined,
    stopCoordinates: routeEvidence.stopCoordinates,
    routeVerified: routeEvidence.verified,
    oneWayMiles: routeEvidence.oneWayMiles,
    oneWayMinutes: routeEvidence.oneWayMinutes,
    snapshot: input.pricing,
  })!;
  const reward = computeBookingReward({
    finalTotal: evaluated.finalPreTaxTotal,
    flatBonus: input.flatBonus,
    earnRate: input.earnRate,
    bonusMultiplier: input.quote.bundleApplied?.bonusMultiplier ?? 1,
    hasOverride: false,
  });
  const pricingReviewReasons = input.pricingReviewReasons || [];
  const travelEligibility = pricingReviewReasons.length > 0 && evaluated.travelEligibility.status !== "out_of_range"
    ? {
        ...evaluated.travelEligibility,
        status: "owner_review" as const,
        requiresOwner: true,
        reasons: [...evaluated.travelEligibility.reasons, ...pricingReviewReasons],
      }
    : evaluated.travelEligibility;
  return {
    ...input.quote,
    subtotal: evaluated.adjustedSubtotal,
    discountTotal: evaluated.automaticDiscountTotal,
    finalTotal: evaluated.finalPreTaxTotal,
    tokenEstimate: reward.totalAward,
    pricingAdjustments: { ...evaluated.pricingAdjustments, rateSource },
    travelEligibility,
    routeEvidence,
    serviceabilityTotal: evaluated.finalPreTaxTotal,
  };
}

function marketplaceShapeForBooking(items: PersistedBookingInput[], fallbackService: string) {
  for (const item of items) {
    const details = (item.details || {}) as Record<string, unknown>;
    const shapeId = typeof details.marketplaceShapeId === "string" ? details.marketplaceShapeId.trim() : "";
    const shape = shapeId ? getMarketplaceRequestShape(shapeId as MarketplaceRequestShapeId) : null;
    if (shape) return shape;
  }
  return getMarketplaceShapeForServiceCode(items[0]?.serviceCode || fallbackService);
}

function marketplaceSourceFlowForBooking(items: PersistedBookingInput[], shapeId: MarketplaceRequestShapeId, fallbackSource: string) {
  const sourceSignal = firstDetailValue(items, [
    "priceMenuSourceSignal",
    "marketplaceSourceSignal",
    "marketplaceSource",
    "sourceSignal",
    "source",
    "utmSource",
    "jcFocus",
  ]) || fallbackSource;
  return getMarketplaceSourceFlowsForContext({
    source: sourceSignal,
    shapeId,
    serviceCode: items[0]?.serviceCode || null,
    serviceLabel: items[0]?.serviceLabel || null,
    limit: 1,
  })[0] || null;
}

function maxCrew(items: BookingPricingResult["items"], fallbackInputs: PersistedBookingInput[]): number {
  const quotedCrew = items.map((item) => item.laborMeta?.crewSize || 0).filter((n) => n > 0);
  const inputCrew = fallbackInputs
    .map((item) => Number((item.details as any)?.crew || (item.details as any)?.crewSize || 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Math.max(1, ...quotedCrew, ...inputCrew, 2);
}

function firstHours(items: BookingPricingResult["items"], fallbackInputs: PersistedBookingInput[]): number | null {
  const quoted = items.map((item) => item.laborMeta?.laborHours || 0).find((n) => n > 0);
  if (quoted) return Math.ceil(quoted);
  const input = fallbackInputs
    .map((item) => Number((item.details as any)?.hours || (item.details as any)?.laborHours || 0))
    .find((n) => Number.isFinite(n) && n > 0);
  return input ? Math.ceil(input) : null;
}

function buildLeadDetails(args: {
  bookingId: string;
  bookingReference: string;
  marketplaceShape?: string;
  inputs: PersistedBookingInput[];
  quote: BookingPricingResult;
  notes?: string;
  source?: string;
  promoCode?: string | null;
  referralSlug?: string | null;
  marketingCampaignId?: string | null;
  marketingTracking?: Record<string, unknown>;
}) {
  const serviceLines = args.inputs.map((item, idx) => {
    const details = (item.details || {}) as Record<string, unknown>;
    const labor = args.quote.items[idx]?.laborMeta;
    const bits = [
      item.serviceLabel || item.serviceCode,
      details.loadType ? `load type: ${details.loadType}` : null,
      details.truckNeeded === true ? "JC truck" : details.truckNeeded === false ? "customer truck" : null,
      details.truckSize ? `truck: ${details.truckSize}` : null,
      labor ? `${labor.crewSize} crew x ${labor.laborHours} hr` : null,
      details.packageLabel ? `package: ${details.packageLabel}` : null,
    ].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  });
  const tracking = args.marketingTracking || {};
  const attributionBits = [
    args.source ? `source: ${args.source}` : null,
    args.promoCode ? `promo: ${args.promoCode}` : null,
    args.referralSlug ? `rep: ${args.referralSlug}` : null,
    args.marketingCampaignId ? `campaign: ${args.marketingCampaignId}` : null,
    typeof tracking.utmSource === "string" && tracking.utmSource ? `utm source: ${tracking.utmSource}` : null,
    typeof tracking.utmCampaign === "string" && tracking.utmCampaign ? `utm campaign: ${tracking.utmCampaign}` : null,
    typeof tracking.jcArea === "string" && tracking.jcArea ? `ad area: ${tracking.jcArea}` : null,
    typeof tracking.jcFocus === "string" && tracking.jcFocus ? `ad focus: ${tracking.jcFocus}` : null,
    typeof tracking.jcRouteDay === "string" && tracking.jcRouteDay ? `route day: ${tracking.jcRouteDay}` : null,
    typeof tracking.jcPackage === "string" && tracking.jcPackage ? `package: ${tracking.jcPackage}` : null,
    typeof tracking.jcCrewTarget === "string" && tracking.jcCrewTarget ? `crew target: ${tracking.jcCrewTarget}` : null,
    typeof tracking.jcHoursTarget === "string" && tracking.jcHoursTarget ? `hours target: ${tracking.jcHoursTarget}` : null,
    typeof tracking.jcPriceBand === "string" && tracking.jcPriceBand ? `price band: ${tracking.jcPriceBand}` : null,
  ].filter(Boolean);
  return [
    `[BOOKING ${args.bookingReference}] Linked booking ${args.bookingId}`,
    attributionBits.length ? `Attribution: ${attributionBits.join(", ")}.` : null,
    args.marketplaceShape ? `Marketplace shape: ${args.marketplaceShape}.` : null,
    `Quote snapshot: subtotal $${args.quote.subtotal.toFixed(2)}, estimate range/final $${args.quote.finalTotal.toFixed(2)}.`,
    "Requested services:",
    ...serviceLines,
    args.notes ? `Customer/crew notes:\n${args.notes}` : null,
  ].filter(Boolean).join("\n");
}

async function notifyOwnersOfLead(lead: any) {
  const ownerRows = await db.select({
    id: users.id,
  }).from(users).where(
    or(
      inArray(users.role, ["admin", "business_owner"]),
      eq(users.email, "upmichiganstatemovers@gmail.com"),
      eq(users.email, "michigankid906@gmail.com"),
    ),
  );
  if (ownerRows.length === 0) return;
  await db.insert(notifications).values(ownerRows.map((owner) => ({
    userId: owner.id,
    type: "quote_request",
    title: "New Marketplace Job Card",
    message: `${lead.firstName} ${lead.lastName} submitted a ${lead.serviceType} request.`,
    data: { leadId: lead.id, orderNumber: lead.orderNumber, bookingId: lead.bookingId },
  }))).onConflictDoNothing();
}

async function resolveMarketingRepUserId(promoCode: string): Promise<string | null> {
  const [ownedPromo] = await db.select({ referralUserId: promoCodes.referralUserId })
    .from(promoCodes)
    .where(eq(promoCodes.code, promoCode))
    .limit(1);
  if (ownedPromo?.referralUserId) return ownedPromo.referralUserId;

  const [workerProfile] = await db.select({ userId: workerProfiles.userId })
    .from(workerProfiles)
    .where(eq(workerProfiles.promoCode, promoCode))
    .limit(1);
  return workerProfile?.userId || null;
}

function toBundleLike(row: BundleDefinition): BundleDefinitionLike {
  // serviceComboJson is stored as jsonb<string[]> — defensively coerce in
  // case an older row was seeded with a different shape.
  const combo = Array.isArray(row.serviceComboJson)
    ? (row.serviceComboJson as string[])
    : [];
  return {
    code: row.code,
    name: row.name,
    serviceCombo: combo,
    discountType: (row.discountType as "percent" | "fixed"),
    discountValue: parseFloat(row.discountValue),
    maxDiscount: row.maxDiscount != null ? parseFloat(row.maxDiscount) : null,
    priority: row.priority,
    isActive: row.isActive,
    merchandisingSlot: row.merchandisingSlot ?? null,
    bonusMultiplier: row.bonusMultiplier != null ? parseFloat(row.bonusMultiplier) : 1,
  };
}

async function loadCatalog(): Promise<Map<string, ServiceCatalogEntry>> {
  const rows = await db
    .select()
    .from(serviceCatalog)
    .where(eq(serviceCatalog.isActive, true));
  return new Map(rows.map((r) => [r.code, r]));
}

async function loadBundles(): Promise<BundleDefinitionLike[]> {
  const rows = await db
    .select()
    .from(bundleDefinitions)
    .where(eq(bundleDefinitions.isActive, true));
  return rows.map(toBundleLike);
}

interface ResolvedItems {
  pricingInputs: BookingPricingItemInput[];
  /** Original per-line snapshot used when persisting the booking. */
  persistInputs: PersistedBookingInput[];
  rateSource: PricingRateSource;
  pricingReviewReasons: string[];
}

type BookingRateContext = {
  rateCardEnabled: boolean;
  routeVerified: boolean;
  routeMiles: number | null;
  rateSource: PricingRateSource;
};

/** Task #218 — Derive a small/medium/large jobSize hint from the per-line
 *  details the chat-intake or wizard sends (size hint, bedrooms, junk
 *  tier, sqft). Returns undefined when nothing in the details indicates a
 *  size — the labor-hours helper then falls back to the service default. */
function deriveJobSize(
  serviceCode: string,
  details: Record<string, unknown>,
): "small" | "medium" | "large" | undefined {
  // Explicit jobSize from the chat-intake parser wins.
  const explicit = String(details.jobSize ?? "").toLowerCase();
  if (explicit === "small" || explicit === "medium" || explicit === "large") {
    return explicit;
  }
  if (serviceCode === "moving") {
    // Task #218 spec step 4: truckSize feeds the labor-hours tier.
    // 15' → medium (2×4=8 labor-hr), 26' → large (4×4=16 labor-hr).
    const truck = String(details.truckSize ?? "").toLowerCase();
    if (truck.includes("15")) return "medium";
    if (truck.includes("26")) return "large";
    const br = String(details.bedrooms ?? "").toLowerCase();
    if (br === "studio" || br === "1br") return "small";
    if (br === "2br" || br === "3br") return "medium";
    if (br === "4br" || br === "5br+" || br === "5br") return "large";
  }
  if (serviceCode === "junk_removal") {
    const tier = String(details.tier ?? "").toLowerCase();
    if (tier === "tiny" || tier === "small") return "small";
    if (tier === "medium") return "medium";
    if (tier === "large" || tier === "xlarge") return "large";
  }
  if (serviceCode === "cleaning" || serviceCode === "move_cleaning") {
    const sqft = Number(details.squareFeet ?? 0);
    if (sqft > 0 && sqft < 1000) return "small";
    if (sqft >= 1000 && sqft < 2500) return "medium";
    if (sqft >= 2500) return "large";
  }
  return undefined;
}

function rateCardServiceForItem(
  serviceCode: string,
  details: Record<string, unknown>,
): MarketplaceHourlyServiceCode | null {
  if (serviceCode === "cleaning") return "cleaning";
  if (serviceCode === "labor") {
    const laborType = String(details.serviceCode || details.laborType || details.movingPath || "").toLowerCase();
    return laborType.includes("pack") ? "pack_unpack" : "load_unload";
  }
  if (serviceCode === "moving") {
    const path = String(details.movingPath || details.loadType || "").toLowerCase();
    return path.includes("pack") ? "pack_unpack" : "load_unload";
  }
  return null;
}

// Services whose dollar amount comes from a non-labor calculator
// (matrix lookups, sqft × rate, rule files). For these the labor meta
// is exposed as derived metadata; the labor amount NEVER overrides
// the unitPrice. Moving keeps its bedrooms × stairs × loadType matrix
// per Task #218 spec step 4. Painting/flooring keep their rule-file
// dollars per spec step 5. Delivery keeps its mileage-based pricer.
//
// Calculator-driven services (painting, flooring, moving, delivery)
// run through their own per-service branches above (estimatePainting,
// estimateFlooring, the moving matrix/labor-tier router, mileage)
// — they do NOT need a Set lookup because the route only needs to
// distinguish "is this in LABOR_AUTHORITATIVE_SERVICES?" below.

// Services where labor IS the source of truth: the spec table maps
// each one to crew × hours, and we override the catalog suggested-min
// so the customer pays exactly what the chat card shows. Anything
// not in this set keeps its own per-service pricer untouched.
const LABOR_AUTHORITATIVE_SERVICES = new Set([
  "lawn_care", "trash_valet", "snow_removal", "window_cleaning",
  "handyman", "junk_removal", "demolition", "labor", "assembly",
  "junk_reset", "deep_clean_turnover", "assembly_finish",
  "walkway_priority",
]);

/** Attach the canonical labor-hours breakdown to a quoted line. */
function buildLaborMeta(
  serviceCode: string,
  unitPrice: number,
  quantity: number,
  details: Record<string, unknown>,
  catalogEntry?: ServiceCatalogEntry,
): BookingPricingItemInput["laborMeta"] {
  const jobSize = deriveJobSize(serviceCode, details);
  const explicitCrew = details.crewSize != null ? Number(details.crewSize)
    : details.crew != null ? Number(details.crew)
    : details.movers != null ? Number(details.movers)
    : undefined;
  const explicitHours = details.laborHours != null ? Number(details.laborHours)
    : details.hours != null ? Number(details.hours)
    : undefined;
  // Catalog context per Task #218 step 2: when a catalog row carries
  // minCrew / defaultLaborHours, those win over the static
  // SERVICE_LABOR_DEFAULTS table. We do NOT pass suggestedMin/Max as a
  // clamp here because buildLaborMeta only computes display metadata —
  // the dollar amount comes from `unitPrice` already resolved upstream.
  const catalogContext = catalogEntry
    ? {
        minCrew: catalogEntry.minCrew,
        defaultLaborHours: catalogEntry.defaultLaborHours as
          | { small?: number; medium?: number; large?: number; default?: number }
          | null
          | undefined,
      }
    : undefined;
  const labor = quoteByLaborHours(serviceCode, {
    jobSize,
    crewSize: explicitCrew,
    laborHours: explicitHours,
    catalog: catalogContext,
  });
  if (!labor) return undefined;

  // Moving: display crew × hours that match the billed dollars exactly.
  // For job-size paths the canonical labor tuples already line up with
  // the canonical billed amount. For matrix paths (bedrooms × stairs)
  // we back-compute hours from the line dollars at 2-decimal precision
  // so crew × hours × the canonical rate equals lineTotal — the chat card
  // never displays math that disagrees with the price.
  const lineTotal = Math.max(0, unitPrice * Math.max(1, quantity));
  if (serviceCode === "moving") {
    // Preserve the canonical two-person, two-hour tuple for the small tier.
    if (jobSize === "small" && lineTotal === SMALL_MOVE_SPECIAL_PRICE) {
      return {
        crewSize: labor.crewSize,
        laborHours: labor.laborHours,
        totalLaborHours: labor.totalLaborHours,
        ratePerHour: labor.ratePerHour,
      };
    }
    const canonicalDollars = +(labor.crewSize * labor.laborHours * LABOR_RATE_PER_HOUR).toFixed(2);
    if (lineTotal > 0 && Math.abs(lineTotal - canonicalDollars) > 0.01) {
      const crew = labor.crewSize;
      const derivedHours = +(lineTotal / (crew * LABOR_RATE_PER_HOUR)).toFixed(2);
      return {
        crewSize: crew,
        laborHours: derivedHours,
        totalLaborHours: +(crew * derivedHours).toFixed(2),
        ratePerHour: LABOR_RATE_PER_HOUR,
      };
    }
    return {
      crewSize: labor.crewSize,
      laborHours: labor.laborHours,
      totalLaborHours: labor.totalLaborHours,
      ratePerHour: labor.ratePerHour,
    };
  }

  // Painting / flooring scale by sqft so their hours genuinely vary
  // with the dollar amount. Back-compute from the line total so the
  // displayed breakdown stays internally consistent.
  if ((serviceCode === "painting" || serviceCode === "flooring")
      && lineTotal > 0 && explicitHours == null) {
    const crew = labor.crewSize;
    const derivedHours = +(lineTotal / (crew * LABOR_RATE_PER_HOUR)).toFixed(2);
    return {
      crewSize: crew,
      laborHours: derivedHours,
      totalLaborHours: +(crew * derivedHours).toFixed(2),
      ratePerHour: LABOR_RATE_PER_HOUR,
    };
  }

  // For everything else, the canonical labor breakdown IS the truth.
  return {
    crewSize: labor.crewSize,
    laborHours: labor.laborHours,
    totalLaborHours: labor.totalLaborHours,
    ratePerHour: labor.ratePerHour,
  };
}

function resolveItems(
  items: ReturnType<typeof bookingQuoteRequestSchema.parse>["items"],
  catalog: Map<string, ServiceCatalogEntry>,
  pricing: CanonicalPricingSnapshot,
  rateContext?: BookingRateContext,
): ResolvedItems {
  const pricingInputs: BookingPricingItemInput[] = [];
  const persistInputs: ResolvedItems["persistInputs"] = [];
  const effectiveRateContext: BookingRateContext = rateContext ?? {
    rateCardEnabled: pricing.marketplaceRateCard?.applicationScope !== "outside_bubble",
    routeVerified: false,
    routeMiles: null,
    rateSource: pricing.marketplaceRateCard?.applicationScope === "outside_bubble"
      ? "local_canonical"
      : pricing.marketplaceRateCard
        ? "movinghelper_special"
        : "local_canonical",
  };
  const pricingReviewReasons: string[] = [];

  for (const item of items) {
    const cat = catalog.get(item.serviceCode);
    if (!cat) {
      throw new HttpError(`Unknown serviceCode: ${item.serviceCode}`, 400);
    }
    let unitPrice =
      item.unitPrice != null
        ? item.unitPrice
        : cat.defaultPrice != null
          ? parseFloat(cat.defaultPrice)
          : 0;
    const priceMode = (item.priceMode || cat.defaultPriceMode) as
      | "fixed"
      | "hourly"
      | "per_unit"
      | "quote";
    const label = item.label || cat.name;
    if (priceMode === "quote" && unitPrice <= 0 && cat.suggestedMin != null) {
      const suggestedMin = parseFloat(cat.suggestedMin);
      if (Number.isFinite(suggestedMin) && suggestedMin > 0) {
        unitPrice = suggestedMin;
      }
    }
    // Captured in the moving branch when the matrix path produces an
    // amount; consumed below buildLaborMeta so the chat-card crew/hours
    // tuple reflects the matrix tier (e.g., 3br → crew=3) rather than
    // SERVICE_LABOR_DEFAULTS' jobSize tuple. Declared at the for-loop
    // scope because it crosses the moving-branch / labor-meta boundary.
    let matrixLaborOverride: { crewSize: number; laborHours: number; totalLaborHours: number; ratePerHour: number } | undefined;
    let canonicalMovingLaborOverride: { crewSize: number; laborHours: number; totalLaborHours: number; ratePerHour: number } | undefined;
    let rateCardLaborOverride: { crewSize: number; laborHours: number; totalLaborHours: number; ratePerHour: number } | undefined;
    let collapseQuantityToOne = false;

    // Task #211 — Painting & Flooring run the chatbot questionnaire
    // through the editable rule files in services/quoteRules/ so the
    // wizard line shows a believable estimate instead of $0/TBD. Always
    // overrides the catalog/wizard-supplied unitPrice for these two
    // codes; rule falls back to catalog suggested-min when no answers
    // are present so we never end up at $0.
    if (item.serviceCode === "painting") {
      const fallbackMin = cat.suggestedMin != null ? parseFloat(cat.suggestedMin) : undefined;
      const fallbackMax = cat.suggestedMax != null ? parseFloat(cat.suggestedMax) : undefined;
      const est = estimatePainting({
        answers: (item.details ?? {}) as PaintingAnswers,
        fallbackMin,
        fallbackMax,
      });
      if (est.amount > 0) unitPrice = est.amount;
    } else if (item.serviceCode === "flooring") {
      const fallbackMin = cat.suggestedMin != null ? parseFloat(cat.suggestedMin) : undefined;
      const fallbackMax = cat.suggestedMax != null ? parseFloat(cat.suggestedMax) : undefined;
      const est = estimateFlooring({
        answers: (item.details ?? {}) as FlooringAnswers,
        fallbackMin,
        fallbackMax,
      });
      if (est.amount > 0) unitPrice = est.amount;
    } else if (item.serviceCode === "moving") {
      // An explicit crew/hour selection is the customer-visible contract, so
      // it is priced first through the active canonical snapshot. Rich matrix
      // inputs remain a fallback only when no crew/hour tuple was selected.
      const details = (item.details ?? {}) as Record<string, unknown>;
      const explicitCrew = Number(details.crewSize ?? details.crew ?? details.movers ?? 0);
      const explicitHours = Number(details.laborHours ?? details.hours ?? details.estimatedHours ?? 0);
      const hasExplicitLabor = Number.isFinite(explicitCrew) && explicitCrew > 0
        && Number.isFinite(explicitHours) && explicitHours > 0;
      const hasDetailedInputs =
        details.bedrooms != null || details.stairs != null || details.loadType != null;
      let appliedJobSize: ReturnType<typeof deriveJobSize> | undefined;
      // matrixLaborOverride is declared at the for-loop scope above so
      // it survives the closing brace of this `else if` branch and
      // remains visible to the buildLaborMeta consumer below. When the
      // matrix path is taken its labor tuple wins downstream — the
      // chat-card crew count must reflect the matrix tier (3br → crew=3),
      // not SERVICE_LABOR_DEFAULTS' jobSize tuple.
      if (hasExplicitLabor) {
        const labor = calculateMovingLabor({
          workers: explicitCrew,
          hours: explicitHours,
          snapshot: pricing,
        });
        unitPrice = labor.total;
        canonicalMovingLaborOverride = {
          crewSize: labor.workers,
          laborHours: labor.hours,
          totalLaborHours: +(labor.workers * labor.hours).toFixed(2),
          ratePerHour: labor.ratePerWorkerHour,
        };
      } else if (hasDetailedInputs) {
        const rawLoadType = String(details.loadType ?? "").toLowerCase();
        const normalizedLoadType =
          rawLoadType.includes("load + unload") || rawLoadType.includes("both")
            ? "local"
            : rawLoadType.includes("load only") || rawLoadType.includes("unload only")
              ? "labor_only"
              : details.loadType as string | undefined;
        const matrix = quoteMovingFromTable({
          bedrooms: details.bedrooms as string | undefined,
          stairs: details.stairs as string | number | undefined,
          loadType: normalizedLoadType,
        });
        if (matrix.amount > 0) {
          unitPrice = matrix.amount;
          matrixLaborOverride = matrix.labor;
        }
      } else {
        // No detailed inputs — only consider job-size / truck-size
        // explicit hints. We deliberately do NOT use deriveJobSize here
        // because that would re-infer from bedrooms (already handled
        // above) and short-circuit future detailed paths.
        const explicitJobSize = (details.jobSize as string | undefined)?.toLowerCase();
        const truckSize = (details.truckSize as string | undefined)?.toLowerCase() ?? "";
        let jobSize: "small" | "medium" | "large" | undefined;
        if (explicitJobSize === "small" || explicitJobSize === "medium" || explicitJobSize === "large") {
          jobSize = explicitJobSize;
        } else if (truckSize.includes("15")) {
          jobSize = "medium";
        } else if (truckSize.includes("26")) {
          jobSize = "large";
        }
        if (jobSize) {
          const labor = quoteByLaborHours("moving", { jobSize });
          if (labor) {
            unitPrice = labor.amount;
            appliedJobSize = jobSize;
          }
        }
      }
      // Keep every small-move path on the canonical two-worker/two-hour rate.
      const finalJobSize = appliedJobSize ?? deriveJobSize("moving", details);
      if (!hasExplicitLabor && finalJobSize === "small") {
        unitPrice = SMALL_MOVE_SPECIAL_PRICE;
      }
      const truckFee = Number(details.truckFee ?? 0);
      if (Number.isFinite(truckFee) && truckFee > 0) {
        unitPrice += truckFee;
      }
      const truckMileageFee = Number(details.truckMileageFee ?? 0);
      if (!truckFee && Number.isFinite(truckMileageFee) && truckMileageFee > 0) {
        unitPrice += truckMileageFee;
      }
      const oversizedItemFee = Number(details.oversizedItemFee ?? 0);
      if (Number.isFinite(oversizedItemFee) && oversizedItemFee > 0) {
        unitPrice += oversizedItemFee;
      }
    }

    // A scoped marketplace card is authoritative only after route evidence
    // classifies the request for that card. This keeps local $95 labor and
    // the farther-client Special-zone card from competing.
    const rateDetails = (item.details ?? {}) as Record<string, unknown>;
    const rateCardService = rateCardServiceForItem(item.serviceCode, rateDetails);
    const requestedCrew = Number(rateDetails.crewSize ?? rateDetails.crew ?? rateDetails.helpers ?? 0);
    const requestedHours = Number(rateDetails.laborHours ?? rateDetails.hours ?? rateDetails.estimatedHours ?? 0);
    const rateCardLine = effectiveRateContext.rateCardEnabled
      && rateCardService && requestedCrew > 0 && requestedHours > 0
      ? calculateRateCardLine({
          serviceCode: rateCardService,
          crewSize: requestedCrew,
          hours: requestedHours,
          snapshot: pricing,
        })
      : null;
    if (rateCardLine) {
      const addOnKeys = ["truckFee", "truckMileageFee", "oversizedItemFee", "disposalFee", "materialsFee"];
      const addOnTotal = addOnKeys.reduce((sum, key) => {
        const amount = Number(rateDetails[key] ?? 0);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0);
      unitPrice = +(rateCardLine.subtotal + addOnTotal).toFixed(2);
      collapseQuantityToOne = true;
      rateCardLaborOverride = {
        crewSize: rateCardLine.crewSize,
        laborHours: rateCardLine.billableHours,
        totalLaborHours: +(rateCardLine.crewSize * rateCardLine.billableHours).toFixed(2),
        ratePerHour: rateCardLine.effectiveWorkerHourlyRate,
      };
    } else if (
      effectiveRateContext.rateCardEnabled
      && pricing.marketplaceRateCard?.applicationScope === "outside_bubble"
      && rateCardService
      && requestedCrew > 0
      && requestedHours > 0
    ) {
      pricingReviewReasons.push(
        `MovingHelper Special-zone pricing does not support ${rateCardService} with ${requestedCrew} helper(s).`,
      );
    }

    const normalizedServiceCode = item.serviceCode.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const uboxMode = String(rateDetails.uboxMode || rateDetails.deliveryMode || rateDetails.serviceType || "").toLowerCase();
    const flatServiceCode = normalizedServiceCode.includes("u_box") || normalizedServiceCode.includes("ubox")
      ? uboxMode.includes("delivery") && (uboxMode.includes("load") || uboxMode.includes("unload"))
        ? "ubox_delivery_load_unload" as const
        : uboxMode.includes("delivery")
          ? "ubox_delivery_only" as const
          : "ubox_load_unload" as const
      : normalizedServiceCode.includes("piano")
        ? "piano" as const
        : normalizedServiceCode.includes("safe")
          ? "safe" as const
          : null;
    const explicitRouteMiles = Number(rateDetails.loadedMiles ?? rateDetails.distanceMiles ?? rateDetails.miles ?? 0);
    const flatRate = effectiveRateContext.rateCardEnabled && flatServiceCode ? calculateMarketplaceFlatRate({
      serviceCode: flatServiceCode,
      quantity: item.quantity,
      boxes: Number(rateDetails.uboxCount ?? rateDetails.boxCount ?? item.quantity),
      miles: effectiveRateContext.routeVerified && effectiveRateContext.routeMiles != null
        ? effectiveRateContext.routeMiles
        : explicitRouteMiles > 0
          ? explicitRouteMiles
          : effectiveRateContext.routeMiles ?? 0,
      snapshot: pricing,
    }) : null;
    if (flatRate != null) {
      unitPrice = flatRate;
      collapseQuantityToOne = true;
    }

    let laborMeta = buildLaborMeta(item.serviceCode, unitPrice, item.quantity, item.details || {}, cat);
    // Matrix labor tuple wins for moving when bedrooms/stairs/loadType
    // were supplied: per spec the matrix is the source of truth, and the
    // chat-card crew count must reflect the matrix tier (3br → crew=3),
    // not the SERVICE_LABOR_DEFAULTS jobSize tuple (medium → crew=2).
    // We deliberately skip this override for the small-move special so
    // that buildLaborMeta's preserved canonical 2-crew × 2-hr tuple
    // continues to drive the chat card for $300 small-move quotes.
    const isSmallSpecial = item.serviceCode === "moving" && unitPrice === SMALL_MOVE_SPECIAL_PRICE;
    if (item.serviceCode === "moving" && matrixLaborOverride && !isSmallSpecial) {
      laborMeta = matrixLaborOverride;
    }
    if (canonicalMovingLaborOverride) {
      laborMeta = canonicalMovingLaborOverride;
    }
    if (rateCardLaborOverride) {
      laborMeta = rateCardLaborOverride;
    }
    // Labor-priced services (lawn, valet, snow, junk, handyman, etc.)
    // get their unitPrice replaced with canonical crew/hour labor
    // so the catalog suggested-min never silently bypasses the chat
    // card's promise. Calculator-priced services (moving matrix,
    // painting/flooring rules, delivery mileage) keep their unitPrice
    // — labor meta on those is metadata only.
    // Labor authority is independent of priceMode — even when the
    // catalog row defaults to "fixed" (trash_valet flat rate) or
    // "hourly" (handyman/labor), the chat card still promises crew ×
    // hours at the canonical rate, so the route must bill that exact amount.
    let effectiveQuantity = collapseQuantityToOne ? 1 : item.quantity;
    if (laborMeta && !rateCardLaborOverride && LABOR_AUTHORITATIVE_SERVICES.has(item.serviceCode)) {
      const laborDollars = +(laborMeta.crewSize * laborMeta.laborHours * laborMeta.ratePerHour).toFixed(2);
      if (laborDollars > 0) {
        // unitPrice now represents the FULL labor block (crew × hours
        // at the canonical rate). If the customer requested quantity > 1, multiply the
        // labor hours into the meta so the chat card stays honest, then
        // collapse quantity to 1 — otherwise computeLineSubtotal would
        // double-count (qty × full-labor-total).
        const qty = Math.max(1, item.quantity);
        if (qty > 1) {
          const scaledHours = +(laborMeta.laborHours * qty).toFixed(2);
          laborMeta = {
            crewSize: laborMeta.crewSize,
            laborHours: scaledHours,
            totalLaborHours: +(laborMeta.crewSize * scaledHours).toFixed(2),
            ratePerHour: laborMeta.ratePerHour,
          };
          unitPrice = +(laborMeta.crewSize * laborMeta.laborHours * laborMeta.ratePerHour).toFixed(2);
        } else {
          unitPrice = laborDollars;
        }
        effectiveQuantity = 1;
      }
    }
    // Per spec line 38: moving keeps the matrix as the truth for the
    // amount, with labor crew/hours surfaced in the breakdown for
    // display only. We do NOT mutate the matrix dollars to match the
    // back-computed labor product — any cent-level disagreement is
    // accepted in favor of preserving matrix authority.
    pricingInputs.push({
      serviceCode: item.serviceCode,
      label,
      quantity: effectiveQuantity,
      unitPrice,
      priceMode,
      discountEligible: cat.discountEligible,
      details: {
        ...(item.details || {}),
        pricingRateSource: effectiveRateContext.rateSource,
      },
      laborMeta,
    });
    persistInputs.push({
      serviceCode: item.serviceCode,
      label,
      serviceLabel: label,
      quantity: effectiveQuantity,
      unitPrice,
      priceMode,
      details: {
        ...(item.details || {}),
        pricingRateSource: effectiveRateContext.rateSource,
      },
    });
  }
  return {
    pricingInputs,
    persistInputs,
    rateSource: effectiveRateContext.rateSource,
    pricingReviewReasons,
  };
}

// ── Public instant-estimate and capacity-checked hold flow ─────────────────
// The quote and capacity checks intentionally recalculate on the server. The
// client never supplies a price, crew count, or availability decision.
router.post("/instant-booking/quote", async (req: Request, res: Response) => {
  try {
    const input = instantBookingRequestSchema.parse(req.body);
    const quote = await instantBookingQuote(input);
    return res.json({ success: true, quote });
  } catch (error) {
    if (error instanceof ZodError) return res.status(400).json({ error: "Check the booking details", details: error.errors });
    console.error("[instant-booking/quote] error:", error);
    return res.status(500).json({ error: "We could not calculate that estimate. Please try again or call us." });
  }
});

router.post("/instant-booking/availability", async (req: Request, res: Response) => {
  try {
    const input = instantBookingRequestSchema.parse(req.body);
    await expireInstantBookingHolds();
    const result = await availableInstantBookingSlots(input);
    return res.json({
      success: true,
      quote: result.quote,
      slots: result.slots,
      timeZone: INSTANT_BOOKING_TIME_ZONE,
      message: result.slots.length
        ? "Choose a start time to place a 24-hour pending hold. No payment is taken yet."
        : "No online slots are available for this date. Please request a callback so we can check alternatives.",
    });
  } catch (error) {
    if (error instanceof ZodError) return res.status(400).json({ error: "Check the booking details", details: error.errors });
    console.error("[instant-booking/availability] error:", error);
    return res.status(500).json({ error: "We could not check crew capacity. Please try again or request a callback." });
  }
});

router.post("/instant-booking/hold", async (req: Request, res: Response) => {
  let client: InstantBookingTransactionClient | null = null;
  try {
    const input = instantBookingRequestSchema.parse(req.body);
    await expireInstantBookingHolds();
    const normalizedPhone = normalizeLeadPhoneNumber(input.customerPhone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: "Enter a complete 10-digit phone number so we can call you back." });
    }
    if (!input.termsAccepted) {
      return res.status(400).json({ error: "Accept the service terms before reserving a time." });
    }
    if (!input.startTime || !INSTANT_BOOKING_START_HOURS.includes(Number(input.startTime.slice(0, 2)) as typeof INSTANT_BOOKING_START_HOURS[number])) {
      return res.status(400).json({ error: "Choose one of the available two-hour start times." });
    }
    const chosenStart = centralDateTimeToUtc(input.requestedDate, input.startTime);
    if (chosenStart.getTime() < Date.now() + 60 * 60_000) {
      return res.status(409).json({ error: "That start time is no longer available. Please choose another slot." });
    }

    await ensureInstantBookingTables();
    const tx = await pool.connect() as unknown as InstantBookingTransactionClient;
    client = tx;
    await tx.query("BEGIN");
    // Serialize competing requests for this exact start. The capacity query
    // below still counts overlaps, so a longer job cannot overbook a slot.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`instant-booking:${input.requestedDate}:${input.startTime}`]);
    const capacity = await capacityForInstantBooking(input, input.startTime, tx);
    if (!capacity.available) {
      await tx.query("ROLLBACK");
      return res.status(409).json({
        error: "That crew slot was just taken. Please choose another available time.",
        availableCrew: capacity.availableCrew,
      });
    }

    const quote = capacity.quote;
    const autoBookEligible = quote.operatingEligibility?.decision === "eligible";
    const initialHoldStatus = autoBookEligible ? "awaiting_deposit" : "pending_review";
    const initialBookingStatus = autoBookEligible ? "awaiting_deposit" : "pending_review";
    const initialLeadStatus = autoBookEligible ? "awaiting_deposit" : "quote_requested";
    const [firstName, ...lastNameParts] = input.customerName.split(/\s+/);
    const lastName = lastNameParts.join(" ") || "Customer";
    const details = {
      bookingFlow: "instant_booking_hold",
      service: input.service,
      destinationAddress: input.destinationAddress || null,
      requestedDate: input.requestedDate,
      requestedStartTime: input.startTime,
      timeZone: INSTANT_BOOKING_TIME_ZONE,
      truckSource: input.truckSource,
      truckSize: input.truckSize,
      difficulty: input.difficulty,
      stairsFlights: input.stairsFlights,
      heavyItems: input.heavyItems,
      junkVolume: input.junkVolume || null,
      requestedHours: quote.requestedHours,
      requiredCrew: quote.crewSize,
      notes: input.notes,
      operatingEligibility: quote.operatingEligibility,
      termsVersion: input.termsVersion,
    };
    const quoteSnapshot = {
      capturedAt: new Date().toISOString(),
      quote,
      request: details,
      capacity: {
        configuredCrew: capacity.capacity,
        legacyReserved: capacity.legacyReserved,
        heldReserved: capacity.heldReserved,
      },
    };
    const syntheticEmail = `instant-booking+${normalizedPhone.replace(/\D/g, "")}-${crypto.randomUUID()}@jconthemove.local`;
    const customerEmail = input.customerEmail || syntheticEmail;
    const bookingResult = await tx.query(`
      INSERT INTO bookings
        (customer_name, customer_email, customer_phone, service_address, notes, subtotal, discount_total, final_total, status, source)
      VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'instant_booking_hold')
      RETURNING id
    `, [
      input.customerName,
      customerEmail,
      normalizedPhone,
      input.serviceAddress,
      input.notes || null,
      quote.minEstimate.toFixed(2),
      quote.maxEstimate.toFixed(2),
      initialBookingStatus,
    ]);
    const bookingId = String(bookingResult.rows[0]?.id || "");
    if (!bookingId) throw new Error("Booking insert returned no id");
    await tx.query(`
      INSERT INTO booking_service_items
        (booking_id, service_code, service_label, quantity, unit_price, line_subtotal, price_mode, details, status, scheduled_at)
      VALUES ($1,$2,$3,1,$4,$5,'quote',$6::jsonb,'pending',$7::timestamptz)
    `, [
      bookingId,
      input.service === "junk" ? "junk_removal" : input.service,
      input.service === "moving" ? "Moving" : input.service === "labor" ? "Labor" : "Junk Removal",
      quote.minEstimate.toFixed(2),
      quote.minEstimate.toFixed(2),
      JSON.stringify(details),
      capacity.startAt.toISOString(),
    ]);
    const leadResult = await tx.query(`
      INSERT INTO leads
        (first_name, last_name, email, phone, service_type, from_address, to_address, move_date, details, source, status,
         truck_config, truck_provider, truck_size, crew_size, confirmed_hours, base_price, total_price,
         booking_id, quote_snapshot, zone_snapshot, arrival_window, deposit_required, is_quote_only,
         sms_consent, sms_consent_recorded_at, sms_consent_source, financial_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'instant_booking_hold',$10,
              $11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23,
              $24,$25,'instant_booking',$26)
      RETURNING id, order_number
    `, [
      firstName,
      lastName,
      customerEmail,
      normalizedPhone,
      input.service === "moving" ? "Residential Move" : input.service === "labor" ? "Labor" : "Junk Removal",
      input.serviceAddress,
      input.destinationAddress || null,
      input.requestedDate,
      [
        autoBookEligible ? "[STANDARD ONLINE BOOKING - 30% DEPOSIT REQUIRED]" : "[PENDING ONLINE HOLD - ADMIN REVIEW REQUIRED]",
        `Requested start: ${input.requestedDate} ${timeLabel(input.startTime)} ${INSTANT_BOOKING_TIME_ZONE}`,
        `Estimate: $${quote.minEstimate}–$${quote.maxEstimate} (subject to review)`,
        `Crew required: ${quote.crewSize}`,
        `Hours: ${quote.requestedHours}`,
        input.notes ? `Customer notes: ${input.notes}` : "",
      ].filter(Boolean).join("\n"),
      initialLeadStatus,
      input.truckSource === "jc_on_the_move" ? "company_truck" : input.truckSource === "customer" ? "customer_truck" : input.truckSource === "rental" ? "rental_truck" : "no_truck",
      input.truckSource,
      input.truckSize,
      quote.crewSize,
      Math.ceil(quote.requestedHours),
      quote.minEstimate.toFixed(2),
      quote.maxEstimate.toFixed(2),
      bookingId,
      JSON.stringify(quoteSnapshot),
      JSON.stringify({ zoneCode: quote.zoneCode, zoneName: quote.zoneName, travelFallback: quote.travelFallback }),
      `${timeLabel(input.startTime)}–${timeLabel(`${String(Math.min(23, Number(input.startTime.slice(0, 2)) + Math.ceil(quote.requestedHours))).padStart(2, "0")}:00`)}`,
      autoBookEligible || quote.travelFallback,
      !autoBookEligible,
      input.smsConsent,
      input.smsConsent ? new Date() : null,
      autoBookEligible ? "awaiting_deposit" : "quote",
    ]);
    const leadId = String(leadResult.rows[0]?.id || "");
    if (!leadId) throw new Error("Lead insert returned no id");
    const expiresAt = new Date(Date.now() + HOLD_LIFETIME_MS);
    const holdResult = await tx.query(`
      INSERT INTO booking_slot_holds
        (booking_id, lead_id, service_date, start_at, duration_minutes, crew_size, status, expires_at, review_required, zone_code, quote_snapshot)
        VALUES ($1,$2,$3::date,$4::timestamptz,$5,$6,$7,$8::timestamptz,$9,$10,$11::jsonb)
      RETURNING id
    `, [
      bookingId,
      leadId,
      input.requestedDate,
      capacity.startAt.toISOString(),
      quote.durationMinutes,
      quote.crewSize,
      initialHoldStatus,
      expiresAt.toISOString(),
      !autoBookEligible || quote.reviewRequired,
      quote.zoneCode,
      JSON.stringify(quoteSnapshot),
    ]);
    await tx.query("COMMIT");
    const holdId = String(holdResult.rows[0]?.id || "");

    let quoteRevision: Awaited<ReturnType<typeof saveQuoteDraft>> | null = null;
    let approvedQuote: Awaited<ReturnType<typeof approveQuoteRevision>> | null = null;
    let finalStatus = initialHoldStatus;
    let paymentUrl: string | null = null;
    let depositSquareInvoiceId: string | null = null;
    let invoiceWarning: string | null = null;
    let depositAmount: number | null = null;
    try {
      quoteRevision = await saveQuoteDraft({
        leadId,
        actorUserId: null,
        lineItems: quote.lineItems,
        discountTotal: 0,
        notes: input.notes || null,
        serviceDate: input.requestedDate,
      });
      if (autoBookEligible) {
        const owner = await pool.query<{ id: string; email: string }>(
          `SELECT id, email FROM users WHERE role='business_owner' AND status='approved' ORDER BY created_at ASC LIMIT 1`,
        );
        if (!owner.rows[0]) throw new Error("No approved business owner is configured for automatic quote approval");
        approvedQuote = await approveQuoteRevision({
          quoteId: quoteRevision.id,
          actor: { userId: owner.rows[0].id, email: owner.rows[0].email, isOwner: true, canApproveStandard: true },
          overrideReason: null,
        });
        depositAmount = Math.round(approvedQuote.customerTotal * 0.3 * 100) / 100;
        const termsHash = crypto.createHash("sha256").update(`${input.termsVersion}:${approvedQuote.id}:${approvedQuote.customerTotal.toFixed(2)}`).digest("hex");
        await pool.query(
          `INSERT INTO job_agreements
             (lead_id, quote_revision_id, terms_version, terms_hash, acceptance_method, acceptance_token_id)
           VALUES ($1,$2,$3,$4,'web_checkbox',$5)
           ON CONFLICT (lead_id, quote_revision_id, terms_hash) DO NOTHING`,
          [leadId, approvedQuote.id, input.termsVersion, termsHash, holdId],
        );
        await pool.query(
          `UPDATE leads SET base_price=$2, total_price=$3, deposit_required=true,
                  deposit_amount_gate=$4, is_quote_only=false, financial_status='awaiting_deposit',
                  last_quote_updated_at=NOW()
            WHERE id=$1`,
          [leadId, approvedQuote.subtotal, approvedQuote.customerTotal, depositAmount],
        );
        await pool.query(
          `UPDATE bookings SET subtotal=$2, discount_total=$3, final_total=$4, status='awaiting_deposit' WHERE id=$1`,
          [bookingId, approvedQuote.subtotal, approvedQuote.discountTotal, approvedQuote.customerTotal],
        );
        const freshLead = await storage.getLead(leadId);
        if (!freshLead) throw new Error("Automatic booking lead could not be reloaded");
        const { squareInvoiceService } = await import("../services/square-invoice");
        if (!squareInvoiceService.isConfigured()) {
          invoiceWarning = "Square is not configured. The time remains held while staff sends the deposit request.";
        } else {
          const hasCustomerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(freshLead.email)
            && !/@jconthemove\.local$/i.test(freshLead.email);
          const invoice = await squareInvoiceService.createInvoiceForLead(
            freshLead,
            depositAmount,
            `30% scheduling deposit for JC ON THE MOVE ${freshLead.serviceType} job`,
            undefined,
            hasCustomerEmail ? "email" : "none",
            { purpose: "deposit", quoteRevisionId: approvedQuote.id },
          );
          paymentUrl = invoice.invoiceUrl || null;
          depositSquareInvoiceId = invoice.squareInvoiceId;
          await db.update(leads).set({ squarePaymentUrl: paymentUrl }).where(eq(leads.id, leadId));
        }
      }
    } catch (quoteRevisionError) {
      // The hold and lead are still useful for recovery, but they may not be
      // approved or invoiced until the revision service succeeds.
      console.error("[instant-booking/hold] quote revision creation failed:", quoteRevisionError instanceof Error ? quoteRevisionError.message : quoteRevisionError);
      if (autoBookEligible) {
        finalStatus = "pending_review";
        invoiceWarning = "Automatic approval could not finish, so the request was moved to staff review. No payment was taken.";
        await pool.query(`UPDATE booking_slot_holds SET status='pending_review', review_required=true WHERE id=$1`, [holdId]).catch(() => undefined);
        await pool.query(`UPDATE bookings SET status='pending_review' WHERE id=$1`, [bookingId]).catch(() => undefined);
        await pool.query(`UPDATE leads SET status='quote_requested', financial_status='quote' WHERE id=$1`, [leadId]).catch(() => undefined);
      }
    }

    // Every quote request is offered for crew-size and quote sampling. The
    // pending-hold flag keeps it distinct from a confirmed dispatch.
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (lead) {
      await emitJobEvent("quote_requested", lead, {
        eventId: `instant-booking-quote:${leadId}`,
        source: "instant_booking_hold",
        extra: { bookingId, holdId, pendingHold: true, expiresAt: expiresAt.toISOString() },
      });
    }
    try {
      const { emitCustomerLifecycleEvent } = await import("../services/customerLifecycle");
      await emitCustomerLifecycleEvent({
        leadId,
        type: paymentUrl ? "deposit_invoice_sent" : "booking_request_received",
        eventKey: `${leadId}:instant_hold:${holdId}:${finalStatus}`,
        title: paymentUrl ? "Your deposit link is ready" : "Your booking request is received",
        message: paymentUrl
          ? `Your standard job and requested time are approved. Pay the $${Number(depositAmount || 0).toFixed(2)} scheduling deposit within 24 hours to confirm the time.`
          : finalStatus === "pending_review"
            ? "Your requested time is held for 24 hours while the team reviews route, scope, and crew requirements. No payment has been taken."
            : "Your requested time is held while staff prepares the scheduling deposit link.",
        payload: { bookingId, holdId, status: finalStatus, expiresAt: expiresAt.toISOString(), depositAmount, squareInvoiceId: depositSquareInvoiceId },
        actionUrl: paymentUrl || undefined,
      });
    } catch (customerEventError) {
      console.error("[instant-booking/hold] customer confirmation notification failed:", customerEventError);
    }
    return res.status(201).json({
      success: true,
      bookingId,
      leadId,
      holdId,
      status: finalStatus,
      expiresAt: expiresAt.toISOString(),
      quote,
      quoteRevisionId: approvedQuote?.id || quoteRevision?.id || null,
      quoteRevision: approvedQuote?.revision || quoteRevision?.revision || null,
      depositAmount,
      paymentUrl,
      invoiceWarning,
      message: finalStatus === "awaiting_deposit"
        ? paymentUrl
          ? "Your standard job is approved. Pay the 30% Square deposit within 24 hours to confirm the time and start crew assignment."
          : "Your standard job is approved and held for 24 hours. Staff will send the 30% deposit request."
        : quote.travelFallback
          ? "We received your conditional hold and travel estimate. An admin will review it before any deposit is requested."
          : "Your requested time is held for 24 hours pending our review. No payment has been taken yet.",
    });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* transaction already completed */ }
    }
    if (error instanceof ZodError) return res.status(400).json({ error: "Check the booking details", details: error.errors });
    console.error("[instant-booking/hold] error:", error);
    return res.status(500).json({ error: "We could not place that hold. Please try again or request a callback." });
  } finally {
    client?.release();
  }
});

// ── POST /api/bookings/quote ───────────────────────────────────────────────
router.post("/bookings/quote", async (req: Request, res: Response) => {
  try {
    const body = bookingQuoteRequestSchema.parse(req.body);
    const activePricing = await getActivePricingSnapshot();
    const catalog = await loadCatalog();
    const activeRateSelection = await resolveBookingRateContext(body, body.items, activePricing.snapshot);
    const {
      pricingInputs,
      persistInputs,
      rateSource,
      pricingReviewReasons,
    } = resolveItems(body.items, catalog, activePricing.snapshot, activeRateSelection.context);
    // Pull live reward-engine settings so the displayed estimate uses the
    // exact same flatBonus/earnRate the issuer (disburseBookingTokens) will
    // use at confirmation time. Booking creation snapshots these onto the
    // booking row to lock in parity even if settings change later.
    const settings = await loadBookingRewardSettings();
    // Task #169 — route through the unified pricingEngine so /book, the
    // chatbot, admin pricing-calibrate, and the orchestrator all hit the
    // same module. quoteBundle loads active bundle definitions internally.
    const baseResult = await quoteBundle(pricingInputs, {
      flatBookingBonus: settings.flatBonus,
      earnRatePerDollar: settings.earnRate,
    });
    // Task #175 — Apply JCMOVES tokens at quote time. Server-side
    // validation against the canonical redemption rules so the rejected
    // amount is surfaced (rather than silently zeroed) and the discounted
    // line + new finalTotal flow into both the displayed quote AND the
    // persisted booking when the customer hits "Confirm".
    const requestedDate = body.requestedDate || firstDetailValue(persistInputs, ["requestedDate", "moveDate", "date"]);
    const serviceAddress = body.serviceAddress || firstDetailValue(persistInputs, ["serviceAddress", "fromAddress", "address"]);
    let result: BookingPricingWithAddressDiscount & {
      tokenRedemption?: { tokens: number; discountUsd: number };
    } = await applyBookingGeographicPricing({
      quote: baseResult,
      body,
      items: persistInputs,
      requestedDate,
      pricing: activePricing.snapshot,
      flatBonus: settings.flatBonus,
      earnRate: settings.earnRate,
      routeEvidence: activeRateSelection.routeEvidence,
      rateSource,
      pricingReviewReasons,
    });
    result = applyServiceAddressDiscount(result, {
      serviceAddress,
      requestedDate,
      flatBonus: settings.flatBonus,
      earnRate: settings.earnRate,
      pricing: activePricing.snapshot,
    });
    if (body.applyTokens && body.applyTokens > 0) {
      const { validateRedemption, tokensToDollars } = await import("@shared/tokenRedemptionRules");
      const validation = validateRedemption(body.applyTokens, result.finalTotal, body.customerTier ?? null);
      if (!validation.valid) {
        return res.status(400).json({
          error: "Token redemption rejected",
          message: validation.message,
          maxTokens: validation.effectiveTokens,
        });
      }
      const tokenDiscount = +tokensToDollars(validation.effectiveTokens).toFixed(2);
      result = {
        ...result,
        tokenRedemption: {
          tokens: validation.effectiveTokens,
          discountUsd: tokenDiscount,
        },
        finalTotal: +Math.max(0, result.finalTotal - tokenDiscount).toFixed(2),
      };
    }
    // Task #174 — Apply demand-based surge multiplier to the finalTotal
    // if the caller provided service coordinates. Mode gating (shadow/
    // soft/full) is enforced inside decideSurge(), so shadow returns 1.0
    // here and the customer sees no change until operators promote.
    let surge: { multiplier: number; band: string; reason: string; surgedTotal: number; zone: string | null } | null = null;
    try {
      // The versioned geographic policy is the sole location premium once
      // published; legacy demand surge must not stack on top of it.
      if (!activePricing.snapshot.geographicPolicy) {
        const { getDemandForCoords } = await import("../demand");
        const { surge: decision, zone } = await getDemandForCoords(body.serviceLat, body.serviceLng);
        if (decision.multiplier !== 1) {
          const surgedTotal = +(result.finalTotal * decision.multiplier).toFixed(2);
          result = { ...result, finalTotal: surgedTotal };
        }
        surge = {
          multiplier: decision.multiplier,
          band: decision.band,
          reason: decision.reason,
          surgedTotal: result.finalTotal,
          zone: zone?.name ?? null,
        };
      }
    } catch (e) {
      console.warn("[bookings/quote] surge compute failed:", e instanceof Error ? e.message : e);
    }
    // Keep the owner-publishable geographic version in shadow mode until it
    // is explicitly activated. This comparison never changes the response.
    if (activePricing.snapshot.version !== "2026.08.3") {
      void (async () => {
        try {
          const candidate = await getPricingSnapshotByCode("2026.08.3");
          if (!candidate) return;
          const candidateRateSelection = await resolveBookingRateContext(body, body.items, candidate.snapshot);
          const candidateItems = resolveItems(
            body.items,
            catalog,
            candidate.snapshot,
            candidateRateSelection.context,
          );
          const candidateBase = await quoteBundle(candidateItems.pricingInputs, {
            flatBookingBonus: settings.flatBonus,
            earnRatePerDollar: settings.earnRate,
          });
          const candidateGeo = await applyBookingGeographicPricing({
            quote: candidateBase,
            body,
            items: candidateItems.persistInputs,
            requestedDate,
            pricing: candidate.snapshot,
            flatBonus: settings.flatBonus,
            earnRate: settings.earnRate,
            routeEvidence: candidateRateSelection.routeEvidence,
            rateSource: candidateItems.rateSource,
            pricingReviewReasons: candidateItems.pricingReviewReasons,
          });
          const candidateFinal = applyServiceAddressDiscount(candidateGeo, {
            serviceAddress,
            requestedDate,
            flatBonus: settings.flatBonus,
            earnRate: settings.earnRate,
            pricing: candidate.snapshot,
          });
          console.info("[pricing-shadow]", JSON.stringify({
            activeVersion: activePricing.snapshot.version,
            candidateVersion: candidate.snapshot.version,
            activePreCreditTotal: result.serviceabilityTotal ?? result.finalTotal,
            candidatePreCreditTotal: candidateFinal.serviceabilityTotal ?? candidateFinal.finalTotal,
            difference: +((candidateFinal.serviceabilityTotal ?? candidateFinal.finalTotal) - (result.serviceabilityTotal ?? result.finalTotal)).toFixed(2),
            travelEligibility: candidateFinal.travelEligibility,
          }));
        } catch (shadowError) {
          console.warn("[pricing-shadow] candidate comparison failed:", shadowError instanceof Error ? shadowError.message : shadowError);
        }
      })();
    }
    // Task #170 — shadow mode. Fire-and-forget a parallel pipeline run
    // and log the parity comparison. Never awaited — response latency is
    // unchanged.
    void (async () => {
      try {
        const { shadowCompareAndLog } = await import("../pipeline");
        await shadowCompareAndLog(
          {
            items: pricingInputs,
            source: "shadow",
            persist: false,
            serviceLat: body.serviceLat,
            serviceLng: body.serviceLng,
          },
          result.finalTotal,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[bookings/quote] shadow run failed:", e instanceof Error ? e.message : e);
      }
    })();
    return res.json({
      success: true,
      quote: {
        ...result,
        pricingVersion: activePricing.snapshot.version,
        pricingSource: activePricing.source,
      },
      surge,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("[bookings/quote] error:", err);
    return res.status(500).json({ error: "Failed to compute quote" });
  }
});

// Task #146 — When a multi-service booking includes a `trash_valet` line
// item, auto-provision the trash subscription + first job from the captured
// details so the admin pipeline doesn't have to phone the customer for
// cans/bag-count/service-day/plan-type. Best-effort: failures are logged
// but do NOT roll back the parent booking — the admin can still pick it up
// from the booking detail view.
async function autoProvisionTrashSubscriptionFromBooking(args: {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  serviceAddress: string | null;
  trashItem: ResolvedItems["persistInputs"][number];
}): Promise<void> {
  try {
    const { trashItem, customerName, customerPhone, customerEmail, serviceAddress, bookingId } = args;
    if (!serviceAddress) {
      console.warn(`[bookings] trash_valet auto-provision skipped (booking=${bookingId}): missing service address`);
      return;
    }
    const details = (trashItem.details || {}) as Record<string, unknown>;
    // Server-side bounds: clamp to the same maxima the UI advertises so the
    // helper is deterministic regardless of what the client sends.
    const cans = Math.max(1, Math.min(10, Number(details.cans) || 1));
    const bagCount = Math.max(0, Math.min(50, Number(details.bagCount) || 0));
    const recyclingEnabled = !!details.recyclingEnabled;
    const recyclingAnchorDate = (details.recyclingAnchorDate as string | undefined) || null;
    const serviceDayOfWeek = Math.max(1, Math.min(6, Number(details.serviceDayOfWeek) || 1));
    // If recycling is enabled but no specific day was chosen, fall back to
    // the trash service day so the subscription always has a complete
    // schedule (matches the dedicated /trash-valet/book behavior).
    const recyclingDayOfWeek = details.recyclingDayOfWeek != null
      ? Math.max(1, Math.min(6, Number(details.recyclingDayOfWeek)))
      : (recyclingEnabled ? serviceDayOfWeek : null);
    const planType = details.planType === "yearly" ? "yearly" : "monthly";
    const serviceNotes = typeof details.notes === "string" ? details.notes.trim() || null : null;

    const { trashSubscriptions, trashJobs } = await import("@shared/schema");
    const { calculateTrashValetQuote, isRecyclingWeek: checkRecycling } = await import("../../shared/trashValetPricing");

    // Skip if an active subscription already exists for this address
    // (matches the duplicate guard in /api/trash/subscribe).
    const normalizedAddr = serviceAddress.trim().toLowerCase();
    const existing = await db
      .select({ id: trashSubscriptions.id })
      .from(trashSubscriptions)
      .where(and(
        sql`LOWER(TRIM(${trashSubscriptions.address})) = ${normalizedAddr}`,
        sql`${trashSubscriptions.status} = 'active'`,
      ));
    if (existing.length > 0) {
      console.info(`[bookings] trash_valet auto-provision skipped (booking=${bookingId}): active sub already exists for ${normalizedAddr}`);
      return;
    }

    // Geocode the service address for travel-surcharge parity with the
    // canonical /api/trash/subscribe path. Failures are non-fatal — quote
    // falls back to local-area pricing the same way that route does.
    let resolvedLat: number | null = null;
    let resolvedLng: number | null = null;
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(serviceAddress)}&format=json&limit=1&countrycodes=us`;
      const geoResp = await fetch(geoUrl, { headers: { "User-Agent": "JCOnTheMove/1.0 contact@jcontmove.com" } });
      if (geoResp.ok) {
        const geoData = await geoResp.json() as Array<{ lat: string; lon: string }>;
        if (geoData.length > 0) {
          resolvedLat = parseFloat(geoData[0].lat);
          resolvedLng = parseFloat(geoData[0].lon);
        }
      }
    } catch { /* geocode failure is non-fatal — surcharge defaults to 0 */ }

    const quote = calculateTrashValetQuote({
      cans,
      bagCount,
      recyclingEnabled,
      recyclingAnchorDate: recyclingAnchorDate || null,
      lat: resolvedLat,
      lng: resolvedLng,
      planType,
    });

    const today = new Date().toISOString().split("T")[0];

    // Compute first-job week before the transaction so both inserts share
    // a consistent serviceWeekOf.
    const serviceDate = new Date();
    let dayDiff = serviceDayOfWeek - serviceDate.getDay();
    if (dayDiff <= 0) dayDiff += 7;
    serviceDate.setDate(serviceDate.getDate() + dayDiff);
    const weekSunday = new Date(serviceDate);
    weekSunday.setDate(serviceDate.getDate() - serviceDate.getDay());
    const weekOfStr = weekSunday.toISOString().split("T")[0];

    const recyclingThisWeek = recyclingEnabled && recyclingAnchorDate
      ? checkRecycling(recyclingAnchorDate, serviceDate)
      : false;
    const weekQuote = calculateTrashValetQuote({
      cans,
      bagCount,
      recyclingEnabled,
      recyclingAnchorDate: recyclingAnchorDate || null,
      lat: resolvedLat,
      lng: resolvedLng,
      planType,
      targetWeekOf: weekOfStr,
    });

    // Subscription + first job are created in a single transaction so we
    // never end up with an active subscription that has no scheduled job
    // (or vice versa).
    const subId = await db.transaction(async (tx) => {
      const [sub] = await tx.insert(trashSubscriptions).values({
        customerName: customerName.trim(),
        phone: customerPhone.trim(),
        email: (customerEmail || "").trim(),
        address: serviceAddress.trim(),
        city: "",
        state: "MI",
        zip: "",
        lat: resolvedLat != null ? String(resolvedLat) : null,
        lng: resolvedLng != null ? String(resolvedLng) : null,
        distanceMiles: quote.distanceMiles != null ? String(quote.distanceMiles) : null,
        travelSurchargeMonthly: String(quote.travelSurchargeMonthly),
        cans,
        bagCount,
        recyclingEnabled,
        recyclingAnchorDate: recyclingAnchorDate || null,
        serviceDayOfWeek,
        recyclingDayOfWeek,
        serviceNotes,
        planType,
        weeklyBasePrice: String(quote.weeklyBasePrice),
        projectedMonthlyPrice: String(quote.projectedMonthlyPrice),
        monthlyMinimumApplied: quote.monthlyMinimumApplied,
        finalMonthlyPrice: String(quote.finalMonthlyPrice),
        billingStatus: "active",
        status: "active",
        nextBillingDate: today,
      }).returning();

      await tx.insert(trashJobs).values({
        subscriptionId: sub.id,
        serviceWeekOf: weekOfStr,
        serviceType: "trash_valet",
        cans,
        bagCount,
        isRecyclingWeek: weekQuote.isRecyclingWeek || recyclingThisWeek,
        weeklyBasePrice: String(weekQuote.weeklyBasePrice),
        recyclingCharge: String(weekQuote.recyclingCharge),
        travelChargePortion: String(weekQuote.travelChargePortion),
        jobValue: String(weekQuote.jobValue),
        status: "scheduled",
      });

      return sub.id;
    });

    console.info(`[bookings] trash_valet auto-provisioned subscription=${subId} from booking=${bookingId}`);
  } catch (err) {
    // Never let trash auto-provisioning break the booking response — the
    // admin can still create the subscription manually from the booking
    // detail view.
    console.error("[bookings] trash_valet auto-provision failed:", err);
  }
}

// ── POST /api/bookings ─────────────────────────────────────────────────────
router.post("/bookings", async (req: Request, res: Response) => {
  try {
    const body = bookingCreateRequestSchema.parse(req.body);
    const activePricing = await getActivePricingSnapshot();
    const catalog = await loadCatalog();
    const activeRateSelection = await resolveBookingRateContext(body, body.items, activePricing.snapshot);
    const {
      pricingInputs,
      persistInputs,
      rateSource,
      pricingReviewReasons,
    } = resolveItems(body.items, catalog, activePricing.snapshot, activeRateSelection.context);
    const bundles = await loadBundles();
    // Snapshot of the active reward-engine settings at quote/creation time.
    // Persisting these on the booking row guarantees the customer-facing
    // tokenEstimate equals what disburseBookingTokens credits at confirm —
    // even if an admin tunes rewardSettings or a bundle's bonusMultiplier
    // in the intervening window.
    const settings = await loadBookingRewardSettings();
    // Task #169 — same engine as /api/bookings/quote so the persisted
    // booking can never disagree with the customer's just-shown estimate.
    const baseQuote: BookingPricingResult = await quoteBundle(pricingInputs, {
      bundleDefinitions: bundles,
      flatBookingBonus: settings.flatBonus,
      earnRatePerDollar: settings.earnRate,
    });
    const appliedMultiplier = baseQuote.bundleApplied?.bonusMultiplier ?? 1;

    // Task #175 — Pre-flight authentication & balance check BEFORE persist.
    // applyTokens / payFromWallet require an authenticated user (otherwise an
    // anonymous caller could persist a discounted booking they never paid
    // for) and the customer's tier comes from `users.loyalty_tier` on the
    // server — never from the request body — so the redemption cap can't
    // be inflated by a tampered payload.
    const authedUserId: string | undefined = (req as { user?: { id?: string } }).user?.id
      || (req.session as { userId?: string } | undefined)?.userId;
    const wantsTokens = !!body.applyTokens && body.applyTokens > 0;
    const wantsWallet = body.payFromWallet === true;
    let serverTier: string | null = null;
    let preflightTokenRedemption: { tokens: number; discountUsd: number } | null = null;
    if (wantsTokens || wantsWallet) {
      if (!authedUserId) {
        return res.status(401).json({
          error: "Authentication required",
          message: "Sign in to apply JCMOVES tokens or pay from your wallet.",
        });
      }
      try {
        const { rows } = await pool.query<{ loyalty_tier: string | null }>(
          `SELECT loyalty_tier FROM users WHERE id = $1 LIMIT 1`,
          [authedUserId],
        );
        serverTier = rows[0]?.loyalty_tier ?? "bronze";
      } catch {
        serverTier = "bronze";
      }
    }
    const requestedDateForDiscount = body.requestedDate || firstDetailValue(persistInputs, ["requestedDate", "moveDate", "date"]);
    const serviceAddressForDiscount = body.serviceAddress || firstDetailValue(persistInputs, ["serviceAddress", "fromAddress", "address"]);
    let quote: BookingPricingWithAddressDiscount & {
      tokenRedemption?: { tokens: number; discountUsd: number };
    } = await applyBookingGeographicPricing({
      quote: baseQuote,
      body,
      items: persistInputs,
      requestedDate: requestedDateForDiscount,
      pricing: activePricing.snapshot,
      flatBonus: settings.flatBonus,
      earnRate: settings.earnRate,
      routeEvidence: activeRateSelection.routeEvidence,
      rateSource,
      pricingReviewReasons,
    });
    quote = applyServiceAddressDiscount(quote, {
      serviceAddress: serviceAddressForDiscount,
      requestedDate: requestedDateForDiscount,
      flatBonus: settings.flatBonus,
      earnRate: settings.earnRate,
      pricing: activePricing.snapshot,
    });
    if (wantsTokens) {
      const { validateRedemption, tokensToDollars } = await import("@shared/tokenRedemptionRules");
      const validation = validateRedemption(body.applyTokens!, quote.finalTotal, serverTier);
      if (!validation.valid) {
        return res.status(400).json({
          error: "Token redemption rejected",
          message: validation.message,
          maxTokens: validation.effectiveTokens,
        });
      }
      // Re-check the live token balance BEFORE persist so we can reject
      // up-front instead of persisting a discounted booking and then
      // having to roll it back when settle fails.
      try {
        const { rows: walletRows } = await pool.query<{ token_balance: string }>(
          `SELECT token_balance FROM wallet_accounts WHERE user_id = $1 LIMIT 1`,
          [authedUserId!],
        );
        const tokens = Number(walletRows[0]?.token_balance ?? 0);
        if (tokens < validation.effectiveTokens) {
          return res.status(400).json({
            error: "Insufficient JCMOVES balance",
            message: `You have ${tokens} JCMOVES — need ${validation.effectiveTokens}.`,
          });
        }
      } catch {
        return res.status(400).json({ error: "Wallet read failed" });
      }
      const tokenDiscount = +tokensToDollars(validation.effectiveTokens).toFixed(2);
      preflightTokenRedemption = { tokens: validation.effectiveTokens, discountUsd: tokenDiscount };
      quote = {
        ...quote,
        finalTotal: +Math.max(0, quote.finalTotal - tokenDiscount).toFixed(2),
        tokenRedemption: preflightTokenRedemption,
      };
    }
    // Same up-front check for wallet cash so we don't persist then refund.
    if (wantsWallet) {
      try {
        const { rows: walletRows } = await pool.query<{ cash_balance: string }>(
          `SELECT cash_balance FROM wallet_accounts WHERE user_id = $1 LIMIT 1`,
          [authedUserId!],
        );
        const cash = Number(walletRows[0]?.cash_balance ?? 0);
        if (cash < quote.finalTotal) {
          return res.status(400).json({
            error: "Insufficient wallet balance",
            message: `Wallet has $${cash.toFixed(2)} — need $${quote.finalTotal.toFixed(2)}.`,
          });
        }
      } catch {
        return res.status(400).json({ error: "Wallet read failed" });
      }
    }

    const requestUser = await getRequestUser(req);
    const requestAuthority = await getAuthorityForUser(requestUser);
    const isWorkerCreated = body.source === "crew_add_job";
    const marketingTracking = safeMarketingTracking(body.marketingTracking);
    const marketingPromoCode = body.promoCode ? body.promoCode.toUpperCase().trim() : "";
    const marketingReferralSlug = body.referralSlug ? body.referralSlug.toLowerCase().trim() : "";
    const marketingCampaignId = body.marketingCampaignId
      ? body.marketingCampaignId.trim()
      : marketingTracking.jcCampaign || marketingTracking.utmContent || "";
    if (isWorkerCreated && !requestUser) {
      return res.status(401).json({
        error: "Authentication required",
        message: "Sign in as a worker to add quotes or jobs.",
      });
    }
    if (isWorkerCreated && requestAuthority.rank < tierRank.bronze) {
      return res.status(403).json({
        error: "Worker authority required",
        message: "Bronze or higher authority is required to post customer quote requests.",
      });
    }
    const requiresQuoteApproval = isWorkerCreated && requestAuthority.tier === "silver";
    const bookingStatus = requiresQuoteApproval ? "pending_quote_approval" : "quote";

    // Task #163 — guarantee every numeric column persists as a finite
    // 2-decimal string. A non-finite quantity / unitPrice / lineSubtotal
    // (NaN, Infinity, undefined) used to crash `.toFixed(2)` and bubble
    // up as a generic 500 that hid the real cause. Quote-only / TBD
    // lines persist as 0.00 with priceMode="quote" instead of throwing.
    const money = (n: unknown): string => {
      const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
      return Math.max(0, v).toFixed(2);
    };

    // Wrap parent + children in a transaction so a child-insert failure
    // never leaves an orphan `bookings` row pointing at no line items.
    const booking = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(bookings)
        .values({
          customerName: body.customerName,
          customerEmail: body.customerEmail || null,
          customerPhone: body.customerPhone,
          serviceAddress: body.serviceAddress || null,
          notes: body.notes || null,
          subtotal: money(quote.subtotal),
          discountTotal: money(quote.discountTotal),
          finalTotal: money(quote.finalTotal),
          bundleAppliedCode: quote.bundleApplied?.code ?? null,
          tokenEstimate: Number.isFinite(quote.tokenEstimate) ? quote.tokenEstimate : 0,
          rewardFlatBonusSnapshot: Math.round(settings.flatBonus),
          rewardEarnRateSnapshot: (Number.isFinite(settings.earnRate) ? settings.earnRate : 0).toFixed(4),
          rewardBonusMultiplierSnapshot: money(appliedMultiplier),
          pricingVersionId: activePricing.versionId,
          pricingVersionCode: activePricing.snapshot.version,
          pricingSnapshot: {
            capturedAt: new Date().toISOString(),
            source: activePricing.source,
            pricing: activePricing.snapshot,
            quote: {
              subtotal: quote.subtotal,
              discountTotal: quote.discountTotal,
              finalTotal: quote.finalTotal,
              bundleApplied: quote.bundleApplied ?? null,
              serviceAddressDiscount: quote.serviceAddressDiscount ?? null,
              pricingAdjustments: quote.pricingAdjustments ?? null,
              travelEligibility: quote.travelEligibility ?? null,
              routeEvidence: quote.routeEvidence ?? null,
              serviceabilityTotal: quote.serviceabilityTotal ?? quote.finalTotal,
              tokenRedemption: quote.tokenRedemption ?? null,
              items: quote.items,
            },
          },
          status: bookingStatus,
          source: body.source || "api",
        })
        .returning();

      if (persistInputs.length > 0) {
        const pricingByIdx = quote.items;
        await tx.insert(bookingServiceItems).values(
          persistInputs.map((p, idx) => ({
            bookingId: created.id,
            serviceCode: p.serviceCode,
            serviceLabel: p.serviceLabel,
            quantity: money(p.quantity),
            unitPrice: money(p.unitPrice),
            lineSubtotal: money(pricingByIdx[idx]?.lineSubtotal),
            priceMode: p.priceMode,
            details: p.details,
          })),
        );
      }
      return created;
    });

    if (requestUser) {
      try {
        await db.insert(quoteAttributions).values({
          bookingId: booking.id,
          userId: requestUser.id,
          attributionType: requiresQuoteApproval ? "silver_quote_builder" : isWorkerCreated ? "worker_quote_builder" : "customer_quote_request",
          promoCode: marketingPromoCode || requestUser.referralCode || null,
          metadata: {
            source: body.source || "api",
            authorityTier: requestAuthority.tier,
            referralSlug: marketingReferralSlug || null,
            marketingCampaignId: marketingCampaignId || null,
            marketingTracking,
            quoteTotal: quote.finalTotal,
            crewSummary: quote.items.map((item) => item.laborMeta).filter(Boolean),
          },
        });
        if (isWorkerCreated) {
          await pool.query(`
            INSERT INTO worker_profiles (user_id, authority_tier, leads_posted_count, updated_at)
            VALUES ($1, $2, 1, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET leads_posted_count = worker_profiles.leads_posted_count + 1,
                updated_at = NOW()
          `, [requestUser.id, requestAuthority.tier]);
        }
        if (requiresQuoteApproval) {
          await db.insert(quoteApprovals).values({
            bookingId: booking.id,
            submittedByUserId: requestUser.id,
            approvalRole: "silver_submission",
            status: "pending",
            notes: "Silver quote draft requires a Gold+ reviewer or business-owner approval.",
          });
        }
      } catch (attrErr) {
        console.error("[bookings] worker attribution failed:", attrErr instanceof Error ? attrErr.message : attrErr);
      }
    }

    if (marketingPromoCode || marketingReferralSlug || marketingCampaignId) {
      try {
        const [rep] = marketingPromoCode || marketingReferralSlug
          ? await db.select().from(marketingReps)
              .where(marketingPromoCode
                ? eq(marketingReps.promoCode, marketingPromoCode)
                : eq(marketingReps.slug, marketingReferralSlug))
              .limit(1)
          : [];
        const repPromoCode = rep?.promoCode || marketingPromoCode || "";
        const repUserId = repPromoCode ? await resolveMarketingRepUserId(repPromoCode) : null;
        await db.insert(quoteAttributions).values({
          bookingId: booking.id,
          userId: repUserId,
          attributionType: repPromoCode || marketingReferralSlug ? "marketing_rep_booking" : "marketing_campaign_booking",
          promoCode: repPromoCode || null,
          metadata: {
            source: body.source || "api",
            referralSlug: rep?.slug || marketingReferralSlug || null,
            marketingCampaignId: marketingCampaignId || null,
            marketingTracking,
            quoteTotal: quote.finalTotal,
            crewSummary: quote.items.map((item) => item.laborMeta).filter(Boolean),
          },
        });
      } catch (attrErr) {
        console.error("[bookings] marketing attribution failed:", attrErr instanceof Error ? attrErr.message : attrErr);
      }
    }

    // Task #131 — reward disbursement intentionally NOT fired here. Newly
    // created bookings start in `status: "quote"`; rewards must only be
    // issued once the customer (or an admin) confirms the booking via
    // POST /api/admin/bookings/:id/confirm.

    // Task #146 — auto-provision a Trash Valet subscription when bundled.
    // The helper already swallows its own errors so this call cannot turn a
    // successful booking create into a 500 even if provisioning fails.
    let linkedLead: typeof leads.$inferSelect | null = null;
    const leadSource = body.source || "api";
    const leadPromoCode = marketingPromoCode || requestUser?.referralCode || null;
    try {
      const [existingLinked] = await db
        .select()
        .from(leads)
        .where(eq(leads.bookingId, booking.id))
        .limit(1);
      if (existingLinked) {
        linkedLead = existingLinked;
      } else {
        const name = splitCustomerName(body.customerName);
        const requestedDate = firstDetailValue(persistInputs, ["requestedDate", "moveDate", "date"]);
        const dropoffAddress = firstDetailValue(persistInputs, ["dropoffAddress", "toAddress", "destinationAddress"]);
        const serviceType = serviceTypeForLead(persistInputs);
        const marketplaceShape = marketplaceShapeForBooking(persistInputs, serviceType);
        const marketplaceSourceFlow = marketplaceSourceFlowForBooking(persistInputs, marketplaceShape.id, leadSource);
        const crewSize = maxCrew(quote.items, persistInputs);
        const confirmedHours = firstHours(quote.items, persistInputs);
        const bookingReference = `JOB-${booking.id.slice(0, 8).toUpperCase()}`;
        const marketplaceQuotePreview =
          body.marketplaceQuotePreview && typeof body.marketplaceQuotePreview === "object"
            ? body.marketplaceQuotePreview
            : null;
        const zoneSnapshot = marketplaceQuotePreview
          ? {
              capturedAt: new Date().toISOString(),
              marketplaceQuotePreview,
            }
          : {};
        const quoteSnapshot = {
          bookingId: booking.id,
          bookingReference,
          source: leadSource,
          promoCode: leadPromoCode,
          referralSlug: marketingReferralSlug || null,
          marketplaceShapeId: marketplaceShape.id,
          marketplaceShape: {
            id: marketplaceShape.id,
            shape: marketplaceShape.shape,
            references: marketplaceShape.references,
            customer: marketplaceShape.customer,
            worker: marketplaceShape.worker,
            company: marketplaceShape.company,
          },
          marketplaceSourceFlowId: marketplaceSourceFlow?.id || null,
          marketplaceSourceFlow: marketplaceSourceFlow
            ? {
                id: marketplaceSourceFlow.id,
                source: marketplaceSourceFlow.source,
                category: marketplaceSourceFlow.category,
                borrowedSignal: marketplaceSourceFlow.borrowedSignal,
                customerMove: marketplaceSourceFlow.customerMove,
                workerMove: marketplaceSourceFlow.workerMove,
                companyControl: marketplaceSourceFlow.companyControl,
                automationHook: marketplaceSourceFlow.automationHook,
                rewardTrigger: marketplaceSourceFlow.rewardTrigger,
                surfaces: marketplaceSourceFlow.surfaces,
              }
            : null,
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          finalTotal: quote.finalTotal,
          pricingVersion: activePricing.snapshot.version,
          pricingSource: activePricing.source,
          serviceStops: body.serviceStops || [],
          tokenEstimate: quote.tokenEstimate,
          marketingCampaignId: marketingCampaignId || null,
          marketingTracking,
          attribution: {
            source: leadSource,
            promoCode: leadPromoCode,
            referralSlug: marketingReferralSlug || null,
            marketingCampaignId: marketingCampaignId || null,
            marketingTracking,
          },
          bundleApplied: quote.bundleApplied ?? null,
          pricingAdjustments: quote.pricingAdjustments ?? null,
          travelEligibility: quote.travelEligibility ?? null,
          routeEvidence: quote.routeEvidence ?? null,
          serviceabilityTotal: quote.serviceabilityTotal ?? quote.finalTotal,
          marketplaceQuotePreview,
          items: quote.items,
          requestedItems: persistInputs.map((item) => ({
            serviceCode: item.serviceCode,
            serviceLabel: item.serviceLabel,
            quantity: item.quantity,
            priceMode: item.priceMode,
            unitPrice: item.unitPrice,
            details: item.details || {},
          })),
        };
        const [createdLead] = await db.insert(leads).values({
          firstName: name.firstName,
          lastName: name.lastName,
          email: body.customerEmail || `booking-${booking.id}@jconthemove.local`,
          phone: body.customerPhone,
          serviceType,
          fromAddress: body.serviceAddress || "Address TBD",
          toAddress: dropoffAddress || null,
          moveDate: requestedDate || null,
          details: buildLeadDetails({
            bookingId: booking.id,
            bookingReference,
            marketplaceShape: marketplaceShape.shape,
            inputs: persistInputs,
            quote,
            notes: body.notes || undefined,
            source: leadSource,
            promoCode: leadPromoCode,
            referralSlug: marketingReferralSlug || null,
            marketingCampaignId: marketingCampaignId || null,
            marketingTracking,
          }),
          status: "quote_requested",
          source: leadSource,
          promoCode: leadPromoCode,
          createdByUserId: requestUser?.id || null,
          truckConfig: firstDetailValue(persistInputs, ["truckSituation"]) || null,
          crewSize,
          confirmedHours,
          basePrice: money(quote.subtotal),
          totalPrice: money(quote.finalTotal),
          quoteNotes: body.notes || null,
          lastQuoteUpdatedAt: new Date(),
          bookingId: booking.id,
          quoteSnapshot,
          zoneSnapshot,
        }).returning();
        linkedLead = createdLead;
        await emitJobEvent("quote_requested", createdLead, {
          actorId: requestUser?.id || null,
          source: "booking_bridge",
          extra: { bookingId: booking.id, bookingReference, marketingCampaignId: marketingCampaignId || null, marketingTracking },
        });
      }
      if (linkedLead) {
        await db.update(quoteAttributions)
          .set({ leadId: linkedLead.id })
          .where(eq(quoteAttributions.bookingId, booking.id));
      }
    } catch (leadErr) {
      console.error("[bookings] marketplace lead bridge failed:", leadErr instanceof Error ? leadErr.message : leadErr);
    }

    let quoteRevision: Awaited<ReturnType<typeof saveQuoteDraft>> | null = null;
    if (linkedLead) {
      try {
        quoteRevision = await saveQuoteDraft({
          leadId: linkedLead.id,
          actorUserId: requestUser?.id || null,
          lineItems: quote.items.map((item) => ({
            name: item.label,
            serviceCode: item.serviceCode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.lineSubtotal,
            discountEligible: item.discountEligible !== false,
            metadata: {
              details: item.details || {},
              laborMeta: item.laborMeta || null,
            },
          })),
          discountTotal: quote.discountTotal,
          notes: body.notes || null,
          serviceDate: requestedDateForDiscount,
        });
      } catch (quoteRevisionError) {
        // Preserve legacy booking creation during rollout, while surfacing a
        // loud server-side error instead of fabricating approval state.
        console.error("[bookings] quote revision creation failed:", quoteRevisionError instanceof Error ? quoteRevisionError.message : quoteRevisionError);
      }
    }

    const trashItem = persistInputs.find((p) => p.serviceCode === "trash_valet");
    if (trashItem) {
      await autoProvisionTrashSubscriptionFromBooking({
        bookingId: booking.id,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail || null,
        serviceAddress: body.serviceAddress || null,
        trashItem,
      });
    }

    // Task #175 — Atomic wallet pay + token redemption.
    // Pre-flight already validated auth + tier (server-derived) + balance
    // BEFORE persist, so by the time we get here the only realistic
    // failure modes are concurrent wallet drains. If settle fails AFTER
    // persist we DELETE the just-created booking row so a discounted
    // booking can never linger without the matching deduction.
    let walletPay: {
      ok: boolean;
      walletCharged: number;
      tokensRedeemed: number;
      tokenDiscountUsd: number;
      reason?: string;
    } | null = null;
    if (wantsWallet || wantsTokens) {
      const { settleBookingPayment } = await import("../services/walletPay");
      const r = await settleBookingPayment({
        userId: authedUserId!,
        bookingId: booking.id,
        amountUsd: quote.finalTotal,
        payFromWallet: wantsWallet,
        applyTokens: body.applyTokens,
        customerTier: serverTier,
        preDiscountSubtotal: baseQuote.finalTotal,
      });
      walletPay = {
        ok: r.ok,
        walletCharged: r.walletCharged,
        tokensRedeemed: r.tokensRedeemed,
        tokenDiscountUsd: r.tokenDiscountUsd,
        reason: r.reason,
      };
      if (!r.ok) {
        try {
          await db.delete(leads).where(eq(leads.bookingId, booking.id));
          await db.delete(bookings).where(eq(bookings.id, booking.id));
        } catch (delErr) {
          console.error("[bookings] rollback delete failed for booking", booking.id, delErr);
        }
        return res.status(409).json({
          error: "Payment settlement failed",
          message: r.reason || "Wallet/token settlement failed — booking was rolled back.",
        });
      }
    }

    let confirmationEmailSent = false;
    try {
      const primaryService = persistInputs[0]?.serviceLabel || persistInputs[0]?.serviceCode || "Multi-service booking";
      const serviceSummary = persistInputs
        .map((item) => item.serviceLabel || item.serviceCode)
        .filter(Boolean)
        .join(", ");
      const customerName = body.customerName || "Customer";
      const moveDate = firstDetailValue(persistInputs, ["requestedDate", "moveDate", "date"]);
      const requestedStartTime = firstDetailValue(persistInputs, ["requestedStartTime", "startTime"]);
      const arrivalWindow = requestedStartTime === "flexible"
        ? "Flexible / TBD"
        : requestedStartTime
          ? jobScheduleLabelForStart(requestedStartTime)
          : null;
      const shouldSendCustomerConfirmation = Boolean(body.customerEmail) && (
        !isWorkerCreated || body.sendConfirmationEmail === true
      );
      const bookingReference = `JOB-${booking.id.slice(0, 8).toUpperCase()}`;

      const [, , customerEmailResult] = await Promise.allSettled([
        notifyAdminNewQuote({
          customerName,
          serviceType: serviceSummary || primaryService,
          phone: body.customerPhone,
          email: body.customerEmail || undefined,
          moveDate: moveDate || undefined,
        }),
        smsService.notifyNewQuote({
          customerName,
          serviceType: serviceSummary || primaryService,
          phone: body.customerPhone,
          moveDate: moveDate || undefined,
        }),
        shouldSendCustomerConfirmation
          ? notifyCustomerBookingRequestReceived({
              to: body.customerEmail!,
              customerName,
              bookingReference,
              serviceSummary: serviceSummary || primaryService,
              serviceAddress: body.serviceAddress || null,
              requestedDate: moveDate || null,
              arrivalWindow,
              estimatedTotal: quote.finalTotal,
            })
          : Promise.resolve(false),
      ]);
      confirmationEmailSent = customerEmailResult.status === "fulfilled" && customerEmailResult.value === true;
    } catch (notifyErr) {
      console.error("[bookings] notification setup failed:", notifyErr instanceof Error ? notifyErr.message : notifyErr);
    }

    return res.status(201).json({
      success: true,
      booking,
      quote: {
        ...quote,
        pricingVersion: activePricing.snapshot.version,
        pricingSource: activePricing.source,
      },
      walletPay,
      lead: linkedLead,
      quoteRevision,
      confirmationEmailSent,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    // Task #163 — log enough context to diagnose any future failure in
    // one log line (serviceCodes, error name + message + stack).
    const serviceCodes = (req.body?.items || [])
      .map((it: any) => it?.serviceCode)
      .filter(Boolean)
      .join(",");
    console.error("[bookings] persist error:", {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      serviceCodes,
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Keep the raw error message server-side only — it can contain DB
    // constraint names / column names / row snippets that shouldn't be
    // surfaced to the customer. Validation errors that ARE safe to show
    // are already returned above via HttpError / ZodError branches.
    return res.status(500).json({ error: "Failed to create booking. Please try again or call us." });
  }
});

// ── GET /api/bundles/featured ─────────────────────────────────────────────
router.get("/bundles/featured", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(bundleDefinitions)
      .where(and(eq(bundleDefinitions.isFeatured, true), eq(bundleDefinitions.isActive, true)))
      .orderBy(asc(bundleDefinitions.priority));

    const slots: Record<string, BundleDefinition[]> = {
      most_popular: [],
      best_value: [],
      fast_addon: [],
    };
    const all: BundleDefinition[] = [];
    for (const row of rows) {
      all.push(row);
      const slot = row.merchandisingSlot ?? "";
      if (slot in slots) slots[slot].push(row);
    }
    return res.json({ slots, bundles: all });
  } catch (err) {
    console.error("[bundles/featured] error:", err);
    return res.status(500).json({ error: "Failed to load featured bundles" });
  }
});

// ── GET /api/service-catalog ──────────────────────────────────────────────
router.get("/service-catalog", async (_req: Request, res: Response) => {
  try {
    const activePricing = await getActivePricingSnapshot();
    const rows = await db
      .select()
      .from(serviceCatalog)
      .where(eq(serviceCatalog.isActive, true))
      .orderBy(asc(serviceCatalog.sortOrder));
    const services = rows.map((row) => {
      const summary = catalogPriceSummary(row.code, activePricing.snapshot);
      return summary
        ? {
            ...row,
            defaultPrice: summary.defaultPrice == null ? null : summary.defaultPrice.toFixed(2),
            suggestedMin: summary.suggestedMin.toFixed(2),
            suggestedMax: summary.suggestedMax.toFixed(2),
          }
        : row;
    });
    return res.json({
      services,
      pricingVersion: activePricing.snapshot.version,
      pricingSource: activePricing.source,
    });
  } catch (err) {
    console.error("[service-catalog] error:", err);
    return res.status(500).json({ error: "Failed to load service catalog" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #130 — Parent-child booking views
// ─────────────────────────────────────────────────────────────────────────────

/** Roll up parent booking status from its children. The lifecycle is
 *  `new → in_progress → completed`, so any partial progress (mixed states
 *  with at least one scheduled/in_progress/completed but not all in a
 *  terminal state) means the bundle as a whole is in progress.
 *
 *    - all cancelled                         → cancelled
 *    - all completed (or completed+cancelled
 *      with at least one completed)          → completed
 *    - any in_progress                       → in_progress
 *    - any scheduled                         → in_progress
 *      (parent has progressed past quote/booked even if work hasn't
 *       physically started)
 *    - any completed + any non-terminal      → in_progress
 *      (mixed: some children done, others still pending)
 *    - else                                  → quote / booked (preserve
 *      parent baseline)
 */
function rollupBookingStatus(
  parentStatus: string,
  items: BookingServiceItem[],
): string {
  if (items.length === 0) return parentStatus;
  const statuses = items.map((i) => i.status);
  const non = (s: string) => statuses.filter((x) => x !== s);
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  // All non-cancelled children are completed → bundle is completed
  if (non("cancelled").length > 0 && non("cancelled").every((s) => s === "completed")) {
    return "completed";
  }
  if (statuses.some((s) => s === "in_progress")) return "in_progress";
  if (statuses.some((s) => s === "scheduled")) return "in_progress";
  // Mixed: at least one completed but others still pending → in_progress
  if (statuses.some((s) => s === "completed") && statuses.some((s) => s === "pending")) {
    return "in_progress";
  }
  // Keep parent baseline (quote or booked) when no child has advanced
  return parentStatus;
}

type BookingWithItems = Booking & {
  items: BookingServiceItem[];
  rolledUpStatus: string;
  attributions?: BookingAttribution[];
  attributionSummary?: BookingAttributionSummary;
};

type BookingAttribution = typeof quoteAttributions.$inferSelect;

type BookingAttributionSummary = {
  source: string | null;
  promoCode: string | null;
  referralSlug: string | null;
  attributionTypes: string[];
  hasMarketingRep: boolean;
  hasWorkerCreator: boolean;
};

function getAttributionMetadata(attr: BookingAttribution): Record<string, unknown> {
  if (attr.metadata && typeof attr.metadata === "object" && !Array.isArray(attr.metadata)) {
    return attr.metadata as Record<string, unknown>;
  }
  return {};
}

function firstStringValue(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function summarizeBookingAttribution(attrs: BookingAttribution[]): BookingAttributionSummary {
  const metadata = attrs.map(getAttributionMetadata);
  const attributionTypes = Array.from(new Set(attrs.map((attr) => attr.attributionType)));

  return {
    source: firstStringValue(metadata.map((meta) => meta.source)),
    promoCode: firstStringValue(attrs.map((attr) => attr.promoCode)),
    referralSlug: firstStringValue(metadata.map((meta) => meta.referralSlug)),
    attributionTypes,
    hasMarketingRep: attributionTypes.some((type) => type.includes("marketing_rep")),
    hasWorkerCreator: attributionTypes.some(
      (type) => type.includes("worker") || type.includes("silver_quote_builder"),
    ),
  };
}

async function loadBookingsWithChildren(
  parents: Booking[],
  options: { includeAttribution?: boolean } = {},
): Promise<BookingWithItems[]> {
  if (parents.length === 0) return [];
  const ids = parents.map((p) => p.id);
  const items = await db
    .select()
    .from(bookingServiceItems)
    .where(inArray(bookingServiceItems.bookingId, ids))
    .orderBy(asc(bookingServiceItems.createdAt));
  const byBooking = new Map<string, BookingServiceItem[]>();
  for (const it of items) {
    const arr = byBooking.get(it.bookingId) ?? [];
    arr.push(it);
    byBooking.set(it.bookingId, arr);
  }

  const byBookingAttribution = new Map<string, BookingAttribution[]>();
  if (options.includeAttribution) {
    const attributions = await db
      .select()
      .from(quoteAttributions)
      .where(inArray(quoteAttributions.bookingId, ids))
      .orderBy(asc(quoteAttributions.createdAt));

    for (const attr of attributions) {
      if (!attr.bookingId) continue;
      const arr = byBookingAttribution.get(attr.bookingId) ?? [];
      arr.push(attr);
      byBookingAttribution.set(attr.bookingId, arr);
    }
  }

  return parents.map((p) => {
    const children = byBooking.get(p.id) ?? [];
    const base = { ...p, items: children, rolledUpStatus: rollupBookingStatus(p.status, children) };
    if (!options.includeAttribution) return base;
    const attributions = byBookingAttribution.get(p.id) ?? [];
    return {
      ...base,
      attributions,
      attributionSummary: summarizeBookingAttribution(attributions),
    };
  });
}

async function requireAdmin(req: any, res: Response): Promise<boolean> {
  const userId = req.user?.id || (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  const user = await storage.getUser(userId);
  const ok = user && (user.role === "admin" || user.role === "business_owner");
  if (!ok) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// Admin-only pending hold queue. These holds deliberately stay out of the
// crew workflow until review and payment have confirmed the job.
router.get("/admin/booking-holds", isAuthenticated, async (req: any, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await ensureInstantBookingTables();
    const status = typeof req.query.status === "string" ? req.query.status : "pending_review";
    const { rows } = await pool.query(
      "SELECT h.*, b.customer_name, b.customer_email, b.customer_phone, b.service_address, " +
      "l.first_name, l.last_name, l.service_type, l.total_price, l.square_payment_url " +
      "FROM booking_slot_holds h JOIN bookings b ON b.id = h.booking_id JOIN leads l ON l.id = h.lead_id " +
      "WHERE ($1 = 'all' OR h.status = $1) ORDER BY h.start_at ASC, h.created_at DESC",
      [status],
    );
    return res.json({ holds: rows, timeZone: INSTANT_BOOKING_TIME_ZONE });
  } catch (error) {
    console.error("[admin/booking-holds] error:", error);
    return res.status(500).json({ error: "Failed to load pending holds" });
  }
});

const reviewInstantBookingHoldSchema = z.object({
  decision: z.enum(["approve", "release"]),
  total: z.coerce.number().positive().max(100000).optional(),
  notes: z.string().trim().max(2000).optional().transform((value) => value || ""),
  // Approval alone is silent. The caller must explicitly request the
  // customer-facing deposit invoice/link.
  sendDepositLink: z.boolean().optional().default(false),
});

router.patch("/admin/booking-holds/:id", isAuthenticated, async (req: any, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await ensureInstantBookingTables();
    const input = reviewInstantBookingHoldSchema.parse(req.body);
    const { rows } = await pool.query(
      "SELECT h.*, b.id AS parent_booking_id FROM booking_slot_holds h " +
      "JOIN bookings b ON b.id = h.booking_id WHERE h.id = $1 LIMIT 1",
      [req.params.id],
    );
    const hold = rows[0];
    if (!hold) return res.status(404).json({ error: "Booking hold not found" });
    if (!["pending_review", "awaiting_deposit"].includes(String(hold.status))) {
      return res.status(409).json({ error: "This hold is already " + String(hold.status) + "." });
    }
    const actorId = req.user?.id || req.session?.userId || null;
    if (input.decision === "release") {
      await pool.query(
        "UPDATE booking_slot_holds SET status='released', admin_notes=$2, reviewed_by_user_id=$3, reviewed_at=NOW(), updated_at=NOW() WHERE id=$1",
        [hold.id, input.notes || null, actorId],
      );
      await pool.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [hold.booking_id]);
      return res.json({ success: true, status: "released", message: "The pending hold was released. The lead remains available for a manual follow-up." });
    }

    const [lead] = await db.select().from(leads).where(eq(leads.id, hold.lead_id)).limit(1);
    if (!lead) return res.status(404).json({ error: "Lead for this hold was not found" });

    const actor = actorId ? await storage.getUser(actorId) : null;
    if (!actor) return res.status(403).json({ error: "Approved staff access required" });
    const actorIsOwner = actor.role === "business_owner"
      || actor.email === "upmichiganstatemovers@gmail.com";
    let draft = await getLatestQuoteRevision(lead.id);
    if (!draft || draft.status !== "draft") {
      draft = await saveQuoteDraft({
        leadId: lead.id,
        actorUserId: actor.id,
        notes: input.notes || lead.quoteNotes || null,
        serviceDate: lead.confirmedDate || lead.moveDate || null,
      });
    }
    if (input.total != null && Math.abs(input.total - draft.customerTotal) >= 0.01) {
      const multiplier = Math.max(0.01, Number((draft.pricingAdjustments as any)?.compoundedMultiplier || 1));
      const baseForRequestedTotal = Math.round((input.total / multiplier) * 100) / 100;
      draft = await saveQuoteDraft({
        leadId: lead.id,
        actorUserId: actor.id,
        lineItems: [{
          name: lead.serviceType || "Service",
          quantity: 1,
          unitPrice: baseForRequestedTotal,
          total: baseForRequestedTotal,
          discountEligible: true,
          metadata: { staffAdjustedFromHold: true },
        }],
        discountTotal: 0,
        notes: input.notes || lead.quoteNotes || null,
        serviceDate: lead.confirmedDate || lead.moveDate || null,
      });
    }
    const approvedQuote = await approveQuoteRevision({
      quoteId: draft.id,
      actor: {
        userId: actor.id,
        email: actor.email,
        isOwner: actorIsOwner,
        canApproveStandard: true,
      },
      overrideReason: input.notes || null,
    });
    const total = approvedQuote.customerTotal;
    if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: "Enter an approved total before requesting the deposit." });
    const depositAmount = Math.round(total * 0.3 * 100) / 100;

    await pool.query(
      "UPDATE booking_slot_holds SET status='awaiting_deposit', admin_notes=$2, reviewed_by_user_id=$3, reviewed_at=NOW(), expires_at=NOW()+INTERVAL '24 hours', updated_at=NOW() WHERE id=$1",
      [hold.id, input.notes || null, actorId],
    );
    await pool.query(
      "UPDATE bookings SET subtotal=$2, discount_total=$3, final_total=$4, status='awaiting_deposit' WHERE id=$1",
      [hold.booking_id, approvedQuote.subtotal.toFixed(2), approvedQuote.discountTotal.toFixed(2), total.toFixed(2)],
    );
    await db.update(leads).set({
      basePrice: approvedQuote.subtotal.toFixed(2),
      totalPrice: total.toFixed(2),
      depositRequired: true,
      depositAmount: depositAmount.toFixed(2),
      isQuoteOnly: false,
      financialStatus: "awaiting_deposit",
      quoteNotes: input.notes || lead.quoteNotes,
      lastQuoteUpdatedAt: new Date(),
    }).where(eq(leads.id, lead.id));

    let paymentUrl: string | null = null;
    let depositSquareInvoiceId: string | null = null;
    let invoiceWarning: string | null = null;
    let quoteSent = false;
    if (input.sendDepositLink) {
      try {
        const { squareInvoiceService } = await import("../services/square-invoice");
        if (!squareInvoiceService.isConfigured()) {
          invoiceWarning = "Square is not configured, so the approved hold is awaiting a manual deposit request.";
        } else {
          const hasCustomerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)
            && !/@(?:jconthemove\.local|example\.(?:com|org|net)|test)$/i.test(lead.email);
          const invoice = await squareInvoiceService.createInvoiceForLead(
            lead,
            depositAmount,
            "30% scheduling deposit for approved JC ON THE MOVE " + lead.serviceType + " job",
            undefined,
            hasCustomerEmail ? "email" : "none",
            { purpose: "deposit", quoteRevisionId: approvedQuote.id },
          );
          paymentUrl = invoice.invoiceUrl || null;
          depositSquareInvoiceId = invoice.squareInvoiceId;
          if (paymentUrl) {
            await db.update(leads).set({ squarePaymentUrl: paymentUrl }).where(eq(leads.id, lead.id));
            if (hasCustomerEmail) {
              const sentAt = new Date();
              await markQuoteRevisionSent({ quoteId: approvedQuote.id, actorUserId: actor.id, sentAt });
              await db.update(leads).set({ quoteSentAt: sentAt }).where(eq(leads.id, lead.id));
              quoteSent = true;
            }
          } else {
            invoiceWarning = "Square created the invoice without returning a shareable link.";
          }
        }
      } catch (error) {
        console.error("[admin/booking-holds] deposit invoice error:", error);
        invoiceWarning = "The hold was approved, but the deposit link could not be created. Use the lead payment action to retry.";
      }
    }

    if (paymentUrl) {
      try {
        const { emitCustomerLifecycleEvent } = await import("../services/customerLifecycle");
        await emitCustomerLifecycleEvent({
          leadId: lead.id,
          type: "deposit_invoice_sent",
          eventKey: `${lead.id}:deposit_invoice_sent:${depositSquareInvoiceId || approvedQuote.id}`,
          title: "Your approved deposit link is ready",
          message: `Pay the $${depositAmount.toFixed(2)} scheduling deposit within 24 hours to confirm the requested time and start crew assignment.`,
          payload: { holdId: hold.id, quoteRevisionId: approvedQuote.id, squareInvoiceId: depositSquareInvoiceId, depositAmount },
          actionUrl: paymentUrl,
        });
      } catch (customerEventError) {
        console.error("[admin/booking-holds] deposit customer notification failed:", customerEventError);
      }
    }

    return res.json({
      success: true,
      status: "awaiting_deposit",
      total,
      depositAmount,
      paymentUrl,
      invoiceWarning,
      quoteRevisionId: approvedQuote.id,
      quoteRevision: approvedQuote.revision,
      quoteSent,
      message: paymentUrl
        ? "Hold approved and deposit link created. Once Square confirms payment, the hold becomes confirmed."
        : "Hold approved and awaiting deposit. No crew notification has been sent yet.",
    });
  } catch (error) {
    if (error instanceof ZodError) return res.status(400).json({ error: "Check the review details", details: error.errors });
    console.error("[admin/booking-holds/:id] error:", error);
    return res.status(500).json({ error: "Failed to review the booking hold" });
  }
});

// ── GET /api/admin/bookings ───────────────────────────────────────────────
// List parent bookings with their children for the admin pipeline. Supports
// the same filter shape (search/status/limit/offset) as /api/admin/pipeline.
router.get("/admin/bookings", isAuthenticated, async (req: any, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const { search, status, limit: lim = 100, offset: off = 0 } = req.query;
    const conditions: any[] = [];
    if (status && status !== "all") conditions.push(eq(bookings.status, String(status)));
    if (search) {
      const q = `%${search}%`;
      conditions.push(
        or(
          ilike(bookings.customerName, q),
          ilike(bookings.customerEmail, q),
          ilike(bookings.customerPhone, q),
        ),
      );
    }
    const parents = await db
      .select()
      .from(bookings)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(bookings.createdAt))
      .limit(Number(lim))
      .offset(Number(off));
    const withChildren = await loadBookingsWithChildren(parents, { includeAttribution: true });
    return res.json({ bookings: withChildren, total: withChildren.length });
  } catch (err) {
    console.error("[admin/bookings] error:", err);
    return res.status(500).json({ error: "Failed to load bookings" });
  }
});

// ── GET /api/admin/bookings/:id ───────────────────────────────────────────
router.get("/admin/bookings/:id", isAuthenticated, async (req: any, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const [parent] = await db.select().from(bookings).where(eq(bookings.id, req.params.id)).limit(1);
    if (!parent) return res.status(404).json({ error: "Booking not found" });
    const [withChildren] = await loadBookingsWithChildren([parent], { includeAttribution: true });
    const auditLog = await db
      .select()
      .from(bookingDiscountAuditLog)
      .where(eq(bookingDiscountAuditLog.bookingId, parent.id))
      .orderBy(desc(bookingDiscountAuditLog.createdAt));
    return res.json({ booking: withChildren, discountAuditLog: auditLog });
  } catch (err) {
    console.error("[admin/bookings/:id] error:", err);
    return res.status(500).json({ error: "Failed to load booking" });
  }
});

// ── GET /api/customer/bookings ────────────────────────────────────────────
// Returns parent bookings (with children) for the authenticated customer,
// matched by their email. Used by /my-jobs to render a bundle card per
// booking with one chip per child service.
router.get(
  "/customer/bookings",
  isAuthenticatedAllowPending,
  async (req: any, res: Response) => {
    try {
      const userId = req.user?.id || (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const user = await storage.getUser(userId);
      if (!user || !user.email) return res.json({ bookings: [] });
      const parents = await db
        .select()
        .from(bookings)
        .where(eq(bookings.customerEmail, user.email))
        .orderBy(desc(bookings.createdAt));
      const withChildren = await loadBookingsWithChildren(parents);
      return res.json({ bookings: withChildren });
    } catch (err) {
      console.error("[customer/bookings] error:", err);
      return res.status(500).json({ error: "Failed to load your bookings" });
    }
  },
);

// ── PATCH /api/admin/bookings/items/:itemId ───────────────────────────────
// Update a single child service item: status, crew assignment, notes.
// Re-rolls up the parent booking status after a successful update so the
// admin pipeline sees an accurate aggregate without a second round-trip.
const updateItemSchema = z.object({
  status: z.enum(["pending", "scheduled", "in_progress", "completed", "cancelled"]).optional(),
  assignedToUserId: z.string().nullable().optional(),
  crewMembers: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

router.patch(
  "/admin/bookings/items/:itemId",
  isAuthenticated,
  async (req: any, res: Response) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const body = updateItemSchema.parse(req.body);
      const [existing] = await db
        .select()
        .from(bookingServiceItems)
        .where(eq(bookingServiceItems.id, req.params.itemId))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Item not found" });

      const update: Partial<BookingServiceItem> = {};
      if (body.status !== undefined) {
        update.status = body.status;
        if (body.status === "completed" && !existing.completedAt) {
          update.completedAt = new Date();
        }
      }
      if (body.assignedToUserId !== undefined) update.assignedToUserId = body.assignedToUserId;
      if (body.crewMembers !== undefined) update.crewMembers = body.crewMembers;
      if (body.notes !== undefined) update.notes = body.notes;
      if (body.scheduledAt !== undefined) {
        update.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
      }

      await db
        .update(bookingServiceItems)
        .set(update)
        .where(eq(bookingServiceItems.id, req.params.itemId));

      // Re-roll parent status based on the new child set.
      const siblings = await db
        .select()
        .from(bookingServiceItems)
        .where(eq(bookingServiceItems.bookingId, existing.bookingId));
      const [parent] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, existing.bookingId))
        .limit(1);
      if (parent) {
        const newParentStatus = rollupBookingStatus(parent.status, siblings);
        if (newParentStatus !== parent.status) {
          await db
            .update(bookings)
            .set({ status: newParentStatus })
            .where(eq(bookings.id, parent.id));
        }
      }
      return res.json({ success: true });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Invalid update", details: err.errors });
      }
      console.error("[admin/bookings/items] error:", err);
      return res.status(500).json({ error: "Failed to update item" });
    }
  },
);

// ── POST /api/admin/bookings/:id/confirm ──────────────────────────────────
// Transition a quoted booking into the confirmed/`booked` lifecycle stage
// and trigger reward disbursement. Idempotent: re-confirming a booking is
// safe (the issuer dedupes on referenceId+rewardType per user) and leaves
// the status as `booked` if it already advanced past `quote`.
router.post(
  "/admin/bookings/:id/confirm",
  isAuthenticated,
  async (req: any, res: Response) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const [parent] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, req.params.id))
        .limit(1);
      if (!parent) return res.status(404).json({ error: "Booking not found" });

      const [linkedLead] = await db.select().from(leads).where(eq(leads.bookingId, parent.id)).limit(1);
      if (linkedLead) {
        const revision = await getLatestQuoteRevision(linkedLead.id);
        if (!revision || !["approved", "sent"].includes(revision.status)) {
          return res.status(409).json({ error: "Approve the latest quote revision before confirming this booking." });
        }
        if (linkedLead.depositRequired && !linkedLead.depositPaid) {
          return res.status(409).json({ error: "The required scheduling deposit has not been paid." });
        }
      }

      if (parent.status === "quote") {
        await db
          .update(bookings)
          .set({ status: "booked" })
          .where(eq(bookings.id, parent.id));
      }

      // Issue customer JCMOVES reward (flat bonus + per-dollar earn × bundle
      // bonus multiplier). Idempotent — safe to re-call.
      const summary = await disburseBookingTokens(parent.id);
      return res.json({ success: true, status: "booked", reward: summary });
    } catch (err) {
      console.error("[admin/bookings/confirm] error:", err);
      return res.status(500).json({ error: "Failed to confirm booking" });
    }
  },
);

router.post(
  "/workers/quote-approvals/bookings/:id/approve",
  isAuthenticated,
  async (req: any, res: Response) => {
    try {
      const user = await getRequestUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const authority = await getAuthorityForUser(user);
      const ownerApproval = user.role === "business_owner" || user.email === "upmichiganstatemovers@gmail.com";
      const canApproveStandard = ownerApproval || user.role === "admin" || authority.rank >= tierRank.gold;
      if (!canApproveStandard) {
        return res.status(403).json({ message: "Gold or Platinum authority required" });
      }
      const [parent] = await db.select().from(bookings).where(eq(bookings.id, req.params.id)).limit(1);
      if (!parent) return res.status(404).json({ message: "Booking not found" });
      const [linkedLead] = await db.select().from(leads).where(eq(leads.bookingId, parent.id)).limit(1);
      if (!linkedLead) return res.status(409).json({ message: "This booking has no linked lead for quote revision approval." });
      const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 1000) : null;
      let draft = await getLatestQuoteRevision(linkedLead.id);
      if (!draft || draft.status !== "draft") {
        draft = await saveQuoteDraft({ leadId: linkedLead.id, actorUserId: user.id, notes });
      }
      const revision = await approveQuoteRevision({
        quoteId: draft.id,
        actor: {
          userId: user.id,
          email: user.email,
          isOwner: ownerApproval,
          canApproveStandard,
        },
        overrideReason: notes,
      });
      await db.update(bookings)
        .set({ status: "quote", subtotal: revision.subtotal.toFixed(2), discountTotal: revision.discountTotal.toFixed(2), finalTotal: revision.customerTotal.toFixed(2) })
        .where(eq(bookings.id, parent.id));
      await db.insert(quoteAttributions).values({
        bookingId: parent.id,
        leadId: linkedLead.id,
        userId: user.id,
        attributionType: "quote_approver",
        metadata: { approved: true, quoteRevisionId: revision.id },
      });
      res.json({ success: true, approved: true, quote: revision });
    } catch (err) {
      console.error("[worker booking approval] error:", err);
      const message = err instanceof Error ? err.message : "Failed to approve quote";
      res.status(/owner|required|cannot|exceeds/i.test(message) ? 403 : 400).json({ message });
    }
  },
);

// ── POST /api/admin/bookings/:id/discount-override ────────────────────────
// Admin override of the auto-applied bundle discount. Writes an audit row
// for every change so we can answer "who changed this and why" later.
const overrideSchema = z.object({
  newDiscount: z.number().nonnegative(),
  reason: z.string().max(500).optional(),
});

router.post(
  "/admin/bookings/:id/discount-override",
  isAuthenticated,
  async (req: any, res: Response) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const body = overrideSchema.parse(req.body);
      const adminUserId = req.user?.id || (req.session as any)?.userId;

      const result = await db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, req.params.id))
          .limit(1);
        if (!parent) throw new HttpError("Booking not found", 404);

        const previousDiscount = parseFloat(parent.discountTotal);
        const newDiscount = body.newDiscount;
        const subtotal = parseFloat(parent.subtotal);
        const newFinal = Math.max(0, subtotal - newDiscount);

        // Recompute the customer's tokenEstimate using the override flag so
        // the stored estimate stays in sync with what disburseBookingTokens
        // will actually issue at confirmation. Use the SAME precedence as
        // the issuer: prefer the booking's snapshotted reward inputs, fall
        // back to live rewardSettings only for legacy rows that predate the
        // snapshot columns. This guarantees parity even if defaults drift
        // between booking creation and the override.
        let flatBonus: number;
        let earnRate: number;
        if (parent.rewardFlatBonusSnapshot != null && parent.rewardEarnRateSnapshot != null) {
          flatBonus = parent.rewardFlatBonusSnapshot;
          earnRate  = parseFloat(parent.rewardEarnRateSnapshot);
        } else {
          const live = await loadBookingRewardSettings();
          flatBonus = live.flatBonus;
          earnRate  = live.earnRate;
        }
        const reward = computeBookingReward({
          finalTotal: newFinal,
          flatBonus,
          earnRate,
          bonusMultiplier: 1, // override drops the bundle multiplier
          hasOverride: true,
        });

        await tx
          .update(bookings)
          .set({
            discountTotal: newDiscount.toFixed(2),
            finalTotal: newFinal.toFixed(2),
            tokenEstimate: reward.totalAward,
          })
          .where(eq(bookings.id, parent.id));

        const [audit] = await tx
          .insert(bookingDiscountAuditLog)
          .values({
            bookingId: parent.id,
            adminUserId,
            previousDiscount: previousDiscount.toFixed(2),
            newDiscount: newDiscount.toFixed(2),
            reason: body.reason ?? null,
          })
          .returning();
        return { previousDiscount, newDiscount, newFinal, audit, tokenEstimate: reward.totalAward };
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Invalid override", details: err.errors });
      }
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("[admin/bookings/discount-override] error:", err);
      return res.status(500).json({ error: "Failed to override discount" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task #131 — Admin: Featured Bundle settings (inline edit) + audit log
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/admin/bundle-definitions ─────────────────────────────────────
// Returns every bundle (active + inactive) for the admin "Featured Bundles"
// settings card. Active-only is exposed via /api/bundles/featured already.
router.get("/admin/bundle-definitions", isAuthenticated, async (req: any, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const rows = await db
      .select()
      .from(bundleDefinitions)
      .orderBy(asc(bundleDefinitions.priority), asc(bundleDefinitions.code));
    return res.json({ bundles: rows });
  } catch (err) {
    console.error("[admin/bundle-definitions] error:", err);
    return res.status(500).json({ error: "Failed to load bundle definitions" });
  }
});

// ── PATCH /api/admin/bundle-definitions/:code ─────────────────────────────
// Inline-edit endpoint for the settings card. Only the fields admins can
// reasonably change at runtime are exposed; combo/discountType edits stay
// in the seed file to keep accounting predictable.
const bundleSettingsPatchSchema = z.object({
  discountValue: z.number().nonnegative().optional(),
  maxDiscount:   z.number().nonnegative().nullable().optional(),
  bonusMultiplier: z.number().min(1).max(5).optional(),
  isFeatured:    z.boolean().optional(),
  isActive:      z.boolean().optional(),
  merchandisingSlot: z.string().nullable().optional(),
});

router.patch(
  "/admin/bundle-definitions/:code",
  isAuthenticated,
  async (req: any, res: Response) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const body = bundleSettingsPatchSchema.parse(req.body);
      const adminUserId = req.user?.id || (req.session as any)?.userId;

      const [existing] = await db
        .select()
        .from(bundleDefinitions)
        .where(eq(bundleDefinitions.code, req.params.code))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Bundle not found" });

      const update: Partial<typeof bundleDefinitions.$inferInsert> = {};
      if (body.discountValue !== undefined) update.discountValue = body.discountValue.toFixed(2);
      if (body.maxDiscount !== undefined) {
        update.maxDiscount = body.maxDiscount === null ? null : body.maxDiscount.toFixed(2);
      }
      if (body.bonusMultiplier !== undefined) update.bonusMultiplier = body.bonusMultiplier.toFixed(2);
      if (body.isFeatured !== undefined) update.isFeatured = body.isFeatured;
      if (body.isActive !== undefined)   update.isActive = body.isActive;
      if (body.merchandisingSlot !== undefined) update.merchandisingSlot = body.merchandisingSlot;

      const [updated] = await db
        .update(bundleDefinitions)
        .set(update)
        .where(eq(bundleDefinitions.code, req.params.code))
        .returning();

      // Durable audit row — mirrors booking_discount_audit_log so admins can
      // query bundle history (who changed what, when) instead of grepping
      // ephemeral process logs.
      const beforeSnapshot = {
        discountValue: existing.discountValue,
        maxDiscount: existing.maxDiscount,
        bonusMultiplier: existing.bonusMultiplier,
        isFeatured: existing.isFeatured,
        isActive: existing.isActive,
        merchandisingSlot: existing.merchandisingSlot,
      };
      try {
        await db.insert(bundleSettingsAuditLog).values({
          bundleCode: existing.code,
          adminUserId: adminUserId ?? null,
          adminEmail: req.user?.email ?? null,
          before: beforeSnapshot,
          after: update,
        });
      } catch (auditErr) {
        console.error("[admin/bundle-definitions] audit insert failed:", auditErr);
      }

      return res.json({ success: true, bundle: updated });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Invalid bundle update", details: err.errors });
      }
      console.error("[admin/bundle-definitions] patch error:", err);
      return res.status(500).json({ error: "Failed to update bundle" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Task #131 — Admin: Booking analytics
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/booking-analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
//   - single  = bookings with exactly 1 child item
//   - bundle  = bookings with 2+ children OR bundleAppliedCode set
//   - aov     = average finalTotal per group
//   - attachRatePerPrimary = primary serviceCode → bundle_count / total_count
//   - topCombinations = top-5 combos (sorted child serviceCode tuples)
//
// All aggregation is done in-memory: booking volume is small enough that
// this is significantly simpler than five overlapping SQL queries.
router.get("/admin/booking-analytics", isAuthenticated, async (req: any, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const conditions: any[] = [];
    if (req.query.from) {
      const from = new Date(String(req.query.from));
      if (!isNaN(from.getTime())) conditions.push(gte(bookings.createdAt, from));
    }
    if (req.query.to) {
      // Inclusive end date: bump a date-only `to` (e.g. "2026-04-19") to
      // start-of-next-day so the whole day is included; then use `<`
      // (strict less-than) to avoid double-counting any record that
      // happens to land exactly on midnight of the next day.
      const raw = String(req.query.to);
      const to = new Date(raw);
      if (!isNaN(to.getTime())) {
        const endExclusive = new Date(to.getTime());
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
        if (dateOnly) endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
        conditions.push(sql`${bookings.createdAt} < ${endExclusive}`);
      }
    }

    const parents = await db
      .select()
      .from(bookings)
      .where(conditions.length ? and(...conditions) : undefined);
    const ids = parents.map((p) => p.id);

    const items = ids.length
      ? await db
          .select()
          .from(bookingServiceItems)
          .where(inArray(bookingServiceItems.bookingId, ids))
      : [];
    const attributions = ids.length
      ? await db
          .select()
          .from(quoteAttributions)
          .where(inArray(quoteAttributions.bookingId, ids))
      : [];
    const itemsByBooking = new Map<string, BookingServiceItem[]>();
    for (const it of items) {
      const arr = itemsByBooking.get(it.bookingId) ?? [];
      arr.push(it);
      itemsByBooking.set(it.bookingId, arr);
    }
    const attributionsByBooking = new Map<string, typeof quoteAttributions.$inferSelect[]>();
    for (const attr of attributions) {
      if (!attr.bookingId) continue;
      const arr = attributionsByBooking.get(attr.bookingId) ?? [];
      arr.push(attr);
      attributionsByBooking.set(attr.bookingId, arr);
    }

    let singleCount = 0;
    let bundleCount = 0;
    let singleTotal = 0;
    let bundleTotal = 0;

    // attach rate per primary service: keyed by the *first* child serviceCode
    // (the customer's anchor service). primary → { total, withBundle }.
    const attach = new Map<string, { total: number; withBundle: number }>();

    // top combinations: keyed by sorted-tuple of child serviceCodes.
    const combos = new Map<string, { combo: string[]; count: number; revenue: number }>();
    const sourceStats = new Map<string, {
      source: string;
      count: number;
      revenue: number;
      bundleCount: number;
      promoCodes: Set<string>;
      campaigns: Set<string>;
      areas: Set<string>;
      focuses: Set<string>;
      routeDays: Set<string>;
      packages: Set<string>;
      priceBands: Set<string>;
      crewTargets: Set<string>;
      hoursTargets: Set<string>;
    }>();
    const campaignStats = new Map<string, {
      campaign: string;
      source: string;
      count: number;
      revenue: number;
      promoCodes: Set<string>;
      areas: Set<string>;
      focuses: Set<string>;
      routeDays: Set<string>;
      packages: Set<string>;
      priceBands: Set<string>;
      crewTargets: Set<string>;
      hoursTargets: Set<string>;
    }>();
    const routeDayStats = new Map<string, {
      routeKey: string;
      routeDay: string;
      area: string;
      count: number;
      revenue: number;
      promoCodes: Set<string>;
      campaigns: Set<string>;
      sources: Set<string>;
      packages: Set<string>;
      priceBands: Set<string>;
    }>();

    const getAttrMeta = (attr: typeof quoteAttributions.$inferSelect): Record<string, unknown> => (
      attr.metadata && typeof attr.metadata === "object" && !Array.isArray(attr.metadata)
        ? attr.metadata as Record<string, unknown>
        : {}
    );
    const firstAttrValue = (
      attrs: typeof quoteAttributions.$inferSelect[],
      picker: (attr: typeof quoteAttributions.$inferSelect, meta: Record<string, unknown>) => unknown,
    ): string | null => {
      const marketingFirst = [...attrs].sort((a, b) => {
        const aMarketing = a.attributionType.includes("marketing") ? 0 : 1;
        const bMarketing = b.attributionType.includes("marketing") ? 0 : 1;
        return aMarketing - bMarketing;
      });
      for (const attr of marketingFirst) {
        const value = picker(attr, getAttrMeta(attr));
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return null;
    };

    for (const p of parents) {
      const children = itemsByBooking.get(p.id) ?? [];
      if (children.length === 0) continue;
      const final = parseFloat(p.finalTotal);
      const isBundle = children.length > 1 || !!p.bundleAppliedCode;
      const attrs = attributionsByBooking.get(p.id) ?? [];
      const source = firstAttrValue(attrs, (_attr, meta) => meta.source) || p.source || "direct";
      const promoCode = firstAttrValue(attrs, (attr) => attr.promoCode);
      const campaign = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return meta.marketingCampaignId || tracking.jcCampaign || tracking.utmContent || tracking.utmCampaign;
      });
      const area = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcArea;
      });
      const focus = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcFocus;
      });
      const routeDay = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcRouteDay;
      });
      const routeKey = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcRouteKey;
      });
      const packageType = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcPackage;
      });
      const crewTarget = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcCrewTarget;
      });
      const hoursTarget = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcHoursTarget;
      });
      const priceBand = firstAttrValue(attrs, (_attr, meta) => {
        const tracking = meta.marketingTracking && typeof meta.marketingTracking === "object" && !Array.isArray(meta.marketingTracking)
          ? meta.marketingTracking as Record<string, unknown>
          : {};
        return tracking.jcPriceBand;
      });

      if (isBundle) {
        bundleCount += 1;
        bundleTotal += final;
      } else {
        singleCount += 1;
        singleTotal += final;
      }

      const primary = children[0].serviceCode;
      const slot = attach.get(primary) ?? { total: 0, withBundle: 0 };
      slot.total += 1;
      if (isBundle) slot.withBundle += 1;
      attach.set(primary, slot);

      if (isBundle) {
        const combo = Array.from(new Set(children.map((c) => c.serviceCode))).sort();
        const key = combo.join("|");
        const slot2 = combos.get(key) ?? { combo, count: 0, revenue: 0 };
        slot2.count += 1;
        slot2.revenue += final;
        combos.set(key, slot2);
      }

      const sourceSlot = sourceStats.get(source) ?? {
        source,
        count: 0,
        revenue: 0,
        bundleCount: 0,
        promoCodes: new Set<string>(),
        campaigns: new Set<string>(),
        areas: new Set<string>(),
        focuses: new Set<string>(),
        routeDays: new Set<string>(),
        packages: new Set<string>(),
        priceBands: new Set<string>(),
        crewTargets: new Set<string>(),
        hoursTargets: new Set<string>(),
      };
      sourceSlot.count += 1;
      sourceSlot.revenue += final;
      if (isBundle) sourceSlot.bundleCount += 1;
      if (promoCode) sourceSlot.promoCodes.add(promoCode);
      if (campaign) sourceSlot.campaigns.add(campaign);
      if (area) sourceSlot.areas.add(area);
      if (focus) sourceSlot.focuses.add(focus);
      if (routeDay) sourceSlot.routeDays.add(routeDay);
      if (packageType) sourceSlot.packages.add(packageType);
      if (priceBand) sourceSlot.priceBands.add(priceBand);
      if (crewTarget) sourceSlot.crewTargets.add(crewTarget);
      if (hoursTarget) sourceSlot.hoursTargets.add(hoursTarget);
      sourceStats.set(source, sourceSlot);

      if (campaign) {
        const campaignSlot = campaignStats.get(campaign) ?? {
          campaign,
          source,
          count: 0,
          revenue: 0,
          promoCodes: new Set<string>(),
          areas: new Set<string>(),
          focuses: new Set<string>(),
          routeDays: new Set<string>(),
          packages: new Set<string>(),
          priceBands: new Set<string>(),
          crewTargets: new Set<string>(),
          hoursTargets: new Set<string>(),
        };
        campaignSlot.count += 1;
        campaignSlot.revenue += final;
        if (promoCode) campaignSlot.promoCodes.add(promoCode);
        if (area) campaignSlot.areas.add(area);
        if (focus) campaignSlot.focuses.add(focus);
        if (routeDay) campaignSlot.routeDays.add(routeDay);
        if (packageType) campaignSlot.packages.add(packageType);
        if (priceBand) campaignSlot.priceBands.add(priceBand);
        if (crewTarget) campaignSlot.crewTargets.add(crewTarget);
        if (hoursTarget) campaignSlot.hoursTargets.add(hoursTarget);
        campaignStats.set(campaign, campaignSlot);
      }

      if (routeDay || routeKey || packageType) {
        const key = routeKey || `${area || "unknown-area"}-${routeDay || "unknown-day"}`;
        const routeSlot = routeDayStats.get(key) ?? {
          routeKey: key,
          routeDay: routeDay || "",
          area: area || "",
          count: 0,
          revenue: 0,
          promoCodes: new Set<string>(),
          campaigns: new Set<string>(),
          sources: new Set<string>(),
          packages: new Set<string>(),
          priceBands: new Set<string>(),
        };
        routeSlot.count += 1;
        routeSlot.revenue += final;
        if (promoCode) routeSlot.promoCodes.add(promoCode);
        if (campaign) routeSlot.campaigns.add(campaign);
        if (source) routeSlot.sources.add(source);
        if (packageType) routeSlot.packages.add(packageType);
        if (priceBand) routeSlot.priceBands.add(priceBand);
        routeDayStats.set(key, routeSlot);
      }
    }

    const attachRatePerPrimary = Array.from(attach.entries())
      .map(([serviceCode, v]) => ({
        serviceCode,
        totalBookings: v.total,
        bundleBookings: v.withBundle,
        attachRate: v.total > 0 ? +(v.withBundle / v.total).toFixed(4) : 0,
      }))
      .sort((a, b) => b.totalBookings - a.totalBookings);

    const topCombinations = Array.from(combos.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((c) => ({ ...c, revenue: +c.revenue.toFixed(2) }));
    const sourceBreakdown = Array.from(sourceStats.values())
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .map((row) => ({
        source: row.source,
        count: row.count,
        revenue: +row.revenue.toFixed(2),
        aov: row.count > 0 ? +(row.revenue / row.count).toFixed(2) : 0,
        bundleCount: row.bundleCount,
        bundleRate: row.count > 0 ? +(row.bundleCount / row.count).toFixed(4) : 0,
        promoCodes: Array.from(row.promoCodes).sort(),
        campaigns: Array.from(row.campaigns).sort(),
        areas: Array.from(row.areas).sort(),
        focuses: Array.from(row.focuses).sort(),
        routeDays: Array.from(row.routeDays).sort(),
        packages: Array.from(row.packages).sort(),
        priceBands: Array.from(row.priceBands).sort(),
        crewTargets: Array.from(row.crewTargets).sort(),
        hoursTargets: Array.from(row.hoursTargets).sort(),
      }));
    const campaignBreakdown = Array.from(campaignStats.values())
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .slice(0, 10)
      .map((row) => ({
        campaign: row.campaign,
        source: row.source,
        count: row.count,
        revenue: +row.revenue.toFixed(2),
        aov: row.count > 0 ? +(row.revenue / row.count).toFixed(2) : 0,
        promoCodes: Array.from(row.promoCodes).sort(),
        areas: Array.from(row.areas).sort(),
        focuses: Array.from(row.focuses).sort(),
        routeDays: Array.from(row.routeDays).sort(),
        packages: Array.from(row.packages).sort(),
        priceBands: Array.from(row.priceBands).sort(),
        crewTargets: Array.from(row.crewTargets).sort(),
        hoursTargets: Array.from(row.hoursTargets).sort(),
      }));
    const routeDayBreakdown = Array.from(routeDayStats.values())
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .map((row) => ({
        routeKey: row.routeKey,
        routeDay: row.routeDay,
        area: row.area,
        count: row.count,
        revenue: +row.revenue.toFixed(2),
        aov: row.count > 0 ? +(row.revenue / row.count).toFixed(2) : 0,
        promoCodes: Array.from(row.promoCodes).sort(),
        campaigns: Array.from(row.campaigns).sort(),
        sources: Array.from(row.sources).sort(),
        packages: Array.from(row.packages).sort(),
        priceBands: Array.from(row.priceBands).sort(),
      }));

    return res.json({
      range: {
        from: req.query.from || null,
        to: req.query.to || null,
      },
      single: {
        count: singleCount,
        revenue: +singleTotal.toFixed(2),
        aov: singleCount > 0 ? +(singleTotal / singleCount).toFixed(2) : 0,
      },
      bundle: {
        count: bundleCount,
        revenue: +bundleTotal.toFixed(2),
        aov: bundleCount > 0 ? +(bundleTotal / bundleCount).toFixed(2) : 0,
      },
      attachRatePerPrimary,
      topCombinations,
      sourceBreakdown,
      campaignBreakdown,
      routeDayBreakdown,
    });
  } catch (err) {
    console.error("[admin/booking-analytics] error:", err);
    return res.status(500).json({ error: "Failed to load booking analytics" });
  }
});

export default router;
