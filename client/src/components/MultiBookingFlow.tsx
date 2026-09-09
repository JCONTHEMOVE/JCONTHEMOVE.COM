// Components for the multi-service /book flow (Task #129).
// All five components live in one file to keep the new flow focused and easy
// to evolve as a unit. Page (`/book`) composes them.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Plus, Minus, Tag, Coins, Users, ChevronUp, ChevronDown,
  Sparkles, Trash2, Pencil, AlertCircle, PhoneCall, Package, Loader2, MapPin,
  Home, Truck, Armchair, Wrench, Dumbbell, Bed, Sofa, Boxes, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { JOB_SCHEDULE_OPTIONS, jobScheduleLabelForStart } from "@shared/jcOperations";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import {
  BUNDLE_SCHEDULING_MODE,
  BUNDLE_FREQUENCY_OPTIONS,
  type BundleSchedulingMode,
} from "@/components/BundleServiceScheduler";
import {
  computeMovingQuote, computeJunkQuote, buildCrewPackages,
  type Answers, type CrewPackage,
} from "@/components/booking-chatbot";
import {
  calculateJcTruckRentalFee,
  JC_TRUCK_EXTRA_MILE_RATE,
  JC_TRUCK_INCLUDED_MILES,
} from "@shared/movingTruckPricing";
import {
  CANONICAL_PRICING_2026_08,
  calculateMovingLabor,
  calculateRateCardLine,
  type CanonicalPricingSnapshot,
} from "@shared/canonicalPricing";

export interface CatalogService {
  id: string;
  code: string;
  name: string;
  category: "core" | "addon" | string;
  defaultPriceMode: "fixed" | "hourly" | "per_unit" | "quote" | string;
  defaultPrice: string | null;
  suggestedMin: string | null;
  suggestedMax: string | null;
  discountEligible: boolean;
  isAddon: boolean;
  description: string | null;
}

export interface FeaturedBundle {
  id: string;
  code: string;
  name: string;
  description: string | null;
  serviceComboJson: string[];
  discountType: "percent" | "fixed" | string;
  discountValue: string;
  maxDiscount: string | null;
  merchandisingSlot: string | null;
}

export interface SelectedItem {
  serviceCode: string;
  label: string;
  quantity: number;
  unitPrice: number;
  priceMode: "fixed" | "hourly" | "per_unit" | "quote";
  details: {
    requestedDate?: string;
    requestedStartTime?: string;
    frequency?: string;
    callToSchedule?: boolean;
    notes?: string;
    scope?: string;
    marketplaceShapeId?: string;
    marketplaceShape?: string;
    priceMenuTaskId?: string;
    priceMenuCategory?: string;
    priceMenuRange?: string;
    priceMenuUnit?: string;
    priceMenuCustomerNeeds?: string[];
    priceMenuOperationsSignal?: string;
    priceMenuSourceSignal?: string;
    priceReviewRequired?: boolean;
    priceMenuStatus?: "estimate" | "menu_price";
    // Task #141: Moving / Junk Removal package picker snapshot — mirrors the
    // data the booking chatbot captures so the cart line carries the chosen
    // crew size, hours, tier, and any customer-entered promo code.
    packageId?: string;
    packageLabel?: string;
    packageTier?: string;
    crew?: number;
    hours?: number;
    minPrice?: number;
    maxPrice?: number;
    movingPath?: "tiny_items" | "load_only" | "unload_only" | "load_unload" | "full_household" | "heavy_specialty" | "packing_assembly";
    jobSize?: string;
    loadType?: string;
    truckNeeded?: boolean;
    truckSize?: string;
    truckFee?: number;
    truckBaseFee?: number;
    truckMileageFee?: number;
    truckIncludedMiles?: number;
    truckExtraMiles?: number;
    truckExtraMileRate?: number;
    hasStairs?: boolean;
    specialItems?: string[];
    heavyItemsConfirmed?: boolean;
    promoCode?: string;
    dropoffAddress?: string;
    verifiedDriveMiles?: number;
    estimatedDriveMinutes?: number;
    driveEstimateNote?: string;
    inventoryItems?: Array<{
      id: string;
      label: string;
      category: string;
      size?: string;
      quantity: number;
      laborHours: number;
    }>;
    inventoryLaborHours?: number;
    inventoryDifficulty?: number;
    inventoryTruckRecommendation?: string;
    inventoryCrewRecommendation?: number;
    inventoryPriceMin?: number;
    inventoryPriceMax?: number;
    quoteConfidence?: "low" | "medium" | "high";
    junkSizingMethod?: "truck_load" | "room_cleanout" | "item_by_item";
    junkLoadTier?: "tiny" | "small" | "medium" | "large";
    junkLoadFraction?: number;
    junkItems?: Array<{
      id: string;
      label: string;
      category: string;
      quantity: number;
      loadFraction: number;
      extraFee?: number;
      specialistReview?: boolean;
    }>;
    junkExtraFeeEstimate?: number;
    junkDifficulty?: number;
    junkConfidence?: "low" | "medium" | "high";
    junkConstructionReview?: boolean;
    // Task #144 — Trash Valet add-on flag captured from the bundled-cart UI
    // so the admin can see the customer wants the recycling can rolled too.
    recyclingEnabled?: boolean;
    // Task #146 — Trash Valet subscription details captured from the bundled
    // cart so the admin pipeline can auto-provision the subscription without
    // a follow-up phone call.
    cans?: number;
    bagCount?: number;
    serviceDayOfWeek?: number;
    recyclingDayOfWeek?: number;
    recyclingAnchorDate?: string;
    planType?: "monthly" | "yearly";
    // Roofing quote-helper snapshot. Stored on the booking item so ops can
    // see exactly what estimate inputs produced the prefilled price.
    roofSquares?: number;
    roofAreaSqFt?: number;
    roofingCurrentType?: string;
    roofingStories?: string;
    roofingPitch?: string;
    roofingTearOff?: string;
    roofingMaterials?: string;
    fastSchedule?: boolean;
    premiumIceShield?: boolean;
  };
}

/** Service codes that should drive their own package-picker UI in the
 *  wizard (instead of the generic flat-price card). */
export function usesPackagePicker(code: string): boolean {
  return code === "moving" || code === "junk_removal";
}

/** Resolve the per-service scheduling pattern, mirroring BundleServiceScheduler.
 *  Services not in the explicit map default to date-only (most jobs are
 *  per-event scheduling). */
export function schedulingModeFor(code: string): BundleSchedulingMode {
  return BUNDLE_SCHEDULING_MODE[code] ?? "date_only";
}

/** Task #218 — labor breakdown the chat card and wizard cart read off
 *  each quoted line. Mirrors BookingPricingItemInput["laborMeta"] on the
 *  server. */
export interface QuoteLaborMeta {
  crewSize: number;
  laborHours: number;
  totalLaborHours: number;
  ratePerHour: number;
}

export interface QuoteResult {
  subtotal: number;
  discountTotal: number;
  finalTotal: number;
  tokenEstimate: number;
  bundleApplied: { code: string; name: string; rawDiscount: number } | null;
  serviceAddressDiscount?: {
    code: string;
    label: string;
    reason: string;
    discountPercent: number;
    amount: number;
  };
  serviceAddressPricingAdjustment?: {
    type: "out_of_town" | "non_discount_day";
    label: string;
    reason: string;
    multiplier: number;
    surchargePercent: number;
    amount: number;
  };
  serviceAddressDiscountHint?: {
    eligible: boolean;
    code: string | null;
    label: string | null;
    reason: string;
    discountPercent: number;
    priceMultiplier?: number;
  };
  pricingAdjustments?: {
    insideBubble: boolean | null;
    rateSource?: "local_canonical" | "movinghelper_special";
    geographicMultiplier: number;
    geographicAmount: number;
    weekendMultiplier: number;
    weekendAmount: number;
    compoundedMultiplier: number;
  };
  travelEligibility?: {
    status: "local" | "extended_auto" | "owner_review" | "out_of_range" | "unverified";
    requiresOwner: boolean;
    canApprove: boolean;
    reasons: string[];
  };
  items: Array<{ serviceCode: string; lineSubtotal: number; laborMeta?: QuoteLaborMeta }>;
  tokenRedemption?: { tokens: number; discountUsd: number };
}

interface DriveEstimateResult {
  miles: number;
  estimatedMinutes?: number;
  farthestStopMilesFromIronwood?: number;
  insideBubble?: boolean;
  note?: string;
  error?: string;
}

const SERVICE_EMOJI: Record<string, string> = {
  moving: "📦",
  junk_removal: "🗑️",
  lawn_care: "🌿",
  trash_valet: "♻️",
  window_cleaning: "🪟",
  snow_removal: "❄️",
  cleaning: "🧼",
  move_cleaning: "🧼",
  roofing: "🏠",
  demolition: "🛠️",
  handyman: "🔧",
  labor: "💪",
  delivery: "🚚",
  junk_reset: "♻️",
  assembly_finish: "🛠️",
  deep_clean_turnover: "✨",
  walkway_priority: "🥾",
  assembly: "🔩",
};

const CREW_HINT: Record<string, number> = {
  moving: 3,
  junk_removal: 2,
  cleaning: 2,
  deep_clean_turnover: 2,
  snow_removal: 2,
  lawn_care: 2,
  window_cleaning: 2,
  roofing: 3,
  demolition: 3,
  move_cleaning: 2,
  trash_valet: 1,
  handyman: 1,
  labor: 2,
  delivery: 2,
  junk_reset: 2,
  assembly_finish: 2,
  assembly: 1,
  walkway_priority: 1,
};

export function emojiFor(code: string): string {
  return SERVICE_EMOJI[code] || "🧰";
}

export function recommendedCrewSize(items: SelectedItem[]): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map(i => CREW_HINT[i.serviceCode] ?? 2));
}

export function priceModeLabel(mode: string, unit: number): string {
  switch (mode) {
    case "hourly": return `$${unit}/hr`;
    case "per_unit": return `$${unit}/unit`;
    case "quote": return "Custom quote";
    default: return `$${unit}`;
  }
}

/** Task #211 — Painting & Flooring lines come back priced (server runs the
 *  chatbot questionnaire through services/quoteRules/) but the catalog
 *  still flags them priceMode="quote" so we can tag them as a
 *  crew-confirmed estimate rather than a binding rack price. Hides the
 *  bare "TBD" copy when we have a real number. */
export const ESTIMATE_SERVICE_CODES = new Set([
  "painting",
  "flooring",
  "roofing",
  "lawn_care",
  "snow_removal",
  "demolition",
]);
export function formatLinePrice(
  item: { serviceCode: string; quantity: number; unitPrice: number; priceMode: string },
  opts: { fractionDigits?: number } = {},
): { text: string; isEstimate: boolean } {
  const digits = opts.fractionDigits ?? 0;
  const total = item.quantity * item.unitPrice;
  if (item.priceMode === "quote") {
    if (ESTIMATE_SERVICE_CODES.has(item.serviceCode) && total > 0) {
      return { text: `$${total.toFixed(digits)}`, isEstimate: true };
    }
    return { text: "TBD", isEstimate: false };
  }
  return { text: `$${total.toFixed(digits)}`, isEstimate: false };
}

export function quoteLineForItem(quote: QuoteResult | null | undefined, item: { serviceCode: string }, idx: number) {
  const line = quote?.items?.[idx];
  return line?.serviceCode === item.serviceCode ? line : undefined;
}

export function formatQuoteLinePrice(
  quote: QuoteResult | null | undefined,
  item: { serviceCode: string; quantity: number; unitPrice: number; priceMode: string },
  idx: number,
  opts: { fractionDigits?: number } = {},
): { text: string; isEstimate: boolean } {
  const digits = opts.fractionDigits ?? 0;
  const quoteLine = quoteLineForItem(quote, item, idx);
  if (typeof quoteLine?.lineSubtotal === "number") {
    return { text: `$${quoteLine.lineSubtotal.toFixed(digits)}`, isEstimate: ESTIMATE_SERVICE_CODES.has(item.serviceCode) };
  }
  return formatLinePrice(item, opts);
}

export function quoteCrewSize(quote: QuoteResult | null | undefined, items: SelectedItem[]): number {
  const quotedCrew = quote?.items
    ?.map((line) => line.laborMeta?.crewSize || 0)
    .filter((crew) => crew > 0);
  if (quotedCrew && quotedCrew.length > 0) return Math.max(...quotedCrew);
  return recommendedCrewSize(items);
}

export function formatReservedCrewSubline(meta?: QuoteLaborMeta): string | null {
  if (!meta?.crewSize || !meta?.laborHours) return null;
  const movers = `${meta.crewSize} mover${meta.crewSize === 1 ? "" : "s"}`;
  const hours = `${meta.laborHours} hour${meta.laborHours === 1 ? "" : "s"}`;
  return `${movers} • ${hours} • Minimum crew reserved`;
}

export function formatLineLaborSubline(meta?: QuoteLaborMeta): string | null {
  if (!meta) return null;
  if (!meta.crewSize || meta.crewSize <= 0) return null;
  if (!meta.laborHours || meta.laborHours <= 0) return null;
  const crewWord = meta.crewSize === 1 ? "person" : "people";
  const hrsLabel = Number.isInteger(meta.laborHours)
    ? `${meta.laborHours}`
    : meta.laborHours.toFixed(1);
  return `${meta.crewSize} ${crewWord} × ${hrsLabel} hrs at $${meta.ratePerHour}/hr`;
}

export function formatMovingFlowSummary(item: SelectedItem): string[] {
  if (item.serviceCode !== "moving") return [];
  const bits: string[] = [];
  if (item.details.movingPath) {
    const path = MOVING_PATHS.find((p) => p.id === item.details.movingPath);
    if (path) bits.push(path.label);
  }
  if (item.details.scope?.trim()) bits.push(item.details.scope.trim());
  if (item.details.loadType) bits.push(item.details.loadType.replace(/^.[^\w]?\s*/, ""));
  if (item.details.truckNeeded === true) {
    bits.push(item.details.truckSize ? `JC truck: ${item.details.truckSize}` : "JC provides truck");
  } else if (item.details.truckNeeded === false) {
    bits.push("Customer truck");
  }
  if (item.details.dropoffAddress?.trim()) bits.push(`Drop-off set`);
  if (item.details.verifiedDriveMiles && item.details.estimatedDriveMinutes) {
    bits.push(`~${Math.round(item.details.verifiedDriveMiles)} mi · ~${item.details.estimatedDriveMinutes} min`);
  }
  return bits;
}

export function formatStartTime(value?: string): string {
  if (!value) return "";
  if (value === "flexible") return "Flexible / TBD";
  const sharedLabel = jobScheduleLabelForStart(value);
  if (sharedLabel !== value) return sharedLabel;
  const [hourRaw, minuteRaw = "00"] = value.split(":");
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minuteRaw.padStart(2, "0")} ${suffix}`;
}

export function formatRequestedSchedule(details: SelectedItem["details"]): string {
  return [
    details.requestedDate,
    details.requestedStartTime ? formatStartTime(details.requestedStartTime) : "",
  ].filter(Boolean).join(" • ");
}

function PreferredScheduleFields({
  date,
  startTime,
  onChange,
  dateLabel = "Preferred date",
  timeLabel = "Preferred start time",
  dateTestId,
  timeTestId,
}: {
  date?: string;
  startTime?: string;
  onChange: (next: { requestedDate?: string; requestedStartTime?: string }) => void;
  dateLabel?: string;
  timeLabel?: string;
  dateTestId?: string;
  timeTestId?: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{dateLabel}</Label>
        <DatePicker
          value={date}
          onChange={(v) => onChange({ requestedDate: v || undefined, requestedStartTime: startTime })}
          placeholder="Pick a date"
          testId={dateTestId}
        />
      </div>
      <div>
        <Label className="text-xs flex items-center gap-1.5">
          <Clock className="h-3 w-3" /> {timeLabel}
        </Label>
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5" data-testid={timeTestId ? `${timeTestId}-chips` : undefined}>
          {JOB_SCHEDULE_OPTIONS.map((opt) => {
            const value = opt.start || "flexible";
            const active = startTime === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ requestedDate: date, requestedStartTime: value })}
                className={cn(
                  "min-h-11 rounded-lg border px-2 py-2 text-[11px] font-semibold leading-tight transition-all",
                  active
                    ? "border-sky-400 bg-sky-500/20 text-sky-200"
                    : "border-border bg-background hover:border-sky-500/50",
                )}
                aria-pressed={active}
                data-testid={timeTestId ? `${timeTestId}-${value}` : undefined}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">One-hour Central-time arrival windows</p>
          <button
            type="button"
            onClick={() => onChange({ requestedDate: date, requestedStartTime: undefined })}
            className="min-h-9 px-3 rounded-md border border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
            data-testid={timeTestId}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ServiceSelector ────────────────────────────────────────────────────────
export function ServiceSelector({
  services, selectedCodes, onAdd, onRemove,
}: {
  services: CatalogService[];
  selectedCodes: Set<string>;
  onAdd: (svc: CatalogService) => void;
  onRemove: (code: string) => void;
}) {
  const core = services.filter(s => !s.isAddon);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="service-selector">
      {core.map(svc => {
        const active = selectedCodes.has(svc.code);
        return (
          <button
            key={svc.code}
            type="button"
            onClick={() => active ? onRemove(svc.code) : onAdd(svc)}
            data-testid={`service-card-${svc.code}`}
            className={cn(
              "relative text-left rounded-2xl border p-4 transition-all active:scale-[0.97]",
              active
                ? "border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-500/10"
                : "border-border bg-card hover:border-orange-500/40"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-3xl">{emojiFor(svc.code)}</span>
              {active && <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />}
            </div>
            <p className="font-bold text-sm mt-2 leading-tight">{svc.name}</p>
            {svc.description && (
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{svc.description}</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1.5">Price shown at review</p>
          </button>
        );
      })}
    </div>
  );
}

// ── BundleBadge + BundleOfferStrip ─────────────────────────────────────────
const SLOT_META: Record<string, { label: string; cls: string }> = {
  most_popular: { label: "Most Popular", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  best_value:   { label: "Best Value",   cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  fast_addon:   { label: "Fast Add-On",  cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
};

function BundleBadge({ slot }: { slot: string }) {
  const meta = SLOT_META[slot] || { label: slot, cls: "bg-muted text-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border", meta.cls)}>
      <Sparkles className="h-2.5 w-2.5" /> {meta.label}
    </span>
  );
}

export function BundleOfferStrip({
  slots, services, selectedCodes, onApplyBundle, isLoading,
}: {
  slots: { most_popular: FeaturedBundle[]; best_value: FeaturedBundle[]; fast_addon: FeaturedBundle[] };
  services: CatalogService[];
  selectedCodes: Set<string>;
  onApplyBundle: (bundle: FeaturedBundle) => void;
  isLoading: boolean;
}) {
  const slotOrder: Array<keyof typeof slots> = ["most_popular", "best_value", "fast_addon"];
  const empty = slotOrder.every(k => (slots[k] || []).length === 0);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-36 rounded-2xl border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground" data-testid="bundles-empty">
        No featured bundles available right now — you can still add any combination of services manually.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="bundle-offer-strip">
      {slotOrder.map(slot => {
        const bundles = slots[slot] || [];
        const bundle = bundles[0]; // first for the slot
        if (!bundle) {
          return (
            <div key={slot} className="rounded-2xl border border-dashed border-border bg-card/50 p-4 flex items-center justify-center text-xs text-muted-foreground">
              <BundleBadge slot={slot} />
            </div>
          );
        }
        const allInCart = bundle.serviceComboJson.every(c => selectedCodes.has(c));
        const discountLine = bundle.discountType === "percent"
          ? `${bundle.discountValue}% off`
          : `$${parseFloat(bundle.discountValue).toFixed(0)} off`;
        return (
          <div
            key={bundle.code}
            className={cn(
              "rounded-2xl border p-4 flex flex-col gap-2 bg-card transition-all",
              allInCart ? "border-emerald-500/60 ring-1 ring-emerald-500/30" : "border-border hover:border-orange-500/40"
            )}
            data-testid={`bundle-card-${bundle.code}`}
          >
            <div className="flex items-start justify-between gap-2">
              <BundleBadge slot={slot} />
              <span className="text-[10px] font-bold text-emerald-500">{discountLine}</span>
            </div>
            <p className="font-bold text-sm leading-tight mt-1">{bundle.name}</p>
            <div className="flex flex-wrap gap-1">
              {bundle.serviceComboJson.map(code => {
                const svc = services.find(s => s.code === code);
                return (
                  <span key={code} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                    {emojiFor(code)} {svc?.name || code}
                  </span>
                );
              })}
            </div>
            {bundle.description && (
              <p className="text-[11px] text-muted-foreground line-clamp-2">{bundle.description}</p>
            )}
            <Button
              type="button"
              size="sm"
              variant={allInCart ? "secondary" : "default"}
              onClick={() => onApplyBundle(bundle)}
              disabled={allInCart}
              className="mt-auto"
              data-testid={`apply-bundle-${bundle.code}`}
            >
              {allInCart ? "Added to cart" : "Add bundle"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

// ── ServiceItemEditor (inline row) ─────────────────────────────────────────
export function ServiceItemEditor({
  item, onChange, onRemove, onOpenDrawer, warning,
}: {
  item: SelectedItem;
  onChange: (next: SelectedItem) => void;
  onRemove: () => void;
  onOpenDrawer: () => void;
  /** Optional inline message shown when a required per-item field is missing. */
  warning?: string | null;
}) {
  const showQty = item.priceMode === "hourly" || item.priceMode === "per_unit";
  const lineSubtotal = item.quantity * item.unitPrice;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3",
        warning ? "border-amber-500/60 ring-1 ring-amber-500/20" : "border-border",
      )}
      data-testid={`item-editor-${item.serviceCode}`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{emojiFor(item.serviceCode)}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{item.label}</p>
          <p className="text-[11px] text-muted-foreground">
            Price shown on review
            {formatRequestedSchedule(item.details) ? ` • ${formatRequestedSchedule(item.details)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-muted-foreground">Review</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        {showQty ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChange({ ...item, quantity: Math.max(1, item.quantity - 1) })}
              className="w-7 h-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
              data-testid={`item-qty-minus-${item.serviceCode}`}
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="text-xs font-bold w-6 text-center">{item.quantity}</span>
            <button
              type="button"
              onClick={() => onChange({ ...item, quantity: item.quantity + 1 })}
              className="w-7 h-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
              data-testid={`item-qty-plus-${item.serviceCode}`}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        ) : <span />}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onOpenDrawer}
            className="px-2.5 py-1 rounded-md border border-border text-[11px] hover:bg-muted flex items-center gap-1"
            data-testid={`item-edit-${item.serviceCode}`}
          >
            <Pencil className="h-3 w-3" /> Details
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-2.5 py-1 rounded-md border border-destructive/40 text-destructive text-[11px] hover:bg-destructive/10 flex items-center gap-1"
            data-testid={`item-remove-${item.serviceCode}`}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        </div>
      </div>
      {warning && (
        <p
          className="mt-2 text-[11px] text-amber-500 flex items-center gap-1"
          data-testid={`item-warning-${item.serviceCode}`}
        >
          <AlertCircle className="h-3 w-3" /> {warning} — open Details to fix.
        </p>
      )}
    </div>
  );
}

// ── MovingJunkPackagePicker ────────────────────────────────────────────────
// Mirrors the chatbot's package-picker for Moving and Junk Removal so the
// wizard sells those services as crew-size × hours packages instead of a
// flat $300/$100 line. The server validates promos and packages at checkout.
const PICKER_HOME_SIZES = [
  "1–2 Items (Tiny Job)",
  "Studio / Single Room",
  "1 Bedroom Apartment",
  "2 Bedroom Apartment",
  "3 Bedroom Apartment",
  "4+ Bedroom Apartment",
  "1–2 Bedroom House",
  "3 Bedroom House",
  "4+ Bedroom House",
  "Commercial / Office",
];

const PICKER_LOAD_TYPES = [
  "Load only",
  "Unload only",
  "Load + unload",
];

const FILTERED_MOVING_SIZES = [
  "1-2 Items",
  "Studio or 1 Bedroom",
  "2 Bedroom Apartment",
  "2 Bedroom House",
  "3 Bedroom House",
  "4 Bedroom House",
  "Commercial / Office",
];

const PICKER_TRUCK_SIZES = [
  "15 ft",
  "26 ft",
  "Custom",
];

const MOVING_PATHS: Array<{
  id: NonNullable<SelectedItem["details"]["movingPath"]>;
  label: string;
  subline: string;
  icon: typeof Package;
  preset: Partial<SelectedItem["details"]>;
}> = [
  {
    id: "tiny_items",
    label: "1 or 2 Items",
    subline: "Fast minimum quote",
    icon: Armchair,
    preset: { jobSize: "1-2 Items", loadType: "Load + unload", truckNeeded: false, truckSize: "15 ft" },
  },
  {
    id: "load_only",
    label: "Load Only",
    subline: "Customer truck or container",
    icon: Truck,
    preset: { loadType: "Load only", truckNeeded: false, truckSize: "15 ft" },
  },
  {
    id: "unload_only",
    label: "Unload Only",
    subline: "Drop-off help",
    icon: Boxes,
    preset: { loadType: "Unload only", truckNeeded: false, truckSize: "15 ft" },
  },
  {
    id: "load_unload",
    label: "Load + Unload",
    subline: "Pickup and destination",
    icon: Truck,
    preset: { loadType: "Load + unload", truckNeeded: false, truckSize: "26 ft" },
  },
  {
    id: "full_household",
    label: "Full Household Move",
    subline: "Rooms, truck, crew",
    icon: Home,
    preset: { jobSize: "3 or 4 Bedroom House", loadType: "Load + unload", truckNeeded: true, truckSize: "26 ft" },
  },
  {
    id: "heavy_specialty",
    label: "Heavy / Specialty Item",
    subline: "Safe, piano, pool table",
    icon: Dumbbell,
    preset: { jobSize: "1-2 Items", loadType: "Load + unload", truckNeeded: false, truckSize: "15 ft", heavyItemsConfirmed: false },
  },
  {
    id: "packing_assembly",
    label: "Packing / Assembly Help",
    subline: "Wrap, pack, assemble",
    icon: Wrench,
    preset: { jobSize: "1-2 Items", loadType: "Load only", truckNeeded: false, truckSize: "Custom" },
  },
];

const MOVING_INVENTORY_OPTIONS: Array<{
  id: string;
  label: string;
  category: string;
  size?: string;
  laborHours: number;
  icon: typeof Package;
  visual?: "bed_twin" | "bed_queen" | "bed_king" | "dresser_small" | "dresser_large";
}> = [
  { id: "bed_twin", label: "Twin bed", category: "beds", size: "twin", laborHours: 0.15, icon: Bed, visual: "bed_twin" },
  { id: "bed_queen", label: "Queen bed", category: "beds", size: "queen", laborHours: 0.25, icon: Bed, visual: "bed_queen" },
  { id: "bed_king", label: "King bed", category: "beds", size: "king", laborHours: 0.5, icon: Bed, visual: "bed_king" },
  { id: "sofa_2", label: "2-seat couch", category: "couches", size: "small", laborHours: 0.2, icon: Sofa },
  { id: "sofa_3", label: "3-seat couch", category: "couches", size: "medium", laborHours: 0.25, icon: Sofa },
  { id: "recliner", label: "Recliner / chair", category: "couches", size: "oversized", laborHours: 0.2, icon: Armchair },
  { id: "dresser_s", label: "Small dresser", category: "dressers", size: "small", laborHours: 0.2, icon: Package, visual: "dresser_small" },
  { id: "dresser_l", label: "Large dresser", category: "dressers", size: "large", laborHours: 0.4, icon: Package, visual: "dresser_large" },
  { id: "table_m", label: "Table", category: "tables", size: "medium", laborHours: 0.5, icon: Package },
  { id: "chairs_4", label: "4 chairs", category: "tables", size: "set", laborHours: 0.4, icon: Armchair },
  { id: "appliance", label: "Appliance", category: "appliances", size: "standard", laborHours: 0.25, icon: Package },
  { id: "fridge", label: "Fridge / freezer", category: "appliances", size: "large", laborHours: 0.5, icon: Package },
  { id: "tv_stand", label: "TV stand", category: "living room", size: "medium", laborHours: 0.35, icon: Package },
  { id: "small_tables", label: "Small table", category: "living room", size: "small", laborHours: 0.15, icon: Package },
  { id: "patio", label: "Patio furniture", category: "outside", size: "set", laborHours: 0.5, icon: Package },
  { id: "garage_space", label: "Garage / shed", category: "extra spaces", size: "medium", laborHours: 0.75, icon: Boxes },
  { id: "basement_space", label: "Basement / attic", category: "extra spaces", size: "medium", laborHours: 0.75, icon: Boxes },
  { id: "heavy_generic", label: "200 lb+ item", category: "heavy", size: "heavy", laborHours: 0.75, icon: Dumbbell },
];

function InventoryItemVisual({
  option,
}: {
  option: (typeof MOVING_INVENTORY_OPTIONS)[number];
}) {
  const Icon = option.icon;
  if (!option.visual) return <Icon className="h-4 w-4" />;

  if (option.visual.startsWith("bed_")) {
    const width = option.visual === "bed_twin" ? 17 : option.visual === "bed_queen" ? 23 : 29;
    return (
      <svg viewBox="0 0 36 24" className="h-6 w-8" aria-label={`${option.label} size visual`} role="img">
        <rect x="3" y="8" width={width} height="11" rx="2" className="fill-current opacity-20" />
        <rect x="3" y="8" width={width} height="11" rx="2" className="stroke-current fill-transparent" strokeWidth="1.8" />
        <rect x="5" y="10" width={Math.max(5, width * 0.28)} height="7" rx="1.2" className="fill-current opacity-45" />
        <path d="M3 6v15M31 19v2" className="stroke-current" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  const isLarge = option.visual === "dresser_large";
  return (
    <svg viewBox="0 0 36 24" className="h-6 w-8" aria-label={`${option.label} size visual`} role="img">
      <rect
        x={isLarge ? 4 : 9}
        y={isLarge ? 4 : 7}
        width={isLarge ? 28 : 18}
        height={isLarge ? 16 : 12}
        rx="2"
        className="stroke-current fill-current opacity-20"
        strokeWidth="1.8"
      />
      {[0, 1, 2].map((row) => (
        <path
          key={row}
          d={`M${isLarge ? 7 : 12} ${isLarge ? 8 + row * 4 : 10 + row * 3}h${isLarge ? 22 : 12}`}
          className="stroke-current opacity-70"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ))}
      <circle cx={isLarge ? 16 : 17} cy={isLarge ? 10 : 11.5} r="0.8" className="fill-current" />
      <circle cx={isLarge ? 20 : 19} cy={isLarge ? 14 : 14.5} r="0.8" className="fill-current" />
    </svg>
  );
}

const MOVING_INVENTORY_SECTIONS: Array<{
  id: string;
  label: string;
  subline: string;
  icon: typeof Package;
  itemIds: string[];
}> = [
  {
    id: "bedroom",
    label: "Bedroom",
    subline: "Beds and dressers",
    icon: Bed,
    itemIds: ["bed_twin", "bed_queen", "bed_king", "dresser_s", "dresser_l"],
  },
  {
    id: "living_room",
    label: "Living Room",
    subline: "Couches, chairs, stands",
    icon: Sofa,
    itemIds: ["sofa_2", "sofa_3", "recliner", "tv_stand", "small_tables"],
  },
  {
    id: "kitchen_dining",
    label: "Kitchen / Dining",
    subline: "Tables, chairs, appliances",
    icon: Armchair,
    itemIds: ["table_m", "chairs_4", "appliance", "fridge"],
  },
  {
    id: "storage_outdoor",
    label: "Garage / Storage / Outdoor",
    subline: "Extra spaces and patio",
    icon: Boxes,
    itemIds: ["garage_space", "basement_space", "patio"],
  },
  {
    id: "heavy_specialty",
    label: "Heavy / Specialty",
    subline: "200 lb+ items and future specialty pieces",
    icon: Dumbbell,
    itemIds: ["heavy_generic"],
  },
];

function defaultOpenInventorySections(path?: SelectedItem["details"]["movingPath"]): string[] {
  if (path === "tiny_items") return ["living_room"];
  if (path === "load_only" || path === "unload_only" || path === "load_unload") return ["bedroom", "living_room"];
  if (path === "full_household") return ["bedroom"];
  if (path === "heavy_specialty") return ["heavy_specialty"];
  return ["living_room"];
}

function summarizeInventory(
  selected: NonNullable<SelectedItem["details"]["inventoryItems"]>,
  details: SelectedItem["details"],
  rate: number,
) {
  const baseHours = selected.reduce((sum, item) => sum + item.quantity * item.laborHours, 0);
  const stairsFactor = details.hasStairs ? 1.2 : 1;
  const unloadFactor = /unload only/i.test(details.loadType || "") ? 0.9 : 1;
  const adjustedHours = Math.max(0, baseHours * stairsFactor * unloadFactor);
  const crew = adjustedHours <= 3 ? 2 : adjustedHours <= 6 ? 3 : adjustedHours <= 10 ? 4 : 5;
  const truck = adjustedHours <= 2.5 ? "15 ft" : adjustedHours <= 7 ? "26 ft" : "26 ft + follow-up review";
  const difficulty = Math.min(10, Math.ceil(adjustedHours + (details.hasStairs ? 2 : 0) + selected.filter((i) => i.category === "heavy").length * 2));
  const laborPrice = Math.ceil(adjustedHours * crew * rate);
  const min = Math.max(150, Math.round(laborPrice * 0.85 / 25) * 25);
  const max = Math.max(min + 75, Math.round(laborPrice * 1.15 / 25) * 25);
  const confidence: "low" | "medium" | "high" = selected.length >= 8 ? "high" : selected.length >= 3 ? "medium" : "low";
  return {
    hours: Number(adjustedHours.toFixed(2)),
    crew,
    truck,
    difficulty,
    min,
    max,
    confidence,
  };
}

type JunkTier = "tiny" | "small" | "medium" | "large";

const JUNK_TIER_JOB_SIZE: Record<JunkTier, string> = {
  tiny: PICKER_HOME_SIZES[0],
  small: PICKER_HOME_SIZES[1],
  medium: PICKER_HOME_SIZES[3],
  large: PICKER_HOME_SIZES[8],
};

const JUNK_TIER_LABEL: Record<JunkTier, string> = {
  tiny: "Tiny pickup",
  small: "Small load",
  medium: "Medium load",
  large: "Large load",
};

const JUNK_SIZING_METHODS: Array<{
  id: NonNullable<SelectedItem["details"]["junkSizingMethod"]>;
  label: string;
  subline: string;
  icon: typeof Package;
}> = [
  { id: "truck_load", label: "Truck Load", subline: "Fastest visual size", icon: Truck },
  { id: "room_cleanout", label: "Room Cleanout", subline: "Pick the space", icon: Home },
  { id: "item_by_item", label: "Item-by-Item", subline: "Most accurate", icon: Package },
];

const JUNK_TRUCK_LOAD_OPTIONS: Array<{
  label: string;
  loadFraction: number;
  tier: JunkTier;
}> = [
  { label: "1 Item", loadFraction: 0.08, tier: "tiny" },
  { label: "1/8 Load", loadFraction: 0.125, tier: "tiny" },
  { label: "1/4 Load", loadFraction: 0.25, tier: "small" },
  { label: "1/2 Load", loadFraction: 0.5, tier: "medium" },
  { label: "3/4 Load", loadFraction: 0.75, tier: "large" },
  { label: "Full Load", loadFraction: 1, tier: "large" },
];

const JUNK_ROOM_CLEANOUT_OPTIONS: Array<{
  label: string;
  loadFraction: number;
  tier: JunkTier;
}> = [
  { label: "Single room", loadFraction: 0.25, tier: "small" },
  { label: "Garage", loadFraction: 0.5, tier: "medium" },
  { label: "Basement", loadFraction: 0.5, tier: "medium" },
  { label: "Attic", loadFraction: 0.35, tier: "medium" },
  { label: "Apartment", loadFraction: 0.5, tier: "medium" },
  { label: "Estate / full-house", loadFraction: 1, tier: "large" },
];

const JUNK_ITEM_OPTIONS: Array<{
  id: string;
  label: string;
  category: string;
  loadFraction: number;
  extraFee?: number;
  specialistReview?: boolean;
  icon: typeof Package;
}> = [
  { id: "junk_sofa", label: "Couch / loveseat", category: "furniture", loadFraction: 0.1, icon: Sofa },
  { id: "junk_chair", label: "Chair / recliner", category: "furniture", loadFraction: 0.05, icon: Armchair },
  { id: "junk_dresser", label: "Dresser / cabinet", category: "furniture", loadFraction: 0.07, icon: Package },
  { id: "junk_table", label: "Table / desk", category: "furniture", loadFraction: 0.06, icon: Package },
  { id: "junk_appliance", label: "Appliance", category: "appliances", loadFraction: 0.08, extraFee: 75, icon: Package },
  { id: "junk_fridge", label: "Refrigerator / freezer", category: "appliances", loadFraction: 0.12, extraFee: 100, icon: Package },
  { id: "junk_mattress", label: "Mattress", category: "bedding", loadFraction: 0.08, extraFee: 50, icon: Bed },
  { id: "junk_boxspring", label: "Box spring", category: "bedding", loadFraction: 0.06, icon: Bed },
  { id: "junk_tv", label: "TV", category: "electronics", loadFraction: 0.03, extraFee: 50, icon: Package },
  { id: "junk_electronics", label: "Electronics", category: "electronics", loadFraction: 0.02, icon: Package },
  { id: "junk_bags", label: "Bags / small junk", category: "small_junk", loadFraction: 0.03, icon: Boxes },
  { id: "junk_boxes", label: "Boxes / totes", category: "small_junk", loadFraction: 0.025, icon: Boxes },
  { id: "junk_yard", label: "Yard waste", category: "outdoor", loadFraction: 0.08, icon: Boxes },
  { id: "junk_patio", label: "Patio furniture", category: "outdoor", loadFraction: 0.08, icon: Armchair },
  { id: "junk_construction", label: "Construction debris", category: "construction", loadFraction: 0.15, specialistReview: true, icon: Wrench },
  { id: "junk_special", label: "Special disposal", category: "special", loadFraction: 0.05, specialistReview: true, icon: AlertCircle },
];

const JUNK_ITEM_SECTIONS: Array<{
  id: string;
  label: string;
  subline: string;
  icon: typeof Package;
  itemIds: string[];
}> = [
  { id: "furniture", label: "Furniture", subline: "Couches, chairs, dressers, tables", icon: Sofa, itemIds: ["junk_sofa", "junk_chair", "junk_dresser", "junk_table"] },
  { id: "appliances", label: "Appliances", subline: "Fridge, freezer, large appliances", icon: Package, itemIds: ["junk_appliance", "junk_fridge"] },
  { id: "bedding", label: "Mattresses / Bedding", subline: "Mattresses and box springs", icon: Bed, itemIds: ["junk_mattress", "junk_boxspring"] },
  { id: "electronics", label: "TVs / Electronics", subline: "TVs and electronics", icon: Package, itemIds: ["junk_tv", "junk_electronics"] },
  { id: "small_junk", label: "Bags / Boxes / Small Junk", subline: "Bagged junk, boxes, totes", icon: Boxes, itemIds: ["junk_bags", "junk_boxes"] },
  { id: "outdoor", label: "Outdoor / Yard Waste", subline: "Patio sets and yard debris", icon: Armchair, itemIds: ["junk_yard", "junk_patio"] },
  { id: "construction", label: "Construction Debris", subline: "Specialist-review surcharge", icon: Wrench, itemIds: ["junk_construction"] },
  { id: "special", label: "Special Disposal", subline: "Anything needing extra handling", icon: AlertCircle, itemIds: ["junk_special"] },
];

function junkTierFromLoadFraction(loadFraction: number): JunkTier {
  if (loadFraction <= 0.125) return "tiny";
  if (loadFraction <= 0.25) return "small";
  if (loadFraction <= 0.5) return "medium";
  return "large";
}

function formatLoadFraction(loadFraction: number) {
  if (loadFraction <= 0.1) return "1 item";
  if (loadFraction <= 0.125) return "1/8 truck";
  if (loadFraction <= 0.25) return "1/4 truck";
  if (loadFraction <= 0.5) return "1/2 truck";
  if (loadFraction <= 0.75) return "3/4 truck";
  return "full truck";
}

function summarizeJunkItems(
  selected: NonNullable<SelectedItem["details"]["junkItems"]>,
  details: SelectedItem["details"],
) {
  const itemCount = selected.reduce((sum, entry) => sum + entry.quantity, 0);
  const itemLoad = selected.reduce((sum, entry) => sum + entry.quantity * entry.loadFraction, 0);
  const chosenLoad = Number(details.junkLoadFraction || 0);
  const loadFraction = Math.min(1, Math.max(chosenLoad, itemLoad));
  const extraFee = selected.reduce((sum, entry) => sum + entry.quantity * (entry.extraFee || 0), 0);
  const specialistReview = selected.some((entry) => entry.specialistReview);
  const constructionReview = selected.some((entry) => entry.category === "construction" || entry.specialistReview);
  const tier = details.junkLoadTier || junkTierFromLoadFraction(loadFraction || itemLoad || chosenLoad || 0.125);
  const difficulty = Math.min(
    10,
    Math.max(1, Math.ceil(loadFraction * 7 + (extraFee > 0 ? 1 : 0) + (specialistReview ? 2 : 0) + (details.hasStairs ? 1 : 0))),
  );
  const confidence: "low" | "medium" | "high" =
    selected.length >= 4 ? "high" : selected.length > 0 || details.junkSizingMethod !== "item_by_item" ? "medium" : "low";
  return {
    itemCount,
    loadFraction: Number((loadFraction || 0.125).toFixed(3)),
    tier,
    extraFee,
    difficulty,
    confidence,
    constructionReview,
  };
}

export const PICKER_SPECIAL_ITEMS = [
  "🎹 Grand Piano",
  "🎹 Upright Piano",
  "🎱 Pool Table",
  "♨️ Hot Tub",
  "🔒 Safe (300 lbs) +$300",
  "🔒 Safe (500 lbs) +$500",
  "🔒 Safe (1000 lbs) +$1000",
  "🏋️ Heavy Item (400 lbs) +$300",
  "🏋️ Heavy Item (600 lbs) +$500",
  "🏋️ Heavy Item (800+ lbs) +$800",
  "🏋️ Large Appliance or Fitness Equipment (200 lbs+) +$100",
  "📦 Other Heavy Item (200 lbs+) +$100",
];

export function MovingJunkPackagePicker({
  item, onChange, serviceAddress, onServiceAddressChange,
}: {
  item: SelectedItem;
  onChange: (next: SelectedItem) => void;
  serviceAddress: string;
  onServiceAddressChange?: (value: string) => void;
}) {
  const isMoving = item.serviceCode === "moving";
  const { data: pricingSnapshot } = useQuery<CanonicalPricingSnapshot>({
    queryKey: ["/api/pricing/v2"],
    staleTime: 5 * 60 * 1000,
  });
  const activePricing = pricingSnapshot ?? CANONICAL_PRICING_2026_08;
  const rate = activePricing.labor.workerHourlyRate;
  const movingLaborTotal = (crewSize: number, hours: number, useSpecialRate = false) => {
    if (useSpecialRate) {
      const line = calculateRateCardLine({
        serviceCode: "load_unload",
        crewSize,
        hours,
        snapshot: activePricing,
      });
      if (line) return line.subtotal;
    }
    return calculateMovingLabor({ workers: crewSize, hours, snapshot: activePricing }).total;
  };
  const trimmedPickupAddress = serviceAddress.trim();
  const needsDropoffAddress = isMoving && /both|load \+ unload/i.test(item.details.loadType || "");
  const trimmedDropoffAddress = needsDropoffAddress ? (item.details.dropoffAddress || "").trim() : "";
  const canEstimateDrive = isMoving
    && trimmedPickupAddress.length >= 5
    && (!needsDropoffAddress || trimmedDropoffAddress.length >= 5);

  const driveEstimateQuery = useQuery<DriveEstimateResult>({
    queryKey: ["/api/utility/estimate-drive-miles", trimmedPickupAddress, trimmedDropoffAddress],
    enabled: canEstimateDrive,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ pickup: trimmedPickupAddress });
      if (trimmedDropoffAddress) params.set("dropoff", trimmedDropoffAddress);
      const res = await fetch(`/api/utility/estimate-drive-miles?${params.toString()}`);
      if (!res.ok) throw new Error("Drive estimate unavailable");
      return res.json() as Promise<DriveEstimateResult>;
    },
  });

  const verifiedDriveMiles = driveEstimateQuery.data?.miles ?? Number(item.details.verifiedDriveMiles ?? 0);
  const truckRental = isMoving && item.details.truckNeeded
    ? calculateJcTruckRentalFee(verifiedDriveMiles, verifiedDriveMiles > JC_TRUCK_INCLUDED_MILES, item.details.truckSize)
    : null;

  // Build an Answers shape from the persisted details so the chatbot's
  // pricing engine can compute the same packages it shows in chat.
  const answers: Answers = useMemo(() => {
    const a: Answers = {
      serviceType: isMoving ? "📦 Moving (local or long-distance)" : "🗑️ Junk Removal",
      homeSize: item.details.jobSize,
      specialItems: item.details.specialItems || [],
      promoCode: item.details.promoCode,
    };
    if (isMoving) {
      a.loadType = item.details.loadType;
      a.truckSize = item.details.truckSize;
      a.truckSituation = item.details.truckNeeded ? "JC ON THE MOVE provides the truck" : "Customer provides truck";
      if (item.details.hasStairs) {
        a.originFloor = "2nd Floor";
        a.originElevator = "🪜 No elevator — stairs only";
      }
    }
    return a;
  }, [isMoving, item.details.jobSize, item.details.specialItems, item.details.promoCode,
      item.details.loadType, item.details.truckNeeded, item.details.truckSize, item.details.hasStairs]);

  const quote = useMemo(() => {
    if (!item.details.jobSize) return null;
    return isMoving
      ? computeMovingQuote(
          answers,
          rate,
          verifiedDriveMiles,
          0,
          activePricing,
          driveEstimateQuery.data?.insideBubble,
        )
      : computeJunkQuote(answers, rate);
  }, [answers, isMoving, rate, item.details.jobSize, verifiedDriveMiles, activePricing.version, driveEstimateQuery.data?.insideBubble]);

  const packages: CrewPackage[] = useMemo(() => {
    const base = quote ? buildCrewPackages(answers, quote, rate, activePricing) : [];
    if (isMoving && quote) {
      const movingQuote = quote as any;
      const useSpecialRate = movingQuote.rateSource === "movinghelper_special";
      const surcharge = Number(movingQuote.specialSurcharge || 0);
      const travel = Number(movingQuote.travelCharge || 0);
      const packageNote = travel > 0 ? ` · +$${travel} travel` : "";
      const standardMovingPackages: CrewPackage[] = [
        {
          id: "pkg_move_1_2m_2h",
          label: "2 movers / 2 hours",
          desc: `${useSpecialRate ? "Farther-client" : "Local"} load, unload, delivery, or 1-2 item help · 4 labor hours${packageNote}`,
          minPrice: movingLaborTotal(2, 2, useSpecialRate) + surcharge + travel,
          maxPrice: movingLaborTotal(2, 2, useSpecialRate) + surcharge + travel,
          crew: 2,
          hours: 2,
          tag: "Quick job",
        },
        {
          id: "pkg_move_2_2m_3h",
          label: "2 movers / 3 hours",
          desc: `Most common ${useSpecialRate ? "farther-client" : "local"} moving-help package · good for U-Haul load, unload, or small apartment${packageNote}`,
          minPrice: movingLaborTotal(2, 3, useSpecialRate) + surcharge + travel,
          maxPrice: movingLaborTotal(2, 3, useSpecialRate) + surcharge + travel,
          crew: 2,
          hours: 3,
          tag: "Most common",
        },
        {
          id: "pkg_move_3_3m_2h",
          label: "3 movers / 2 hours",
          desc: `Faster crew for stairs, heavier pieces, or tight unload windows · 6 labor hours${packageNote}`,
          minPrice: movingLaborTotal(3, 2, useSpecialRate) + surcharge + travel,
          maxPrice: movingLaborTotal(3, 2, useSpecialRate) + surcharge + travel,
          crew: 3,
          hours: 2,
          tag: "Faster crew",
        },
        {
          id: "pkg_move_4_quote_review",
          label: "Quote review / large crew",
          desc: `Large home, multiple stops, heavy access, or longer route · coordinator confirms crew and final price${packageNote}`,
          minPrice: movingLaborTotal(4, 4, useSpecialRate) + surcharge + travel,
          maxPrice: movingLaborTotal(4, 4, useSpecialRate) + surcharge + travel,
          crew: 4,
          hours: 4,
          tag: "Review",
        },
      ];
      const movingBase = standardMovingPackages.filter(pkg => !pkg.crew || pkg.crew >= movingQuote.crew);
      if (!truckRental) return movingBase;
      const truckNote = ` · truck rental $${truckRental.baseFee}`
        + (truckRental.mileageFee > 0 ? ` + $${truckRental.mileageFee} mileage` : "");
      return movingBase.map((pkg) => ({
        ...pkg,
        desc: `${pkg.desc}${truckNote}`,
        minPrice: pkg.minPrice + truckRental.totalFee,
        maxPrice: pkg.maxPrice + truckRental.totalFee,
      }));
    }
    const pricedForJunk = !isMoving
      ? base.map((pkg) => {
          const extraFee = item.details.junkExtraFeeEstimate || 0;
          const reviewBuffer = item.details.junkConstructionReview ? 150 : 0;
          const extraNote = extraFee > 0 ? ` · extra disposal $${extraFee}` : "";
          const reviewNote = item.details.junkConstructionReview ? " · construction debris review" : "";
          return {
            ...pkg,
            desc: `${pkg.desc}${extraNote}${reviewNote}`,
            minPrice: pkg.minPrice + extraFee,
            maxPrice: pkg.maxPrice + extraFee + reviewBuffer,
          };
        })
      : base;
    if (!isMoving) return pricedForJunk;
    if (!truckRental) return pricedForJunk;
    const truckNote = ` · truck rental $${truckRental.baseFee}`
      + (truckRental.mileageFee > 0 ? ` + $${truckRental.mileageFee} mileage` : "");
    return pricedForJunk.map((pkg) => ({
      ...pkg,
      desc: `${pkg.desc}${truckNote}`,
      minPrice: pkg.minPrice + truckRental.totalFee,
      maxPrice: pkg.maxPrice + truckRental.totalFee,
    }));
  }, [
    quote,
    answers,
    rate,
    activePricing.version,
    isMoving,
    item.details.junkExtraFeeEstimate,
    item.details.junkConstructionReview,
    truckRental?.baseFee,
    truckRental?.mileageFee,
    truckRental?.totalFee,
  ]);

  // Keep the selected package in sync with the live package list. Two cases:
  //  1. The selected id no longer exists (user changed job size, load type,
  //     etc.) → drop the selection so they have to pick again.
  //  2. The id still exists but its price band, crew or hours changed (e.g.
  //     the user toggled a special item or stairs after picking) →
  //     reapply the same package so unitPrice / details stay accurate. Without
  //     this the cart would submit stale pricing for the new inputs.
  const packageSig = packages
    .map(p => `${p.id}:${p.minPrice}-${p.maxPrice}:${p.crew ?? ""}x${p.hours ?? ""}`)
    .join("|");
  const [showMorePackages, setShowMorePackages] = useState(false);
  const selectedPackage = packages.find(p => p.id === item.details.packageId) || null;
  const recommendedPackage = packages.find(p => p.tag === "Most common") || packages[0] || null;
  const selectedPath = MOVING_PATHS.find((path) => path.id === item.details.movingPath) || null;
  const hideLoadChoice = isMoving && ["load_only", "unload_only", "load_unload"].includes(item.details.movingPath || "");
  const showDropoffForPath = isMoving && ["load_unload", "full_household"].includes(item.details.movingPath || "");
  const showInventoryBuilder = isMoving && !!item.details.movingPath && item.details.movingPath !== "packing_assembly";
  const inventoryItems = item.details.inventoryItems || [];
  const inventorySummary = summarizeInventory(inventoryItems, item.details, rate);
  const junkItems = item.details.junkItems || [];
  const junkSummary = summarizeJunkItems(junkItems, item.details);
  const [openInventorySections, setOpenInventorySections] = useState<Set<string>>(
    () => new Set(defaultOpenInventorySections(item.details.movingPath)),
  );
  const [openJunkSections, setOpenJunkSections] = useState<Set<string>>(
    () => new Set(["furniture", "appliances"]),
  );
  const hasCoreForRecommendation = !isMoving || (
    !!item.details.jobSize &&
    !!item.details.loadType &&
    item.details.truckNeeded != null &&
    !!item.details.truckSize
  );
  useEffect(() => {
    if (!item.details.packageId) return;
    if (item.details.packageId === "visual_inventory_estimate") return;
    const current = packages.find(p => p.id === item.details.packageId);
    if (!current) {
      onChange({
        ...item,
        unitPrice: 0,
        details: {
          ...item.details,
          packageId: undefined, packageLabel: undefined, packageTier: undefined,
          crew: undefined, hours: undefined, minPrice: undefined, maxPrice: undefined,
        },
      });
      return;
    }
    const drifted =
      current.minPrice !== item.details.minPrice ||
      current.maxPrice !== item.details.maxPrice ||
      current.crew     !== item.details.crew ||
      current.hours    !== item.details.hours ||
      current.label    !== item.details.packageLabel;
    if (drifted) applyPackage(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageSig]);

  useEffect(() => {
    if (item.details.packageId || !recommendedPackage || !hasCoreForRecommendation) return;
    applyPackage(recommendedPackage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.details.packageId, recommendedPackage?.id, hasCoreForRecommendation]);

  function applyPackage(pkg: CrewPackage) {
    onChange({
      ...item,
      quantity: 1,
      unitPrice: Math.round(pkg.minPrice),
      priceMode: "fixed",
      details: {
        ...item.details,
        packageId: pkg.id,
        packageLabel: pkg.label,
        packageTier: quote?.type === "moving" || quote?.type === "junk" ? quote.tier : undefined,
        crew: pkg.crew,
        hours: pkg.hours,
        minPrice: pkg.minPrice,
        maxPrice: pkg.maxPrice,
        truckFee: truckRental?.totalFee,
        truckBaseFee: truckRental?.baseFee,
        truckMileageFee: truckRental?.mileageFee,
        truckIncludedMiles: truckRental?.includedMiles,
        truckExtraMiles: truckRental?.extraMiles,
        truckExtraMileRate: truckRental?.ratePerExtraMile,
      },
    });
  }

  function patch(d: Partial<SelectedItem["details"]>) {
    onChange({ ...item, details: { ...item.details, ...d } });
  }

  function applyMovingPath(path: (typeof MOVING_PATHS)[number]) {
    onChange({
      ...item,
      unitPrice: 0,
      priceMode: "quote",
      details: {
        ...item.details,
        ...path.preset,
        movingPath: path.id,
        packageId: undefined,
        packageLabel: undefined,
        packageTier: undefined,
        crew: undefined,
        hours: undefined,
        minPrice: undefined,
        maxPrice: undefined,
      },
    });
  }

  function patchJunkQuote(next: Partial<SelectedItem["details"]>, nextItems = junkItems) {
    const summary = summarizeJunkItems(nextItems, { ...item.details, ...next });
    patch({
      ...next,
      jobSize: JUNK_TIER_JOB_SIZE[summary.tier],
      junkLoadTier: summary.tier,
      junkLoadFraction: summary.loadFraction,
      junkItems: nextItems,
      junkExtraFeeEstimate: summary.extraFee,
      junkDifficulty: summary.difficulty,
      junkConfidence: summary.confidence,
      junkConstructionReview: summary.constructionReview,
      packageId: undefined,
      packageLabel: undefined,
      packageTier: undefined,
      crew: undefined,
      hours: undefined,
      minPrice: undefined,
      maxPrice: undefined,
    });
  }

  function applyJunkMethod(method: (typeof JUNK_SIZING_METHODS)[number]) {
    const firstOpen = method.id === "truck_load"
      ? ["furniture", "appliances"]
      : method.id === "room_cleanout"
        ? ["furniture", "small_junk"]
        : ["furniture"];
    setOpenJunkSections(new Set(firstOpen));
    patchJunkQuote({ junkSizingMethod: method.id });
  }

  function applyJunkTruckLoad(option: (typeof JUNK_TRUCK_LOAD_OPTIONS)[number]) {
    patchJunkQuote({
      junkSizingMethod: "truck_load",
      junkLoadTier: option.tier,
      junkLoadFraction: option.loadFraction,
    });
  }

  function applyJunkRoomCleanout(option: (typeof JUNK_ROOM_CLEANOUT_OPTIONS)[number]) {
    patchJunkQuote({
      junkSizingMethod: "room_cleanout",
      junkLoadTier: option.tier,
      junkLoadFraction: option.loadFraction,
    });
  }

  function updateJunkItem(option: (typeof JUNK_ITEM_OPTIONS)[number], delta: number) {
    const existing = junkItems.find((entry) => entry.id === option.id);
    const nextQty = Math.max(0, (existing?.quantity || 0) + delta);
    const without = junkItems.filter((entry) => entry.id !== option.id);
    const nextItems = nextQty > 0
      ? [...without, {
          id: option.id,
          label: option.label,
          category: option.category,
          quantity: nextQty,
          loadFraction: option.loadFraction,
          extraFee: option.extraFee,
          specialistReview: option.specialistReview,
        }]
      : without;
    patchJunkQuote({ junkSizingMethod: item.details.junkSizingMethod || "item_by_item" }, nextItems);
  }

  function updateInventory(option: (typeof MOVING_INVENTORY_OPTIONS)[number], delta: number) {
    const existing = inventoryItems.find((entry) => entry.id === option.id);
    const nextQty = Math.max(0, (existing?.quantity || 0) + delta);
    const without = inventoryItems.filter((entry) => entry.id !== option.id);
    const nextItems = nextQty > 0
      ? [...without, {
          id: option.id,
          label: option.label,
          category: option.category,
          size: option.size,
          quantity: nextQty,
          laborHours: option.laborHours,
        }]
      : without;
    const nextSummary = summarizeInventory(nextItems, item.details, rate);
    onChange({
      ...item,
      quantity: 1,
      unitPrice: nextItems.length > 0 ? Math.round(nextSummary.min) : 0,
      priceMode: nextItems.length > 0 ? "fixed" : "quote",
      details: {
        ...item.details,
      inventoryItems: nextItems,
      inventoryLaborHours: nextSummary.hours,
      inventoryDifficulty: nextSummary.difficulty,
      inventoryTruckRecommendation: nextSummary.truck,
      inventoryCrewRecommendation: nextSummary.crew,
      inventoryPriceMin: nextSummary.min,
      inventoryPriceMax: nextSummary.max,
      quoteConfidence: nextSummary.confidence,
      packageId: nextItems.length > 0 ? "visual_inventory_estimate" : undefined,
      packageLabel: nextItems.length > 0 ? "Visual inventory estimate" : undefined,
      packageTier: nextItems.length > 0 ? "inventory" : undefined,
      crew: nextItems.length > 0 ? nextSummary.crew : undefined,
      hours: nextItems.length > 0 ? nextSummary.hours : undefined,
      minPrice: nextItems.length > 0 ? nextSummary.min : undefined,
      maxPrice: nextItems.length > 0 ? nextSummary.max : undefined,
      },
    });
  }

  function toggleInventorySection(sectionId: string) {
    setOpenInventorySections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function summarizeSection(itemIds: string[]) {
    const selected = inventoryItems.filter((entry) => itemIds.includes(entry.id));
    const count = selected.reduce((sum, entry) => sum + entry.quantity, 0);
    const hours = selected.reduce((sum, entry) => sum + entry.quantity * entry.laborHours, 0);
    return { count, hours: Number(hours.toFixed(2)) };
  }

  function toggleJunkSection(sectionId: string) {
    setOpenJunkSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function summarizeJunkSection(itemIds: string[]) {
    const selected = junkItems.filter((entry) => itemIds.includes(entry.id));
    const count = selected.reduce((sum, entry) => sum + entry.quantity, 0);
    const load = selected.reduce((sum, entry) => sum + entry.quantity * entry.loadFraction, 0);
    const extraFee = selected.reduce((sum, entry) => sum + entry.quantity * (entry.extraFee || 0), 0);
    const needsReview = selected.some((entry) => entry.specialistReview);
    return { count, load: Number(load.toFixed(2)), extraFee, needsReview };
  }

  useEffect(() => {
    setOpenInventorySections(new Set(defaultOpenInventorySections(item.details.movingPath)));
  }, [item.details.movingPath]);

  useEffect(() => {
    if (!isMoving) return;
    if (!canEstimateDrive) {
      if (
        item.details.verifiedDriveMiles != null ||
        item.details.estimatedDriveMinutes != null ||
        item.details.driveEstimateNote
      ) {
        patch({
          verifiedDriveMiles: undefined,
          estimatedDriveMinutes: undefined,
          driveEstimateNote: undefined,
        });
      }
      return;
    }
    if (!driveEstimateQuery.data) return;
    const nextMiles = driveEstimateQuery.data.miles || 0;
    const nextMinutes = driveEstimateQuery.data.estimatedMinutes || 0;
    const nextNote = driveEstimateQuery.data.note || undefined;
    if (
      item.details.verifiedDriveMiles === nextMiles &&
      item.details.estimatedDriveMinutes === nextMinutes &&
      item.details.driveEstimateNote === nextNote
    ) {
      return;
    }
    patch({
      verifiedDriveMiles: nextMiles,
      estimatedDriveMinutes: nextMinutes,
      driveEstimateNote: nextNote,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMoving,
    canEstimateDrive,
    driveEstimateQuery.data?.miles,
    driveEstimateQuery.data?.estimatedMinutes,
    driveEstimateQuery.data?.note,
  ]);

  function toggleSpecial(label: string) {
    const cur = item.details.specialItems || [];
    const next = cur.includes(label) ? cur.filter(s => s !== label) : [...cur, label];
    patch({ specialItems: next });
  }

  function shortSpecialLabel(label: string) {
    if (/grand piano/i.test(label)) return "Grand piano";
    if (/upright piano/i.test(label)) return "Upright piano";
    if (/pool table/i.test(label)) return "Pool table";
    if (/hot tub/i.test(label)) return "Hot tub";
    if (/safe/i.test(label)) return "Safe";
    if (/appliance|fitness/i.test(label)) return "Appliance";
    return "Other heavy";
  }

  return (
    <div className="space-y-3" data-testid={`pkg-picker-${item.serviceCode}`}>
      {isMoving && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <Label className="text-xs">What kind of moving quote are we building?</Label>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {MOVING_PATHS.map((path) => {
              const Icon = path.icon;
              const active = item.details.movingPath === path.id;
              return (
                <button
                  key={path.id}
                  type="button"
                  onClick={() => applyMovingPath(path)}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-all active:scale-[0.98]",
                    active
                      ? "border-blue-500 bg-blue-500/15 text-blue-100"
                      : "border-border bg-card hover:border-blue-500/50",
                  )}
                  data-testid={`moving-path-${path.id}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground",
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black leading-tight">{path.label}</span>
                      <span className="block text-[10px] text-muted-foreground">{path.subline}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {selectedPath && (
            <p className="mt-2 text-[11px] text-sky-300">
              Filtered path: {selectedPath.label}. We'll only ask what matters for this job.
            </p>
          )}
        </div>
      )}
      {!isMoving && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Label className="text-xs">Junk Removal Quote Builder</Label>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Size it by truck load, room cleanout, or item-by-item details.
              </p>
            </div>
            <div className="text-right text-[10px] text-muted-foreground">
              <p className="font-black text-foreground">{JUNK_TIER_LABEL[junkSummary.tier]}</p>
              <p>{formatLoadFraction(junkSummary.loadFraction)}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {JUNK_SIZING_METHODS.map((method) => {
              const Icon = method.icon;
              const active = item.details.junkSizingMethod === method.id;
              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => applyJunkMethod(method)}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-all active:scale-[0.98]",
                    active
                      ? "border-blue-500 bg-blue-500/15 text-blue-100"
                      : "border-border bg-card hover:border-blue-500/50",
                  )}
                  data-testid={`junk-method-${method.id}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground",
                    )}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black leading-tight">{method.label}</span>
                      <span className="block text-[10px] text-muted-foreground">{method.subline}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {item.details.junkSizingMethod === "truck_load" && (
            <div className="mt-3">
              <Label className="text-xs">Truck load visual</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {JUNK_TRUCK_LOAD_OPTIONS.map((option) => {
                  const active = item.details.junkLoadFraction === option.loadFraction;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => applyJunkTruckLoad(option)}
                      className={cn(
                        "rounded-md border px-2 py-2 text-xs font-bold transition-all",
                        active
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                          : "border-border bg-card hover:border-foreground/30",
                      )}
                      data-testid={`junk-truck-load-${option.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {item.details.junkSizingMethod === "room_cleanout" && (
            <div className="mt-3">
              <Label className="text-xs">Room cleanout shortcut</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {JUNK_ROOM_CLEANOUT_OPTIONS.map((option) => {
                  const active = item.details.junkLoadFraction === option.loadFraction && item.details.junkLoadTier === option.tier;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => applyJunkRoomCleanout(option)}
                      className={cn(
                        "rounded-md border px-2 py-2 text-xs font-bold transition-all",
                        active
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                          : "border-border bg-card hover:border-foreground/30",
                      )}
                      data-testid={`junk-room-${option.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {item.details.junkSizingMethod && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Details / extra-fee items</Label>
                <span className="text-[10px] text-muted-foreground">
                  Fridge +$100 · Mattress +$50 · TV +$50
                </span>
              </div>
              {JUNK_ITEM_SECTIONS.map((section) => {
                const SectionIcon = section.icon;
                const isOpen = openJunkSections.has(section.id);
                const sectionSummary = summarizeJunkSection(section.itemIds);
                const sectionOptions = JUNK_ITEM_OPTIONS.filter((option) => section.itemIds.includes(option.id));
                const summaryText = sectionSummary.count > 0
                  ? `${sectionSummary.count} item${sectionSummary.count === 1 ? "" : "s"} · +${sectionSummary.load.toFixed(2)} load${sectionSummary.extraFee ? " · extras" : ""}${sectionSummary.needsReview ? " · review" : ""}`
                  : "Tap to open";
                return (
                  <div
                    key={section.id}
                    className="overflow-hidden rounded-lg border border-border bg-card"
                    data-testid={`junk-section-${section.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleJunkSection(section.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                      aria-expanded={isOpen}
                      data-testid={`junk-section-toggle-${section.id}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          sectionSummary.count > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-muted text-muted-foreground",
                        )}>
                          <SectionIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-black leading-tight">{section.label}</span>
                          <span className="block text-[10px] text-muted-foreground">{section.subline}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={cn(
                          "max-w-[11rem] truncate rounded-full px-2 py-1 text-[10px] font-bold",
                          sectionSummary.count > 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground",
                        )}>
                          {summaryText}
                        </span>
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="grid grid-cols-1 gap-2 border-t border-border/70 p-2 sm:grid-cols-2 lg:grid-cols-3">
                        {sectionOptions.map((option) => {
                          const Icon = option.icon;
                          const selected = junkItems.find((entry) => entry.id === option.id);
                          const qty = selected?.quantity || 0;
                          return (
                            <div
                              key={option.id}
                              className={cn(
                                "rounded-lg border p-2",
                                qty > 0 ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-background",
                              )}
                              data-testid={`junk-item-${option.id}`}
                            >
                              <button
                                type="button"
                                onClick={() => updateJunkItem(option, 1)}
                                className="w-full text-left"
                              >
                                <span className="flex items-center gap-2">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                                    <Icon className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-xs font-bold leading-tight">{option.label}</span>
                                    <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">
                                      {option.specialistReview ? "Specialist review" : option.extraFee ? `+$${option.extraFee} extra fee` : option.category}
                                    </span>
                                  </span>
                                </span>
                              </button>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateJunkItem(option, -1)}
                                  disabled={qty === 0}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
                                  aria-label={`Remove ${option.label}`}
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="text-xs font-black">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => updateJunkItem(option, 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
                                  aria-label={`Add ${option.label}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
                <p className="font-black text-sky-200">
                  {JUNK_TIER_LABEL[junkSummary.tier]} · {formatLoadFraction(junkSummary.loadFraction)}
                  {junkSummary.extraFee > 0 ? ` · $${junkSummary.extraFee} extra fees` : ""}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Specialist confirms final quote.
                </p>
                {junkSummary.constructionReview && (
                  <p className="mt-1 text-amber-300">
                    Construction debris or special disposal needs review; the high end of the range may change.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {isMoving && onServiceAddressChange && (
        <div>
          <Label className="text-xs">
            {item.details.movingPath === "unload_only" ? "Unload / service address" : "Pickup / service address"}
          </Label>
          <PlacesAutocomplete
            value={serviceAddress}
            onChange={onServiceAddressChange}
            onPlaceSelect={(place) => onServiceAddressChange(place.fullAddress)}
            placeholder="Start typing the pickup address"
            inputClassName="mt-1 w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-orange-500/30"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            This drives the route, travel time, and JC truck mileage.
          </p>
        </div>
      )}

      {isMoving && (
      <div>
        <Label className="text-xs">{isMoving ? "How big is the move?" : "How much junk?"}</Label>
        <select
          value={item.details.jobSize || ""}
          onChange={(e) => patch({ jobSize: e.target.value || undefined })}
          className="mt-1 w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
          data-testid={`pkg-jobsize-${item.serviceCode}`}
        >
          <option value="">Pick a size…</option>
          {(isMoving ? FILTERED_MOVING_SIZES : PICKER_HOME_SIZES).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      )}

      {isMoving && !hideLoadChoice && (
        <div>
          <Label className="text-xs">Do you need help loading, unloading, or both?</Label>
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            {PICKER_LOAD_TYPES.map(opt => {
              const active = item.details.loadType === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => patch({ loadType: opt })}
                  className={cn(
                    "text-[11px] px-2 py-1.5 rounded-md border text-center leading-tight transition-all",
                    active
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                      : "border-border bg-card hover:border-foreground/30",
                  )}
                  data-testid={`pkg-loadtype-${item.serviceCode}-${opt.slice(0, 4)}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isMoving && (
        <div>
          <Label className="text-xs">Do you need us to provide a truck?</Label>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {[
              { label: "Customer provides truck", value: false },
              { label: "JC provides truck", value: true },
            ].map((opt) => {
              const active = item.details.truckNeeded === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => patch({
                    truckNeeded: opt.value,
                    truckSize: item.details.truckSize,
                    truckFee: opt.value ? item.details.truckFee : undefined,
                    truckBaseFee: opt.value ? item.details.truckBaseFee : undefined,
                    truckMileageFee: opt.value ? item.details.truckMileageFee : undefined,
                    truckIncludedMiles: opt.value ? item.details.truckIncludedMiles : undefined,
                    truckExtraMiles: opt.value ? item.details.truckExtraMiles : undefined,
                    truckExtraMileRate: opt.value ? item.details.truckExtraMileRate : undefined,
                  })}
                  className={cn(
                    "text-[11px] px-2 py-1.5 rounded-md border text-center leading-tight transition-all",
                    active
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                      : "border-border bg-card hover:border-foreground/30",
                  )}
                  data-testid={`pkg-truck-needed-${item.serviceCode}-${opt.value ? "yes" : "no"}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isMoving && item.details.truckNeeded != null && (
        <div>
          <Label className="text-xs">Truck size</Label>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {PICKER_TRUCK_SIZES.map((size) => {
              const active = item.details.truckSize === size;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => patch({ truckSize: size })}
                  className={cn(
                    "text-[11px] px-2 py-1.5 rounded-md border text-center leading-tight transition-all",
                    active
                      ? "border-orange-400 bg-orange-500/20 text-orange-300"
                      : "border-border bg-card hover:border-foreground/30",
                  )}
                  data-testid={`pkg-truck-size-${item.serviceCode}-${size.slice(0, 2)}`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(needsDropoffAddress || showDropoffForPath) && (
        <div>
          <Label className="text-xs">Drop-off address</Label>
          <PlacesAutocomplete
            value={item.details.dropoffAddress || ""}
            onChange={(value) => patch({ dropoffAddress: value || undefined })}
            onPlaceSelect={(place) => patch({ dropoffAddress: place.fullAddress || undefined })}
            placeholder="Start typing the destination address"
            inputClassName="w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            inputTestId={`pkg-dropoff-${item.serviceCode}`}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            We use this with the verified pickup address to estimate drive time.
          </p>
        </div>
      )}

      {showInventoryBuilder && (
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Label className="text-xs">Build your moving story</Label>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Start with the main rooms and tap what is moving. We will turn the story into the right crew and truck setup.
              </p>
            </div>
            {inventoryItems.length > 0 && (
              <div className="text-right text-[10px] text-muted-foreground">
                <p className="font-black text-foreground">
                  {inventoryItems.reduce((sum, entry) => sum + entry.quantity, 0)} item{inventoryItems.reduce((sum, entry) => sum + entry.quantity, 0) === 1 ? "" : "s"}
                </p>
                <p>{inventorySummary.crew} movers</p>
              </div>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {MOVING_INVENTORY_SECTIONS.map((section) => {
              const SectionIcon = section.icon;
              const isOpen = openInventorySections.has(section.id);
              const sectionSummary = summarizeSection(section.itemIds);
              const sectionOptions = MOVING_INVENTORY_OPTIONS.filter((option) => section.itemIds.includes(option.id));
              return (
                <div
                  key={section.id}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                  data-testid={`inventory-section-${section.id}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleInventorySection(section.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
                    aria-expanded={isOpen}
                    data-testid={`inventory-section-toggle-${section.id}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        sectionSummary.count > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-muted text-muted-foreground",
                      )}>
                        <SectionIcon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black leading-tight">{section.label}</span>
                        <span className="block text-[10px] text-muted-foreground">{section.subline}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn(
                        "rounded-full px-2 py-1 text-[10px] font-bold",
                        sectionSummary.count > 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground",
                      )}>
                        {sectionSummary.count > 0
                          ? `${sectionSummary.count} item${sectionSummary.count === 1 ? "" : "s"} selected`
                          : "Tap to open"}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-1 gap-2 border-t border-border/70 p-2 sm:grid-cols-2 lg:grid-cols-3">
                      {sectionOptions.map((option) => {
                        const selected = inventoryItems.find((entry) => entry.id === option.id);
                        const qty = selected?.quantity || 0;
                        return (
                          <div
                            key={option.id}
                            className={cn(
                              "rounded-lg border p-2",
                              qty > 0 ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-background",
                            )}
                            data-testid={`inventory-item-${option.id}`}
                          >
                            <button
                              type="button"
                              onClick={() => updateInventory(option, 1)}
                              className="w-full text-left"
                            >
                              <span className="flex items-center gap-2">
                                <span className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                  <InventoryItemVisual option={option} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-xs font-bold leading-tight">{option.label}</span>
                                  <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{option.category}</span>
                                </span>
                              </span>
                            </button>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => updateInventory(option, -1)}
                                disabled={qty === 0}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border disabled:opacity-40"
                                aria-label={`Remove ${option.label}`}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-xs font-black">{qty}</span>
                              <button
                                type="button"
                                onClick={() => updateInventory(option, 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
                                aria-label={`Add ${option.label}`}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {inventoryItems.length > 0 && (
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs">
              <p className="font-black text-sky-200">
                Recommended setup: {inventorySummary.crew} movers · {inventorySummary.truck}
              </p>
              <p className="mt-1 text-muted-foreground">
                Your estimate appears at review using your location, crew, and schedule. A specialist confirms the final quote before scheduling.
              </p>
            </div>
          )}
        </div>
      )}

      <PreferredScheduleFields
        date={item.details.requestedDate}
        startTime={item.details.requestedStartTime}
        onChange={patch}
        dateLabel="Preferred date"
        dateTestId={`pkg-date-${item.serviceCode}`}
        timeTestId={`pkg-start-time-${item.serviceCode}`}
      />

      {isMoving && (
        <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <MapPin className="h-3 w-3 mt-0.5 shrink-0 text-sky-400" />
          {!trimmedPickupAddress ? (
            <p>Add the pickup address to verify drive time.</p>
          ) : needsDropoffAddress && trimmedDropoffAddress.length < 5 ? (
            <p>Add the drop-off address to calculate the full route.</p>
          ) : driveEstimateQuery.isLoading ? (
            <p className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Verifying drive time...
            </p>
          ) : item.details.verifiedDriveMiles && item.details.estimatedDriveMinutes ? (
            <div className="space-y-0.5">
              <p>~{Math.round(item.details.verifiedDriveMiles)} miles away - ~{item.details.estimatedDriveMinutes} min</p>
              {truckRental && (
                <p className="text-sky-300">
                  JC truck includes {JC_TRUCK_INCLUDED_MILES} miles
                  {truckRental.mileageFee > 0 ? ` - ${truckRental.extraMiles} extra miles apply` : ""}
                </p>
              )}
            </div>
          ) : driveEstimateQuery.isError ? (
            <p>Drive time will be confirmed after review.</p>
          ) : null}
        </div>
      )}

      <div>
        <Label className="text-xs flex items-center gap-1">
          <Package className="h-3 w-3" /> Recommended crew
        </Label>
        {!quote ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Pick a {isMoving ? "move size" : "load size"} to get the crew recommendation.
          </p>
        ) : packages.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No standard packages available. Darrell will confirm the right setup.
          </p>
        ) : item.details.packageId === "visual_inventory_estimate" ? (
          <div className="mt-1.5 rounded-xl border border-emerald-500 bg-emerald-500/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold">Inventory estimate saved</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {item.details.crew || inventorySummary.crew} movers recommended from the items selected.
                </p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            </div>
            {packages.length > 0 && (
              <button
                type="button"
                onClick={() => setShowMorePackages((v) => !v)}
                className="mt-2 text-[11px] font-semibold text-sky-300 hover:text-sky-200"
              >
                {showMorePackages ? "Hide crew options" : "Choose a different crew setup"}
              </button>
            )}
          </div>
        ) : selectedPackage ? (
          <div className="mt-1.5 rounded-xl border border-emerald-500 bg-emerald-500/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold flex items-center gap-1.5">
                  {selectedPackage.label}
                  {selectedPackage.tag && (
                    <span className="text-[10px] font-bold text-orange-400 bg-orange-500/15 px-1.5 py-0.5 rounded">
                      {selectedPackage.tag}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{selectedPackage.desc}</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            </div>
            {packages.length > 1 && (
              <button
                type="button"
                onClick={() => setShowMorePackages((v) => !v)}
                className="mt-2 text-[11px] font-semibold text-sky-300 hover:text-sky-200"
              >
                {showMorePackages ? "Hide other crew options" : "See more crew options"}
              </button>
            )}
          </div>
        ) : null}
        {showMorePackages && packages.length > 1 && (
          <div className="mt-2 space-y-2">
            {packages.map(pkg => {
              const active = item.details.packageId === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => applyPackage(pkg)}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition-all",
                    active
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-border bg-card hover:border-orange-500/40",
                  )}
                  data-testid={`pkg-option-${pkg.id}`}
                >
                  <p className="text-sm font-bold">{pkg.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{pkg.desc}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <details className="rounded-lg border border-border/70 bg-background/40">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold flex items-center justify-between">
          Optional details
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </summary>
        <div className="border-t border-border/60 p-3 space-y-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              id={`stairs-${item.serviceCode}`}
              type="checkbox"
              checked={!!item.details.hasStairs}
              onChange={(e) => patch({ hasStairs: e.target.checked })}
              className="h-4 w-4"
              data-testid={`pkg-stairs-${item.serviceCode}`}
            />
            {isMoving ? "Stairs at pickup or drop-off" : "Stairs, long carry, or difficult access"}
          </label>

          {isMoving && (
            <div>
              <Label className="text-xs">Promo code</Label>
              <Input
                value={item.details.promoCode || ""}
                onChange={(e) => patch({ promoCode: e.target.value.toUpperCase() || undefined })}
                placeholder="JCMOVES"
                data-testid={`pkg-promo-${item.serviceCode}`}
                className="uppercase"
              />
            </div>
          )}

          <div>
            <Label className="text-xs">Anything we should know?</Label>
            <Textarea
              value={item.details.notes || item.details.scope || ""}
              onChange={(e) => patch({ notes: e.target.value, scope: undefined })}
              placeholder="Gate code, parking, tight stairs, inventory notes, timing..."
              rows={3}
              data-testid={`pkg-notes-${item.serviceCode}`}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

// ── InlineItemConfigure ────────────────────────────────────────────────────
// Renders the full per-item editor (qty, scheduling, scope, notes) inline
// inside the service card. Used by the wizard's "configure" step so users
// can edit every field without opening a modal/drawer.
export function InlineItemConfigure({
  item, onChange, onRemove, warning, serviceAddress, onServiceAddressChange, onRequestContinue,
}: {
  item: SelectedItem;
  onChange: (next: SelectedItem) => void;
  onRemove: () => void;
  warning?: string | null;
  serviceAddress?: string;
  onServiceAddressChange?: (value: string) => void;
  onRequestContinue?: () => void;
}) {
  const usesPicker = usesPackagePicker(item.serviceCode);
  const isMoving = item.serviceCode === "moving";
  const mode = schedulingModeFor(item.serviceCode);
  const showQty = item.priceMode === "hourly" || item.priceMode === "per_unit";
  const lineSubtotal = item.quantity * item.unitPrice;
  const freqOptions = BUNDLE_FREQUENCY_OPTIONS[item.serviceCode] || [];

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 space-y-3",
        warning ? "border-amber-500/60 ring-1 ring-amber-500/20" : "border-border",
      )}
      data-testid={`inline-item-${item.serviceCode}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{emojiFor(item.serviceCode)}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{item.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {usesPicker && item.details.packageLabel
              ? item.details.packageLabel
              : "Price shown on review"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-muted-foreground">Review</p>
        </div>
      </div>

      {usesPicker && (
        <MovingJunkPackagePicker
          item={item}
          onChange={onChange}
          serviceAddress={serviceAddress || ""}
          onServiceAddressChange={onServiceAddressChange}
        />
      )}

      {usesPicker && isMoving && (
        <div
          className={cn(
            "rounded-xl border p-3 sm:p-4",
            warning
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-emerald-500/40 bg-emerald-500/10",
          )}
          data-testid="moving-card-confirmation"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-black text-foreground">
                {warning ? "Finish this moving quote" : "Moving job ready for review"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {warning
                  ? warning
                  : `${item.details.packageLabel || "Crew reserved"} · ${item.details.loadType || "Moving help"} · final estimate appears on review.`}
              </p>
            </div>
            <Button
              type="button"
              onClick={onRequestContinue}
              disabled={!!warning || !onRequestContinue}
              className="w-full sm:w-auto shrink-0"
              data-testid="moving-inline-continue"
            >
              Continue to contact
            </Button>
          </div>
          {!warning && (
            <p className="mt-2 text-[11px] text-emerald-300">
              Next we’ll grab your name and phone, then you’ll confirm the request.
            </p>
          )}
        </div>
      )}

      {/* Qty (hourly / per_unit only). Hidden when the package picker drives
          this card (Moving / Junk Removal) so we don't show two pricing UIs. */}
      {!usesPicker && showQty && (
        <div>
          <Label className="text-xs">{item.priceMode === "hourly" ? "Hours" : "Quantity"}</Label>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => onChange({ ...item, quantity: Math.max(1, item.quantity - 1) })}
              className="w-8 h-8 rounded-md border border-border flex items-center justify-center hover:bg-muted"
              data-testid={`inline-qty-minus-${item.serviceCode}`}
            ><Minus className="h-3 w-3" /></button>
            <span className="text-sm font-bold w-8 text-center">{item.quantity}</span>
            <button
              type="button"
              onClick={() => onChange({ ...item, quantity: item.quantity + 1 })}
              className="w-8 h-8 rounded-md border border-border flex items-center justify-center hover:bg-muted"
              data-testid={`inline-qty-plus-${item.serviceCode}`}
            ><Plus className="h-3 w-3" /></button>
          </div>
        </div>
      )}

      {/* Scheduling — package picker handles its own date + notes for
          Moving / Junk Removal, so skip the generic block when active. */}
      {!usesPicker && (mode === "call_only" ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5 flex items-start gap-2" data-testid={`inline-call-only-${item.serviceCode}`}>
          <PhoneCall className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-snug">
            Quick chat needed — we'll call within 24 hours after submission to lock in the schedule.
          </p>
        </div>
      ) : (
        <>
          <PreferredScheduleFields
            date={item.details.requestedDate}
            startTime={item.details.requestedStartTime}
            onChange={(next) => onChange({ ...item, details: { ...item.details, ...next } })}
            dateLabel="Preferred start date"
            dateTestId={`inline-date-${item.serviceCode}`}
            timeTestId={`inline-start-time-${item.serviceCode}`}
          />
          {mode === "date_freq" && freqOptions.length > 0 && (
            <div>
              <Label className="text-xs">Frequency</Label>
              <div className="flex flex-wrap gap-1.5 mt-1" data-testid={`inline-freq-${item.serviceCode}`}>
                {freqOptions.map(opt => {
                  const active = item.details.frequency === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChange({ ...item, details: { ...item.details, frequency: opt.value } })}
                      className={cn(
                        "text-[11px] px-2.5 py-1 rounded-full border transition-all",
                        active
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                          : "border-border bg-card hover:border-foreground/30",
                      )}
                      data-testid={`inline-freq-${item.serviceCode}-${opt.value}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ))}

      {/* Task #144 + #146 — Trash Valet: capture cans, bags, service day,
          plan type and the recycling upsell so the admin pipeline can
          auto-provision the subscription without a follow-up phone call. */}
      {item.serviceCode === "trash_valet" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Number of cans</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={item.details.cans ?? 1}
                onChange={(e) => onChange({
                  ...item,
                  details: { ...item.details, cans: Math.max(1, Number(e.target.value) || 1) },
                })}
                data-testid={`inline-cans-${item.serviceCode}`}
              />
            </div>
            <div>
              <Label className="text-xs">Extra bags</Label>
              <Input
                type="number"
                min={0}
                max={50}
                value={item.details.bagCount ?? 0}
                onChange={(e) => onChange({
                  ...item,
                  details: { ...item.details, bagCount: Math.max(0, Number(e.target.value) || 0) },
                })}
                data-testid={`inline-bags-${item.serviceCode}`}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Trash pickup day</Label>
            <div className="flex flex-wrap gap-1.5 mt-1" data-testid={`inline-day-${item.serviceCode}`}>
              {[
                { value: 1, label: "Mon" },
                { value: 2, label: "Tue" },
                { value: 3, label: "Wed" },
                { value: 4, label: "Thu" },
                { value: 5, label: "Fri" },
                { value: 6, label: "Sat" },
              ].map(opt => {
                const active = (item.details.serviceDayOfWeek ?? 1) === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({ ...item, details: { ...item.details, serviceDayOfWeek: opt.value } })}
                    className={cn(
                      "text-[11px] px-2.5 py-1 rounded-full border transition-all",
                      active
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                        : "border-border bg-card hover:border-foreground/30",
                    )}
                    data-testid={`inline-day-${item.serviceCode}-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs">Billing plan</Label>
            <div className="flex flex-wrap gap-1.5 mt-1" data-testid={`inline-plan-${item.serviceCode}`}>
              {[
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly (11 months charged · 12 served)" },
              ].map(opt => {
                const active = (item.details.planType ?? "monthly") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange({
                      ...item,
                      details: { ...item.details, planType: opt.value as "monthly" | "yearly" },
                    })}
                    className={cn(
                      "text-[11px] px-2.5 py-1 rounded-full border transition-all",
                      active
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                        : "border-border bg-card hover:border-foreground/30",
                    )}
                    data-testid={`inline-plan-${item.serviceCode}-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="flex items-center gap-2">
              <input
                id={`recycling-${item.serviceCode}`}
                type="checkbox"
                checked={!!item.details.recyclingEnabled}
                onChange={(e) => onChange({ ...item, details: { ...item.details, recyclingEnabled: e.target.checked } })}
                className="h-4 w-4"
                data-testid={`inline-recycling-${item.serviceCode}`}
              />
              <Label htmlFor={`recycling-${item.serviceCode}`} className="text-xs cursor-pointer flex items-center gap-1.5">
                ♻️ Add bi-weekly recycling-can pickup
              </Label>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 ml-6">
              We'll roll your recycling can to the curb every other week alongside your trash service.
            </p>

            {item.details.recyclingEnabled && (
              <div className="mt-2.5 ml-6 space-y-2">
                <div>
                  <Label className="text-xs">Recycling pickup day</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1" data-testid={`inline-recycling-day-${item.serviceCode}`}>
                    {[
                      { value: 1, label: "Mon" },
                      { value: 2, label: "Tue" },
                      { value: 3, label: "Wed" },
                      { value: 4, label: "Thu" },
                      { value: 5, label: "Fri" },
                      { value: 6, label: "Sat" },
                    ].map(opt => {
                      const active = (item.details.recyclingDayOfWeek ?? item.details.serviceDayOfWeek ?? 1) === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => onChange({
                            ...item,
                            details: { ...item.details, recyclingDayOfWeek: opt.value },
                          })}
                          className={cn(
                            "text-[11px] px-2.5 py-1 rounded-full border transition-all",
                            active
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-border bg-card hover:border-foreground/30",
                          )}
                          data-testid={`inline-recycling-day-${item.serviceCode}-${opt.value}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">First recycling week starts</Label>
                  <DatePicker
                    value={item.details.recyclingAnchorDate}
                    onChange={(v) => onChange({
                      ...item,
                      details: { ...item.details, recyclingAnchorDate: v || undefined },
                    })}
                    placeholder="Pick the anchor date"
                    testId={`inline-recycling-anchor-${item.serviceCode}`}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!usesPicker && (
        <>
          <div>
            <Label className="text-xs">Scope (what should we focus on?)</Label>
            <Input
              value={item.details.scope || ""}
              onChange={(e) => onChange({ ...item, details: { ...item.details, scope: e.target.value } })}
              placeholder="e.g. front yard only, 1 truckload"
              data-testid={`inline-scope-${item.serviceCode}`}
            />
          </div>

          <div>
            <Label className="text-xs">Notes / special instructions (optional)</Label>
            <Textarea
              value={item.details.notes || ""}
              onChange={(e) => onChange({ ...item, details: { ...item.details, notes: e.target.value } })}
              placeholder="Gate code, parking notes, anything we should know"
              rows={2}
              data-testid={`inline-notes-${item.serviceCode}`}
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-between pt-1">
        {warning ? (
          <p className="text-[11px] text-amber-500 flex items-center gap-1" data-testid={`inline-warning-${item.serviceCode}`}>
            <AlertCircle className="h-3 w-3" /> {warning}
          </p>
        ) : (
          <p className="text-[11px] text-emerald-500 flex items-center gap-1" data-testid={`inline-ok-${item.serviceCode}`}>
            <CheckCircle2 className="h-3 w-3" /> Ready
          </p>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="px-2.5 py-1 rounded-md border border-destructive/40 text-destructive text-[11px] hover:bg-destructive/10 flex items-center gap-1"
          data-testid={`inline-remove-${item.serviceCode}`}
        >
          <Trash2 className="h-3 w-3" /> Remove
        </button>
      </div>
    </div>
  );
}

// ── AddOnDrawer (inline drawer using Sheet) ────────────────────────────────
// Reuses the same scheduling pattern as BundleServiceScheduler:
// per service code, the drawer renders one of three layouts:
//   - call_only:  no date input, "we'll call you" message + flag set
//   - date_only:  preferred date picker
//   - date_freq:  date + frequency chips (weekly/biweekly etc.)
export function AddOnDrawer({
  open, item, onClose, onSave,
}: {
  open: boolean;
  item: SelectedItem | null;
  onClose: () => void;
  onSave: (next: SelectedItem) => void;
}) {
  const [draft, setDraft] = useState<SelectedItem | null>(null);

  // Reset draft when the targeted item changes (or drawer reopens for a new item).
  useEffect(() => {
    if (item) {
      setDraft({
        ...item,
        details: {
          ...item.details,
          // Default call_only services to "callToSchedule = true" so the
          // submitted booking carries the right flag without user input.
          callToSchedule:
            item.details.callToSchedule ??
            (schedulingModeFor(item.serviceCode) === "call_only" ? true : undefined),
        },
      });
    } else {
      setDraft(null);
    }
  }, [item]);

  if (!open || !item || !draft) return null;

  const mode = schedulingModeFor(draft.serviceCode);
  const showQty = draft.priceMode === "hourly" || draft.priceMode === "per_unit";
  const freqOptions = BUNDLE_FREQUENCY_OPTIONS[draft.serviceCode] || [];

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto" data-testid="addon-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="text-2xl">{emojiFor(draft.serviceCode)}</span>
            {draft.label}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          {showQty && (
            <div>
              <Label className="text-xs">{draft.priceMode === "hourly" ? "Hours" : "Quantity"}</Label>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, quantity: Math.max(1, draft.quantity - 1) })}
                  className="w-9 h-9 rounded-md border border-border flex items-center justify-center"
                ><Minus className="h-4 w-4" /></button>
                <Input
                  type="number"
                  min={1}
                  value={draft.quantity}
                  onChange={(e) => setDraft({ ...draft, quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-20 text-center"
                  data-testid="drawer-quantity"
                />
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, quantity: draft.quantity + 1 })}
                  className="w-9 h-9 rounded-md border border-border flex items-center justify-center"
                ><Plus className="h-4 w-4" /></button>
                <span className="text-xs text-muted-foreground ml-2">
                  {priceModeLabel(draft.priceMode, draft.unitPrice)}
                </span>
              </div>
            </div>
          )}

          {mode === "call_only" ? (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 flex items-start gap-2" data-testid="drawer-call-only">
              <PhoneCall className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-snug">
                Quick chat needed for {draft.label.toLowerCase()} — we'll call you within 24 hours after submission to lock in details.
              </p>
            </div>
          ) : (
            <>
              <PreferredScheduleFields
                date={draft.details.requestedDate}
                startTime={draft.details.requestedStartTime}
                onChange={(next) => setDraft({ ...draft, details: { ...draft.details, ...next } })}
                dateLabel="Preferred start date"
                dateTestId="drawer-date"
                timeTestId="drawer-start-time"
              />
              {mode === "date_freq" && freqOptions.length > 0 && (
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1" data-testid="drawer-frequency">
                    {freqOptions.map(opt => {
                      const active = draft.details.frequency === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDraft({ ...draft, details: { ...draft.details, frequency: opt.value } })}
                          className={cn(
                            "text-[11px] px-2.5 py-1 rounded-full border transition-all",
                            active
                              ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                              : "border-border bg-card hover:border-foreground/30",
                          )}
                          data-testid={`drawer-freq-${opt.value}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <Label className="text-xs">Scope (what should we focus on?)</Label>
            <Input
              value={draft.details.scope || ""}
              onChange={(e) => setDraft({ ...draft, details: { ...draft.details, scope: e.target.value } })}
              placeholder="e.g. front yard only, 1 truckload"
              data-testid="drawer-scope"
            />
          </div>
          <div>
            <Label className="text-xs">Notes / special instructions</Label>
            <Textarea
              value={draft.details.notes || ""}
              onChange={(e) => setDraft({ ...draft, details: { ...draft.details, notes: e.target.value } })}
              placeholder="Gate code, parking notes, anything we should know"
              rows={3}
              data-testid="drawer-notes"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => onSave(draft)}
              data-testid="drawer-save"
            >
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── BookingSummarySticky ───────────────────────────────────────────────────
export function BookingSummarySticky({
  items, quote, isQuoting, onCheckout, canCheckout, bottomSlot, showPricing = true,
}: {
  items: SelectedItem[];
  quote: QuoteResult | null;
  isQuoting: boolean;
  onCheckout: () => void;
  canCheckout: boolean;
  showPricing?: boolean;
  /** Optional replacement for the default checkout CTA (e.g. wizard Back/Continue). */
  bottomSlot?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const subtotal = quote?.subtotal ?? items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discount = quote?.discountTotal ?? 0;
  const serviceAddressDiscountAmount = quote?.serviceAddressDiscount?.amount ?? 0;
  const bundleDiscountAmount = Math.max(0, discount - serviceAddressDiscountAmount);
  const finalTotal = quote?.finalTotal ?? subtotal - discount;
  const tokens = quote?.tokenEstimate ?? 0;
  const crew = quoteCrewSize(quote, items);
  const hasQuoteItems = items.some(i => i.priceMode !== "quote");

  // Desktop sticky right panel
  const desktopPanel = (
    <aside className="hidden lg:block sticky top-4 self-start w-[320px] shrink-0">
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3" data-testid="summary-desktop">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Your booking</p>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a service to start your booking.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              {items.map((i, idx) => {
                return (
                  <div key={i.serviceCode} className="flex justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="block truncate">{emojiFor(i.serviceCode)} {i.label}</span>
                      {formatRequestedSchedule(i.details) && (
                        <span className="block truncate text-[10px] text-muted-foreground">{formatRequestedSchedule(i.details)}</span>
                      )}
                    </span>
                    <span className="font-semibold text-muted-foreground">{showPricing ? formatQuoteLinePrice(quote, i, idx).text : "Review"}</span>
                  </div>
                );
              })}
            </div>
            {showPricing ? (
            <div className="border-t border-border pt-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              {bundleDiscountAmount > 0 && quote?.bundleApplied && (
                <div className="flex justify-between text-sm text-emerald-500">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {quote.bundleApplied.name}</span>
                  <span>-${bundleDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              {quote?.serviceAddressDiscount && (
                <div className="flex justify-between gap-3 text-sm text-emerald-500">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {quote.serviceAddressDiscount.label}</span>
                  <span>-${quote.serviceAddressDiscount.amount.toFixed(2)}</span>
                </div>
              )}
              {quote?.serviceAddressPricingAdjustment && (
                <div className="flex justify-between gap-3 text-sm text-orange-500">
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {quote.serviceAddressPricingAdjustment.label}
                  </span>
                  <span>+${quote.serviceAddressPricingAdjustment.amount.toFixed(2)}</span>
                </div>
              )}
              {!quote?.serviceAddressDiscount && !quote?.serviceAddressPricingAdjustment && quote?.serviceAddressDiscountHint?.reason && (
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs leading-relaxed text-emerald-600 dark:text-emerald-200">
                  {quote.serviceAddressDiscountHint.reason}
                </div>
              )}
              {quote?.serviceAddressPricingAdjustment?.reason && (
                <div className="rounded-md border border-orange-500/20 bg-orange-500/10 p-2 text-xs leading-relaxed text-orange-700 dark:text-orange-200">
                  {quote.serviceAddressPricingAdjustment.reason}
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1">
                <span>Total</span>
                <span>{hasQuoteItems && finalTotal === 0 ? "Custom" : `$${finalTotal.toFixed(2)}`}</span>
              </div>
              {!hasQuoteItems && finalTotal === 0 && items.length > 0 && (
                <p className="text-[10px] text-muted-foreground">Final total confirmed after review</p>
              )}
            </div>
            ) : (
              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">Quote details are saved for specialist approval before final pricing.</p>
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              {crew > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Crew reserved: {crew}</span>}
              {showPricing && <span className="flex items-center gap-1 text-orange-400"><Coins className="h-3 w-3" /> +{tokens} JCMOVES</span>}
            </div>
            {bottomSlot ?? (
              <Button
                type="button"
                className="w-full"
                onClick={onCheckout}
                disabled={!canCheckout || isQuoting}
                data-testid="summary-checkout-desktop"
              >
                {isQuoting ? "Updating…" : "Continue to checkout"}
              </Button>
            )}
          </>
        )}
      </div>
    </aside>
  );

  // Mobile docked bar
  const mobileBar = (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm" data-testid="summary-mobile">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2 text-left"
        data-testid="summary-mobile-toggle"
      >
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Your booking</span>
          <span className="text-sm font-bold">
            {items.length === 0 ? "No items yet" : showPricing ? `${items.length} item${items.length === 1 ? "" : "s"} • $${finalTotal.toFixed(0)}` : `${items.length} item${items.length === 1 ? "" : "s"} • review price at end`}
            {showPricing && discount > 0 && <span className="text-emerald-500 text-xs ml-1">(−${discount.toFixed(0)})</span>}
          </span>
        </div>
        {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {!collapsed && items.length > 0 && (
        <div className="px-4 pb-2 space-y-1.5 max-h-48 overflow-y-auto">
          {items.map((i, idx) => {
            return (
              <div key={i.serviceCode} className="flex justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate">{emojiFor(i.serviceCode)} {i.label}</span>
                  {formatRequestedSchedule(i.details) && (
                    <span className="block truncate text-[10px] text-muted-foreground">{formatRequestedSchedule(i.details)}</span>
                  )}
                </span>
                <span className="font-semibold text-muted-foreground">{showPricing ? formatQuoteLinePrice(quote, i, idx).text : "Review"}</span>
              </div>
            );
          })}
          {showPricing ? (
          <>
          <div className="flex justify-between text-xs pt-1 border-t border-border">
            <span className="text-muted-foreground">Subtotal</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          {bundleDiscountAmount > 0 && quote?.bundleApplied && (
            <div className="flex justify-between text-xs text-emerald-500">
              <span>{quote.bundleApplied.name}</span>
              <span>-${bundleDiscountAmount.toFixed(2)}</span>
            </div>
          )}
          {quote?.serviceAddressDiscount && (
            <div className="flex justify-between gap-3 text-xs text-emerald-500">
              <span>{quote.serviceAddressDiscount.label}</span>
              <span>-${quote.serviceAddressDiscount.amount.toFixed(2)}</span>
            </div>
          )}
          {quote?.serviceAddressPricingAdjustment && (
            <div className="flex justify-between gap-3 text-xs text-orange-500">
              <span>{quote.serviceAddressPricingAdjustment.label}</span>
              <span>+${quote.serviceAddressPricingAdjustment.amount.toFixed(2)}</span>
            </div>
          )}
          {!quote?.serviceAddressDiscount && !quote?.serviceAddressPricingAdjustment && quote?.serviceAddressDiscountHint?.reason && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2 text-[11px] leading-relaxed text-emerald-600 dark:text-emerald-200">
              {quote.serviceAddressDiscountHint.reason}
            </div>
          )}
          {quote?.serviceAddressPricingAdjustment?.reason && (
            <div className="rounded-md border border-orange-500/20 bg-orange-500/10 p-2 text-[11px] leading-relaxed text-orange-700 dark:text-orange-200">
              {quote.serviceAddressPricingAdjustment.reason}
            </div>
          )}
          <div className="flex justify-between text-[11px] text-muted-foreground">
            {crew > 0 && <span><Users className="inline h-3 w-3" /> Crew reserved: {crew}</span>}
            <span className="text-orange-400"><Coins className="inline h-3 w-3" /> +{tokens} JCMOVES</span>
          </div>
          </>
          ) : (
            <div className="text-[11px] text-muted-foreground border-t border-border pt-1">
              Specialist approval before final pricing.
            </div>
          )}
        </div>
      )}
      <div className="px-4 pb-3">
        {bottomSlot ?? (
          <Button
            type="button"
            className="w-full"
            onClick={onCheckout}
            disabled={!canCheckout || isQuoting}
            data-testid="summary-checkout-mobile"
          >
            {isQuoting ? "Updating…" : items.length === 0 ? "Add a service" : "Continue to checkout"}
          </Button>
        )}
      </div>
    </div>
  );

  return <>{desktopPanel}{mobileBar}</>;
}

// ── BundleSuggestionDialog ────────────────────────────────────────────────
// Smart popup that watches the cart and pops once at meaningful moments:
//  - "auto_applied": cart already qualifies for a featured bundle (savings
//    were applied automatically). Single OK button — purely informational.
//  - "one_away": no bundle is currently applied AND every selected service
//    belongs to one bundle that is missing exactly one service. Offers Add /
//    No thanks. Recommends the bundle with the highest expected discount.
// The page is responsible for tracking shown signatures so the same popup
// doesn't re-fire on the same cart shape.
export type BundleSuggestion =
  | { mode: "auto_applied"; bundle: FeaturedBundle; savings: number }
  | { mode: "one_away"; bundle: FeaturedBundle; missing: CatalogService };

export function BundleSuggestionDialog({
  suggestion, services, onAccept, onClose,
}: {
  suggestion: BundleSuggestion | null;
  services: CatalogService[];
  /** Called when user clicks the primary action.
   *  - auto_applied: just dismisses (acts like Close)
   *  - one_away: parent should add `suggestion.missing` to the cart */
  onAccept: () => void;
  onClose: () => void;
}) {
  const open = !!suggestion;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="bundle-suggestion-dialog" className="sm:max-w-md">
        {suggestion?.mode === "auto_applied" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-400" />
                You unlocked the {suggestion.bundle.name}!
              </DialogTitle>
              <DialogDescription>
                Saving you <span className="font-bold text-emerald-500">${suggestion.savings.toFixed(0)}</span> automatically — no code or coupon needed.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl bg-card border border-border p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Includes</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestion.bundle.serviceComboJson.map((code) => {
                  const svc = services.find((s) => s.code === code);
                  return (
                    <span key={code} className="text-xs bg-muted px-2 py-0.5 rounded-full">
                      {emojiFor(code)} {svc?.name || code}
                    </span>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onAccept} className="w-full" data-testid="bundle-dialog-ok">
                Sweet, got it
              </Button>
            </DialogFooter>
          </>
        )}
        {suggestion?.mode === "one_away" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-orange-400" />
                Add {suggestion.missing.name} to save{" "}
                {suggestion.bundle.discountType === "percent"
                  ? `${suggestion.bundle.discountValue}%`
                  : `$${parseFloat(suggestion.bundle.discountValue).toFixed(0)}`}
              </DialogTitle>
              <DialogDescription>
                You're one service away from the <span className="font-semibold">{suggestion.bundle.name}</span> bundle.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl bg-card border border-border p-3 flex items-center gap-3">
              <span className="text-3xl">{emojiFor(suggestion.missing.code)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{suggestion.missing.name}</p>
                {suggestion.missing.description && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{suggestion.missing.description}</p>
                )}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose} className="flex-1" data-testid="bundle-dialog-decline">
                No thanks
              </Button>
              <Button onClick={onAccept} className="flex-1" data-testid="bundle-dialog-add">
                Add &amp; save
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Validation banner ─────────────────────────────────────────────────────
export function ValidationBanner({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 flex gap-2" data-testid="validation-banner">
      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <ul className="text-xs text-destructive space-y-0.5">
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  );
}
