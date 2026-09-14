// /book — chunked multi-service booking wizard (Task #138).
// One step visible at a time, sticky live summary across all steps, smart
// bundle popup that fires once per cart shape (auto-applied or one-away).

import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneRewardsEnrollment } from "@/components/phone-rewards-enrollment";
import { phoneError } from "@shared/phone";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Phone, Coins, Users, Tag, Loader2, AlertCircle,
  Shield, Star, MapPin, PhoneCall, ClipboardList, Upload, Camera, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/hooks/useAuth";
import { getVisitorId } from "@/hooks/usePageView";
import {
  MIN_REDEMPTION_TOKENS,
  REDEMPTION_INCREMENT,
  maxTokensForSubtotal,
  tokensToDollars,
} from "@shared/tokenRedemptionRules";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import AddressField from "@/components/AddressField";
import MarketplaceShapeContext from "@/components/MarketplaceShapeContext";
import MarketplaceProcessGuide from "@/components/MarketplaceProcessGuide";
import MarketplaceSourceFlowStrip from "@/components/MarketplaceSourceFlowStrip";
import MarketplaceNextStepFlow from "@/components/MarketplaceNextStepFlow";
import SmartRequestShapePicker from "@/components/SmartRequestShapePicker";
import SmartBookingGuidanceCard from "@/components/SmartBookingGuidanceCard";
import ServicePriceMenu from "@/components/ServicePriceMenu";
import type { User } from "@shared/schema";
import {
  CANONICAL_PRICING_2026_08,
  type CanonicalPricingSnapshot,
} from "@shared/canonicalPricing";
import { calculateLaborBooking } from "@shared/laborBooking";
import {
  getMarketplaceRequestShape,
  getMarketplaceShapeForServiceCode,
  type MarketplaceActionPhase,
  type MarketplaceRequestShapeId,
} from "@shared/marketplaceShapes";
import {
  formatServicePriceRange,
  sourceSignalForServicePriceMenuTask,
  type ServicePriceMenuTask,
} from "@shared/servicePriceMenu";
import {
  estimateMovingCrewHours,
  inferSmartBookingText,
  type SmartBookingAnswers,
  type SmartBookingTextInference,
} from "@shared/smartBookingEngine";
import {
  ServiceSelector, InlineItemConfigure, BookingSummarySticky,
  BundleSuggestionDialog, type BundleSuggestion,
  type CatalogService, type FeaturedBundle, type SelectedItem, type QuoteResult,
  emojiFor, schedulingModeFor,
  formatMovingFlowSummary, formatQuoteLinePrice, quoteLineForItem, quoteCrewSize,
  formatRequestedSchedule, PICKER_SPECIAL_ITEMS,
} from "@/components/MultiBookingFlow";

interface BundleSlots {
  most_popular: FeaturedBundle[];
  best_value: FeaturedBundle[];
  fast_addon: FeaturedBundle[];
}

const FALLBACK_SERVICE_CATALOG: CatalogService[] = [
  {
    id: "fallback-moving",
    code: "moving",
    name: "Moving",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "300",
    suggestedMax: "2500",
    discountEligible: true,
    isAddon: false,
    description: "Local and route-day moving help.",
  },
  {
    id: "fallback-junk-removal",
    code: "junk_removal",
    name: "Junk Removal",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "170",
    suggestedMax: "600",
    discountEligible: true,
    isAddon: false,
    description: "Single-item pickups through cleanouts and dump runs.",
  },
  {
    id: "fallback-delivery",
    code: "delivery",
    name: "Delivery",
    category: "core",
    defaultPriceMode: "fixed",
    defaultPrice: "150",
    suggestedMin: "125",
    suggestedMax: "450",
    discountEligible: true,
    isAddon: false,
    description: "Single item, store pickup, appliance, and small delivery work.",
  },
  {
    id: "fallback-labor",
    code: "labor",
    name: "Labor",
    category: "core",
    defaultPriceMode: "hourly",
    defaultPrice: String(CANONICAL_PRICING_2026_08.labor.workerHourlyRate),
    suggestedMin: "170",
    suggestedMax: "1000",
    discountEligible: true,
    isAddon: false,
    description: "General labor, lifting, carrying, staging, and setup.",
  },
  {
    id: "fallback-lawn-care",
    code: "lawn_care",
    name: "Lawn Care",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "45",
    suggestedMax: "250",
    discountEligible: true,
    isAddon: false,
    description: "Mowing, trimming, cleanup, and repeat yard work.",
  },
  {
    id: "fallback-snow-removal",
    code: "snow_removal",
    name: "Snow Removal",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "50",
    suggestedMax: "400",
    discountEligible: true,
    isAddon: false,
    description: "Per-event and seasonal snow removal.",
  },
  {
    id: "fallback-handyman",
    code: "handyman",
    name: "Handyman",
    category: "core",
    defaultPriceMode: "hourly",
    defaultPrice: "75",
    suggestedMin: "150",
    suggestedMax: "750",
    discountEligible: true,
    isAddon: false,
    description: "Small repairs, installs, punch lists, and property tasks.",
  },
  {
    id: "fallback-demolition",
    code: "demolition",
    name: "Light Demolition",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "300",
    suggestedMax: "1500",
    discountEligible: true,
    isAddon: false,
    description: "Tear-out, small demo, cleanout, and debris haul-off.",
  },
  {
    id: "fallback-flooring",
    code: "flooring",
    name: "Flooring",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "400",
    suggestedMax: "5000",
    discountEligible: true,
    isAddon: false,
    description: "Flooring repair, removal, prep, and installation.",
  },
  {
    id: "fallback-roofing",
    code: "roofing",
    name: "Roofing",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "500",
    suggestedMax: "8000",
    discountEligible: true,
    isAddon: false,
    description: "Roof repair, shingle work, tear-off, and replacement review.",
  },
  {
    id: "fallback-painting",
    code: "painting",
    name: "Painting",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "300",
    suggestedMax: "3500",
    discountEligible: true,
    isAddon: false,
    description: "Interior, exterior, trim, prep, and repaint work.",
  },
  {
    id: "fallback-cleaning",
    code: "cleaning",
    name: "Cleaning",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "150",
    suggestedMax: "600",
    discountEligible: true,
    isAddon: false,
    description: "Standard, deep, and turnover cleaning.",
  },
  {
    id: "fallback-move-cleaning",
    code: "move_cleaning",
    name: "Move-In/Out Cleaning",
    category: "core",
    defaultPriceMode: "fixed",
    defaultPrice: "300",
    suggestedMin: "300",
    suggestedMax: "1200",
    discountEligible: true,
    isAddon: false,
    description: "Turnover cleaning before or after a move.",
  },
  {
    id: "fallback-window-cleaning",
    code: "window_cleaning",
    name: "Window Cleaning",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "75",
    suggestedMax: "500",
    discountEligible: true,
    isAddon: false,
    description: "Inside and outside window cleaning by pane count.",
  },
  {
    id: "fallback-trash-valet",
    code: "trash_valet",
    name: "Trash Valet",
    category: "core",
    defaultPriceMode: "fixed",
    defaultPrice: "30",
    suggestedMin: "30",
    suggestedMax: "129",
    discountEligible: true,
    isAddon: false,
    description: "Curbside trash and recycling subscription.",
  },
  {
    id: "fallback-custom",
    code: "custom",
    name: "Something Else",
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: "0",
    suggestedMax: null,
    discountEligible: true,
    isAddon: false,
    description: "Use this when the job needs staff review before pricing.",
  },
];

function defaultUnitPrice(svc: CatalogService): number {
  if (svc.defaultPrice) return parseFloat(svc.defaultPrice);
  if (svc.suggestedMin) return parseFloat(svc.suggestedMin);
  return 0;
}

function defaultPriceMode(svc: CatalogService): SelectedItem["priceMode"] {
  return (svc.defaultPriceMode as SelectedItem["priceMode"]) || "fixed";
}

function fallbackServiceName(code: string, label?: string | null) {
  if (label?.trim()) return label.trim();
  return code
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackCatalogService(code: string, label?: string | null): CatalogService {
  const existing = FALLBACK_SERVICE_CATALOG.find((entry) => entry.code === code);
  if (existing) {
    return label?.trim() ? { ...existing, name: label.trim() } : existing;
  }

  return {
    id: `fallback_${code}`,
    code,
    name: fallbackServiceName(code, label),
    category: "core",
    defaultPriceMode: "quote",
    defaultPrice: null,
    suggestedMin: null,
    suggestedMax: null,
    discountEligible: true,
    isAddon: false,
    description: "Quote-review service path.",
  };
}

function resolveCatalogService(services: CatalogService[], code: string, label?: string | null): CatalogService {
  return services.find((entry) => entry.code === code) || fallbackCatalogService(code, label);
}

function makeItem(svc: CatalogService): SelectedItem {
  // Pre-populate `callToSchedule` for call_only services so they're not stuck
  // in a "needs attention" state until the user opens an editor.
  const mode = schedulingModeFor(svc.code);
  const details: SelectedItem["details"] =
    mode === "call_only" ? { callToSchedule: true } : {};
  // Task #141: Moving and Junk Removal are sold via the chatbot's crew-size ×
  // hours package picker. Initialise them as a quote (no flat unit price)
  // until the user picks a specific package in the configure step.
  const isPicker = svc.code === "moving" || svc.code === "junk_removal";
  // Task #146 — pre-populate sensible Trash Valet defaults so the customer
  // can submit without touching every field, but the admin still gets a
  // complete subscription payload.
  if (svc.code === "trash_valet") {
    details.cans = 1;
    details.bagCount = 0;
    details.serviceDayOfWeek = 1;
    details.planType = "monthly";
    details.recyclingEnabled = false;
  }
  return {
    serviceCode: svc.code,
    label: svc.name,
    quantity: 1,
    unitPrice: isPicker ? 0 : defaultUnitPrice(svc),
    priceMode: isPicker ? "quote" : defaultPriceMode(svc),
    details,
  };
}

interface CreateBookingResponse {
  success: true;
  confirmationEmailSent: boolean;
  booking: {
    id: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string;
    serviceAddress: string | null;
    finalTotal: string;
    discountTotal: string;
    tokenEstimate: number;
  };
  quote: QuoteResult;
  lead?: {
    id: string;
    orderNumber?: number;
    status?: string;
  } | null;
}

interface QuickRequestResponse {
  success: true;
  lead: {
    id: string;
    orderNumber: number;
    displayOrderNumber: string;
    status: string;
    serviceLabel?: string;
    photoCount?: number;
    promoCode?: string | null;
    referralSlug?: string | null;
    marketingCampaignId?: string | null;
  };
}

type MarketingTracking = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  jcCampaign?: string;
  jcArea?: string;
  jcFocus?: string;
  jcRouteCity?: string;
  jcRouteState?: string;
  jcRouteZip?: string;
  jcRouteDay?: string;
  jcRouteKey?: string;
  jcPromoType?: string;
  jcPackage?: string;
  jcCrewTarget?: string;
  jcHoursTarget?: string;
  jcPriceBand?: string;
  fbclid?: string;
  referrer?: string;
};

type BookingAttribution = {
  promoCode: string;
  referralSlug: string;
  marketingCampaignId: string;
  marketingTracking: MarketingTracking;
};

type BookingMode = "choose" | "quick" | "builder";

type QuickRequestPhoto = {
  name: string;
  type: string;
  mimeType: string;
  size: number;
  url: string;
};

const QUICK_REQUEST_MAX_PHOTOS = 5;
const QUICK_REQUEST_MAX_PHOTO_BYTES = 3 * 1024 * 1024;

const SERVICE_CODE_ALIASES: Record<string, string> = {
  moving: "moving",
  move: "moving",
  movers: "moving",
  residential: "moving",
  uhaul: "moving",
  "u-haul": "moving",
  ubox: "moving",
  "u-box": "moving",
  pods: "moving",
  pod: "moving",
  load: "moving",
  unload: "moving",
  junk: "junk_removal",
  junk_removal: "junk_removal",
  "junk-removal": "junk_removal",
  hauling: "junk_removal",
  cleanup: "cleaning",
  cleanout: "cleaning",
  cleaning: "cleaning",
  move_cleaning: "cleaning",
  "move-cleaning": "cleaning",
  "cleanup-labor": "cleaning",
  snow: "snow_removal",
  snow_removal: "snow_removal",
  "snow-removal": "snow_removal",
  handyman: "handyman",
  window: "window_cleaning",
  windows: "window_cleaning",
  window_cleaning: "window_cleaning",
  "window-cleaning": "window_cleaning",
  "trash-valet": "trash_valet",
  trash_valet: "trash_valet",
  demolition: "demolition",
  demo: "demolition",
  flooring: "flooring",
  painting: "painting",
  roofing: "roofing",
  labor: "labor",
  delivery: "delivery",
  deliveries: "delivery",
  other: "custom",
  custom: "custom",
  "something-else": "custom",
  justask: "custom",
  "just-ask": "custom",
};

function normalizeServiceCodeParam(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SERVICE_CODE_ALIASES[normalized] ?? normalized.replace(/-/g, "_");
}

function serviceCodeFromAdFocus(value?: string): string {
  const focus = String(value || "").toLowerCase();
  if (!focus.trim()) return "";
  if (/\b(junk|cleanout|trash|dump)\b/.test(focus)) return "junk_removal";
  if (/\b(move|moving|mover|movers|load|unload|u-?haul|u-?box|ubox|pods?)\b/.test(focus)) return "moving";
  if (/\b(delivery|deliver|pickup|pick-up|store pickup)\b/.test(focus)) return "delivery";
  if (/\b(cleaning|cleanup|clean-up|maid)\b/.test(focus)) return "cleaning";
  if (/\b(handyman|repair|assembly|assemble)\b/.test(focus)) return "handyman";
  if (/\b(window|windows)\b/.test(focus)) return "window_cleaning";
  if (/\b(snow|shovel|plow)\b/.test(focus)) return "snow_removal";
  if (/\b(lawn|mow|yard)\b/.test(focus)) return "lawn_care";
  if (/\b(demo|demolition)\b/.test(focus)) return "demolition";
  if (/\b(floor|flooring|vinyl|laminate)\b/.test(focus)) return "flooring";
  if (/\b(roof|roofing|shingle|leak)\b/.test(focus)) return "roofing";
  if (/\b(paint|painting)\b/.test(focus)) return "painting";
  if (/\b(labor|helper|extra hands|last-minute)\b/.test(focus)) return "labor";
  return "";
}

function serviceCodeFromSmartInference(inferred: SmartBookingTextInference): string {
  const serviceType = String(inferred.serviceType || "").toLowerCase();
  if (!serviceType.trim()) return "";
  if (/\btrash valet\b/.test(serviceType)) return "trash_valet";
  if (/\bjunk|haul|removal|cleanout\b/.test(serviceType)) return "junk_removal";
  if (/\bmove|moving|load|unload|u-?haul|u-?box|pods?\b/.test(serviceType)) return "moving";
  if (/\bdeliver|delivery|pickup\b/.test(serviceType)) return "delivery";
  if (/\bclean|maid\b/.test(serviceType)) return "cleaning";
  if (/\bhandyman|repair|assembly\b/.test(serviceType)) return "handyman";
  if (/\bwindow\b/.test(serviceType)) return "window_cleaning";
  if (/\bsnow|plow|shovel\b/.test(serviceType)) return "snow_removal";
  if (/\blawn|mow|yard\b/.test(serviceType)) return "lawn_care";
  if (/\bdemo|demolition\b/.test(serviceType)) return "demolition";
  if (/\blabor|helper|extra hands\b/.test(serviceType)) return "labor";
  if (/\bpaint\b/.test(serviceType)) return "painting";
  if (/\bfloor\b/.test(serviceType)) return "flooring";
  if (/\broof\b/.test(serviceType)) return "roofing";
  return serviceCodeFromAdFocus(serviceType);
}

function normalizeSmartDate(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (
      parsed.getFullYear() === Number(year) &&
      parsed.getMonth() === Number(month) - 1 &&
      parsed.getDate() === Number(day)
    ) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return "";
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!slash) return "";
  const [, month, day, yearRaw] = slash;
  const now = new Date();
  const fullYear = yearRaw
    ? Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw)
    : now.getFullYear();
  const parsed = new Date(fullYear, Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== fullYear ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return "";
  }
  return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function smartLoadType(inferred: SmartBookingTextInference): string | undefined {
  const loadType = String(inferred.loadType || "").toLowerCase();
  if (!loadType) return undefined;
  if (/delivery|transport/.test(loadType)) return "Delivery / transport";
  if (/unload only/.test(loadType)) return "Unload only";
  if (/load only/.test(loadType)) return "Load only";
  if (/both|load.*unload|unload.*load/.test(loadType)) return "Load + unload";
  return undefined;
}

function smartMovingPath(inferred: SmartBookingTextInference): SelectedItem["details"]["movingPath"] {
  const loadType = String(inferred.loadType || "").toLowerCase();
  const jobSize = `${inferred.jobSize || ""} ${inferred.homeSize || ""}`.toLowerCase();
  if (/heavy|specialty|piano|safe|pool table|hot tub/.test(jobSize)) return "heavy_specialty";
  if (/unload only/.test(loadType)) return "unload_only";
  if (/load only/.test(loadType)) return "load_only";
  if (/both|load.*unload|unload.*load/.test(loadType)) return "load_unload";
  if (/4\+|4 bed|full house|whole house|large house/.test(jobSize)) return "full_household";
  if (/1-2 items|single item|couple items/.test(jobSize)) return "tiny_items";
  return "load_unload";
}

function smartJobSize(inferred: SmartBookingTextInference): string | undefined {
  const size = String(inferred.jobSize || inferred.homeSize || "").toLowerCase();
  if (!size) return undefined;
  if (/1-2 items|single item|couple/.test(size)) return "1-2 Items";
  if (/studio|1-bed|1 bed|1 bedroom/.test(size)) return "Studio or 1 Bedroom";
  if (/2-3|2 bed|2 bedroom/.test(size)) return "2 Bedroom House";
  if (/3 bed|3 bedroom/.test(size)) return "3 Bedroom House";
  if (/4\+|4 bed|4 bedroom|full house|whole house|large house/.test(size)) return "4 Bedroom House";
  return inferred.jobSize || inferred.homeSize;
}

function smartTruckNeeded(inferred: SmartBookingTextInference): boolean | undefined {
  const situation = String(inferred.truckSituation || "").toLowerCase();
  if (!situation) return undefined;
  if (/jc|company|provide|bring|need truck|your truck/.test(situation)) return true;
  if (/customer|my truck|own truck|rental|no truck|u-?haul|budget|penske|pods?|u-?box/.test(situation)) return false;
  return undefined;
}

function smartTruckSize(inferred: SmartBookingTextInference, path?: SelectedItem["details"]["movingPath"]): string | undefined {
  const truckSize = String(inferred.truckSize || "").toLowerCase();
  if (/26/.test(truckSize)) return "26 ft";
  if (/15|16|17|20|22|24/.test(truckSize)) return "15 ft";
  if (/10|12|u-?box|pod|container|custom/.test(truckSize)) return "Custom";
  if (path === "full_household" || path === "load_unload") return "26 ft";
  if (path) return "15 ft";
  return undefined;
}

function appendSmartNote(existing: string, raw: string) {
  const trimmed = raw.trim();
  if (!trimmed || existing.includes(trimmed)) return existing;
  return existing.trim()
    ? `${existing.trim()}\n\nSmart start: ${trimmed}`
    : `Smart start: ${trimmed}`;
}

function smartStartSummaryParts(input: {
  serviceCode: string;
  zip?: string;
  date?: string;
  loadType?: string;
  truckSize?: string;
  crew?: number;
  hours?: number;
}) {
  const parts = [input.serviceCode.replace(/_/g, " ")];
  if (input.zip) parts.push(`ZIP ${input.zip}`);
  if (input.date) parts.push(input.date);
  if (input.loadType) parts.push(input.loadType);
  if (input.truckSize) parts.push(input.truckSize);
  if (input.crew && input.hours) parts.push(`${input.crew} movers / ${input.hours} hours`);
  return parts.filter(Boolean).join(" - ");
}

function formatAttributionSummary(attribution: Pick<BookingAttribution, "promoCode" | "referralSlug">) {
  const parts: string[] = [];
  if (attribution.promoCode) parts.push(`Referral code ${attribution.promoCode}`);
  if (attribution.referralSlug) {
    const repName = attribution.referralSlug
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    parts.push(`Rep page ${repName}`);
  }
  return parts.length > 0 ? `${parts.join(" - ")} attached` : "";
}

function formatAdHint(marketingTracking: MarketingTracking) {
  const focus = marketingTracking.jcFocus?.trim();
  const area = marketingTracking.jcArea?.trim();
  const routeDay = marketingTracking.jcRouteDay?.trim();
  const promoPackage = marketingTracking.jcPackage?.trim();
  if (routeDay && area && promoPackage) return `${area} ${routeDay} - ${promoPackage.replace(/-/g, " ")}`;
  if (routeDay && area) return `${area} ${routeDay}`;
  if (focus && area) return `${focus} around ${area}`;
  if (focus) return focus;
  if (area) return `Help around ${area}`;
  return "";
}

function zipFromAddress(value: string) {
  const match = value.match(/\b\d{5}(?:-\d{4})?\b/);
  return match?.[0]?.slice(0, 5) || "";
}

function normalizeMarketplaceShapeId(value?: string | null): MarketplaceRequestShapeId | null {
  if (value === "fast_quote" || value === "moving_help" || value === "delivery_reuse" || value === "repeat_loop") {
    return value;
  }
  return null;
}

function marketplaceShapeForServiceCode(serviceCode?: string | null): MarketplaceRequestShapeId {
  return getMarketplaceShapeForServiceCode(serviceCode).id;
}

function serviceCodeForMarketplaceShape(shapeId: MarketplaceRequestShapeId) {
  if (shapeId === "delivery_reuse") return "delivery";
  if (shapeId === "moving_help") return "moving";
  return null;
}

function defaultMarketplaceShapeId(codes: string[], explicit?: MarketplaceRequestShapeId | null): MarketplaceRequestShapeId {
  if (explicit) return explicit;
  const firstCode = codes.find(Boolean);
  return firstCode ? marketplaceShapeForServiceCode(firstCode) : "delivery_reuse";
}

function priceMenuScope(task: ServicePriceMenuTask) {
  const needs = task.customerNeeds.join(", ");
  return `${task.label}: ${task.description} Typical range ${formatServicePriceRange(task)} (${task.priceUnit}). Need: ${needs}.`;
}

function movingPackageDetails(
  crew: number,
  hours: number,
  label: string,
  snapshot: CanonicalPricingSnapshot = CANONICAL_PRICING_2026_08,
): Partial<SelectedItem["details"]> {
  const baseEstimate = calculateLaborBooking({ crewSize: crew, hours, snapshot }).laborTotal;
  return {
    packageId: `smart_${crew}m_${String(hours).replace(".", "p")}h`,
    packageLabel: label,
    crew,
    hours,
    minPrice: baseEstimate,
    maxPrice: baseEstimate,
    inventoryCrewRecommendation: crew,
    inventoryLaborHours: hours,
    inventoryPriceMin: baseEstimate,
    inventoryPriceMax: baseEstimate,
    quoteConfidence: "medium" as const,
  };
}

function appendQuickAnswerNote(existing: string, note: string) {
  const trimmed = note.trim();
  if (!trimmed || existing.includes(trimmed)) return existing;
  return existing.trim()
    ? `${existing.trim()}\n\nQuick answer: ${trimmed}`
    : `Quick answer: ${trimmed}`;
}

const STEPS = ["services", "address", "configure", "contact", "safety", "review"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS: Record<Step, string> = {
  services: "Pick services",
  address: "Job details",
  configure: "Configure each service",
  contact: "Contact info",
  safety: "Safety check",
  review: "Contact & review",
};
const STEP_PHASES: Record<Step, { number: 1 | 2 | 3; label: string; detail: string }> = {
  services: { number: 1, label: "Service", detail: "Choose the work" },
  address: { number: 2, label: "Details", detail: "Location and timing" },
  configure: { number: 2, label: "Details", detail: "Crew, truck, scope" },
  contact: { number: 2, label: "Details", detail: "Contact and notes" },
  safety: { number: 2, label: "Details", detail: "Heavy items" },
  review: { number: 3, label: "Confirm", detail: "Lock in request" },
};

function marketplaceActionPhaseForStep(step: Step): MarketplaceActionPhase {
  const phase = STEP_PHASES[step];
  if (phase.number === 1) return "start";
  if (phase.number === 2) return "progress";
  return "finish";
}

function shortHeavyLabel(label: string) {
  if (/grand piano/i.test(label)) return "Grand piano";
  if (/upright piano/i.test(label)) return "Upright piano";
  if (/pool table/i.test(label)) return "Pool table";
  if (/hot tub/i.test(label)) return "Hot tub";
  if (/1000/.test(label)) return "Safe 1000 lbs";
  if (/500/.test(label)) return "Safe 500 lbs";
  if (/safe/i.test(label)) return "Safe 300 lbs";
  if (/800\+/.test(label)) return "800+ lb item";
  if (/600/.test(label)) return "600 lb item";
  if (/400/.test(label)) return "400 lb item";
  if (/appliance|fitness/i.test(label)) return "Appliance";
  return "Other 200 lb+";
}

function readQuickRequestPhoto(file: File): Promise<QuickRequestPhoto> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url.startsWith("data:image/")) {
        reject(new Error(`${file.name} could not be read as an image.`));
        return;
      }
      resolve({
        name: file.name,
        type: file.type || "image/*",
        mimeType: file.type || "image/*",
        size: file.size,
        url,
      });
    };
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

function safetyNeedsAttention(item: SelectedItem): string | null {
  if (item.serviceCode !== "moving") return null;
  if (!item.details.heavyItemsConfirmed) {
    return "Confirm heavy/special items before review";
  }
  return null;
}

function itemNeedsAttention(item: SelectedItem): string | null {
  // Task #141: Moving / Junk Removal must pass through the package picker so
  // we capture crew, hours and tier (and any JC222 flat-rate eligibility)
  // before the booking submits.
  if (item.serviceCode === "moving" || item.serviceCode === "junk_removal") {
    if (item.serviceCode === "moving" && !item.details.movingPath) return "Pick a quote path";
    if (!item.details.jobSize)   return "Pick a job size";
    if (item.serviceCode === "moving" && !item.details.loadType) return "Pick load or unload";
    if (item.serviceCode === "moving" && item.details.truckNeeded == null) return "Tell us who provides the truck";
    if (item.serviceCode === "moving" && item.details.truckNeeded != null && !item.details.truckSize) return "Pick a truck size";
    if (item.serviceCode === "moving" && /both|load \+ unload/i.test(item.details.loadType || "") && !item.details.dropoffAddress?.trim()) {
      return "Enter the drop-off address";
    }
    const hasInventoryEstimate =
      item.serviceCode === "moving" &&
      !!item.details.inventoryItems?.length &&
      !!item.details.inventoryCrewRecommendation &&
      item.details.inventoryPriceMin != null &&
      item.details.inventoryPriceMax != null;
    if (!item.details.packageId && !hasInventoryEstimate) return "Pick a crew package";
    if (!item.details.requestedDate) return "Date required";
    if (!item.details.requestedStartTime) return "Start time required";
    return null;
  }
  // Task #146 — Trash Valet runs as a recurring subscription, not a single
  // dated job. Validate the subscription fields the admin pipeline needs to
  // auto-provision instead of asking for a single requestedDate.
  if (item.serviceCode === "trash_valet") {
    if (!item.details.cans || item.details.cans < 1) return "Pick how many cans";
    if (!item.details.serviceDayOfWeek) return "Pick a trash pickup day";
    if (item.details.recyclingEnabled && !item.details.recyclingAnchorDate) {
      return "Pick the first recycling week date";
    }
    return null;
  }
  const mode = schedulingModeFor(item.serviceCode);
  if (mode === "date_only" && !item.details.requestedDate) return "Date required";
  if (mode === "date_freq") {
    if (!item.details.requestedDate) return "Date required";
    if (!item.details.frequency) return "Frequency required";
  }
  if (mode === "call_only" && !item.details.callToSchedule) return "Confirm scheduling preference";
  return null;
}

function QuickRequestForm({
  services,
  onBuildQuote,
  onHome,
  attribution,
  initialServiceCode,
}: {
  services: CatalogService[];
  onBuildQuote: () => void;
  onHome: () => void;
  attribution: BookingAttribution;
  initialServiceCode?: string;
}) {
  const { toast } = useToast();
  const serviceOptions = services.length > 0
    ? services.filter((svc) => !svc.isAddon).map((svc) => ({ code: svc.code, name: svc.name }))
    : FALLBACK_SERVICE_CATALOG.filter((svc) => !svc.isAddon).map((svc) => ({ code: svc.code, name: svc.name }));
  const initialFromAdFocus = serviceCodeFromAdFocus(attribution.marketingTracking.jcFocus);
  const normalizedInitialServiceCode = normalizeServiceCodeParam(initialServiceCode || initialFromAdFocus || "");
  const serviceSuggestedFromAd = !initialServiceCode && !!initialFromAdFocus && serviceOptions.some((svc) => svc.code === normalizedInitialServiceCode);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    serviceCode: serviceOptions.some((svc) => svc.code === normalizedInitialServiceCode) ? normalizedInitialServiceCode : "moving",
    notes: "",
    mediaLink: "",
  });
  const [photoFiles, setPhotoFiles] = useState<QuickRequestPhoto[]>([]);
  const [photoReading, setPhotoReading] = useState(false);
  const [submitted, setSubmitted] = useState<QuickRequestResponse["lead"] | null>(null);
  const canSubmit =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    /^(?:1)?[2-9]\d{2}[2-9]\d{6}$/.test(form.phone.replace(/\D/g, "")) &&
    form.serviceCode.trim().length > 0;
  const attributionSummary = formatAttributionSummary(attribution);
  const adHint = formatAdHint(attribution.marketingTracking);

  const submitQuick = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/quick-request", {
        ...form,
        promoCode: attribution.promoCode || undefined,
        referralSlug: attribution.referralSlug || undefined,
        marketingCampaignId: attribution.marketingCampaignId || undefined,
        marketingTracking: attribution.marketingTracking,
        photos: photoFiles,
      });
      return res.json() as Promise<QuickRequestResponse>;
    },
    onSuccess: (data) => {
      setSubmitted(data.lead);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not send quick request",
        description: err.message ? err.message.slice(0, 180) : "Please try again or call us.",
        variant: "destructive",
      });
    },
  });

  async function copyQuickRequestDetails(lead: QuickRequestResponse["lead"]) {
    const lines = [
      `JC ON THE MOVE quick request ${lead.displayOrderNumber}`,
      `Customer: ${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      `Phone: ${form.phone}`,
      `Service: ${lead.serviceLabel || form.serviceCode}`,
      `Photos: ${lead.photoCount || 0}`,
      lead.promoCode ? `Referral code: ${lead.promoCode}` : "",
      lead.referralSlug ? `Rep page: ${lead.referralSlug}` : "",
      lead.marketingCampaignId ? `Campaign: ${lead.marketingCampaignId}` : "",
      form.mediaLink.trim() ? `Photo/video/album link: ${form.mediaLink.trim()}` : "",
      form.notes.trim() ? `Notes: ${form.notes.trim()}` : "",
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "Request details copied", description: lead.displayOrderNumber });
    } catch {
      toast({
        title: "Copy failed",
        description: "Use the order number when you call or text.",
        variant: "destructive",
      });
    }
  }

  if (submitted) {
    const photoCount = submitted.photoCount || 0;
    const smsFollowUpText = [
      `Hi JC ON THE MOVE, I just submitted quick request ${submitted.displayOrderNumber}.`,
      `Service: ${submitted.serviceLabel || form.serviceCode}.`,
      `Phone: ${form.phone}.`,
      `Photos attached: ${photoCount}.`,
      form.mediaLink.trim() ? `Media link: ${form.mediaLink.trim()}.` : "",
      photoCount === 0 ? "I can text photos, a video, or an album link if needed." : "I can text more photos, a video, or an album link if needed.",
    ].filter(Boolean).join(" ");
    return (
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 sm:p-6 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black">Quick Request Sent</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Order {submitted.displayOrderNumber} is in the quote-needed queue. A coordinator will call or text you shortly at {form.phone} to confirm the details.
            </p>
          </div>
          <div className="grid gap-2 text-left text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Request</p>
              <p className="mt-1 font-black">{submitted.serviceLabel || "Service"} quote needed</p>
              <p className="mt-1 text-muted-foreground">Call required. No pricing shown yet.</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Photos</p>
              <p className="mt-1 font-black">{photoCount > 0 ? `${photoCount} attached` : "No photos attached"}</p>
              <p className="mt-1 text-muted-foreground">{photoCount > 0 ? "We will review them before calling. You can text more photos, videos, or an album link." : "You can text photos, videos, or an album link when we follow up."}</p>
            </div>
          </div>
          {(submitted.promoCode || submitted.referralSlug) && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-left text-xs text-emerald-700 dark:text-emerald-300">
              {submitted.promoCode && <p className="font-black">Referral code {submitted.promoCode} attached</p>}
              {submitted.referralSlug && <p className="mt-1">Rep page: {submitted.referralSlug}</p>}
            </div>
          )}
          <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3 text-left text-xs text-blue-700 dark:text-blue-300">
            <p className="font-black">Need faster help?</p>
            <p className="mt-1">Call or text now and mention order {submitted.displayOrderNumber}. {form.mediaLink.trim() ? "Your photo/video link is attached to the request." : "Add a Google Photos album or video link if it helps explain the job."}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a href="tel:+19062859312">
              <Button className="w-full">Call Now</Button>
            </a>
            <a href={`sms:+19062859312?&body=${encodeURIComponent(smsFollowUpText)}`}>
              <Button className="w-full" variant="outline">Text Details / Album</Button>
            </a>
            <Button type="button" variant="outline" onClick={() => copyQuickRequestDetails(submitted)}>
              <Copy className="mr-2 h-4 w-4" />
              Copy Details
            </Button>
            <Button onClick={onBuildQuote}>Build a detailed quote</Button>
            <Button variant="outline" onClick={onHome}>Return Home</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-8">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-500">Fast local help</p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-black">Request a callback in 60 seconds</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Send the basics now. A coordinator reviews the job, calls or texts you, and finishes the quote with you.
          </p>
          {attributionSummary && (
            <p className="mt-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-600 dark:text-emerald-300">
              {attributionSummary}
            </p>
          )}
          {adHint && (
            <p className="mt-2 inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-600 dark:text-blue-300">
              From ad: {adHint}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">First name</Label>
            <Input
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="First name"
              data-testid="quick-first-name"
            />
          </div>
          <div>
            <Label className="text-xs">Last name</Label>
            <Input
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Last name"
              data-testid="quick-last-name"
            />
          </div>
          <div>
            <Label className="text-xs">Phone number</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="(906) 285-9312"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={18}
              data-testid="quick-phone"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Enter all 10 digits so we can call or text you back.</p>
          </div>
          <div>
            <Label className="text-xs">Service</Label>
            <select
              value={form.serviceCode}
              onChange={(e) => setForm((f) => ({ ...f, serviceCode: e.target.value }))}
              className="mt-1 w-full h-10 rounded-md border border-border bg-background px-2 text-sm"
              data-testid="quick-service"
            >
              {serviceOptions.map((svc) => (
                <option key={svc.code} value={svc.code}>{svc.name}</option>
              ))}
            </select>
            {serviceSuggestedFromAd && (
              <p className="mt-1 text-[11px] font-semibold text-blue-600 dark:text-blue-300">
                Suggested from the ad you clicked.
              </p>
            )}
          </div>
        </div>
        <div>
          <Label className="text-xs">Notes (optional)</Label>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="What do you need help with? Address, timing, truck size, or anything important..."
            rows={4}
            data-testid="quick-notes"
          />
        </div>
        <div>
          <Label className="text-xs">Photo, video, or album link (optional)</Label>
          <Input
            value={form.mediaLink}
            onChange={(e) => setForm((f) => ({ ...f, mediaLink: e.target.value }))}
            placeholder="Paste a Google Photos album, video, or shared folder link"
            inputMode="url"
            data-testid="quick-media-link"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Best for full room walkthroughs, larger videos, or more photos than the upload box allows.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-border p-4">
          <Label className="text-xs flex items-center gap-1">
            <Camera className="h-3.5 w-3.5" /> Photos (optional)
          </Label>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Show us what needs moved, removed, delivered, or cleaned. Photos help us send the right crew and avoid surprise pricing. For videos or full albums, paste the link above.
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted">
            <Upload className="h-4 w-4" />
            {photoReading ? "Reading photos..." : "Add photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={photoReading}
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                if (!files.length) return;
                const imageFiles = files.filter((file) => file.type.startsWith("image/"));
                if (imageFiles.length !== files.length) {
                  toast({
                    title: "Images only",
                    description: "Quick requests can include JPG, PNG, HEIC, or other image files.",
                    variant: "destructive",
                  });
                }
                const accepted = imageFiles.slice(0, QUICK_REQUEST_MAX_PHOTOS);
                if (imageFiles.length > QUICK_REQUEST_MAX_PHOTOS) {
                  toast({
                    title: "Photo limit",
                    description: `Attach up to ${QUICK_REQUEST_MAX_PHOTOS} photos to keep the callback request fast.`,
                    variant: "destructive",
                  });
                }
                const oversized = accepted.find((file) => file.size > QUICK_REQUEST_MAX_PHOTO_BYTES);
                if (oversized) {
                  toast({
                    title: "Photo too large",
                    description: `${oversized.name} is over 3 MB. Send larger photos by text after submitting.`,
                    variant: "destructive",
                  });
                  e.currentTarget.value = "";
                  return;
                }
                setPhotoReading(true);
                try {
                  setPhotoFiles(await Promise.all(accepted.map(readQuickRequestPhoto)));
                } catch (error) {
                  toast({
                    title: "Could not read photos",
                    description: error instanceof Error ? error.message : "Please try different photos.",
                    variant: "destructive",
                  });
                } finally {
                  setPhotoReading(false);
                  e.currentTarget.value = "";
                }
              }}
            />
          </label>
          {photoFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-5 gap-2">
                {photoFiles.map((photo) => (
                  <img
                    key={`${photo.name}-${photo.size}`}
                    src={photo.url}
                    alt={photo.name}
                    className="aspect-square w-full rounded-md border border-border object-cover"
                  />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {photoFiles.length} photo{photoFiles.length === 1 ? "" : "s"} attached. We will review them before calling.
              </p>
            </div>
          )}
        </div>
        <PhoneRewardsEnrollment phone={form.phone} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            disabled={!canSubmit || submitQuick.isPending || photoReading}
            onClick={() => submitQuick.mutate()}
            data-testid="quick-submit"
          >
            {submitQuick.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : "Request Callback"}
          </Button>
          <Button type="button" variant="outline" onClick={onBuildQuote}>
            Build my quote instead
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MultiServiceBookPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth() as { user: User | null | undefined };
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Worker mode is a convenience entry point for authenticated staff, not a
  // client-side authority signal. The server still verifies quote authority.
  const workerModeRequested = useMemo(() => {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("worker") === "1" || sp.get("mode") === "worker";
  }, []);
  const isWorker = workerModeRequested && ["admin", "employee", "business_owner"].includes(user?.role || "");

  // Task #207 — URL prefill contract. Read once on mount so the chat-intake
  // overlay (and the existing single-service homepage tiles) can hand the
  // wizard a ready-made cart + jump straight to the configure / contact
  // step. Resolved against the live catalog inside an effect below; here
  // we just snapshot the raw query params.
  //
  // Note on `?bundle=<code>`: the URL contract carries it for analytics /
  // hand-off transparency, but the wizard does not need to consume it —
  // the live bundle engine in /api/bookings/quote auto-applies any
  // matching bundle based purely on cart contents. So we deliberately
  // do not extract it here; the existing one-away / auto-applied popup
  // in this file (driven by `quote.bundleApplied`) is the single source
  // of truth for bundle UX.
  const urlPrefill = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        codes: [] as string[],
        jumpStep: null as Step | null,
        serviceAddress: "",
        requestedDate: "",
        linePrice: null as number | null,
        lineLabel: "",
        lineDetails: {} as SelectedItem["details"],
        marketplaceShapeId: null as MarketplaceRequestShapeId | null,
      };
    }
    const sp = new URLSearchParams(window.location.search);
    const codes = new Set<string>();
    const multi = sp.get("services");
    if (multi) {
      multi.split(",")
        .map((c) => normalizeServiceCodeParam(c))
        .filter(Boolean)
        .forEach((c) => codes.add(c));
    }
    // Single-service alias used by the existing home tiles (e.g. ?service=moving).
    // Tile values use slug-style codes that may differ from catalog codes; we
    // normalise the few legacy aliases here.
    const single = sp.get("service");
    if (single) {
      codes.add(normalizeServiceCodeParam(single));
    }
    if (codes.size === 0) {
      const inferredFromAd = serviceCodeFromAdFocus(sp.get("jc_focus") || sp.get("utm_campaign") || "");
      if (inferredFromAd) codes.add(inferredFromAd);
    }
    const stepParam = sp.get("step");
    const jumpStep = stepParam && (STEPS as readonly string[]).includes(stepParam)
      ? (stepParam as Step)
      : null;
    const serviceAddress = sp.get("address")?.trim() || "";
    const requestedDate = (sp.get("date") || sp.get("requestedDate") || sp.get("moveDate") || "").trim();
    const marketplaceShapeId = normalizeMarketplaceShapeId(sp.get("shape") || sp.get("marketplaceShape"));
    const rawPrice = Number(sp.get("price"));
    const linePrice = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    const lineLabel = sp.get("label")?.trim() || "";
    let lineDetails: SelectedItem["details"] = {};
    const detailsParam = sp.get("details");
    if (detailsParam) {
      try {
        const parsed = JSON.parse(detailsParam) as SelectedItem["details"];
        if (parsed && typeof parsed === "object") lineDetails = parsed;
      } catch {
        lineDetails = {};
      }
    }
    return { codes: Array.from(codes), jumpStep, serviceAddress, requestedDate, linePrice, lineLabel, lineDetails, marketplaceShapeId };
  }, []);

  const attribution = useMemo(() => {
    if (typeof window === "undefined") {
      return { promoCode: "", referralSlug: "", marketingCampaignId: "", marketingTracking: {} };
    }
    const sp = new URLSearchParams(window.location.search);
    const marketingTracking: MarketingTracking = {
      utmSource: (sp.get("utm_source") || "").trim(),
      utmMedium: (sp.get("utm_medium") || "").trim(),
      utmCampaign: (sp.get("utm_campaign") || "").trim(),
      utmContent: (sp.get("utm_content") || "").trim(),
      jcCampaign: (sp.get("jc_campaign") || "").trim(),
      jcArea: (sp.get("jc_area") || "").trim(),
      jcFocus: (sp.get("jc_focus") || "").trim(),
      jcRouteCity: (sp.get("jc_route_city") || "").trim(),
      jcRouteState: (sp.get("jc_route_state") || "").trim(),
      jcRouteZip: (sp.get("jc_route_zip") || "").trim(),
      jcRouteDay: (sp.get("jc_route_day") || "").trim(),
      jcRouteKey: (sp.get("jc_route_key") || "").trim(),
      jcPromoType: (sp.get("jc_promo_type") || "").trim(),
      jcPackage: (sp.get("jc_package") || "").trim(),
      jcCrewTarget: (sp.get("jc_crew_target") || "").trim(),
      jcHoursTarget: (sp.get("jc_hours_target") || "").trim(),
      jcPriceBand: (sp.get("jc_price_band") || "").trim(),
      fbclid: (sp.get("fbclid") || "").trim(),
      referrer: document.referrer || "",
    };
    return {
      promoCode: (sp.get("promo") || sp.get("promoCode") || "").trim().toUpperCase(),
      referralSlug: (sp.get("rep") || sp.get("ref") || "").trim().toLowerCase(),
      marketingCampaignId: marketingTracking.jcCampaign || marketingTracking.utmContent || "",
      marketingTracking,
    };
  }, []);
  const attributionSummary = formatAttributionSummary(attribution);
  const adHint = formatAdHint(attribution.marketingTracking);

  const [step, setRawStep] = useState<Step>("services");
  // Preserve old deep links while presenting three customer-facing sections.
  const setStep = (next: Step) => setRawStep(next === "configure" || next === "safety" ? "address" : next === "contact" ? "review" : next);
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [selectedMarketplaceShapeId, setSelectedMarketplaceShapeId] = useState<MarketplaceRequestShapeId>(
    () => defaultMarketplaceShapeId(urlPrefill.codes, urlPrefill.marketplaceShapeId),
  );
  const [selectedPriceMenuTaskId, setSelectedPriceMenuTaskId] = useState<string | null>(null);
  const [serviceAddress, setServiceAddress] = useState("");
  // Task #164 — captured by AddressField so the green confirmation pill
  // can render after a Places click, geocode-on-blur, or autofill resolve.
  // Not sent to the backend (the multi-booking POST only takes the full
  // address string) but kept locally so the UX matches the other flows.
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [contact, setContact] = useState({
    customerName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "",
    customerEmail: user?.email || "",
    customerPhone: user?.phoneNumber || "",
    notes: "",
  });
  const [smartStartText, setSmartStartText] = useState("");
  const [smartStartSummary, setSmartStartSummary] = useState("");
  // Task #169 — worker-mode-only fields. Captured here and folded into the
  // notes payload + source field so they reach the lead/booking record
  // without requiring a schema migration. The dispatch task (#172) will
  // promote these into first-class columns.
  const [workerFields, setWorkerFields] = useState({
    assignedTo: "",       // crew member name to assign the job to
    leadSource: "",       // door-knock, referral, repeat, walkup, other
    internalNotes: "",    // crew-only notes invisible to the customer
  });
  const [workerSendCustomerEmail, setWorkerSendCustomerEmail] = useState(false);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  // Task #181 — wallet payment / token redemption state
  const [payFromWallet, setPayFromWallet] = useState(false);
  const [applyTokens, setApplyTokens] = useState(0);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const customerTier = (user?.loyaltyTier as string | undefined) || "bronze";
  const bookingFunnelSessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [confirmation, setConfirmation] = useState<
    CreateBookingResponse["booking"] & { items: SelectedItem[]; quote: QuoteResult; confirmationEmailSent: boolean } | null
  >(null);
  const stepIndex = (s: Step) => STEPS.indexOf(s);
  const hasMovingService = useMemo(() => items.some((item) => item.serviceCode === "moving"), [items]);
  const hasApprovalOnlyQuoteItems = useMemo(
    () => items.some((item) => item.serviceCode === "moving" || item.serviceCode === "junk_removal"),
    [items],
  );
  const primaryMarketplaceItem = useMemo(() => {
    return (
      items.find((item) => item.serviceCode === "moving")
      || items.find((item) => item.serviceCode === "delivery")
      || items.find((item) => item.serviceCode === "junk_removal")
      || items[0]
      || null
    );
  }, [items]);
  const selectedMarketplaceShape = useMemo(() => {
    return getMarketplaceRequestShape(selectedMarketplaceShapeId) || getMarketplaceRequestShape("moving_help")!;
  }, [selectedMarketplaceShapeId]);
  const marketplaceSourceHint = useMemo(() => {
    const candidates = [
      isWorker ? workerFields.leadSource : "",
      attribution.marketingTracking.jcFocus,
      attribution.marketingTracking.utmSource,
      attribution.marketingTracking.utmCampaign,
      attribution.marketingTracking.utmMedium,
      attribution.referralSlug,
      attribution.promoCode,
      "booking_funnel",
    ];
    return candidates.map((value) => String(value || "").trim()).find(Boolean) || "booking_funnel";
  }, [
    isWorker,
    workerFields.leadSource,
    attribution.marketingTracking.jcFocus,
    attribution.marketingTracking.utmSource,
    attribution.marketingTracking.utmCampaign,
    attribution.marketingTracking.utmMedium,
    attribution.referralSlug,
    attribution.promoCode,
  ]);
  const smartBookingGuidanceAnswers = useMemo<SmartBookingAnswers>(() => {
    const moving = items.find((item) => item.serviceCode === "moving");
    const primary = primaryMarketplaceItem;
    const scheduledItem = items.find((item) => item.details.requestedDate || item.details.requestedStartTime) || primary;
    const zip = addressZip || zipFromAddress(serviceAddress);
    const movingDetails = moving?.details;
    const crew = movingDetails?.crew || movingDetails?.inventoryCrewRecommendation || undefined;
    const hours = movingDetails?.hours || movingDetails?.inventoryLaborHours || undefined;
    const truckSituation =
      movingDetails?.truckNeeded === true
        ? "JC ON THE MOVE provides truck"
        : movingDetails?.truckNeeded === false
          ? "Customer provides truck or no truck needed"
          : undefined;
    const inventoryItems = items.flatMap((item) => [
      ...(item.details.inventoryItems || []),
      ...(item.details.junkItems || []),
    ]);
    const specialItems = items.flatMap((item) => item.details.specialItems || []);
    const itemNotes = items.map((item) => item.details.notes || item.details.scope || "").filter(Boolean).join("\n");
    const notes = [contact.notes, itemNotes, smartStartSummary, smartStartText].filter(Boolean).join("\n");

    return {
      marketplaceShapeId: selectedMarketplaceShape.id,
      serviceType: primary?.serviceCode || selectedMarketplaceShape.id,
      serviceCode: primary?.serviceCode || serviceCodeForMarketplaceShape(selectedMarketplaceShape.id),
      serviceLabel: primary?.label || selectedMarketplaceShape.shape,
      serviceAddress: serviceAddress.trim() || undefined,
      address: serviceAddress.trim() || undefined,
      fromAddress: serviceAddress.trim() || undefined,
      fromZip: zip || undefined,
      zip: zip || undefined,
      pickupAddress: serviceAddress.trim() || undefined,
      dropoffAddress: movingDetails?.dropoffAddress || undefined,
      toAddress: movingDetails?.dropoffAddress || undefined,
      requestedDate: scheduledItem?.details.requestedDate || undefined,
      moveDate: scheduledItem?.details.requestedDate || undefined,
      timeWindow: scheduledItem?.details.requestedStartTime || undefined,
      loadType: movingDetails?.loadType || movingDetails?.movingPath || undefined,
      movingPath: movingDetails?.movingPath || undefined,
      truckSituation,
      truckProvider: truckSituation,
      truckSize: movingDetails?.truckSize || undefined,
      selectedMovingRec: movingDetails?.packageId || undefined,
      selectedMovingRecLabel: movingDetails?.packageLabel || undefined,
      selectedMovingRecCrew: crew,
      selectedMovingRecHours: hours,
      crewSize: crew,
      laborHours: hours,
      packageId: movingDetails?.packageId || undefined,
      selectedPackage: movingDetails?.packageLabel || undefined,
      items: inventoryItems,
      inventory: inventoryItems,
      specialItems,
      notes: notes || undefined,
      fullName: contact.customerName.trim() || undefined,
      customerName: contact.customerName.trim() || undefined,
      phone: contact.customerPhone.trim() || undefined,
      customerPhone: contact.customerPhone.trim() || undefined,
      email: contact.customerEmail.trim() || undefined,
      customerEmail: contact.customerEmail.trim() || undefined,
    };
  }, [
    items,
    primaryMarketplaceItem,
    selectedMarketplaceShape.id,
    selectedMarketplaceShape.shape,
    addressZip,
    serviceAddress,
    contact.notes,
    contact.customerName,
    contact.customerPhone,
    contact.customerEmail,
    smartStartSummary,
    smartStartText,
  ]);
  const [bookingMode, setBookingMode] = useState<BookingMode>(() => {
    if (typeof window === "undefined") return "choose";
    const sp = new URLSearchParams(window.location.search);
    const rawMode = sp.get("mode");
    if (rawMode === "quick") return "quick";
    if (rawMode === "builder" || rawMode === "worker" || sp.get("worker") === "1") return "builder";
    return "choose";
  });

  // ── Data
  const { data: catalogData } = useQuery<{ services: CatalogService[] }>({
    queryKey: ["/api/service-catalog"],
  });
  const services: CatalogService[] = catalogData?.services?.length
    ? catalogData.services
    : FALLBACK_SERVICE_CATALOG;

  const { data: pricingSnapshot } = useQuery<CanonicalPricingSnapshot>({
    queryKey: ["/api/pricing/v2"],
    staleTime: 5 * 60 * 1000,
  });
  const activePricing = pricingSnapshot ?? CANONICAL_PRICING_2026_08;

  const { data: bundlesData } = useQuery<{ slots: BundleSlots; bundles: FeaturedBundle[] }>({
    queryKey: ["/api/bundles/featured"],
  });
  const allBundles: FeaturedBundle[] = bundlesData?.bundles || [];

  // Task #181 — Live wallet balance for the signed-in customer. Only
  // queried when authenticated; anonymous users see no wallet panel.
  const { data: walletData } = useQuery<{ tokenBalance: string; cashBalance: string }>({
    queryKey: ["/api/wallet/balance"],
    enabled: !!user,
  });
  const walletCash = walletData ? parseFloat(walletData.cashBalance || "0") : 0;
  const walletTokens = walletData ? Math.floor(parseFloat(walletData.tokenBalance || "0")) : 0;

  function buildBookingFunnelSnapshot() {
    return {
      bookingMode,
      step,
      marketplaceShapeId: selectedMarketplaceShape.id,
      marketplaceShape: selectedMarketplaceShape.shape,
      serviceAddress: serviceAddress.trim() || null,
      city: addressCity || null,
      state: addressState || null,
      zip: addressZip || zipFromAddress(serviceAddress) || null,
      attribution: {
        promoCode: attribution.promoCode || null,
        referralSlug: attribution.referralSlug || null,
        marketingCampaignId: attribution.marketingCampaignId || null,
        marketingTracking: attribution.marketingTracking,
      },
      contact: {
        name: contact.customerName.trim() || null,
        phone: contact.customerPhone.trim() || null,
        email: contact.customerEmail.trim() || null,
        hasNotes: contact.notes.trim().length > 0,
      },
      workerMode: isWorker,
      workerFields: isWorker
        ? {
            assignedTo: workerFields.assignedTo.trim() || null,
            leadSource: workerFields.leadSource.trim() || null,
            hasInternalNotes: workerFields.internalNotes.trim().length > 0,
          }
        : null,
      items: items.map((item) => ({
        serviceCode: item.serviceCode,
        label: item.label,
        marketplaceShapeId: item.details.marketplaceShapeId || selectedMarketplaceShape.id,
        marketplaceShape: item.details.marketplaceShape || selectedMarketplaceShape.shape,
        movingPath: item.details.movingPath || null,
        loadType: item.details.loadType || null,
        truckNeeded: item.details.truckNeeded ?? null,
        truckSize: item.details.truckSize || null,
        jobSize: item.details.jobSize || null,
        requestedDate: item.details.requestedDate || null,
        requestedStartTime: item.details.requestedStartTime || null,
        packageId: item.details.packageId || null,
        packageLabel: item.details.packageLabel || null,
        crew: item.details.crew || item.details.inventoryCrewRecommendation || null,
        hours: item.details.hours || item.details.inventoryLaborHours || null,
        minPrice: item.details.minPrice || item.details.inventoryPriceMin || null,
        maxPrice: item.details.maxPrice || item.details.inventoryPriceMax || null,
        verifiedDriveMiles: item.details.verifiedDriveMiles || null,
        inventoryItemCount: item.details.inventoryItems?.reduce((sum: number, entry: any) => sum + Number(entry.quantity || 0), 0) || 0,
        specialItemsCount: item.details.specialItems?.length || 0,
      })),
      quote: quote
        ? {
            subtotal: quote.subtotal,
            finalTotal: quote.finalTotal,
            discountTotal: quote.discountTotal,
            tokenEstimate: quote.tokenEstimate,
          }
        : null,
      continueReason: canContinueReason(),
      tokenError,
    };
  }

  function trackBookingFunnel(eventType: string, options: {
    errorMessage?: string;
    bookingId?: string;
    leadId?: string | null;
  } = {}) {
    if (typeof window === "undefined") return;
    const payload = {
      visitorId: getVisitorId(),
      sessionId: bookingFunnelSessionIdRef.current,
      page: window.location.pathname + window.location.search,
      eventType,
      step,
      bookingId: options.bookingId,
      leadId: options.leadId,
      errorMessage: options.errorMessage,
      fieldSnapshot: buildBookingFunnelSnapshot(),
    };
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon("/api/analytics/booking-funnel", blob)) return;
      }
    } catch {
      // Fall through to fetch.
    }
    fetch("/api/analytics/booking-funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  // Task #181 — normalize the requested redemption whenever the tier cap
  // (driven by quote.subtotal) or wallet token balance shrinks. Without
  // this, the slider's rendered value clamps but state remains stale and
  // submit could send an `applyTokens` above the cap, triggering a
  // server rejection the user has no way to recover from once the
  // slider hides.
  useEffect(() => {
    if (bookingMode === "choose") return;
    if (confirmation) return;
    const timer = window.setTimeout(() => {
      trackBookingFunnel("step_snapshot");
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookingMode,
    step,
    selectedMarketplaceShape.id,
    serviceAddress,
    addressCity,
    addressState,
    addressZip,
    contact.customerName,
    contact.customerPhone,
    contact.customerEmail,
    contact.notes,
    workerFields.assignedTo,
    workerFields.leadSource,
    workerFields.internalNotes,
    JSON.stringify(items),
    quote?.finalTotal,
    tokenError,
    confirmation,
  ]);

  const tokenSliderMax = useMemo(() => {
    const subtotal = quote?.subtotal ?? 0;
    if (subtotal <= 0) return 0;
    const tierCap = maxTokensForSubtotal(subtotal, customerTier);
    return Math.min(walletTokens, tierCap);
  }, [quote?.subtotal, customerTier, walletTokens]);

  useEffect(() => {
    if (applyTokens === 0) return;
    if (tokenSliderMax < MIN_REDEMPTION_TOKENS) {
      setApplyTokens(0);
      return;
    }
    if (applyTokens > tokenSliderMax) {
      const snapped = Math.floor(tokenSliderMax / REDEMPTION_INCREMENT) * REDEMPTION_INCREMENT;
      setApplyTokens(snapped < MIN_REDEMPTION_TOKENS ? 0 : snapped);
    }
  }, [tokenSliderMax, applyTokens]);

  // Task #181 — auto-uncheck "Pay from wallet" if cash drops below the
  // current total. The server has no partial-fallback today, so leaving
  // the box checked would just guarantee a 400 at submit.
  useEffect(() => {
    if (!payFromWallet) return;
    const total = quote?.finalTotal ?? 0;
    if (walletCash < total) setPayFromWallet(false);
  }, [walletCash, quote?.finalTotal, payFromWallet]);

  // ── Live quote (debounced + latest-wins to prevent stale-response races)
  // `quoteCartSig` records the cart signature the current `quote` represents.
  // Anything that reads `quote.bundleApplied` for behavior (the bundle popup)
  // must check `quoteCartSig === currentCartSig` first — otherwise we'd act
  // on a quote computed for a different cart shape.
  const cartSigOf = (xs: SelectedItem[]) =>
    xs.map(i => i.serviceCode).slice().sort().join(",");
  const [quoteCartSig, setQuoteCartSig] = useState<string>("");
  const quoteSeqRef = useRef(0);
  const quoteMutation = useMutation({
    mutationFn: async (payload: { seq: number; sig: string; payloadItems: SelectedItem[]; applyTokens: number }) => {
      const body: Record<string, unknown> = {
        serviceAddress: serviceAddress.trim() || undefined,
        requestedDate: payload.payloadItems
          .map((item) => item.details.requestedDate)
          .find(Boolean) || undefined,
        promoCode: attribution.promoCode || undefined,
        items: payload.payloadItems.map(i => ({
          serviceCode: i.serviceCode,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          priceMode: i.priceMode,
          label: i.label,
          details: i.details,
        })),
        source: "web_multi_book",
      };
      if (payload.applyTokens >= MIN_REDEMPTION_TOKENS) {
        body.applyTokens = payload.applyTokens;
        body.customerTier = customerTier;
      }
      try {
        const res = await apiRequest("POST", "/api/bookings/quote", body);
        const data = await res.json();
        return { seq: payload.seq, sig: payload.sig, data, error: null as string | null };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Quote failed";
        return { seq: payload.seq, sig: payload.sig, data: null, error: message };
      }
    },
    onSuccess: ({ seq, sig, data, error }) => {
      if (seq !== quoteSeqRef.current) return;
      if (error) {
        // apiRequest throws on non-2xx with `${status}: ${body}`. Strip
        // the status prefix and surface the server's message text.
        const m = error.match(/^\d+:\s*(.*)$/);
        let msg = m ? m[1] : error;
        try {
          const parsed = JSON.parse(msg);
          msg = parsed.message || parsed.error || msg;
        } catch { /* not json */ }
        setTokenError(msg);
        trackBookingFunnel("quote_error", { errorMessage: msg });
        return;
      }
      if (data?.quote) {
        setQuote(data.quote as QuoteResult);
        setQuoteCartSig(sig);
        setTokenError(null);
      }
    },
  });

  useEffect(() => {
    if (items.length === 0) { setQuote(null); setQuoteCartSig(""); return; }
    const t = setTimeout(() => {
      quoteSeqRef.current += 1;
      quoteMutation.mutate({
        seq: quoteSeqRef.current,
        sig: cartSigOf(items),
        payloadItems: items,
        applyTokens,
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(items),
    applyTokens,
    serviceAddress,
    attribution.promoCode,
    customerTier,
    activePricing.version,
  ]);

  // ── Item helpers
  const selectedCodes = useMemo(() => new Set(items.map(i => i.serviceCode)), [items]);

  function detailsWithMarketplaceShape(details: SelectedItem["details"], shapeId: MarketplaceRequestShapeId): SelectedItem["details"] {
    const shape = getMarketplaceRequestShape(shapeId);
    return {
      ...details,
      marketplaceShapeId: shape?.id || shapeId,
      marketplaceShape: shape?.shape || shapeId,
    };
  }

  function addService(svc: CatalogService) {
    const shapeId = selectedMarketplaceShapeId === "fast_quote" || selectedMarketplaceShapeId === "repeat_loop"
      ? selectedMarketplaceShapeId
      : marketplaceShapeForServiceCode(svc.code);
    setSelectedPriceMenuTaskId(null);
    setSelectedMarketplaceShapeId(shapeId);
    setItems(prev => {
      const existing = prev.find(i => i.serviceCode === svc.code);
      const next = existing || makeItem(svc);
      const nextItem = {
        ...next,
        details: detailsWithMarketplaceShape(next.details, shapeId),
      };
      return existing
        ? prev.map(i => i.serviceCode === svc.code ? nextItem : i)
        : [...prev, nextItem];
    });
  }

  function applyMarketplaceShape(shapeId: MarketplaceRequestShapeId) {
    setSelectedPriceMenuTaskId(null);
    setSelectedMarketplaceShapeId(shapeId);
    const targetCode = serviceCodeForMarketplaceShape(shapeId);
    const svc = targetCode ? services.find((entry) => entry.code === targetCode) : null;

    setItems(prev => {
      if (!svc) {
        return prev.map((item) => ({
          ...item,
          details: detailsWithMarketplaceShape(item.details, shapeId),
        }));
      }

      const existing = prev.find((item) => item.serviceCode === svc.code);
      const baseItem = existing || makeItem(svc);
      const baseEstimate = shapeId === "moving_help"
        ? calculateLaborBooking({ crewSize: 2, hours: 3, snapshot: activePricing }).laborTotal
        : 0;
      const shapedDetails: SelectedItem["details"] = {
        ...detailsWithMarketplaceShape(baseItem.details, shapeId),
        ...(shapeId === "moving_help" && !baseItem.details.packageId
          ? {
              packageId: "shape_default_2x3",
              packageLabel: "Common moving help package",
              crew: baseItem.details.crew || 2,
              hours: baseItem.details.hours || 3,
              minPrice: baseItem.details.minPrice || baseEstimate,
              maxPrice: baseItem.details.maxPrice || baseEstimate,
              inventoryCrewRecommendation: baseItem.details.inventoryCrewRecommendation || 2,
              inventoryLaborHours: baseItem.details.inventoryLaborHours || 3,
              inventoryPriceMin: baseItem.details.inventoryPriceMin || baseEstimate,
              inventoryPriceMax: baseItem.details.inventoryPriceMax || baseEstimate,
              quoteConfidence: baseItem.details.quoteConfidence || ("medium" as const),
            }
          : {}),
      };
      const nextItem: SelectedItem = {
        ...baseItem,
        details: shapedDetails,
        priceMode: svc.code === "moving" ? "quote" : baseItem.priceMode,
      };

      return existing
        ? prev.map((item) => item.serviceCode === svc.code ? nextItem : item)
        : [...prev, nextItem];
    });
    setBookingMode("builder");
  }

  function applyPriceMenuTask(task: ServicePriceMenuTask) {
    const svc = resolveCatalogService(services, task.serviceCode, task.label);
    const shape = getMarketplaceRequestShape(task.shapeId);
    const menuRange = formatServicePriceRange(task);
    const sourceSignal = sourceSignalForServicePriceMenuTask(task);
    const taskScope = priceMenuScope(task);
    const reviewNote = `Menu estimate only. Review before sold. Ops check: ${task.operationsSignal}`;
    const shapedDetails: SelectedItem["details"] = {
      marketplaceShapeId: task.shapeId,
      marketplaceShape: shape?.shape || task.shapeId,
      priceMenuTaskId: task.id,
      priceMenuCategory: task.categoryId,
      priceMenuRange: menuRange,
      priceMenuUnit: task.priceUnit,
      priceMenuCustomerNeeds: task.customerNeeds,
      priceMenuOperationsSignal: task.operationsSignal,
      priceMenuSourceSignal: sourceSignal,
      priceReviewRequired: true,
      priceMenuStatus: "estimate",
      scope: taskScope,
      notes: reviewNote,
      crew: task.defaultCrew,
      hours: task.defaultHours,
      minPrice: task.priceMin,
      maxPrice: task.priceMax,
      inventoryCrewRecommendation: task.defaultCrew,
      inventoryLaborHours: task.defaultHours,
      inventoryPriceMin: task.priceMin,
      inventoryPriceMax: task.priceMax,
      quoteConfidence: task.jobSize === "quote_review" ? "low" : "medium",
      jobSize: task.jobSize === "quote_review" ? "Quote review" : task.jobSize,
      ...(task.movingPath ? { movingPath: task.movingPath } : {}),
      ...(task.loadType ? { loadType: task.loadType } : {}),
      ...(task.serviceCode === "moving"
        ? {
            truckNeeded: false,
            truckSize: "Customer truck or container",
            packageId: `price_menu_${task.id}`,
            packageLabel: `${task.label} estimate (${menuRange})`,
          }
        : {}),
    };

    setSelectedPriceMenuTaskId(task.id);
    setSelectedMarketplaceShapeId(task.shapeId);
    setItems((prev) => {
      const existing = prev.find((item) => item.serviceCode === svc.code);
      const baseItem = existing || makeItem(svc);
      const nextItem: SelectedItem = {
        ...baseItem,
        label: task.label,
        unitPrice: task.priceMin,
        priceMode: "quote",
        details: {
          ...baseItem.details,
          ...shapedDetails,
        },
      };
      return existing
        ? prev.map((item) => item.serviceCode === svc.code ? nextItem : item)
        : [...prev, nextItem];
    });
    setBookingMode("builder");
    setStep(serviceAddress.trim() || addressZip ? "configure" : "address");
    toast({
      title: "Estimate path added",
      description: `${task.label} added as ${menuRange}. Staff reviews before final price.`,
    });
  }

  function applyMovingQuickPatch(
    details: Partial<SelectedItem["details"]>,
    description: string,
    nextStep: Step = "configure",
  ) {
    const svc = resolveCatalogService(services, "moving");
    setSelectedPriceMenuTaskId(null);
    setSelectedMarketplaceShapeId("moving_help");
    setItems((prev) => {
      const existing = prev.find((item) => item.serviceCode === svc.code);
      const baseItem = existing || makeItem(svc);
      const quickNote = details.notes;
      const nextDetails: SelectedItem["details"] = {
        ...detailsWithMarketplaceShape(baseItem.details, "moving_help"),
        ...details,
      };
      if (quickNote) {
        nextDetails.notes = appendQuickAnswerNote(baseItem.details.notes || "", quickNote);
      }
      const nextItem: SelectedItem = {
        ...baseItem,
        priceMode: "quote",
        unitPrice: typeof details.minPrice === "number" ? details.minPrice : baseItem.unitPrice,
        details: nextDetails,
      };
      return existing
        ? prev.map((item) => item.serviceCode === svc.code ? nextItem : item)
        : [...prev, nextItem];
    });
    setBookingMode("builder");
    setStep(nextStep);
    trackBookingFunnel("smart_guidance_option_selected");
    toast({ title: "Smart answer applied", description });
  }

  function applyPrimaryQuickNote(note: string, nextStep: Step = "configure") {
    const target = primaryMarketplaceItem;
    if (!target) {
      setContact((current) => ({
        ...current,
        notes: appendQuickAnswerNote(current.notes, note),
      }));
      setBookingMode("builder");
      setStep(nextStep);
      toast({ title: "Smart answer saved", description: note });
      return;
    }
    setItems((prev) => prev.map((item) => item.serviceCode === target.serviceCode
      ? { ...item, details: { ...item.details, notes: appendQuickAnswerNote(item.details.notes || "", note) } }
      : item));
    setBookingMode("builder");
    setStep(nextStep);
    trackBookingFunnel("smart_guidance_option_selected");
    toast({ title: "Smart answer saved", description: note });
  }

  function applySmartGuidanceOption(stepId: string, option: string) {
    const normalized = option.toLowerCase();

    if (stepId === "where_when") {
      if (normalized.includes("date flexible")) {
        setContact((current) => ({
          ...current,
          notes: appendQuickAnswerNote(current.notes, "Date flexible"),
        }));
      }
      setBookingMode("builder");
      setStep("address");
      trackBookingFunnel("smart_guidance_option_selected");
      toast({
        title: "Next: address and date",
        description: normalized.includes("date flexible")
          ? "Date flexibility saved. Add ZIP or address so we can price the zone."
          : "Add ZIP or address so we can price the zone fast.",
      });
      return;
    }

    if (stepId === "job_shape") {
      if (normalized.includes("delivery")) {
        applyMarketplaceShape("delivery_reuse");
        setStep("address");
        toast({ title: "Delivery path selected", description: "Pickup/drop-off and item details will size the card." });
        return;
      }
      if (normalized.includes("repeat")) {
        applyMarketplaceShape("repeat_loop");
        setStep("services");
        toast({ title: "Repeat work path selected", description: "Choose lawn, snow, junk, handyman, cleaning, or another route-ready service." });
        return;
      }
      if (normalized.includes("not sure")) {
        applyMarketplaceShape("fast_quote");
        setStep("services");
        toast({ title: "Quick quote path selected", description: "Pick the closest service or leave the details for quote review." });
        return;
      }
      const movingPath: SelectedItem["details"]["movingPath"] = normalized.includes("unload") && !normalized.includes("load +")
        ? "unload_only"
        : normalized.includes("load +") || normalized.includes("load /") || normalized.includes("load and")
          ? "load_unload"
          : "load_only";
      const loadType = movingPath === "unload_only"
        ? "Unload only"
        : movingPath === "load_unload"
          ? "Load + unload"
          : "Load only";
      applyMovingQuickPatch(
        {
          movingPath,
          loadType,
          jobSize: "Standard moving help",
        },
        `${loadType} saved. Next we need truck, package, date, and address.`,
        "address",
      );
      return;
    }

    if (stepId === "truck_context") {
      if (normalized.includes("customer truck") || normalized.includes("u-haul")) {
        applyMovingQuickPatch(
          {
            truckNeeded: false,
            truckSize: normalized.includes("u-haul") ? "U-Haul / rental truck" : "Customer truck",
            jobSize: "Standard moving help",
          },
          "Customer truck context saved.",
        );
        return;
      }
      if (normalized.includes("need jc")) {
        applyMovingQuickPatch(
          {
            truckNeeded: true,
            truckSize: "JC truck needed",
            jobSize: "Standard moving help",
            notes: "Customer may need JC truck.",
          },
          "JC truck need saved for quote review.",
        );
        return;
      }
      if (normalized.includes("trailer") || normalized.includes("storage") || normalized.includes("container")) {
        applyMovingQuickPatch(
          {
            truckNeeded: false,
            truckSize: normalized.includes("trailer") ? "Trailer" : "Storage/container",
            jobSize: "Standard moving help",
            notes: option,
          },
          `${option} saved for quote review.`,
        );
        return;
      }
      if (normalized.includes("stairs")) {
        applyMovingQuickPatch(
          {
            hasStairs: true,
            notes: "Stairs/access mentioned.",
          },
          "Stairs/access note saved.",
        );
        return;
      }
    }

    if (stepId === "smart_package") {
      if (normalized.includes("2 movers / 3")) {
        applyMovingQuickPatch(
          {
            ...movingPackageDetails(2, 3, "2 movers / 3 hours", activePricing),
            jobSize: "Standard moving help",
          },
          "Common 2 movers / 3 hours package selected.",
        );
        return;
      }
      if (normalized.includes("3 movers / 2")) {
        applyMovingQuickPatch(
          {
            ...movingPackageDetails(3, 2, "3 movers / 2 hours", activePricing),
            jobSize: "Standard moving help",
          },
          "Faster 3 movers / 2 hours package selected.",
        );
        return;
      }
      if (normalized.includes("2 movers / 2")) {
        applyMovingQuickPatch(
          {
            ...movingPackageDetails(2, 2, "2 movers / 2 hours", activePricing),
            jobSize: "Small moving help",
          },
          "Small 2 movers / 2 hours package selected.",
        );
        return;
      }
      applyMovingQuickPatch(
        {
          packageId: "quote_review",
          packageLabel: "Quote review - crew confirms",
          priceReviewRequired: true,
          quoteConfidence: "low" as const,
          notes: "Customer selected quote review instead of a standard package.",
        },
        "Quote review saved. Staff will confirm crew, hours, and final price.",
      );
      return;
    }

    if (stepId === "detail_capture") {
      if (normalized.includes("no extra")) {
        applyPrimaryQuickNote("No extra details added.");
        return;
      }
      applyPrimaryQuickNote(option);
      return;
    }

    if (stepId === "contact_recovery") {
      const preference = normalized.includes("email")
        ? "Preferred contact: email"
        : normalized.includes("call")
          ? "Preferred contact: call"
          : normalized.includes("help now")
            ? "Urgent request: needs help now"
            : "Preferred contact: text";
      setContact((current) => ({
        ...current,
        notes: appendQuickAnswerNote(current.notes, preference),
      }));
      setBookingMode("builder");
      setStep("contact");
      trackBookingFunnel("smart_guidance_option_selected");
      toast({ title: "Contact preference saved", description: preference });
      return;
    }

    applyPrimaryQuickNote(option);
  }

  function applySmartStart() {
    const raw = smartStartText.trim();
    if (!raw) {
      toast({
        title: "Add a job sentence first",
        description: "Example: unload a 26 ft U-Haul in 49938 on 7/4, 2 movers for 3 hours.",
        variant: "destructive",
      });
      return;
    }

    const inferred = inferSmartBookingText(raw);
    const serviceCode = serviceCodeFromSmartInference(inferred) || "moving";
    const inferredShapeId = marketplaceShapeForServiceCode(serviceCode);
    const svc = resolveCatalogService(services, serviceCode);

    setSelectedMarketplaceShapeId(inferredShapeId);
    const requestedDate = normalizeSmartDate(inferred.moveDate);
    const zip = inferred.fromZip?.slice(0, 5) || "";
    const movingPath = serviceCode === "moving" ? smartMovingPath(inferred) : undefined;
    const loadType = serviceCode === "moving" ? smartLoadType(inferred) : undefined;
    const truckNeeded = serviceCode === "moving" ? smartTruckNeeded(inferred) : undefined;
    const truckSize = serviceCode === "moving" ? smartTruckSize(inferred, movingPath) : undefined;
    const jobSize = serviceCode === "moving" ? smartJobSize(inferred) : undefined;
    const explicitCrew = Number(inferred.selectedMovingRecCrew);
    const explicitHours = Number(inferred.selectedMovingRecHours);
    const movingPlan = serviceCode === "moving"
      ? estimateMovingCrewHours({
          serviceType: "Moving",
          jobSize,
          homeSize: inferred.homeSize,
          truckSize: inferred.truckSize,
          selectedMovingRecLabel: inferred.selectedMovingRecLabel,
        })
      : null;
    const crew = serviceCode === "moving"
      ? (Number.isFinite(explicitCrew) && explicitCrew > 0 ? explicitCrew : movingPlan?.crew || 2)
      : undefined;
    const hours = serviceCode === "moving"
      ? (Number.isFinite(explicitHours) && explicitHours > 0 ? explicitHours : movingPlan?.hours || 3)
      : undefined;
    const baseEstimate = crew && hours
      ? calculateLaborBooking({ crewSize: crew, hours, snapshot: activePricing }).laborTotal
      : 0;

    setItems((prev) => {
      const existing = prev.find((item) => item.serviceCode === svc.code);
      const baseItem = existing || makeItem(svc);
      const nextDetails: SelectedItem["details"] = serviceCode === "moving"
        ? {
            ...detailsWithMarketplaceShape(baseItem.details, inferredShapeId),
            movingPath: movingPath || baseItem.details.movingPath,
            ...(loadType ? { loadType } : {}),
            ...(truckNeeded != null ? { truckNeeded } : {}),
            ...(truckSize ? { truckSize } : {}),
            ...(jobSize ? { jobSize } : {}),
            ...(requestedDate ? { requestedDate } : {}),
            ...(crew && hours
              ? {
                  packageId: "visual_inventory_estimate",
                  packageLabel: "Smart start crew estimate",
                  packageTier: undefined,
                  crew,
                  hours,
                  minPrice: baseEstimate,
                  maxPrice: baseEstimate,
                  inventoryCrewRecommendation: crew,
                  inventoryLaborHours: hours,
                  inventoryPriceMin: baseEstimate,
                  inventoryPriceMax: baseEstimate,
                  quoteConfidence: "medium" as const,
                }
              : {}),
          }
        : {
            ...detailsWithMarketplaceShape(baseItem.details, inferredShapeId),
            ...(requestedDate ? { requestedDate } : {}),
            notes: appendSmartNote(baseItem.details.notes || "", raw),
          };

      const nextItem: SelectedItem = {
        ...baseItem,
        quantity: 1,
        unitPrice: serviceCode === "moving" && baseEstimate ? Math.round(baseEstimate * 0.8) : baseItem.unitPrice,
        priceMode: serviceCode === "moving" ? "quote" : baseItem.priceMode,
        details: nextDetails,
      };

      return existing
        ? prev.map((item) => item.serviceCode === svc.code ? nextItem : item)
        : [...prev, nextItem];
    });

    if (zip) {
      setAddressZip(zip);
      if (!serviceAddress.trim()) setServiceAddress(zip);
    }
    setContact((current) => ({
      ...current,
      notes: appendSmartNote(current.notes, raw),
    }));
    setBookingMode("builder");
    setStep(zip || serviceAddress.trim() ? "configure" : "address");
    setSmartStartSummary(smartStartSummaryParts({
      serviceCode: svc.code,
      zip,
      date: requestedDate,
      loadType,
      truckSize,
      crew,
      hours,
    }));
    trackBookingFunnel("smart_start_applied");
    toast({
      title: "Smart start applied",
      description: "Review the details before you lock it in.",
    });
  }

  function startBuilder() {
    setBookingMode("builder");
    // A fresh customer must choose the actual service before the form asks
    // for an address or schedule. Do not seed a marketplace default and skip
    // required screens; URL-prefilled and worker flows populate themselves.
    setStep(items.length === 0 ? "services" : step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function removeService(code: string) {
    setItems(prev => prev.filter(i => i.serviceCode !== code));
  }
  function updateItem(next: SelectedItem) {
    setItems(prev => prev.map(i => i.serviceCode === next.serviceCode ? next : i));
  }
  function patchItemDetails(serviceCode: string, details: Partial<SelectedItem["details"]>) {
    setItems(prev => prev.map(i => i.serviceCode === serviceCode
      ? { ...i, details: { ...i.details, ...details } }
      : i));
  }
  function toggleSafetySpecial(item: SelectedItem, label: string) {
    const cur = item.details.specialItems || [];
    const next = cur.includes(label) ? cur.filter(s => s !== label) : [...cur, label];
    patchItemDetails(item.serviceCode, { specialItems: next, heavyItemsConfirmed: true });
  }

  // Task #207 — Resolve URL prefill against the live catalog the moment
  // the catalog query lands. Codes that don't exist in the catalog are
  // silently skipped (e.g. a chip that points at "painting" before the
  // catalog stocks it). Runs exactly once per page load using a ref so
  // the customer can later remove an auto-added service without it
  // bouncing back on the next render.
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    if (services.length === 0) return;
    if (
      urlPrefill.codes.length === 0 &&
      !urlPrefill.jumpStep &&
      !urlPrefill.serviceAddress &&
      !urlPrefill.requestedDate &&
      !urlPrefill.linePrice &&
      !urlPrefill.lineLabel &&
      !urlPrefill.marketplaceShapeId &&
      Object.keys(urlPrefill.lineDetails).length === 0
    ) {
      prefillAppliedRef.current = true;
      return;
    }
    let next = [...items];
    const prefillShapeId = urlPrefill.marketplaceShapeId
      || (urlPrefill.codes[0] ? marketplaceShapeForServiceCode(urlPrefill.codes[0]) : selectedMarketplaceShapeId)
      || selectedMarketplaceShapeId;
    if (urlPrefill.marketplaceShapeId) setSelectedMarketplaceShapeId(urlPrefill.marketplaceShapeId);
    for (const code of urlPrefill.codes) {
      const svc = services.find((s) => s.code === code);
      if (!svc) continue;
      if (!next.some((item) => item.serviceCode === svc.code)) {
        const item = makeItem(svc);
        next = [...next, { ...item, details: detailsWithMarketplaceShape(item.details, marketplaceShapeForServiceCode(svc.code)) }];
      }
    }

    const firstCode = urlPrefill.codes[0];
    if (firstCode) {
      next = next.map((item) => {
        if (item.serviceCode !== firstCode) return item;
        return {
          ...item,
          label: urlPrefill.lineLabel || item.label,
          unitPrice: urlPrefill.linePrice ?? item.unitPrice,
          details: detailsWithMarketplaceShape({
            ...item.details,
            ...(urlPrefill.requestedDate ? { requestedDate: urlPrefill.requestedDate } : {}),
            ...urlPrefill.lineDetails,
          }, prefillShapeId),
        };
      });
    }
    setItems(next);
    if (urlPrefill.serviceAddress) {
      setServiceAddress(urlPrefill.serviceAddress);
    }
    if (urlPrefill.jumpStep) {
      let resolvedStep = urlPrefill.jumpStep;
      if (!urlPrefill.serviceAddress && stepIndex(resolvedStep) >= stepIndex("address")) {
        resolvedStep = "address";
      }
      if (stepIndex(resolvedStep) >= stepIndex("configure") && next.some((item) => !!itemNeedsAttention(item))) {
        resolvedStep = "configure";
      }
      setStep(resolvedStep);
    }
    prefillAppliedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.length]);

  // ── Smart bundle popup ───────────────────────────────────────────────────
  // Compute the right suggestion (auto_applied or one_away), gated by a
  // shown-signature ref so the same dialog never re-pops for the same cart.
  const [suggestion, setSuggestion] = useState<BundleSuggestion | null>(null);
  const shownSigRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (step !== "review") return;
    if (items.length === 0 || allBundles.length === 0) return;
    let popupTimer: number | undefined;
    const cartCodes = new Set(items.map(i => i.serviceCode));
    const sortedCart = [...cartCodes].sort().join(",");
    // Wait until the live quote has caught up to the current cart shape.
    // Acting on a stale `quote.bundleApplied` would fire an auto_applied
    // popup for a cart that may no longer qualify — and would suppress
    // the correct one_away pitch for the new shape.
    if (quoteCartSig !== sortedCart) return;
    const appliedCode = quote?.bundleApplied?.code ?? null;
    const sig = `${sortedCart}|${appliedCode ?? ""}`;
    if (shownSigRef.current.has(sig)) return;

    // Mode 1 — auto_applied: a featured bundle is currently being applied.
    // Show one informational popup; do not pitch any other bundle.
    if (appliedCode) {
      const bundle = allBundles.find(b => b.code === appliedCode);
      if (bundle) {
        popupTimer = window.setTimeout(() => setSuggestion({
            mode: "auto_applied",
            bundle,
            savings: quote?.discountTotal ?? 0,
          }), 700);
        shownSigRef.current.add(sig);
      }
      return () => {
        if (popupTimer) window.clearTimeout(popupTimer);
      };
    }

    // Mode 2 — one_away: no bundle applied. Find a bundle where the cart
    // is a strict subset of its combo and exactly one service is missing.
    // Prefer the one with the largest expected discount.
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    let best: { bundle: FeaturedBundle; missingCode: string; expected: number } | null = null;

    for (const bundle of allBundles) {
      const combo = bundle.serviceComboJson;
      const allCartItemsInCombo = items.every(i => combo.includes(i.serviceCode));
      if (!allCartItemsInCombo) continue;
      const missing = combo.filter(c => !cartCodes.has(c));
      if (missing.length !== 1) continue;

      const expected = bundle.discountType === "percent"
        ? subtotal * (parseFloat(bundle.discountValue) / 100)
        : parseFloat(bundle.discountValue);
      if (!best || expected > best.expected) {
        best = { bundle, missingCode: missing[0], expected };
      }
    }

    if (best) {
      const missingSvc = services.find(s => s.code === best!.missingCode);
      if (missingSvc) {
        popupTimer = window.setTimeout(() => setSuggestion({ mode: "one_away", bundle: best.bundle, missing: missingSvc }), 700);
        shownSigRef.current.add(sig);
      }
    }
    return () => {
      if (popupTimer) window.clearTimeout(popupTimer);
    };
  }, [step, items, quote, allBundles, services]);

  useEffect(() => {
    if (step !== "review" && suggestion) setSuggestion(null);
  }, [step, suggestion]);

  function handleSuggestionAccept() {
    if (!suggestion) return;
    if (suggestion.mode === "one_away") {
      addService(suggestion.missing);
      toast({
        title: `${suggestion.bundle.name} unlocked`,
        description: "Discount will apply automatically.",
      });
    }
    setSuggestion(null);
  }

  // ── Submit (final step)
  const submitMutation = useMutation({
    mutationFn: async () => {
      // Task #169 — worker mode appends the crew-only fields to the notes
      // string and tags the source so admin/dispatch can filter on it.
      const workerNoteParts: string[] = [];
      if (isWorker && workerFields.assignedTo.trim()) workerNoteParts.push(`[CREW ASSIGN] ${workerFields.assignedTo.trim()}`);
      if (isWorker && workerFields.leadSource.trim()) workerNoteParts.push(`[LEAD SOURCE] ${workerFields.leadSource.trim()}`);
      if (isWorker && workerFields.internalNotes.trim()) workerNoteParts.push(`[INTERNAL] ${workerFields.internalNotes.trim()}`);
      const customerNotes = contact.notes.trim();
      const combinedNotes = [customerNotes, ...workerNoteParts].filter(Boolean).join("\n");

      const res = await apiRequest("POST", "/api/bookings", {
        items: items.map(i => ({
          serviceCode: i.serviceCode,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          priceMode: i.priceMode,
          label: i.label,
          details: i.details,
        })),
        customerName: contact.customerName.trim(),
        customerEmail: contact.customerEmail.trim() || undefined,
        customerPhone: contact.customerPhone.trim(),
        serviceAddress: serviceAddress.trim() || undefined,
        notes: combinedNotes || undefined,
        source: isWorker ? "crew_add_job" : "web_multi_book",
        sendConfirmationEmail: isWorker ? workerSendCustomerEmail : true,
        promoCode: attribution.promoCode || undefined,
        referralSlug: attribution.referralSlug || undefined,
        marketingCampaignId: attribution.marketingCampaignId || undefined,
        marketingTracking: attribution.marketingTracking,
        ...((() => {
          // Re-clamp at submit so a stale state value can never bypass
          // the slider's tier/wallet cap (defense in depth — the effect
          // above already normalises on cap changes).
          const capped = Math.min(applyTokens, tokenSliderMax);
          const snapped = Math.floor(capped / REDEMPTION_INCREMENT) * REDEMPTION_INCREMENT;
          return snapped >= MIN_REDEMPTION_TOKENS
            ? { applyTokens: snapped, customerTier }
            : {};
        })()),
        ...(payFromWallet ? { payFromWallet: true } : {}),
      });
      return res.json() as Promise<CreateBookingResponse>;
    },
    onSuccess: (data) => {
      if (data?.booking) {
        setConfirmation({
          ...data.booking,
          items: [...items],
          quote: data.quote,
          confirmationEmailSent: data.confirmationEmailSent,
        });
        trackBookingFunnel("submit_success", {
          bookingId: data.booking.id,
          leadId: data.lead?.id || null,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    onError: (err: Error) => {
      // Task #181 — if the server rejected wallet/token redemption,
      // surface the message inline in the wallet panel rather than
      // burying it in a toast that disappears.
      const raw = err.message || "";
      const m = raw.match(/^\d+:\s*(.*)$/);
      let parsed: { error?: string; message?: string } | null = null;
      try { parsed = JSON.parse(m ? m[1] : raw); } catch { /* not json */ }
      const errCode = parsed?.error || "";
      const isWalletRedemptionError = /wallet|token|redemption|insufficient|jcmoves/i.test(errCode + " " + (parsed?.message || ""));
      trackBookingFunnel("submit_error", {
        errorMessage: parsed?.message || parsed?.error || raw || "Booking submit failed",
      });
      if (isWalletRedemptionError) {
        setTokenError(parsed?.message || parsed?.error || "Wallet payment was rejected.");
        return;
      }
      toast({
        title: "Could not create booking",
        description: raw ? raw.slice(0, 200) : "Please try again or call us.",
        variant: "destructive",
      });
    },
  });

  // ── Per-step gate. Returns reason string when Continue should be disabled.
  function canContinueReason(): string | null {
    // Global guard: every step past services requires at least one item, in
    // case a user removes their last service after step 1 and tries to
    // proceed/submit (server requires items.length > 0 — would 400).
    if (items.length === 0) return "Add at least one service to continue";
    if (stepIndex(step) >= stepIndex("address")) {
      if (!serviceAddress.trim()) return "Enter the service address";
    }
    if (step !== "services") {
      for (const item of items) {
        const w = itemNeedsAttention(item);
        if (w) return `${item.label}: ${w.toLowerCase()}`;
      }
    }
    if (stepIndex(step) >= stepIndex("contact")) {
      if (!contact.customerName.trim()) return "Enter your full name";
      const phoneProblem = phoneError(contact.customerPhone);
      if (phoneProblem) return phoneProblem;
      const email = contact.customerEmail.trim();
      if (!email) return "Enter your email so we can confirm";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address";
    }
    if (step !== "services") {
      for (const item of items) {
        const w = safetyNeedsAttention(item);
        if (w) return `${item.label}: ${w.toLowerCase()}`;
      }
    }
    return null;
  }

  function goNext() {
    const reason = canContinueReason();
    if (reason) return;
    setStep(step === "services" ? "address" : "review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function goBack() {
    setStep(step === "review" ? "address" : "services");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Confirmation screen
  if (confirmation) {
    const c = confirmation;
    const finalTotal = Number(c.quote?.finalTotal ?? c.finalTotal ?? 0);
    const subtotal = Number(c.quote?.subtotal ?? finalTotal);
    const discount = Number(c.quote?.discountTotal ?? c.discountTotal ?? 0);
    const serviceAddressDiscountAmount = c.quote?.serviceAddressDiscount?.amount ?? 0;
    const bundleDiscountAmount = Math.max(0, discount - serviceAddressDiscountAmount);
    const crew = quoteCrewSize(c.quote, c.items);
    const confirmationPrimaryItem = c.items[0];
    const approvalOnlyConfirmation = c.items.some((item) => item.serviceCode === "moving" || item.serviceCode === "junk_removal");
    const trackUrl = c.customerEmail
      ? `/customer-login?intent=track&email=${encodeURIComponent(c.customerEmail)}`
      : "/customer-login?intent=track";
    const bookingReference = c.id ? `JOB-${c.id.slice(0, 8).toUpperCase()}` : "JOB REQUEST";
    const supportMessage = `Hi JC ON THE MOVE, I just submitted ${bookingReference}. Can you confirm the next step?`;
    const supportSmsHref = `sms:+19062859312?&body=${encodeURIComponent(supportMessage)}`;
    return (
      <div className="min-h-screen bg-background pb-16">
        <div className="max-w-2xl mx-auto px-4 pt-8">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 sm:p-6 space-y-5 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black">Service Request Submitted</h1>
              <p className="text-sm text-muted-foreground mt-2">
                {c.confirmationEmailSent
                  ? `A request receipt was emailed to ${c.customerEmail}.`
                  : "Your request is saved. A crew coordinator will review it next."}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Your crew coordinator will contact you shortly at {c.customerPhone} to confirm price and scheduling.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Fast scheduling • Local crew • Rewards earned automatically
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-left">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Booking reference</p>
              <p className="mt-1 text-2xl font-black tracking-normal">{bookingReference}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Mention this reference if you call or text before your coordinator reaches out.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
              <span className="flex items-center justify-center gap-1"><Shield className="h-3.5 w-3.5 text-emerald-500" /> Licensed</span>
              <span className="flex items-center justify-center gap-1"><Star className="h-3.5 w-3.5 text-yellow-500" /> 5-Star</span>
              <span className="flex items-center justify-center gap-1"><MapPin className="h-3.5 w-3.5 text-sky-500" /> Local Crew</span>
            </div>
            <div className="rounded-xl bg-card border border-border p-4 text-left space-y-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Service secured</p>
              {c.items.map((i, idx) => {
                const fallbackLinePrice = formatQuoteLinePrice(c.quote, i, idx, { fractionDigits: 2 });
                // Use index alignment so duplicate lines of the same service
                // get their own quote subtotal and reserved-crew details.
                const quoteLine = quoteLineForItem(c.quote, i, idx);
                const movingSummary = formatMovingFlowSummary(i);
                const resolvedLineSubtotal = typeof quoteLine?.lineSubtotal === "number"
                  ? quoteLine.lineSubtotal
                  : null;
                return (
                  <div key={i.serviceCode} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      {emojiFor(i.serviceCode)} {i.label}{formatRequestedSchedule(i.details) ? ` • ${formatRequestedSchedule(i.details)}` : ""}
                      {movingSummary.length > 0 && (
                        <span className="block text-[10px] font-normal text-muted-foreground" data-testid={`confirm-line-moving-${i.serviceCode}`}>
                          {movingSummary.join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="font-semibold text-right whitespace-nowrap">
                      {resolvedLineSubtotal !== null
                        ? `$${resolvedLineSubtotal.toFixed(2)}`
                        : fallbackLinePrice.text}
                      {(approvalOnlyConfirmation || fallbackLinePrice.isEstimate) && (
                        <span className="block text-[10px] font-normal text-muted-foreground">estimate · crew confirms</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {!approvalOnlyConfirmation && <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>}
              {!approvalOnlyConfirmation && bundleDiscountAmount > 0 && c.quote.bundleApplied && (
                <div className="flex justify-between text-sm text-emerald-500">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {c.quote.bundleApplied.name}</span>
                  <span>-${bundleDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              {!approvalOnlyConfirmation && c.quote.serviceAddressDiscount && (
                <div className="flex justify-between text-sm text-emerald-500">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {c.quote.serviceAddressDiscount.label}</span>
                  <span>-${c.quote.serviceAddressDiscount.amount.toFixed(2)}</span>
                </div>
              )}
              {!approvalOnlyConfirmation && c.quote.serviceAddressPricingAdjustment && (
                <div className="flex justify-between text-sm text-orange-500">
                  <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {c.quote.serviceAddressPricingAdjustment.label}</span>
                  <span>+${c.quote.serviceAddressPricingAdjustment.amount.toFixed(2)}</span>
                </div>
              )}
              {!approvalOnlyConfirmation && <div className="flex justify-between text-lg font-black pt-1">
                <span>Total</span>
                <span>${finalTotal.toFixed(2)}</span>
              </div>}
              {approvalOnlyConfirmation && (
                <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-blue-300">Saved estimate</p>
                    <p className="text-lg font-black text-white">${finalTotal.toFixed(2)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This saved estimate uses the same canonical pricing calculation shown on review. A specialist confirms scope before scheduling.
                  </p>
                </div>
              )}
              {!approvalOnlyConfirmation && <div className="rounded-lg border border-orange-500/25 bg-orange-500/10 p-3 text-sm">
                <p className="font-black text-orange-500">
                  You earned {c.tokenEstimate.toLocaleString()} JCMOVES Rewards
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Redeem toward future moves, junk removal, and more.
                </p>
              </div>}
              <div className="flex justify-between text-xs text-muted-foreground">
                {crew > 0 && <span><Users className="inline h-3 w-3" /> Crew reserved: {crew}</span>}
                <span>{approvalOnlyConfirmation ? "Specialist confirmation" : "Flat job estimate"}</span>
              </div>
            </div>
            <MarketplaceNextStepFlow
              side="customer"
              shapeId={selectedMarketplaceShape.id}
              serviceCode={confirmationPrimaryItem?.serviceCode || primaryMarketplaceItem?.serviceCode || null}
              serviceLabel={confirmationPrimaryItem?.label || primaryMarketplaceItem?.label || null}
              source={marketplaceSourceHint}
              compact
              className="text-left"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button className="w-full" onClick={() => setLocation(isWorker ? "/crew" : trackUrl)}>
                {isWorker ? "Return to Crew Planner" : "Track My Job"}
              </Button>
              <Button className="w-full" variant="outline" onClick={() => setLocation("/book")}>Book Another Service</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button className="w-full" variant="outline" asChild>
                <a href="tel:+19062859312">
                  <PhoneCall className="mr-2 h-4 w-4" />
                  Call JC
                </a>
              </Button>
              <Button className="w-full" variant="outline" asChild>
                <a href={supportSmsHref}>
                  <Phone className="mr-2 h-4 w-4" />
                  Text Reference
                </a>
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Wizard
  if (bookingMode === "quick") {
    return (
      <div className="min-h-screen bg-background text-foreground pb-12">
        <div className="border-b border-border px-4 py-3 sticky top-0 bg-background/95 backdrop-blur-sm z-30">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <button onClick={() => setBookingMode("choose")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Options
            </button>
            <h1 className="font-bold text-base sm:text-lg">Quick Request</h1>
            <a href="tel:+19062859312" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
          </div>
        </div>
        <QuickRequestForm
          services={services}
          onBuildQuote={startBuilder}
          onHome={() => setLocation("/")}
          attribution={attribution}
          initialServiceCode={urlPrefill.codes[0]}
        />
      </div>
    );
  }

  if (bookingMode === "choose" && !isWorker) {
    return (
      <div className="min-h-screen bg-background text-foreground pb-12">
        <div className="border-b border-border px-4 py-3 sticky top-0 bg-background/95 backdrop-blur-sm z-30">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <button onClick={() => setLocation("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Home
            </button>
            <h1 className="font-bold text-base sm:text-lg">Get Your Quote</h1>
            <a href="tel:+19062859312" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 pt-8">
          <div className="mb-6 max-w-2xl">
            <p className="text-xs font-black uppercase tracking-widest text-blue-500">Fast local help</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-black">Tell us what needs done.</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Pick the fastest path. Request a callback in 60 seconds or build a detailed quote with address, schedule, photos, and job scope.
            </p>
            {attributionSummary && (
              <p className="mt-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-600 dark:text-emerald-300">
                {attributionSummary}
              </p>
            )}
            {adHint && (
              <p className="mt-2 inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-600 dark:text-blue-300">
                From ad: {adHint}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button type="button" onClick={() => setBookingMode("quick")} className="text-left rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 sm:p-6 transition-all hover:border-emerald-400" data-testid="entry-quick-request">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-white">
                <PhoneCall className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-2xl font-black">Have someone call me</h2>
              <p className="mt-2 text-sm text-muted-foreground">60-second request. Name, phone, service, optional notes/photos. No pricing shown until a specialist quotes it.</p>
              <p className="mt-4 text-xs font-black uppercase tracking-wide text-emerald-500">Quick request - call required</p>
            </button>
            <button type="button" onClick={startBuilder} className="text-left rounded-2xl border border-blue-500/30 bg-blue-500/10 p-5 sm:p-6 transition-all hover:border-blue-400" data-testid="entry-build-quote">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
                <ClipboardList className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-2xl font-black">Build my quote</h2>
              <p className="mt-2 text-sm text-muted-foreground">Guided project paths for moving, junk, cleaning, and more. Moving starts with filtered cards before any detailed questions.</p>
              <p className="mt-4 text-xs font-black uppercase tracking-wide text-blue-500">Filtered quote builder - price range</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isLast = step === "review";
  const continueReason = canContinueReason();
  const isFirst = step === "services";
  const currentPhase = STEP_PHASES[step];
  const marketplaceActionPhase = marketplaceActionPhaseForStep(step);
  const phaseProgress = (currentPhase.number / 3) * 100;

  // Wizard nav rendered both inside the desktop summary panel and inside
  // the mobile docked summary bar so it's visible across all steps.
  const wizardNav = (
    <div className="space-y-2 w-full">
      {continueReason && (
        <p className="text-[11px] text-amber-500 flex items-start gap-1" data-testid="continue-reason">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {continueReason}
        </p>
      )}
      <div className="flex gap-2">
        {!isFirst && (
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            className="flex-1"
            data-testid="wizard-back"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        )}
        {isLast ? (
          <Button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || !!continueReason}
            className="flex-1"
            data-testid="wizard-confirm"
          >
            {submitMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Booking…</>
              : "Send booking request"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={goNext}
            disabled={!!continueReason}
            className="flex-1"
            data-testid="wizard-continue"
          >
            Continue <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-44 lg:pb-12">
      {/* Top bar */}
      <div className="border-b border-border px-4 py-3 sticky top-0 bg-background/95 backdrop-blur-sm z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <button onClick={() => setLocation("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-home">
            <ArrowLeft className="h-4 w-4" /> Home
          </button>
          <h1 className="font-bold text-base sm:text-lg">
            {isWorker ? "Add a Job (Crew)" : "Book Your Services"}
          </h1>
          <a href="tel:+19062859312" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        </div>
      </div>

      {/* Task #169 — worker-mode banner */}
      {isWorker && (
        <div className="max-w-6xl mx-auto px-4 pt-3" data-testid="banner-worker-mode">
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            <span>Crew mode — posting on behalf of a customer. Pricing & token estimate match the customer-facing flow exactly.</span>
          </div>
        </div>
      )}

      {/* Progress indicator */}
      <div className="max-w-6xl mx-auto px-4 pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-orange-500" data-testid="step-indicator">
            Part {currentPhase.number} of 3 · {currentPhase.label}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {currentPhase.detail}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-orange-500 transition-all duration-300"
            style={{ width: `${phaseProgress}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{STEP_LABELS[step]}</p>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-6 flex gap-6">
        <div className="flex-1 min-w-0 space-y-6 [&_input]:min-h-12 [&_input]:text-base [&_select]:min-h-12 [&_select]:text-base [&_textarea]:text-base [&_button]:min-h-11">
          {isWorker && step !== "review" && (
            <section className="rounded-2xl border border-blue-500/25 bg-blue-500/10 p-4" data-testid="smart-start-card">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-blue-400" /> Smart start
                    </h2>
                    <p className="text-xs text-muted-foreground">One sentence can fill the first pass.</p>
                  </div>
                  {smartStartSummary && (
                    <span className="hidden sm:inline rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                      Applied
                    </span>
                  )}
                </div>
                <Textarea
                  value={smartStartText}
                  onChange={(event) => setSmartStartText(event.target.value)}
                  placeholder="Example: unload a 26 ft U-Haul in 49938 on 7/4, 2 movers for 3 hours"
                  className="min-h-[76px]"
                  data-testid="smart-start-input"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    onClick={applySmartStart}
                    disabled={services.length === 0}
                    data-testid="smart-start-apply"
                  >
                    Apply Smart Start
                  </Button>
                  {smartStartSummary && (
                    <p className="text-[11px] text-muted-foreground break-words [overflow-wrap:anywhere]" data-testid="smart-start-summary">
                      {smartStartSummary}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Step 1 — Services */}
          {isWorker && step !== "review" && (
            <section data-testid="booking-marketplace-flow">
              <SmartRequestShapePicker
                selectedShapeId={selectedMarketplaceShapeId}
                onSelect={applyMarketplaceShape}
                className="mb-3"
              />
              <ServicePriceMenu
                activeShapeId={selectedMarketplaceShape.id}
                selectedTaskId={selectedPriceMenuTaskId}
                onSelectTask={applyPriceMenuTask}
                className="mb-3"
              />
              <SmartBookingGuidanceCard
                answers={smartBookingGuidanceAnswers}
                serviceLabel={primaryMarketplaceItem?.label || selectedMarketplaceShape.shape}
                compact
                nextOnly
                onQuickOption={applySmartGuidanceOption}
                className="mb-3"
              />
              <MarketplaceProcessGuide
                source={marketplaceSourceHint}
                shapeId={selectedMarketplaceShape.id}
                serviceCode={primaryMarketplaceItem?.serviceCode || null}
                serviceLabel={primaryMarketplaceItem?.label || null}
                audience={isWorker ? "worker" : "customer"}
                compact
                className="mb-3"
              />
              <MarketplaceSourceFlowStrip
                source={marketplaceSourceHint}
                shapeId={selectedMarketplaceShape.id}
                serviceCode={primaryMarketplaceItem?.serviceCode || null}
                serviceLabel={primaryMarketplaceItem?.label || null}
                audience={isWorker ? "worker" : "customer"}
                phase={marketplaceActionPhase}
                className="mb-3"
              />
              <MarketplaceShapeContext
                shapeId={selectedMarketplaceShape.id}
                serviceCode={primaryMarketplaceItem?.serviceCode || null}
                serviceLabel={primaryMarketplaceItem?.label || null}
                source={marketplaceSourceHint}
                audience={isWorker ? "worker" : "customer"}
                compact
                maxIdeas={0}
                maxFlows={1}
              />
            </section>
          )}

          {step === "services" && (
            <section data-testid="step-services">
              <header className="mb-3">
                <h2 className="text-xl font-black">What do you need?</h2>
                <p className="text-sm text-muted-foreground">Tap each service. We'll suggest a bundle if your selection qualifies.</p>
              </header>
              <ServiceSelector
                services={services}
                selectedCodes={selectedCodes}
                onAdd={addService}
                onRemove={removeService}
              />
            </section>
          )}

          {/* Step 2 — Address */}
          {step === "address" && (
            <section data-testid="step-address">
              <header className="mb-3">
                <h2 className="text-xl font-black">{hasMovingService ? "Where do you need help?" : "Where are we going?"}</h2>
                <p className="text-sm text-muted-foreground">
                  {hasMovingService
                    ? "Use the pickup address for load-only or full moves. For a full move, add the destination below."
                    : "The address where the work will happen."}
                </p>
              </header>
              <AddressField
                value={serviceAddress}
                onChange={setServiceAddress}
                city={addressCity}
                state={addressState}
                zip={addressZip}
                onCityChange={setAddressCity}
                onStateChange={setAddressState}
                onZipChange={setAddressZip}
                onResolved={(p) => setServiceAddress(p.fullAddress)}
                placeholder="123 Main St, Ironwood, MI"
                theme="zinc"
                hint="Pick a suggestion or just keep typing — we'll confirm the city, state, and ZIP automatically."
                disableGoogle
                data-testid="address-field-multi"
              />
            </section>
          )}

          {/* Step 3 — Configure each item (inline cards, no drawer) */}
          {step === "address" && (
            <section data-testid="step-configure">
              <header className="mb-3">
                <h2 className="text-xl font-black">Job details</h2>
                <p className="text-sm text-muted-foreground">Pick a date, frequency, and scope for every item before continuing.</p>
              </header>
              <div className="space-y-3">
                {items.map(item => (
                  <InlineItemConfigure
                    key={item.serviceCode}
                    item={item}
                    serviceAddress={serviceAddress}
                    onChange={updateItem}
                    onRemove={() => removeService(item.serviceCode)}
                    onRequestContinue={goNext}
                    warning={itemNeedsAttention(item) || safetyNeedsAttention(item)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Step 4 - Contact info */}
          {step === "review" && (
            <section data-testid="step-contact">
              <header className="mb-3">
                <h2 className="text-xl font-black">How do we reach you?</h2>
                <p className="text-sm text-muted-foreground">
                  {isWorker
                    ? "Add the customer's contact information for scheduling and follow-up."
                    : "We'll email your request receipt, then call or text to confirm scheduling."}
                </p>
              </header>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Full name</Label>
                  <Input
                    value={contact.customerName}
                    onChange={(e) => setContact(c => ({ ...c, customerName: e.target.value }))}
                    placeholder="Your full name"
                    data-testid="contact-name"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Phone</Label>
                    <Input
                      type="tel"
                      value={contact.customerPhone}
                      onChange={(e) => setContact(c => ({ ...c, customerPhone: e.target.value }))}
                      placeholder="Best phone number"
                      data-testid="contact-phone"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input
                      type="email"
                      value={contact.customerEmail}
                      onChange={(e) => setContact(c => ({ ...c, customerEmail: e.target.value }))}
                      placeholder="Best email address"
                      data-testid="contact-email"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Notes for the crew (optional)</Label>
                  <Textarea
                    value={contact.notes}
                    onChange={(e) => setContact(c => ({ ...c, notes: e.target.value }))}
                    placeholder="Anything not already covered in your service details"
                    rows={3}
                    data-testid="contact-notes"
                  />
                </div>
                {/* Task #169 — worker-mode-only fields */}
                {isWorker && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-3" data-testid="worker-fields">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">Crew-only details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Assign to crew member</Label>
                        <Input
                          value={workerFields.assignedTo}
                          onChange={(e) => setWorkerFields(w => ({ ...w, assignedTo: e.target.value }))}
                          placeholder="e.g. Marcus, Tina"
                          data-testid="worker-assigned-to"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Lead source</Label>
                        <Input
                          value={workerFields.leadSource}
                          onChange={(e) => setWorkerFields(w => ({ ...w, leadSource: e.target.value }))}
                          placeholder="door-knock · referral · repeat · walk-up"
                          data-testid="worker-lead-source"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Internal notes (crew-only)</Label>
                      <Textarea
                        value={workerFields.internalNotes}
                        onChange={(e) => setWorkerFields(w => ({ ...w, internalNotes: e.target.value }))}
                        placeholder="Site hazards, customer mood, pricing rationale — invisible to customer"
                        rows={2}
                        data-testid="worker-internal-notes"
                      />
                    </div>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-blue-500/20 bg-background/50 p-3">
                      <Checkbox
                        checked={workerSendCustomerEmail}
                        onCheckedChange={(checked) => setWorkerSendCustomerEmail(checked === true)}
                        data-testid="worker-send-confirmation-email"
                      />
                      <span className="text-xs leading-relaxed">
                        <strong className="block text-foreground">Email the customer a request receipt</strong>
                        <span className="text-muted-foreground">Sends the job summary and explains that price and scheduling still need coordinator confirmation.</span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Step 5 — Safety check */}
          {step === "address" && hasMovingService && (
            <section data-testid="step-safety">
              <header className="mb-3">
                <h2 className="text-xl font-black">Safety check</h2>
                <p className="text-sm text-muted-foreground">
                  Before final review, confirm there are no seriously heavy items or select them now so we send the right crew.
                </p>
              </header>
              <div className="space-y-3">
                {items.filter(item => item.serviceCode === "moving").map(item => {
                  const selected = item.details.specialItems || [];
                  const hasSelectedHeavy = selected.length > 0;
                  return (
                    <div key={item.serviceCode} className="rounded-2xl border border-border bg-card p-4 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black">{emojiFor(item.serviceCode)} {item.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            200 lb+ items, safes, pianos, pool tables, hot tubs, and large appliances must be marked for billing and safe handling.
                          </p>
                        </div>
                        {item.details.heavyItemsConfirmed && (
                          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => patchItemDetails(item.serviceCode, {
                          specialItems: [],
                          heavyItemsConfirmed: true,
                        })}
                        className={`w-full rounded-xl border px-3 py-3 text-left text-sm font-semibold transition-all ${
                          item.details.heavyItemsConfirmed && !hasSelectedHeavy
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                            : "border-border bg-background hover:border-emerald-500/40"
                        }`}
                        data-testid={`safety-no-heavy-${item.serviceCode}`}
                      >
                        No seriously heavy or specialty items on this project
                        <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                          Standard furniture and boxes only.
                        </span>
                      </button>

                      <div>
                        <Label className="text-xs">Select heavy / specialty items billed extra</Label>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {PICKER_SPECIAL_ITEMS.map(label => {
                            const active = selected.includes(label);
                            return (
                              <button
                                key={label}
                                type="button"
                                onClick={() => toggleSafetySpecial(item, label)}
                                className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${
                                  active
                                    ? "border-orange-400 bg-orange-500/20 text-orange-300"
                                    : "border-border bg-background hover:border-orange-500/40"
                                }`}
                                data-testid={`safety-heavy-${item.serviceCode}-${shortHeavyLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                              >
                                {shortHeavyLabel(label)}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Standard 200 lb+ items add $100. Specialty items and very heavy safes/pool tables are billed at the shown heavy-item rate and confirmed by the crew coordinator.
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 5 — Review */}
          {step === "review" && (
            <section data-testid="step-review">
              <header className="mb-3">
                <h2 className="text-xl font-black">Review &amp; confirm</h2>
                <p className="text-sm text-muted-foreground">Last look before we lock it in.</p>
              </header>
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Address</p>
                  <p className="text-sm leading-relaxed break-words [overflow-wrap:anywhere]">{serviceAddress}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Contact</p>
                  <p className="text-sm leading-relaxed break-words [overflow-wrap:anywhere]">{contact.customerName} · {contact.customerPhone} · {contact.customerEmail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isWorker
                      ? workerSendCustomerEmail ? "Customer request receipt will be emailed." : "Customer email is saved; no receipt will be sent."
                      : "Request receipt will be emailed after submission."}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Job shape</p>
                  <p className="text-sm leading-relaxed break-words [overflow-wrap:anywhere]">
                    {selectedMarketplaceShape.shape} - {selectedMarketplaceShape.references}
                  </p>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Services</p>
                  <div className="space-y-1.5">
                    {items.map((i, idx) => {
                      const linePrice = formatQuoteLinePrice(quote, i, idx, { fractionDigits: 2 });
                      const approvalOnlyLine = i.serviceCode === "moving" || i.serviceCode === "junk_removal";
                      // Use index alignment so duplicate lines of the same
                      // service get their own quote subtotal and crew details.
                      const quoteLine = quoteLineForItem(quote, i, idx);
                      const movingSummary = formatMovingFlowSummary(i);
                      return (
                        <div key={i.serviceCode} className="flex justify-between text-sm">
                          <span className="min-w-0 pr-2">
                            {emojiFor(i.serviceCode)} {i.label}
                            {formatRequestedSchedule(i.details) ? ` · ${formatRequestedSchedule(i.details)}` : i.details.callToSchedule ? " · we'll call" : ""}
                            {i.details.frequency ? ` · ${i.details.frequency}` : ""}
                            {movingSummary.length > 0 && (
                              <span className="block text-[10px] font-normal text-muted-foreground" data-testid={`review-line-moving-${i.serviceCode}`}>
                                {movingSummary.join(" · ")}
                              </span>
                            )}
                          </span>
                          <span className="font-semibold whitespace-nowrap text-right">
                            {approvalOnlyLine && !quoteLine ? "Quote review" : linePrice.text}
                            {(approvalOnlyLine || linePrice.isEstimate) && (
                              <span className="block text-[10px] font-normal text-muted-foreground">estimate · crew confirms</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {hasMovingService && (
                  <div className="border-t border-border pt-3">
                    <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-cyan-300">Canonical booking estimate</p>
                          {quoteMutation.isPending ? (
                            <p className="mt-1 text-sm font-bold text-cyan-100">Updating the quote...</p>
                          ) : quote ? (
                            <>
                              <p className="mt-1 text-lg font-black text-white">
                                ${quote.finalTotal.toFixed(2)}
                              </p>
                              <p className="mt-1 text-[11px] font-semibold text-cyan-100" data-testid="moving-rate-source">
                                {quote.pricingAdjustments?.rateSource === "movinghelper_special"
                                  ? quote.pricingAdjustments.insideBubble === false
                                    ? "MovingHelper Special-zone pricing · beyond 50 miles"
                                    : "MovingHelper Special-zone pricing · route verification pending"
                                  : "Local canonical pricing"}
                              </p>
                              {(() => {
                                const movingIndex = items.findIndex((item) => item.serviceCode === "moving");
                                const labor = movingIndex >= 0 ? quote.items[movingIndex]?.laborMeta : undefined;
                                return labor ? (
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    {labor.crewSize} movers - {labor.laborHours} billable hours - ${labor.ratePerHour}/mover/hr
                                  </p>
                                ) : null;
                              })()}
                              {(quote.discountTotal > 0 || quote.pricingAdjustments) && (
                                <p className="mt-1 text-[11px] text-cyan-100/80">
                                  {quote.discountTotal > 0 ? `Discounts -$${quote.discountTotal.toFixed(2)}` : "No discount"}
                                  {quote.pricingAdjustments
                                    ? ` - zone/weekend adjustment ${quote.pricingAdjustments.compoundedMultiplier.toFixed(3)}x`
                                    : " - standard zone"}
                                </p>
                              )}
                              {quote.travelEligibility?.requiresOwner && (
                                <p className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-100">
                                  Manual review required before this estimate can become a final approved quote.
                                  {quote.travelEligibility.reasons[quote.travelEligibility.reasons.length - 1]
                                    ? ` ${quote.travelEligibility.reasons[quote.travelEligibility.reasons.length - 1]}`
                                    : ""}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="mt-1 text-sm font-bold text-cyan-100">
                              The estimate appears after crew, hours, and address details are selected.
                            </p>
                          )}
                        </div>
                        <MapPin className="h-5 w-5 shrink-0 text-cyan-300" />
                      </div>
                      <p className="mt-2 text-[11px] text-cyan-100/80">
                        This is the same server-calculated quote that is recomputed and saved when you submit. A coordinator still confirms scope and schedule.
                      </p>
                    </div>
                  </div>
                )}
                {quote && !hasApprovalOnlyQuoteItems && (
                  <div className="border-t border-border pt-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>${quote.subtotal.toFixed(2)}</span>
                    </div>
                    {quote.discountTotal > 0 && quote.bundleApplied && (
                      <div className="flex justify-between text-sm text-emerald-500">
                        <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {quote.bundleApplied.name}</span>
                        <span>−${quote.discountTotal.toFixed(2)}</span>
                      </div>
                    )}
                    {quote.tokenRedemption && quote.tokenRedemption.discountUsd > 0 && (
                      <div className="flex justify-between text-sm text-orange-500" data-testid="line-token-redemption">
                        <span className="flex items-center gap-1">
                          <Coins className="h-3 w-3" /> {quote.tokenRedemption.tokens.toLocaleString()} JCMOVES applied
                        </span>
                        <span>−${quote.tokenRedemption.discountUsd.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold pt-1 border-t border-border">
                      <span>Total</span>
                      <span>${quote.finalTotal.toFixed(2)}</span>
                    </div>
                    <p className="text-[11px] text-orange-400 text-right pt-1">
                      <Coins className="inline h-3 w-3" /> +{quote.tokenEstimate} JCMOVES on completion
                    </p>
                  </div>
                )}
                {hasApprovalOnlyQuoteItems && (
                  <div className="border-t border-border pt-3">
                    <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3">
                      <p className="text-sm font-black text-blue-300">Quote being reviewed</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        We saved the inventory and scheduling details. A specialist confirms the final price before scheduling.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <PhoneRewardsEnrollment phone={contact.customerPhone} crew={isWorker} />
              {/* Task #181 — Wallet & JCMOVES token redemption */}
              {user && walletData && !hasApprovalOnlyQuoteItems && (() => {
                const subtotalForCap = quote?.subtotal ?? 0;
                const tierCap = subtotalForCap > 0
                  ? maxTokensForSubtotal(subtotalForCap, customerTier)
                  : 0;
                const sliderMax = tokenSliderMax;
                const canRedeem = sliderMax >= MIN_REDEMPTION_TOKENS;
                const cashShort = walletCash < (quote?.finalTotal ?? 0);
                return (
                  <div className="mt-4 rounded-2xl border border-border bg-card p-4 space-y-4" data-testid="wallet-panel">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Your JCMOVES wallet</p>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{customerTier}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">USD credit</p>
                        <p className="font-bold text-lg" data-testid="wallet-cash-balance">${walletCash.toFixed(2)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-3">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">JCMOVES tokens</p>
                        <p className="font-bold text-lg flex items-center gap-1" data-testid="wallet-token-balance">
                          <Coins className="h-4 w-4 text-orange-500" /> {walletTokens.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={payFromWallet}
                        onCheckedChange={(c) => setPayFromWallet(!!c)}
                        disabled={walletCash <= 0 || cashShort}
                        data-testid="checkbox-pay-from-wallet"
                      />
                      <span className="leading-tight">
                        <span className="font-semibold">Pay from wallet</span>
                        <span className="block text-xs text-muted-foreground">
                          {walletCash <= 0
                            ? "No USD credit available. Add credit on the Wallet page."
                            : cashShort
                              ? `Need $${(quote?.finalTotal ?? 0).toFixed(2)} — wallet only has $${walletCash.toFixed(2)}. Top up to pay from wallet.`
                              : "Use your JCMOVES USD credit instead of a card."}
                        </span>
                      </span>
                    </label>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Apply JCMOVES tokens</Label>
                        <span className="text-xs font-mono" data-testid="token-slider-value">
                          {applyTokens.toLocaleString()} = ${tokensToDollars(applyTokens).toFixed(2)}
                        </span>
                      </div>
                      {canRedeem ? (
                        <>
                          <Slider
                            min={0}
                            max={sliderMax}
                            step={REDEMPTION_INCREMENT}
                            value={[Math.min(applyTokens, sliderMax)]}
                            onValueChange={(v) => {
                              const raw = v[0] ?? 0;
                              const snapped = Math.floor(raw / REDEMPTION_INCREMENT) * REDEMPTION_INCREMENT;
                              setApplyTokens(snapped < MIN_REDEMPTION_TOKENS ? 0 : snapped);
                            }}
                            data-testid="slider-apply-tokens"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Max {sliderMax.toLocaleString()} JCMOVES (your {customerTier} tier covers up to{" "}
                            ${tokensToDollars(tierCap).toFixed(2)} of this job).
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground" data-testid="token-cap-too-low">
                          {walletTokens < MIN_REDEMPTION_TOKENS
                            ? `Need at least ${MIN_REDEMPTION_TOKENS.toLocaleString()} JCMOVES to redeem (you have ${walletTokens.toLocaleString()}).`
                            : `Subtotal too low to redeem tokens at your ${customerTier} tier.`}
                        </p>
                      )}
                      {tokenError && (
                        <p className="text-[11px] text-red-500 flex items-start gap-1" data-testid="token-error">
                          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {tokenError}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {!user && (
                <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="wallet-signin-hint">
                  <Coins className="inline h-3 w-3 mr-1 text-orange-500" />
                  Sign in to pay from your JCMOVES wallet or apply your tokens.
                </div>
              )}
            </section>
          )}

        </div>

        <BookingSummarySticky
          items={items}
          quote={quote}
          isQuoting={quoteMutation.isPending}
          onCheckout={() => { /* unused in wizard mode */ }}
          canCheckout={items.length > 0}
          showPricing={step === "review" && !hasApprovalOnlyQuoteItems}
          bottomSlot={wizardNav}
        />
      </div>

      <BundleSuggestionDialog
        suggestion={suggestion}
        services={services}
        onAccept={handleSuggestionAccept}
        onClose={() => setSuggestion(null)}
      />
    </div>
  );
}
