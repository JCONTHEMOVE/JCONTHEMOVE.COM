// Task #207 — Chat-style "describe your job" intake overlay.
//
// Drives a small state machine: ask_service → ask_size → ask_addons →
// ask_timing → show_result. The result step renders the recommended-plan
// card (services + bundle + live total) and hands off to the booking
// wizard at /book?services=…&bundle=…&step=…
//
// Mobile: bottom sheet that slides up.
// Desktop: centered modal.
//
// All actual pricing flows through the existing /api/bookings/quote
// endpoint — this component never invents a discount.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { cn } from "@/lib/utils";
import {
  X, Send, Loader2, Sparkles, ArrowRight, MessageCircle, Tag,
} from "lucide-react";
import {
  parseJobIntake, friendlyServiceLabel, bundleHintName, ADDON_CHIPS, formatLaborBreakdownLine,
  chipToServiceCode, type ParseResult,
} from "@/lib/serviceParser";
import {
  JC_TRUCK_EXTRA_MILE_RATE,
  JC_TRUCK_INCLUDED_MILES,
  JC_TRUCK_LOCAL_RENTAL_FEE,
  JC_TRUCK_OUT_OF_TOWN_RENTAL_FEE,
} from "@shared/movingTruckPricing";

type Step =
  | "ask_location"
  | "ask_service"
  | "ask_size"
  | "ask_moving_load"
  | "ask_moving_truck"
  | "ask_moving_stairs"
  | "ask_moving_heavy"
  | "ask_addons"
  | "ask_timing"
  | "show_result"
  | "fallback";

interface ChatMessage {
  from: "bot" | "user";
  text: string;
}

// Hero chips on the home page — kept short on purpose so the prompt
// reads like a friendly chat opener.
export const CHAT_QUICK_CHIPS: string[] = [
  "Moving",
  "Junk",
  "Cleaning",
  "Lawn",
  "Snow",
  "Handyman",
  "Window",
  "Trash Valet",
];

// Wider chip set used inside the overlay (the ask-service step + the
// fallback "didn't catch that" recovery panel). Includes every service
// the parser recognises, even ones that may not yet be in the live
// catalog — those still produce a meaningful contact-step handoff.
const FALLBACK_CHIPS: string[] = [
  ...CHAT_QUICK_CHIPS,
  "Demolition",
  "Roofing",
  "Painting",
  "Flooring",
  "Move Cleaning",
  "Delivery",
  "Labor",
];

interface CatalogService {
  id: string;
  code: string;
  name: string;
  defaultPriceMode: string;
  defaultPrice: string | null;
  suggestedMin: string | null;
  suggestedMax: string | null;
}

/** Task #218 — labor breakdown the chat card reads off each quoted line.
 *  Mirrors BookingPricingItemInput["laborMeta"] on the server. */
interface QuoteLaborMeta {
  crewSize: number;
  laborHours: number;
  totalLaborHours: number;
  ratePerHour: number;
}

interface QuoteResponseItem {
  serviceCode: string;
  lineSubtotal: number;
  unitPrice: number;
  quantity: number;
  laborMeta?: QuoteLaborMeta;
}

interface QuoteResponse {
  success: true;
  quote: {
    subtotal: number;
    discountTotal: number;
    finalTotal: number;
    bundleApplied: { code: string; name: string; rawDiscount: number } | null;
    items: QuoteResponseItem[];
  };
}

interface FeaturedBundle {
  code: string;
  name: string;
  serviceComboJson: string[];
  discountType: "percent" | "fixed";
  discountValue: string;
  maxDiscount: string | null;
}

const SIZE_OPTIONS = [
  { label: "1 or 2 items", value: "small" },
  { label: "Studio or 1 bedroom", value: "small" },
  { label: "2 bedroom apartment or house", value: "medium" },
  { label: "3 or 4 bedroom house", value: "large" },
];

const TIMING_OPTIONS = [
  "ASAP / this week",
  "Next week",
  "2–3 weeks out",
  "Just exploring",
];

const MOVING_LOAD_OPTIONS = ["Load only", "Unload only", "Load + unload"];
const MOVING_TRUCK_OPTIONS = [
  "Customer provides truck",
  `JC provides truck - local +$${JC_TRUCK_LOCAL_RENTAL_FEE}`,
  `JC provides truck - out of town +$${JC_TRUCK_OUT_OF_TOWN_RENTAL_FEE}`,
];
const MOVING_STAIR_OPTIONS = [
  "No stairs / elevator available",
  "1 flight of stairs",
  "2+ flights of stairs",
];
const MOVING_HEAVY_OPTIONS = [
  "No oversized items",
  "200 lb item +$100",
  "Pool table +$500",
  "Safe 300 lb +$300",
  "Safe 500 lb +$500",
  "Safe 1000 lb +$1000",
  "800+ lb item - custom quote",
];

const SERVICE_AREA_LOCATIONS = [
  { city: "Ironwood", state: "MI", zip: "49938", aliases: ["ironwood", "49938"] },
  { city: "Ashland", state: "WI", zip: "54806", aliases: ["ashland", "54806"] },
  { city: "Iron River", state: "MI", zip: "49935", aliases: ["iron river", "49935"] },
  { city: "Houghton", state: "MI", zip: "49931", aliases: ["houghton", "49931"] },
  { city: "Hurley", state: "WI", zip: "54534", aliases: ["hurley", "54534"] },
  { city: "Bessemer", state: "MI", zip: "49911", aliases: ["bessemer", "49911"] },
  { city: "Wakefield", state: "MI", zip: "49968", aliases: ["wakefield", "49968"] },
  { city: "Mellen", state: "WI", zip: "54546", aliases: ["mellen", "54546"] },
  { city: "Minocqua", state: "WI", zip: "54548", aliases: ["minocqua", "54548"] },
  { city: "Mercer", state: "WI", zip: "54547", aliases: ["mercer", "54547"] },
  { city: "Phelps", state: "WI", zip: "54554", aliases: ["phelps", "54554"] },
];

function shouldAskSize(services: string[]): boolean {
  return services.some((c) =>
    ["moving", "junk_removal", "cleaning", "demolition"].includes(c),
  );
}

// Tiny console-only analytics shim — task says a follow-up will wire these
// to a real sink. Kept dependency-free so removing it later is one find.
function track(event: string, payload?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[chat-intake] ${event}`, payload || {});
}

function buildBookUrl(
  parsed: ParseResult,
  step: "configure" | "contact",
  serviceAddress?: string,
  details?: Record<string, unknown>,
): string {
  const params = new URLSearchParams();
  if (parsed.services.length > 0) {
    params.set("services", parsed.services.join(","));
  }
  if (parsed.bundleHint) {
    params.set("bundle", parsed.bundleHint);
  }
  if (serviceAddress?.trim()) params.set("address", serviceAddress.trim());
  if (details && Object.keys(details).length > 0) params.set("details", JSON.stringify(details));
  params.set("step", step);
  return `/book?${params.toString()}`;
}

function normalizeLocalAddress(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const matchedArea = SERVICE_AREA_LOCATIONS.find((area) =>
    area.aliases.some((alias) => lower.includes(alias)),
  );
  const exactZipArea = SERVICE_AREA_LOCATIONS.find((area) => area.zip === trimmed);
  if (exactZipArea) return `${exactZipArea.city}, ${exactZipArea.state} ${exactZipArea.zip}`;
  if (matchedArea && lower === matchedArea.city.toLowerCase()) {
    return `${matchedArea.city}, ${matchedArea.state} ${matchedArea.zip}`;
  }
  if (/\b(mi|wi)\b/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\d+\s+/.test(trimmed)) {
    const area = matchedArea || SERVICE_AREA_LOCATIONS[0];
    return `${trimmed}, ${area.city}, ${area.state} ${area.zip}`;
  }
  if (/^\d{5}(-\d{4})?$/.test(trimmed)) {
    return trimmed;
  }
  if (matchedArea) return `${matchedArea.city}, ${matchedArea.state} ${matchedArea.zip}`;
  return trimmed;
}

function getAddressSuggestions(input: string): string[] {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return ["Ironwood, MI 49938", "Ashland, WI 54806", "Hurley, WI 54534"];
  }
  const lower = trimmed.toLowerCase();
  const matchedAreas = SERVICE_AREA_LOCATIONS.filter((area) =>
    area.aliases.some((alias) => alias.includes(lower) || lower.includes(alias)),
  );
  const suggestions = new Set<string>();
  if (/^\d+\s+/.test(trimmed)) suggestions.add(normalizeLocalAddress(trimmed));
  for (const area of matchedAreas) suggestions.add(`${area.city}, ${area.state} ${area.zip}`);
  if (!matchedAreas.length && trimmed.length >= 3 && !/^\d+\s+/.test(trimmed)) {
    for (const area of SERVICE_AREA_LOCATIONS.filter((area) => area.city.toLowerCase().startsWith(lower)).slice(0, 3)) {
      suggestions.add(`${area.city}, ${area.state} ${area.zip}`);
    }
  }
  return Array.from(suggestions).filter(Boolean).slice(0, 3);
}

export interface ChatIntakeOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Optional service code/chip label to seed as the first answer. */
  initialChip?: string;
  /** Optional free-text seed (used when the customer types into the hero
   *  prompt and clicks "Start chat"). */
  initialFreeText?: string;
}

export default function ChatIntakeOverlay({
  open, onClose, initialChip, initialFreeText,
}: ChatIntakeOverlayProps) {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("ask_location");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pickedService, setPickedService] = useState<string | undefined>(undefined);
  const [freeText, setFreeText] = useState("");
  const [serviceLocation, setServiceLocation] = useState("");
  const [size, setSize] = useState<string | undefined>(undefined);
  const [movingLoadType, setMovingLoadType] = useState<string | undefined>(undefined);
  const [movingTruck, setMovingTruck] = useState<string | undefined>(undefined);
  const [movingStairs, setMovingStairs] = useState<string | undefined>(undefined);
  const [movingHeavy, setMovingHeavy] = useState<string | undefined>(undefined);
  const [addons, setAddons] = useState<string[]>([]);
  const [timing, setTiming] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const addressSuggestions = useMemo(
    () => (step === "ask_location" ? getAddressSuggestions(draft) : []),
    [draft, step],
  );

  // Reset every time the overlay opens so re-opens don't show stale chat.
  useEffect(() => {
    if (!open) return;
    track("chat_opened", { initialChip, hasSeedText: !!initialFreeText });
    setMessages([{
      from: "bot",
      text: "What's the ZIP code or service address? I'll use that first so the quote starts with the right travel area.",
    }]);
    setDraft("");
    setPickedService(initialChip);
    setFreeText(initialFreeText || "");
    setServiceLocation("");
    setSize(undefined);
    setMovingLoadType(undefined);
    setMovingTruck(undefined);
    setMovingStairs(undefined);
    setMovingHeavy(undefined);
    setAddons([]);
    setTiming(undefined);
    setStep("ask_location");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll the message list as new bubbles arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, step]);

  function pushBot(text: string) {
    setMessages((m) => [...m, { from: "bot", text }]);
  }
  function pushUser(text: string) {
    setMessages((m) => [...m, { from: "user", text }]);
  }

  function isMovingParsed(services: string[]) {
    return services.includes("moving");
  }

  function promptAfterService(parsed: ParseResult) {
    if (parsed.services.length === 0) {
      setStep("fallback");
      pushBot("Got it — pick the closest service below and I'll keep going.");
    } else if (shouldAskSize(parsed.services)) {
      setStep("ask_size");
      pushBot("Roughly how big is the job?");
    } else {
      setStep("ask_timing");
      pushBot("When do you need this done?");
    }
  }

  function handleLocationSubmit(text: string) {
    const trimmed = normalizeLocalAddress(text);
    if (trimmed.length < 3) return;
    pushUser(trimmed);
    setDraft("");
    setServiceLocation(trimmed);
    const seeded = parseJobIntake({ pickedService, freeText });
    if (seeded.services.length > 0) {
      if (initialChip || initialFreeText) pushUser(initialChip || initialFreeText || "");
      promptAfterService(seeded);
    } else {
      setStep("ask_service");
      pushBot("What service do you need — moving, junk, cleaning, snow, lawn, windows, or something else?");
    }
  }

  function handleAskServiceSubmit(text: string, viaChip?: string) {
    const trimmed = text.trim();
    if (!trimmed && !viaChip) return;
    pushUser(trimmed || viaChip || "");
    setDraft("");
    if (viaChip) setPickedService(viaChip);
    if (trimmed) setFreeText(trimmed);

    const parsed = parseJobIntake({
      pickedService: viaChip ?? pickedService,
      freeText: trimmed || freeText,
    });

    if (parsed.services.length === 0) {
      setStep("fallback");
      pushBot("Hmm — I'm not sure I caught that. Tap the service that best fits and I'll take it from there.");
      return;
    }
    promptAfterService(parsed);
  }

  function handleSizePick(value: string, label: string) {
    pushUser(label);
    setSize(value);
    const nextParsed = parseJobIntake({ pickedService, freeText, size: value });
    if (isMovingParsed(nextParsed.services)) {
      setStep("ask_moving_load");
      pushBot("For the move, are we loading, unloading, or doing both?");
    } else {
      setStep("ask_timing");
      pushBot("When do you need this done?");
    }
  }

  function handleMovingLoadPick(value: string) {
    pushUser(value);
    setMovingLoadType(value);
    setStep("ask_moving_truck");
    pushBot("Who's providing the truck?");
  }

  function handleMovingTruckPick(value: string) {
    pushUser(value);
    setMovingTruck(value);
    setStep("ask_moving_stairs");
    pushBot("Any stairs at pickup or drop-off?");
  }

  function handleMovingStairsPick(value: string) {
    pushUser(value);
    setMovingStairs(value);
    setStep("ask_moving_heavy");
    pushBot("Any oversized or extra-heavy item?");
  }

  function handleMovingHeavyPick(value: string) {
    pushUser(value);
    setMovingHeavy(value);
    setStep("ask_timing");
    pushBot("When do you need this done?");
  }

  function handleAddonsContinue() {
    if (addons.length > 0) {
      pushUser(addons.join(", "));
    } else {
      pushUser("Nothing extra");
    }
    setStep("show_result");
    pushBot("Here's the plan I put together for you →");
  }

  function handleTimingPick(value: string) {
    pushUser(value);
    setTiming(value);
    setStep("ask_addons");
    pushBot("Last thing: anything else to bundle with this job?");
  }

  // Step-aware free-text composer. Lets the customer type a reply on
  // any step (not just ask_service) — matches the spec's "free-text
  // OR quick-reply" intent. We re-run the parser on each free-text
  // turn so size / timing words ("studio", "next week", etc.) bias
  // the final ParseResult correctly.
  function handleComposerSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraft("");
    if (step === "ask_location") {
      handleLocationSubmit(trimmed);
      return;
    }
    if (step === "ask_service") {
      handleAskServiceSubmit(trimmed);
      return;
    }
    pushUser(trimmed);
    if (step === "ask_size") {
      // Stash the raw words as freeText so the parser's size heuristics
      // pick them up; pick a default size bucket for the chip-driven
      // bundle/addon logic.
      setFreeText((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
      setSize((prev) => prev || "medium");
      const nextParsed = parseJobIntake({ pickedService, freeText: `${freeText} ${trimmed}`, size: size || "medium" });
      if (isMovingParsed(nextParsed.services)) {
        setStep("ask_moving_load");
        pushBot("For the move, are we loading, unloading, or doing both?");
      } else {
        setStep("ask_timing");
        pushBot("When do you need this done?");
      }
    } else if (step === "ask_moving_load") {
      setMovingLoadType(trimmed);
      setStep("ask_moving_truck");
      pushBot("Who's providing the truck?");
    } else if (step === "ask_moving_truck") {
      setMovingTruck(trimmed);
      setStep("ask_moving_stairs");
      pushBot("Any stairs at pickup or drop-off?");
    } else if (step === "ask_moving_stairs") {
      setMovingStairs(trimmed);
      setStep("ask_moving_heavy");
      pushBot("Any oversized or extra-heavy item?");
    } else if (step === "ask_moving_heavy") {
      setMovingHeavy(trimmed);
      setStep("ask_timing");
      pushBot("When do you need this done?");
    } else if (step === "ask_addons") {
      setFreeText((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
      setStep("show_result");
      pushBot("Here's the plan I put together for you →");
    } else if (step === "ask_timing") {
      setTiming(trimmed);
      setStep("ask_addons");
      pushBot("Last thing: anything else to bundle with this job?");
    }
  }

  // Final parsed result powers both the summary card and the handoff URL.
  const parsed: ParseResult = useMemo(
    () => parseJobIntake({
      pickedService,
      freeText,
      size,
      addons,
      timing,
    }),
    [pickedService, freeText, size, addons, timing],
  );

  const movingDetails = useMemo(() => {
    const details: Record<string, unknown> = {};
    if (serviceLocation.trim()) details.serviceAddress = serviceLocation.trim();
    if (size) details.jobSize = size;
    if (movingLoadType) {
      details.loadType = movingLoadType;
    }
    if (movingTruck) {
      details.truckNeeded = movingTruck.startsWith("JC provides");
      details.truckFee = movingTruck.includes("out of town")
        ? JC_TRUCK_OUT_OF_TOWN_RENTAL_FEE
        : movingTruck.includes("local")
          ? JC_TRUCK_LOCAL_RENTAL_FEE
          : 0;
      details.truckProviderLabel = movingTruck;
      details.truckIncludedMiles = JC_TRUCK_INCLUDED_MILES;
      details.truckExtraMileRate = JC_TRUCK_EXTRA_MILE_RATE;
    }
    if (movingStairs) {
      details.hasStairs = !movingStairs.toLowerCase().includes("no stairs");
      details.stairs = movingStairs.includes("2+") ? 2 : movingStairs.includes("1 flight") ? 1 : 0;
      details.stairsLabel = movingStairs;
    }
    if (movingHeavy && !movingHeavy.toLowerCase().includes("no oversized")) {
      details.specialItems = [movingHeavy];
      details.oversizedItemFee = movingHeavy.includes("200 lb") ? 100
        : movingHeavy.includes("Pool table") ? 500
          : movingHeavy.includes("300 lb") ? 300
            : movingHeavy.includes("500 lb") ? 500
              : movingHeavy.includes("1000 lb") ? 1000
            : 0;
      details.oversizedItemLabel = movingHeavy;
    }
    if (timing) details.requestedDate = timing;
    return details;
  }, [serviceLocation, size, movingLoadType, movingTruck, movingStairs, movingHeavy, timing]);

  // ── Live quote (only fires on the result step) ──────────────────────────
  const { data: catalog } = useQuery<{ services: CatalogService[] }>({
    queryKey: ["/api/service-catalog"],
    enabled: step === "show_result",
  });

  // Feature bundle list — used to drive the one-away upsell hint off
  // the same data source as book.tsx so the chat never drifts from the
  // real bundle config.
  const { data: bundlesData } = useQuery<{ bundles: FeaturedBundle[] }>({
    queryKey: ["/api/bundles/featured"],
    enabled: step === "show_result",
  });
  const allBundles: FeaturedBundle[] = bundlesData?.bundles || [];

  const quoteMutation = useMutation({
    mutationFn: async (input: {
      items: Array<{ serviceCode: string; quantity: number; unitPrice: number; priceMode: string; label: string; details?: Record<string, unknown> }>;
    }) => {
      const res = await apiRequest("POST", "/api/bookings/quote", {
        items: input.items,
        source: "chat_intake",
      });
      return res.json() as Promise<QuoteResponse>;
    },
  });

  // Reset the quote mutation whenever the overlay reopens so a stale
  // result from the previous session never flashes on the new card
  // before the fresh quote arrives.
  useEffect(() => {
    if (open) quoteMutation.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // How many of the parsed services actually exist in the live catalog.
  // Used to gate the "Book Now" CTA so a customer never lands on the
  // booking wizard's contact step with a completely empty cart (would
  // happen today only when every parsed service is recognised by the
  // parser but missing from the catalog, e.g. painting/flooring).
  // Returns null while the catalog is still loading so the CTA is
  // disabled by default until we can confirm a real match.
  const catalogMatchCount: number | null = useMemo(() => {
    if (!catalog?.services) return null;
    return parsed.services.filter((c) => catalog.services.some((s) => s.code === c)).length;
  }, [catalog?.services, parsed.services]);

  // Build minimal cart from parsed services × catalog defaults and request
  // the live quote whenever we land on the result step (or the parsed cart
  // shape changes inside the result step).
  const cartSig = parsed.services.join(",");
  useEffect(() => {
    if (step !== "show_result") return;
    if (!catalog?.services || parsed.services.length === 0) return;
    // Task #218 — Pass the parser's jobSizeHint into each line's
    // `details` so the server's labor-hours model honors small/medium/
    // large mappings (small move = 2×2hr, medium = 2×4hr, large = 4×4hr,
    // medium junk = 2×2hr, etc.). Without this the chat card would just
    // see catalog defaults and the heading copy wouldn't match the math.
    const sizeHint = parsed.jobSizeHint;
    const items = parsed.services
      .map((code) => catalog.services.find((s) => s.code === code))
      .filter((s): s is CatalogService => !!s)
      .map((s) => {
        const details: Record<string, unknown> = {};
        if (serviceLocation.trim()) details.serviceAddress = serviceLocation.trim();
        if (sizeHint) details.jobSize = sizeHint;
        if (s.code === "moving") Object.assign(details, movingDetails);
        // Task #218 round-7 — Do NOT synthesize a bedrooms value from
        // the chat size hint. The route layer treats bedrooms as a
        // signal that the customer hand-described their move, which
        // forces matrix-based pricing and bypasses the labor tiers
        // (small=$340, medium=$680, large=$1360) the chat card
        // promised. The bare `jobSize` hint above is enough.
        if (s.code === "junk_removal" && sizeHint) {
          details.tier = sizeHint;
        }
        return {
          serviceCode: s.code,
          quantity: 1,
          unitPrice: s.defaultPrice
            ? parseFloat(s.defaultPrice)
            : s.suggestedMin
              ? parseFloat(s.suggestedMin)
              : 0,
          priceMode: s.defaultPriceMode || "quote",
          label: s.name,
          details,
        };
      });
    if (items.length === 0) return;
    quoteMutation.mutate({ items });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cartSig, catalog?.services?.length, movingDetails, serviceLocation]);

  function handleHandoff(target: "configure" | "contact") {
    track("chat_handoff_to_book", {
      services: parsed.services,
      bundleHint: parsed.bundleHint,
      target,
    });
    const url = buildBookUrl(
      parsed,
      target,
      serviceLocation,
      parsed.services.includes("moving") ? movingDetails : undefined,
    );
    onClose();
    setLocation(url);
  }

  // Funnel signal: fire chat_completed the first time the customer
  // reaches the recommendation card, regardless of whether they go on
  // to hand off into the booking wizard. Tracked once per overlay
  // session so we don't double-count when the parsed cart shape
  // changes within the result step.
  const completedFiredRef = useRef(false);
  useEffect(() => {
    if (!open) {
      completedFiredRef.current = false;
      return;
    }
    if (step === "show_result" && !completedFiredRef.current) {
      completedFiredRef.current = true;
      track("chat_completed", {
        services: parsed.services,
        bundleHint: parsed.bundleHint,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  // One-away upsell: same algorithm as book.tsx (suggestion mode
  // "one_away") but driven off the parsed cart and the live
  // /api/bundles/featured response, so the chat hint stays in sync
  // with the real bundle config — never drifts. Suppressed when the
  // live quote already applies a bundle (no point upselling on top of
  // an applied bundle).
  const oneAwayHint = useMemo(() => {
    if (!parsed.services.length) return null;
    if (quoteMutation.data?.quote.bundleApplied) return null;
    const cartCodes = new Set(parsed.services);
    const subtotal = quoteMutation.data?.quote.subtotal ?? 0;
    let best: { bundle: FeaturedBundle; missingCode: string; expected: number } | null = null;
    for (const bundle of allBundles) {
      const combo = bundle.serviceComboJson;
      const allCartItemsInCombo = parsed.services.every((c) => combo.includes(c));
      if (!allCartItemsInCombo) continue;
      const missing = combo.filter((c) => !cartCodes.has(c));
      if (missing.length !== 1) continue;
      const expected = bundle.discountType === "percent"
        ? subtotal * (parseFloat(bundle.discountValue) / 100)
        : parseFloat(bundle.discountValue);
      if (!best || expected > best.expected) {
        best = { bundle, missingCode: missing[0], expected };
      }
    }
    if (!best) return null;
    const dollarHint = best.expected > 0
      ? ` (save ~$${Math.round(best.expected)})`
      : "";
    return {
      code: best.bundle.code,
      name: best.bundle.name,
      line: `Add ${friendlyServiceLabel(best.missingCode)} to unlock ${best.bundle.name}${dollarHint}.`,
    };
  }, [parsed.services, allBundles, quoteMutation.data]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end md:items-center md:justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      data-testid="chat-intake-backdrop"
    >
      <div
        className={cn(
          "w-full md:w-[520px] bg-slate-900 border border-slate-700 text-white",
          "rounded-t-3xl md:rounded-2xl shadow-2xl",
          "h-[85vh] md:h-[640px] flex flex-col overflow-hidden",
          "animate-in slide-in-from-bottom-4 md:fade-in-0 md:zoom-in-95",
        )}
        onClick={(e) => e.stopPropagation()}
        data-testid="chat-intake-overlay"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-blue-600/20 flex items-center justify-center">
              <MessageCircle className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <p className="font-bold text-sm leading-none">Describe your job</p>
              <p className="text-[11px] text-slate-400 mt-0.5">We'll prep a plan & price</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white"
            aria-label="Close chat"
            data-testid="chat-intake-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                m.from === "bot"
                  ? "bg-slate-800 text-slate-100 self-start"
                  : "bg-blue-600 text-white self-end ml-auto",
              )}
              data-testid={`chat-msg-${m.from}`}
            >
              {m.text}
            </div>
          ))}

          {/* Step-specific UI rendered inline below the bubbles */}
          {step === "ask_service" && (
            <div className="pt-2 space-y-2" data-testid="chat-step-service">
              <p className="text-[11px] text-slate-400 uppercase tracking-widest">Quick pick</p>
              <div className="flex flex-wrap gap-1.5">
                {CHAT_QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => handleAskServiceSubmit("", chip)}
                    className="text-xs font-semibold rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 transition-colors"
                    data-testid={`chat-chip-${chip.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "fallback" && (
            <div className="pt-2 space-y-2" data-testid="chat-step-fallback">
              <p className="text-[11px] text-slate-400 uppercase tracking-widest">Pick a service</p>
              <div className="flex flex-wrap gap-1.5">
                {FALLBACK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => {
                      const code = chipToServiceCode(chip);
                      if (!code) return;
                      pushUser(chip);
                      setPickedService(chip);
                      setFreeText("");
                      const seed = parseJobIntake({ pickedService: chip });
                      promptAfterService(seed);
                    }}
                    className="text-xs font-semibold rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5"
                    data-testid={`chat-fallback-chip-${chip.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === "ask_size" && (
            <div className="pt-2 space-y-1.5" data-testid="chat-step-size">
              {SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleSizePick(opt.value, opt.label)}
                  className="w-full text-left text-sm rounded-xl border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700 px-3 py-2 transition-colors"
                  data-testid={`chat-size-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {step === "ask_moving_load" && (
            <div className="pt-2 space-y-1.5" data-testid="chat-step-moving-load">
              {MOVING_LOAD_OPTIONS.map((opt) => (
                <button key={opt} onClick={() => handleMovingLoadPick(opt)} className="w-full text-left text-sm rounded-xl border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700 px-3 py-2">
                  {opt}
                </button>
              ))}
            </div>
          )}

          {step === "ask_moving_truck" && (
            <div className="pt-2 space-y-1.5" data-testid="chat-step-moving-truck">
              {MOVING_TRUCK_OPTIONS.map((opt) => (
                <button key={opt} onClick={() => handleMovingTruckPick(opt)} className="w-full text-left text-sm rounded-xl border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700 px-3 py-2">
                  {opt}
                </button>
              ))}
            </div>
          )}

          {step === "ask_moving_stairs" && (
            <div className="pt-2 space-y-1.5" data-testid="chat-step-moving-stairs">
              {MOVING_STAIR_OPTIONS.map((opt) => (
                <button key={opt} onClick={() => handleMovingStairsPick(opt)} className="w-full text-left text-sm rounded-xl border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700 px-3 py-2">
                  {opt}
                </button>
              ))}
            </div>
          )}

          {step === "ask_moving_heavy" && (
            <div className="pt-2 space-y-1.5" data-testid="chat-step-moving-heavy">
              {MOVING_HEAVY_OPTIONS.map((opt) => (
                <button key={opt} onClick={() => handleMovingHeavyPick(opt)} className="w-full text-left text-sm rounded-xl border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700 px-3 py-2">
                  {opt}
                </button>
              ))}
            </div>
          )}

          {step === "ask_addons" && (
            <div className="pt-2 space-y-2" data-testid="chat-step-addons">
              <div className="flex flex-wrap gap-1.5">
                {ADDON_CHIPS.map((chip) => {
                  const active = addons.includes(chip.label);
                  // Hide an add-on chip if its code is already in the cart
                  if (parsed.services.includes(chip.code) && !active) return null;
                  return (
                    <button
                      key={chip.code}
                      onClick={() => {
                        setAddons((prev) =>
                          prev.includes(chip.label)
                            ? prev.filter((c) => c !== chip.label)
                            : [...prev, chip.label]);
                      }}
                      className={cn(
                        "text-xs font-semibold rounded-full border px-3 py-1.5 transition-colors",
                        active
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                          : "border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200",
                      )}
                      data-testid={`chat-addon-${chip.code}`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
              <Button
                size="sm"
                onClick={handleAddonsContinue}
                className="bg-blue-600 hover:bg-blue-500 mt-2"
                data-testid="chat-addons-continue"
              >
                Continue <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          )}

          {step === "ask_timing" && (
            <div className="pt-2 space-y-1.5" data-testid="chat-step-timing">
              {TIMING_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleTimingPick(opt)}
                  className="w-full text-left text-sm rounded-xl border border-slate-700 bg-slate-800 hover:border-blue-500 hover:bg-slate-700 px-3 py-2"
                  data-testid={`chat-timing-${opt.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {step === "show_result" && (
            <RecommendedPlanCard
              parsed={parsed}
              quote={quoteMutation.data?.quote}
              isLoading={quoteMutation.isPending}
              error={quoteMutation.isError ? "Couldn't load a live estimate — you can still continue." : null}
              oneAwayHint={oneAwayHint}
              hasCatalogMatch={catalogMatchCount !== null && catalogMatchCount > 0}
              onCustomize={() => handleHandoff("configure")}
              onBookNow={() => handleHandoff("contact")}
            />
          )}
        </div>

        {/* Composer — available on every conversational step so the
            customer can always type a free-text reply alongside the
            quick-reply chips. Hidden on the result step where the card
            takes over and on the fallback step where chips are the
            recovery affordance. */}
        {(step === "ask_location" || step === "ask_service" || step === "ask_size" || step === "ask_moving_load" || step === "ask_moving_truck" || step === "ask_moving_stairs" || step === "ask_moving_heavy" || step === "ask_addons" || step === "ask_timing") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleComposerSubmit(draft);
            }}
            className="border-t border-slate-800 px-3 py-3 flex items-center gap-2"
          >
            {step === "ask_location" ? (
              <div className="relative flex-1">
                <PlacesAutocomplete
                  suggestionPlacement="above"
                  value={draft}
                  onChange={setDraft}
                  onPlaceSelect={place => setDraft(place.fullAddress)}
                  onBlur={(e) => {
                    const normalized = normalizeLocalAddress(e.currentTarget.value);
                    if (normalized && normalized !== draft) setDraft(normalized);
                  }}
                  placeholder="ZIP code or full service address"
                  autoFocus
                  autoComplete="street-address"
                  name="street-address"
                  inputClassName="bg-slate-800 border-slate-700 px-3.5 text-white placeholder:text-slate-500 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/40"
                  data-testid="chat-location-input"
                />
                {addressSuggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {addressSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleComposerSubmit(suggestion)}
                        className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2.5 py-1 text-left text-[11px] font-bold text-blue-100 hover:border-blue-300/70 hover:bg-blue-500/20"
                        data-testid={`chat-address-suggestion-${suggestion.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      >
                        Use {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  step === "ask_service" ? "e.g. Moving out of a 2-bed and need junk gone"
                  : step === "ask_size" ? "Type the size or tap a quick reply"
                  : step.startsWith("ask_moving_") ? "Type an answer or tap a quick reply"
                  : step === "ask_addons" ? "Type any extras or tap to skip"
                  : "Type a date / day or tap a quick reply"
                }
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                autoFocus={step === "ask_service"}
                data-testid="chat-composer-input"
              />
            )}
            <Button
              type="submit"
              size="icon"
              className="bg-blue-600 hover:bg-blue-500 shrink-0"
              disabled={!draft.trim()}
              data-testid="chat-composer-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── RecommendedPlanCard ────────────────────────────────────────────────────
interface RecommendedPlanCardProps {
  parsed: ParseResult;
  quote: QuoteResponse["quote"] | undefined;
  isLoading: boolean;
  error: string | null;
  oneAwayHint: { code: string; name: string; line: string } | null;
  hasCatalogMatch: boolean;
  onCustomize: () => void;
  onBookNow: () => void;
}

function RecommendedPlanCard({
  parsed, quote, isLoading, error, oneAwayHint, hasCatalogMatch, onCustomize, onBookNow,
}: RecommendedPlanCardProps) {
  // Bundle line truth source — must match what the live quote engine
  // actually applies. The parser's bundleHint is only used as an
  // optimistic placeholder *before* the live quote has resolved, so the
  // card never invents a discount. Once the quote arrives (loading
  // finished, no error), we trust quote.bundleApplied as authoritative.
  const quoteResolved = !!quote && !isLoading && !error;
  const bundle = quote?.bundleApplied
    ? quote.bundleApplied
    : (!quoteResolved && parsed.bundleHint
      ? { code: parsed.bundleHint, name: bundleHintName(parsed.bundleHint), rawDiscount: 0 }
      : null);
  // Only show "−$X" on the bundle row if the live engine actually
  // discounted — never derived from the parser hint alone.
  const bundleDiscount = quote?.discountTotal ?? 0;

  return (
    <div
      className="rounded-2xl border border-blue-500/30 bg-slate-800/70 p-4 space-y-3 mt-2"
      data-testid="chat-result-card"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-400" />
        <p className="text-xs font-bold uppercase tracking-widest text-blue-300">Recommended Plan</p>
      </div>

      {parsed.services.length === 0 ? (
        <p className="text-sm text-slate-300">
          We couldn't find a match — tap "Customize" to pick services manually.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {parsed.services.map((code) => {
            // Task #218 — When the live quote has resolved, prefer the
            // server's crewSize/laborHours so the label matches the
            // dollar math exactly (e.g. "2 Movers (4 hrs)" → $680).
            const quotedItem = quote?.items?.find((it) => it.serviceCode === code);
            const meta = quotedItem?.laborMeta;
            return (
              <li
                key={code}
                className="flex flex-col text-sm text-slate-100"
                data-testid={`chat-result-service-${code}`}
              >
                <span>
                  {friendlyServiceLabel(code, {
                    jobSize: parsed.jobSizeHint,
                    crewSize: meta?.crewSize,
                    laborHours: meta?.laborHours,
                  })}
                </span>
                {meta && formatLaborBreakdownLine(meta) && (
                  <span
                    className="text-[11px] text-slate-400 pl-5"
                    data-testid={`chat-result-labor-${code}`}
                  >
                    {formatLaborBreakdownLine(meta)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {bundle && (
        <div
          className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1.5 text-xs"
          data-testid="chat-result-bundle"
        >
          <span className="flex items-center gap-1.5 text-emerald-300 font-semibold">
            <Tag className="h-3 w-3" /> {bundle.name}
            {!quoteResolved && (
              <span className="text-[10px] font-normal text-emerald-200/70">(checking…)</span>
            )}
          </span>
          {bundleDiscount > 0 && (
            <span className="text-emerald-300 font-bold">−${bundleDiscount.toFixed(0)}</span>
          )}
        </div>
      )}

      <div className="border-t border-slate-700 pt-2 flex items-center justify-between text-sm">
        <span className="text-slate-400">Estimated total</span>
        {isLoading ? (
          <span className="text-slate-300 inline-flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> calculating…
          </span>
        ) : quote ? (
          <span className="font-extrabold text-lg text-white" data-testid="chat-result-total">
            ${quote.finalTotal.toFixed(0)}
          </span>
        ) : (
          <span className="text-slate-400 text-xs">we'll confirm at booking</span>
        )}
      </div>

      {oneAwayHint && (
        <p
          className="text-[11px] text-orange-300 bg-orange-500/10 border border-orange-500/20 rounded-lg px-2 py-1.5"
          data-testid="chat-result-one-away"
        >
          💡 {oneAwayHint.line}
        </p>
      )}

      <p className="text-[10px] text-slate-500">
        Based on 500+ jobs in Ironwood. Final price confirmed when we lock in the date.
      </p>

      {error && (
        <p className="text-[11px] text-amber-400" data-testid="chat-result-error">{error}</p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Button
          variant="outline"
          className="flex-1 border-slate-600 text-white hover:bg-slate-700"
          onClick={onCustomize}
          data-testid="chat-result-customize"
        >
          Customize
        </Button>
        <Button
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold"
          onClick={onBookNow}
          // Disabled when no service made it into the live cart so the
          // wizard's contact step never opens with an empty cart. The
          // Customize button stays enabled so the customer can still
          // pick a service manually from the wizard.
          disabled={parsed.services.length === 0 || !hasCatalogMatch}
          data-testid="chat-result-book"
          title={!hasCatalogMatch && parsed.services.length > 0
            ? "We don't have an instant price for this — tap Customize to continue."
            : undefined}
        >
          Book Now <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
