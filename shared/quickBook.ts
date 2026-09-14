import { normalizeCustomerPhone } from "./phone";
import { z } from "zod";
import { isHourlyJobArrivalWindow } from "./jcOperations";

export const quickBookWorkScopeSchema = z.enum(["load_only", "unload_only", "load_unload"]);
export const quickBookTruckConfigSchema = z.enum(["customer_truck", "company_truck", "rental_truck", "no_truck"]);
export const quickBookTruckSizeSchema = z.enum(["none", "cargo_van", "15_ft", "20_ft", "26_ft", "custom"]);
export const quickBookConfidenceSchema = z.enum(["high", "medium", "low"]);
export const quickBookFieldSourceSchema = z.enum(["voice", "typed", "tap", "server"]);

export const quickBookSpecialItemsSchema = z.object({
  piano: z.boolean().nullable().default(null),
  safe: z.boolean().nullable().default(null),
  hotTub: z.boolean().nullable().default(null),
  poolTable: z.boolean().nullable().default(null),
  otherLargeItem: z.boolean().nullable().default(null),
  notes: z.string().trim().max(2000).default(""),
});

export const quickBookInventorySchema = z.object({
  boxes: z.number().int().min(0).max(10000).nullable().default(null),
  washerDryer: z.boolean().nullable().default(null),
  refrigerator: z.boolean().nullable().default(null),
  patioFurniture: z.boolean().nullable().default(null),
  notes: z.string().trim().max(2000).default(""),
});

export const quickBookStopSchema = z.object({
  address: z.string().trim().min(1).max(500),
  note: z.string().trim().max(1000).default(""),
});

export const quickBookDraftSchema = z.object({
  serviceType: z.enum(["moving", "labor"]).default("moving"),
  customerName: z.string().trim().max(160).default(""),
  customerPhone: z.string().trim().max(60).default(""),
  customerEmail: z.string().trim().max(254).default(""),
  smsConsent: z.boolean().nullable().default(null),
  confirmedDate: z.string().trim().max(10).default(""),
  arrivalWindow: z.string().trim().max(100).default(""),
  pickupAddress: z.string().trim().max(500).default(""),
  destinationAddress: z.string().trim().max(500).default(""),
  pickupAccessCode: z.string().trim().max(1000).default(""),
  pickupInstructions: z.string().trim().max(4000).default(""),
  destinationAccessCode: z.string().trim().max(1000).default(""),
  destinationInstructions: z.string().trim().max(4000).default(""),
  additionalStops: z.array(quickBookStopSchema).max(8).default([]),
  propertySize: z.string().trim().max(120).default(""),
  bedrooms: z.number().int().min(0).max(20).nullable().default(null),
  stairsFlights: z.number().int().min(0).max(50).nullable().default(null),
  hasElevator: z.boolean().nullable().default(null),
  workScope: quickBookWorkScopeSchema.nullable().default(null),
  truckConfig: quickBookTruckConfigSchema.nullable().default(null),
  truckSize: quickBookTruckSizeSchema.default("none"),
  estimatedHours: z.number().int().min(1).max(24).nullable().default(null),
  crewSize: z.number().int().min(1).max(12).nullable().default(null),
  crewMemberIds: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  crewLeadUserId: z.string().trim().max(120).nullable().default(null),
  crewConfirmed: z.boolean().default(false),
  specialItemsConfirmed: z.boolean().default(false),
  specialItems: quickBookSpecialItemsSchema.default({
    piano: null,
    safe: null,
    hotTub: null,
    poolTable: null,
    otherLargeItem: null,
    notes: "",
  }),
  inventory: quickBookInventorySchema.default({
    boxes: null,
    washerDryer: null,
    refrigerator: null,
    patioFurniture: null,
    notes: "",
  }),
  promoCode: z.string().trim().max(50).default(""),
  notes: z.string().trim().max(6000).default(""),
});

export type QuickBookDraft = z.infer<typeof quickBookDraftSchema>;

export const EMPTY_QUICK_BOOK_DRAFT: QuickBookDraft = quickBookDraftSchema.parse({});

const aiNullableString = z.string().trim().max(6000).nullable();
const aiNullableBoolean = z.boolean().nullable();
const aiNullableNumber = z.number().nullable();

/**
 * AI extraction is deliberately a patch. Every property is required by the
 * generated JSON schema and uses null for "not stated" so an LLM can never
 * erase previously confirmed staff input by omission.
 */
export const quickBookAiPatchSchema = z.object({
  serviceType: z.enum(["moving", "labor"]).nullable(),
  customerName: aiNullableString,
  customerPhone: aiNullableString,
  customerEmail: aiNullableString,
  smsConsent: aiNullableBoolean,
  confirmedDate: aiNullableString,
  arrivalWindow: aiNullableString,
  pickupAddress: aiNullableString,
  destinationAddress: aiNullableString,
  pickupAccessCode: aiNullableString,
  pickupInstructions: aiNullableString,
  destinationAccessCode: aiNullableString,
  destinationInstructions: aiNullableString,
  additionalStops: z.array(quickBookStopSchema).nullable(),
  propertySize: aiNullableString,
  bedrooms: aiNullableNumber,
  stairsFlights: aiNullableNumber,
  hasElevator: aiNullableBoolean,
  workScope: quickBookWorkScopeSchema.nullable(),
  truckConfig: quickBookTruckConfigSchema.nullable(),
  truckSize: quickBookTruckSizeSchema.nullable(),
  estimatedHours: aiNullableNumber,
  crewSize: aiNullableNumber,
  specialItemsConfirmed: aiNullableBoolean,
  specialItems: z.object({
    piano: aiNullableBoolean,
    safe: aiNullableBoolean,
    hotTub: aiNullableBoolean,
    poolTable: aiNullableBoolean,
    otherLargeItem: aiNullableBoolean,
    notes: aiNullableString,
  }).nullable(),
  inventory: z.object({
    boxes: aiNullableNumber,
    washerDryer: aiNullableBoolean,
    refrigerator: aiNullableBoolean,
    patioFurniture: aiNullableBoolean,
    notes: aiNullableString,
  }).nullable(),
  promoCode: aiNullableString,
  notes: aiNullableString,
});

export const quickBookExtractionSchema = z.object({
  patch: quickBookAiPatchSchema,
  fieldConfidence: z.record(quickBookConfidenceSchema),
  ambiguities: z.array(z.string().trim().min(1).max(300)).max(20),
  assistantMessage: z.string().trim().min(1).max(1200),
  nextQuestion: z.string().trim().max(500),
  suggestions: z.array(z.string().trim().min(1).max(160)).max(8),
});

export type QuickBookExtraction = z.infer<typeof quickBookExtractionSchema>;

export type QuickBookFieldMeta = Record<string, {
  confidence: z.infer<typeof quickBookConfidenceSchema>;
  source: z.infer<typeof quickBookFieldSourceSchema>;
  updatedAt: string;
}>;

export type QuickBookReadiness = {
  ready: boolean;
  missingFields: string[];
  reviewReasons: string[];
};

export type QuickBookCrewSuggestion = {
  id: string;
  name: string;
  score: number;
  available: boolean;
  reason: string;
  recommended: boolean;
};

export type QuickBookSessionResponse = {
  id: string;
  status: "draft" | "ready" | "booked" | "abandoned";
  revision: number;
  draft: QuickBookDraft;
  fieldMeta: QuickBookFieldMeta;
  missingFields: string[];
  reviewReasons: string[];
  readiness: QuickBookReadiness;
  quote: Record<string, unknown> | null;
  crewSuggestions: QuickBookCrewSuggestion[];
  assistantMessage: string;
  nextQuestion: string;
  suggestions: string[];
  agent: {
    provider: "gateway" | "deterministic";
    model: string;
    fallbackUsed: boolean;
    reason?: string;
  };
  bookingId?: string | null;
  leadId?: string | null;
  startedAt: string;
  updatedAt: string;
};

export function quickBookPhoneIsComplete(value: string) {
  return normalizeCustomerPhone(value) !== null;
}

export function quickBookAddressLooksComplete(value: string) {
  const text = value.trim();
  const hasStreetOrBoxNumber = /\b\d{1,6}[A-Z]?\b/i.test(text);
  const hasLocality = /\b\d{5}(?:-\d{4})?\b/.test(text) || /,\s*[A-Z]{2}\b/i.test(text);
  return text.length >= 12 && hasStreetOrBoxNumber && hasLocality;
}

export function quickBookHasSpecialtyReview(draft: QuickBookDraft) {
  return Object.entries(draft.specialItems)
    .some(([key, value]) => key !== "notes" && value === true);
}

export function evaluateQuickBookReadiness(
  draft: QuickBookDraft,
  options: { quoteReady?: boolean; quoteReviewReasons?: string[] } = {},
): QuickBookReadiness {
  const missingFields: string[] = [];
  const reviewReasons = [...(options.quoteReviewReasons || [])];

  if (draft.customerName.trim().length < 2) missingFields.push("customer name");
  if (!quickBookPhoneIsComplete(draft.customerPhone)) missingFields.push("10-digit phone");
  if (draft.smsConsent === null) missingFields.push("text-message consent");
  if (!quickBookAddressLooksComplete(draft.pickupAddress)) missingFields.push("complete pickup address");
  if (draft.workScope === "load_unload" && !quickBookAddressLooksComplete(draft.destinationAddress)) {
    missingFields.push("complete destination address");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.confirmedDate)) missingFields.push("confirmed date");
  if (!isHourlyJobArrivalWindow(draft.arrivalWindow)) missingFields.push("one-hour arrival window");
  if (!draft.workScope) missingFields.push("work scope");
  if (!draft.truckConfig) missingFields.push("truck or equipment choice");
  if (draft.stairsFlights === null) missingFields.push("stairs");
  if (draft.hasElevator === null) missingFields.push("elevator");
  if (!draft.specialItemsConfirmed) missingFields.push("special-item check");
  if (!draft.crewSize) missingFields.push("crew size");
  if (!draft.estimatedHours) missingFields.push("estimated hours");
  if (!draft.crewConfirmed || draft.crewMemberIds.length !== draft.crewSize) missingFields.push("confirmed named crew");
  if (!draft.crewLeadUserId || !draft.crewMemberIds.includes(draft.crewLeadUserId)) missingFields.push("confirmed crew lead");
  if (quickBookHasSpecialtyReview(draft)) reviewReasons.push("Specialty items require an owner-reviewed handling fee.");
  if (options.quoteReady === false) reviewReasons.push("An exact server quote is not ready.");

  return {
    ready: missingFields.length === 0 && reviewReasons.length === 0,
    missingFields: Array.from(new Set(missingFields)),
    reviewReasons: Array.from(new Set(reviewReasons)),
  };
}
