import { useState, useRef, useEffect, useMemo } from "react";
import BookingConfirmedTiles from "@/components/BookingConfirmedTiles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Send, CheckCircle2, ArrowRight, Sparkles, RotateCcw, ChevronRight, AlertCircle, Users, DollarSign, Camera, X, CreditCard, Clock } from "lucide-react";
import { calculateWindowCleaningQuote } from "@shared/windowCleaningPricing";
import { calculateTrashValetQuote, TRASH_VALET_TRAVEL_THRESHOLD_MILES, TRASH_VALET_OUT_OF_AREA_MINIMUM } from "@shared/trashValetPricing";
import { calculateJumpStartQuote } from "@shared/jumpStartPricing";
import { getDepositInfo } from "@shared/depositRules";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { buildBookingIntakeFromChatbot, type BookingIntakeResult } from "@shared/bookingIntake";
import { calculateMovingTravelCharge, getMovingDistanceBracketFromMiles, getMovingTravelFeeForBracket } from "@shared/movingPricing";
import { applySmartBookingAnswer, shouldSkipSmartBookingStep } from "@shared/smartBookingEngine";
import {
  CANONICAL_PRICING_2026_08,
  calculateMovingLabor,
  calculateRateCardLine,
  type CanonicalPricingSnapshot,
} from "@shared/canonicalPricing";

// ─────────────────────────────────────────────
// Service categories
// ─────────────────────────────────────────────
const PRICEABLE_SERVICES = ["Moving", "Junk Removal", "Trash Valet", "Window Cleaning", "Jump Start"];
const QUOTE_ONLY_SERVICES = ["Painting", "Flooring", "Roofing", "Handyman", "Lawn Care", "Snow Removal", "Move-In/Out Cleaning", "Light Demolition"];
const JUNK_TRAVEL_CHARGE_PER_TIER = 50;  // $50 per 25-mile band from Ironwood
const JUNK_TRAVEL_TIER_MILES      = 25;  // miles per tier
const CANONICAL_MOVING_RATE = CANONICAL_PRICING_2026_08.labor.workerHourlyRate;

function canonicalMovingLaborTotal(
  workers: number,
  hours: number,
  ratePerMoverHour = CANONICAL_MOVING_RATE,
  pricingSnapshot: CanonicalPricingSnapshot = CANONICAL_PRICING_2026_08,
  useMarketplaceRateCard = false,
) {
  if (useMarketplaceRateCard) {
    const specialLine = calculateRateCardLine({
      serviceCode: "load_unload",
      crewSize: workers,
      hours,
      snapshot: pricingSnapshot,
    });
    if (specialLine) return specialLine.subtotal;
  }
  const snapshot = ratePerMoverHour === pricingSnapshot.labor.workerHourlyRate
    ? pricingSnapshot
    : {
        ...pricingSnapshot,
        labor: { ...pricingSnapshot.labor, workerHourlyRate: ratePerMoverHour },
      };
  return calculateMovingLabor({ workers, hours, snapshot }).total;
}

function movingRateCardAppliesForDistance(
  distanceMiles: number,
  pricingSnapshot: CanonicalPricingSnapshot,
  insideBubble?: boolean | null,
) {
  const card = pricingSnapshot.marketplaceRateCard;
  if (!card) return false;
  if (card.applicationScope !== "outside_bubble") return true;
  if (insideBubble != null) return !insideBubble;
  const bubbleMiles = pricingSnapshot.geographicPolicy?.bubbleRadiusMiles ?? 50;
  return Number.isFinite(distanceMiles) && distanceMiles > bubbleMiles;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type StepType = "choice" | "multiselect" | "text" | "address" | "contact" | "notes" | "deposit_ack" | "package_select" | "photo_upload" | "moving_recs";

interface Step {
  id: string;
  question: string;
  subtext?: string;
  type: StepType;
  options?: string[];
  show?: (a: Answers) => boolean;
  placeholder?: string;
  optional?: boolean;
  employeeOnly?: boolean;
}

export interface Answers {
  serviceType?: string;
  serviceCategory?: "priceable" | "quote_only";
  // General location (captured first, before service type)
  serviceAddress?: string;
  // Moving fields
  jobSize?: string;          // "Single item…" | "Studio or 1-bed" | "2–3 bed" | "4+ bed"
  propertyType?: string;
  distanceReport?: string;   // self-reported distance bracket for moving
  fromZip?: string;
  toZip?: string;
  loadType?: string;
  moveDate?: string;
  homeSize?: string;
  originFloor?: string;
  originElevator?: string;
  destFloor?: string;
  destElevator?: string;
  parkingDistance?: string;
  furniture?: string[];
  boxCount?: string;
  specialItems?: string[];
  oversizedItemCount?: string;
  packingHelp?: string;
  truckSituation?: string;
  truckSize?: string;        // "15' truck" | "26' truck"
  selectedMovingRec?: string;      // ID of the selected MovingRecommendation card
  selectedMovingRecLabel?: string; // e.g. "2 movers + 15' truck"
  selectedMovingRecNotes?: string; // full rate note written into job notes
  selectedMovingRecCrew?: string;
  selectedMovingRecHours?: string;
  selectedMovingRecTotalMin?: string;
  selectedMovingRecTotalMax?: string;
  // Trash Valet fields
  trashCans?: string;
  trashBags?: string;
  recyclingEnabled?: string;
  trashPlanType?: string;
  // Junk Removal fields
  junkLocation?: string;
  // Window Cleaning fields
  windowLocation?: string;
  standardWindows?: string;
  largeWindows?: string;
  ladderWindows?: string;
  windowInside?: string;
  windowOutside?: string;
  // Quote-only fields
  jobScope?: string;
  jobLocation?: string;
  // Deposit
  depositZip?: string;
  depositAcknowledged?: string;
  // Package selection
  selectedPackage?: string;
  // Promo code
  promoCode?: string;
  // Contact
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
  // Snow Removal fields
  snowDrivewayType?: string;
  snowAddons?: string[];
  // Move-In/Out Cleaning fields
  cleanHomeSize?: string;
  cleanBathrooms?: string;
  cleanAppliances?: string[];
  cleanType?: string;
  cleanAddons?: string[];
  // Light Demolition fields
  demoCrewSize?: string;
  demoDuration?: string;
  demoHazards?: string[];
  demoWasteRemoval?: string;
  demoScope?: string[];
  // Handyman fields
  handymanScale?: string;
  handymanCategory?: string;
  // Flooring fields
  flooringOldRemoval?: string;
  flooringCurrentType?: string;
  flooringNewProduct?: string;
  flooringMaterials?: string;
  flooringRoomsSqft?: string;
  flooringHaulAway?: string;
  flooringTrim?: string;
  // Painting fields
  paintingIntExt?: string;
  paintingType?: string;
  paintingRoomCount?: string;
  paintingRoomSize?: string;
  paintingCeilings?: string;
  paintingAddons?: string[];
  paintingPrep?: string;
  paintingMaterials?: string;
  paintingPrimer?: string;
  paintingSurfaceCondition?: string;
  paintingSpecialtyAreas?: string;
  // Roofing fields
  roofingCurrentType?: string;
  roofingStories?: string;
  roofingPitch?: string;
  roofingTearOff?: string;
  roofingWasteRemoval?: string;
  roofingMaterials?: string;
  // Employee photo upload
  employeePhotos?: string;
  // Lawn Care structured fields
  lawnPropertySize?: string;
  lawnServices?: string[];
  lawnFrequency?: string;
  lawnCondition?: string;
  // Moving crew preference
  crewPreference?: string;
  // Jump Start fields
  vehicleType?: string;
}

export interface MovingQuote {
  type: "moving";
  tier: "tiny" | "small" | "medium" | "large";
  crew: number;
  minHrs: number;
  maxHrs: number;
  minPrice: number;
  maxPrice: number;
  tokensEstimate: number;
  specialSurcharge: number;
  promoApplied?: boolean;
  promoCode?: string;
  rawMinPrice?: number;
  travelCharge?: number;
  jcmovesApplied?: boolean;
  jcmovesDiscount?: number;
  stakingPerkApplied?: boolean;
  stakingPerkDiscount?: number;
  stakingPerkPct?: number;
  rateSource?: "local_canonical" | "movinghelper_special";
}

interface TrashValetQuoteResult {
  type: "trash_valet";
  finalMonthlyPrice: number;
  minPrice: number;
  maxPrice: number;
}

interface WindowQuoteResult {
  type: "window_cleaning";
  paneCount: number;
  minPrice: number;
  maxPrice: number;
  total: number;
}

interface JunkQuote {
  type: "junk";
  tier: "tiny" | "small" | "medium" | "large";
  crew: number;
  minHrs: number;
  maxHrs: number;
  minPrice: number;
  maxPrice: number;
  tokensEstimate: number;
  specialSurcharge: number;
  travelCharge?: number;
  jcmovesApplied?: boolean;
  jcmovesDiscount?: number;
  stakingPerkApplied?: boolean;
  stakingPerkDiscount?: number;
  stakingPerkPct?: number;
}

interface QuoteOnlyResult {
  type: "quote_only";
  service: string;
  minPrice: number;
  maxPrice: number;
}

interface JumpStartQuoteResult {
  type: "jump_start";
  flatPrice: number;
  isCustomQuote: boolean;
  distanceTier: string;
  minPrice: number;
  maxPrice: number;
}

type QuoteResult = MovingQuote | JunkQuote | TrashValetQuoteResult | WindowQuoteResult | QuoteOnlyResult | JumpStartQuoteResult;

export interface CrewPackage {
  id: string;
  label: string;
  desc: string;
  minPrice: number;
  maxPrice: number;
  crew?: number;
  hours?: number;
  tag?: string;
  originalPrice?: number;
  priceLabel?: string;
}

interface Message {
  from: "bot" | "user";
  text: string;
  ts: number;
}

// ─────────────────────────────────────────────
// Step Definitions
// ─────────────────────────────────────────────

function getServiceLabel(rawType: string): string {
  if (rawType.includes("Moving") || rawType.includes("Local Move") || rawType.includes("Loading") || rawType.includes("Unloading") || rawType.includes("Packing Only")) return "Moving";
  if (rawType.includes("Junk")) return "Junk Removal";
  if (rawType.includes("Trash Valet")) return "Trash Valet";
  if (rawType.includes("Window")) return "Window Cleaning";
  if (rawType.includes("Painting")) return "Painting";
  if (rawType.includes("Flooring")) return "Flooring";
  if (rawType.includes("Roofing")) return "Roofing";
  if (rawType.includes("Handyman")) return "Handyman";
  if (rawType.includes("Lawn")) return "Lawn Care";
  if (rawType.includes("Snow")) return "Snow Removal";
  if (rawType.includes("Cleaning") || rawType.includes("Move-In")) return "Move-In/Out Cleaning";
  if (rawType.includes("Demo") || rawType.includes("Demolition")) return "Light Demolition";
  if (rawType.includes("Jump Start") || rawType.includes("Jump start")) return "Jump Start";
  return "Moving";
}

function isMovingService(a: Answers) {
  const s = a.serviceType || "";
  return s.includes("Moving") || s.includes("Move") || s.includes("Loading") || s.includes("Unloading") || s.includes("Packing Only");
}

function isJunkService(a: Answers) {
  return (a.serviceType || "").includes("Junk");
}

function isTrashValetService(a: Answers) {
  return (a.serviceType || "").includes("Trash Valet");
}

function isWindowCleaningService(a: Answers) {
  return (a.serviceType || "").includes("Window");
}

function isPriceableService(a: Answers) {
  const svc = getServiceLabel(a.serviceType || "");
  return PRICEABLE_SERVICES.includes(svc);
}

function isQuoteOnlyService(a: Answers) {
  const svc = getServiceLabel(a.serviceType || "");
  return QUOTE_ONLY_SERVICES.includes(svc);
}

function isSnowService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Snow Removal";
}

function isCleaningService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Move-In/Out Cleaning";
}

function isDemoService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Light Demolition";
}

function isHandymanService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Handyman";
}

function isFlooringService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Flooring";
}

function isPaintingService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Painting";
}

function isRoofingService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Roofing";
}

function isLawnService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Lawn Care";
}

function isJumpStartService(a: Answers) {
  return getServiceLabel(a.serviceType || "") === "Jump Start";
}

function hasStructuredSteps(a: Answers) {
  return isSnowService(a) || isCleaningService(a) || isDemoService(a) ||
    isHandymanService(a) || isFlooringService(a) || isPaintingService(a) || isRoofingService(a) || isLawnService(a);
}

function needsDepositCheck(a: Answers) {
  return isQuoteOnlyService(a);
}

const STEPS: Step[] = [
  {
    id: "serviceAddress",
    question: "Where do you need help?",
    subtext: "Enter your address or city — we'll check availability and distance.",
    type: "address",
    placeholder: "123 Main St, Ironwood, MI",
  },
  {
    id: "serviceType",
    question: "What service do you need?",
    subtext: "Pick the one that best describes your situation.",
    type: "choice",
    options: [
      "📦 Moving (local or long-distance)",
      "🗑️ Junk Removal",
      "🗑️ Trash Valet (weekly curbside)",
      "🪟 Window Cleaning",
      "🎨 Painting",
      "🪵 Flooring",
      "🏠 Roofing",
      "🔧 Handyman",
      "❄️ Snow Removal",
      "🌿 Lawn Care",
      "✨ Move-In/Out Cleaning",
      "⚒️ Light Demolition",
      "⚡ Jump Start",
    ],
  },

  // ── MOVING STEPS ──────────────────────────────────────────────────────────
  {
    id: "jobSize",
    question: "Roughly how big is the moving job?",
    subtext: "Pick the closest match. We can confirm exact inventory before final booking.",
    type: "choice",
    options: [
      "1-2 items only",
      "Studio or 1 bedroom",
      "2 bedroom",
      "3 bedroom",
      "4 bedroom or larger",
    ],
    show: (a) => isMovingService(a),
  },
  {
    id: "propertyType",
    question: "Is it a house or apartment?",
    subtext: "This helps with crew size, stairs, parking, and truck planning.",
    type: "choice",
    options: [
      "Apartment / condo",
      "House",
      "Storage unit",
      "Office / commercial",
    ],
    show: (a) => isMovingService(a) && !(a.jobSize || "").includes("1-2 items"),
  },
  {
    id: "oldJobSize",
    question: "What are you moving?",
    subtext: "Pick the closest match — this helps us recommend the right crew.",
    type: "choice",
    options: [
      "📦 Single item or a couple small things",
      "🛋️ Studio or 1-bedroom",
      "🏠 2–3 bedroom home",
      "🏡 4+ bedroom / full house",
    ],
    show: () => false,
  },
  {
    id: "loadType",
    question: "What are we doing?",
    subtext: "Load only = we load the truck at the pickup. Unload only = we unload at the destination. Both = full move.",
    type: "choice",
    options: [
      "🔼 Load only (we load the truck)",
      "🔽 Unload only (we unload at destination)",
      "🔄 Both — load AND unload",
    ],
    // Tiny jobs: the "single item" framing implies both — no need for this question
    show: (a) => isMovingService(a) && !(a.jobSize || "").includes("1-2 items"),
  },
  {
    id: "fromZip",
    question: "What's the pickup address?",
    subtext: "Start typing — we'll suggest addresses as you go.",
    type: "address",
    placeholder: "123 Main St, Ironwood, MI",
    // Skip if serviceAddress already captured the pickup location upfront
    show: (a) => isMovingService(a) && !(a.loadType || "").includes("Unload only") && !a.serviceAddress,
  },
  {
    id: "toZip",
    question: "What's the delivery address?",
    subtext: "Where are we dropping everything off?",
    type: "address",
    placeholder: "456 Oak Ave, Hurley, WI",
    show: (a) => isMovingService(a) && !(a.loadType || "").includes("Load only"),
  },
  {
    id: "moveDate",
    question: "When do you need this done?",
    type: "choice",
    options: [
      "🔥 ASAP / This week",
      "📅 Next week",
      "🗓️ 2–3 weeks out",
      "📆 Next month",
      "⏳ 2+ months out",
      "🌀 Flexible / Not sure",
    ],
    show: (a) => isMovingService(a) || isJunkService(a),
  },
  {
    id: "homeSize",
    question: "What's the size of the space or job?",
    subtext: "Pick the closest match.",
    type: "choice",
    options: [
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
    ],
    show: (a) => isMovingService(a) || isJunkService(a),
  },
  {
    id: "originFloor",
    question: "Which floor are you on at the PICKUP location?",
    type: "choice",
    options: ["Ground Floor / 1st", "2nd Floor", "3rd Floor", "4th Floor or Higher"],
    show: (a) => isMovingService(a) && !(a.loadType || "").includes("Unload only"),
  },
  {
    id: "originElevator",
    question: "Is there a working elevator at the pickup location?",
    type: "choice",
    options: ["✅ Yes, there's an elevator", "🪜 No elevator — stairs only"],
    show: (a) =>
      isMovingService(a) &&
      !(a.loadType || "").includes("Unload only") &&
      !["Ground Floor / 1st"].includes(a.originFloor || ""),
  },
  {
    id: "destFloor",
    question: "Which floor at the DROP-OFF location?",
    type: "choice",
    options: ["Ground Floor / 1st", "2nd Floor", "3rd Floor", "4th Floor or Higher"],
    show: (a) => isMovingService(a) && !(a.loadType || "").includes("Load only"),
  },
  {
    id: "destElevator",
    question: "Is there a working elevator at the drop-off location?",
    type: "choice",
    options: ["✅ Yes, there's an elevator", "🪜 No elevator — stairs only"],
    show: (a) =>
      isMovingService(a) &&
      !(a.loadType || "").includes("Load only") &&
      !["Ground Floor / 1st"].includes(a.destFloor || ""),
  },
  {
    id: "parkingDistance",
    question: "How far is truck parking from your door?",
    subtext: "Longer carries take more time.",
    type: "choice",
    options: [
      "🚛 Right outside the door (<30 ft)",
      "🚶 Short walk (30–100 ft)",
      "🏃 Long carry (100 ft+)",
    ],
    // Hidden — simplified Moving flow uses jobSize + specialItems for scope
    show: (a) => false,
  },
  {
    id: "furniture",
    question: "Select all large furniture items you have:",
    subtext: "Tap everything that applies. Tap again to deselect.",
    type: "multiselect",
    options: [
      "King Bed", "Queen Bed", "Full / Twin Bed",
      "Sofa", "Sectional Sofa", "Loveseat",
      "Dining Table", "Dining Chairs (4+)",
      "Desk / Office Chair", "Dresser",
      "Wardrobe / Armoire", "Large Bookshelf",
      "TV (65\"+)", "TV (under 65\")",
      "Refrigerator", "Washer / Dryer",
      "Stove / Range", "None of the above",
    ],
    // Hidden for Moving — `jobSize` step covers scope; for Junk service only
    show: (a) => false,
  },
  {
    id: "boxCount",
    question: "Roughly how many packed boxes?",
    subtext: "Boxes under 20 lbs count. Don't overthink it.",
    type: "choice",
    options: [
      "Under 10 boxes", "10–25 boxes", "25–50 boxes",
      "50–75 boxes", "75–100 boxes", "100+ boxes",
    ],
    // Hidden for Moving — `jobSize` covers the scope
    show: (a) => false,
  },
  {
    id: "specialItems",
    question: "Any heavy or specialty items?",
    subtext: "Heavy = 200 lbs or more. Standard heavy items add $100; specialty items may require a custom quote.",
    type: "multiselect",
    options: [
      "🎹 Upright Piano",
      "🎹 Grand Piano",
      "🎱 Pool Table",
      "♨️ Hot Tub",
      "🔒 Safe (300 lbs) +$300",
      "🔒 Safe (500 lbs) +$500",
      "🔒 Safe (1000 lbs) +$1000",
      "🏋️ Heavy Item (400 lbs) +$500",
      "🏋️ Heavy Item (600 lbs) +$500",
      "🏋️ Heavy Item (800+ lbs) +$1000",
      "🏋️ Large Appliance or Fitness Equipment (200 lbs+) +$100",
      "📦 Other Heavy Item (200 lbs+) +$100",
      "None of these",
    ],
    show: (a) => isMovingService(a) || isJunkService(a),
  },
  {
    id: "oversizedItemCount",
    question: "How many oversized or extra-heavy items?",
    subtext: "Quantity matters for the quote. We'll confirm the exact inventory before final booking.",
    type: "choice",
    options: ["1 item", "2 items", "3 items", "4+ items"],
    show: (a) => isMovingService(a) && (a.specialItems || []).some((s) => s !== "None of these"),
  },
  {
    id: "junkLocation",
    question: "Where's the junk located?",
    subtext: "We need your address to schedule pickup.",
    type: "address",
    placeholder: "123 Main St, Ironwood, MI",
    show: (a) => isJunkService(a) && !a.serviceAddress,
  },
  {
    id: "packingHelp",
    question: "Do you need packing help?",
    subtext: "We bring all supplies.",
    type: "choice",
    options: [
      "✅ No — I'm already packed",
      "📦 Pack a few fragile items",
      "🏠 Full packing service (whole home)",
    ],
    show: (a) => isMovingService(a) && !(a.jobSize || "").includes("1-2 items"),
  },
  {
    id: "distanceReport",
    question: "How far is the move?",
    subtext: "Pick the closest match. We'll confirm the exact distance.",
    type: "choice",
    options: [
      "📍 Local — within 20 miles of Ironwood",
      "🗺️ About 1 hour away (30–70 miles)",
      "🛣️ About 2 hours away (70–140 miles)",
      "🌎 About 3 hours or more (140+ miles)",
    ],
    show: (a) => isMovingService(a),
  },
  {
    id: "truckSituation",
    question: "Do you have a moving truck?",
    subtext: "Our rental includes 50 miles. Extra A-to-B miles are billed at $5/mi after that.",
    type: "choice",
    options: [
      "🚗 I'll bring my own truck (or rental)",
      "🚛 JC ON THE MOVE provides the truck",
    ],
    // Tiny jobs use flat rates — no truck question
    show: (a) => isMovingService(a) && !(a.jobSize || "").includes("1-2 items"),
  },
  {
    id: "truckSize",
    question: "Which truck size?",
    subtext: "The 15' is great for studios and 1–2 bedrooms. The 26' handles large homes and heavy loads.",
    type: "choice",
    options: [
      "🚐 15' truck — studio, 1–2 bed, smaller loads",
      "🚛 26' truck — 3+ bed, large home, heavy loads",
    ],
    show: (a) => isMovingService(a) && !(a.jobSize || "").includes("1-2 items"),
  },
  {
    id: "movingRec",
    question: "Here's your instant quote:",
    subtext: "Pick the option that works best for you.",
    type: "moving_recs",
    show: (a) => isMovingService(a),
  },

  // ── TRASH VALET STEPS ──────────────────────────────────────────────────────
  {
    id: "trashCans",
    question: "How many trash cans do you have?",
    subtext: "This is for weekly trash pickup.",
    type: "choice",
    options: ["1 can", "2 cans", "3 cans", "4+ cans"],
    show: (a) => isTrashValetService(a),
  },
  {
    id: "trashBags",
    question: "Any extra bags beyond your cans?",
    type: "choice",
    options: ["No extra bags", "1–4 extra bags", "5–9 extra bags", "10+ extra bags"],
    show: (a) => isTrashValetService(a),
  },
  {
    id: "recyclingEnabled",
    question: "Do you want bi-weekly recycling pickup?",
    type: "choice",
    options: ["✅ Yes, add recycling", "❌ No, trash only"],
    show: (a) => isTrashValetService(a),
  },
  {
    id: "trashPlanType",
    question: "What plan type works best for you?",
    type: "choice",
    options: ["📅 Monthly (pay each month)", "📆 Yearly (save 1 month — 11 months charged)"],
    show: (a) => isTrashValetService(a),
  },
  {
    id: "depositZip",
    question: "What's your service address?",
    subtext: "We'll use this to confirm service availability.",
    type: "address",
    placeholder: "123 Main St, Ironwood, MI",
    show: (a) => isTrashValetService(a),
  },

  // ── WINDOW CLEANING STEPS ─────────────────────────────────────────────────
  {
    id: "windowLocation",
    question: "What's the address for the window cleaning?",
    subtext: "We'll confirm local availability and scheduling.",
    type: "address",
    placeholder: "123 Main St, Ironwood, MI",
    show: (a) => isWindowCleaningService(a),
  },
  {
    id: "standardWindows",
    question: "How many standard-size windows do you have?",
    subtext: "Standard = typical residential window.",
    type: "text",
    placeholder: "e.g. 10",
    show: (a) => isWindowCleaningService(a),
  },
  {
    id: "largeWindows",
    question: "How many large / picture windows?",
    subtext: "Large = floor-to-ceiling or oversized pane (counts as 2 panes).",
    type: "text",
    placeholder: "e.g. 3",
    show: (a) => isWindowCleaningService(a),
  },
  {
    id: "ladderWindows",
    question: "How many windows require a ladder?",
    subtext: "2nd floor or higher. These are $10/pane.",
    type: "text",
    placeholder: "e.g. 0",
    show: (a) => isWindowCleaningService(a),
  },
  {
    id: "windowInside",
    question: "Do you want inside cleaning too?",
    type: "choice",
    options: ["✅ Yes — inside + outside", "❌ Outside only"],
    show: (a) => isWindowCleaningService(a),
  },

  // ── QUOTE-ONLY SERVICE STEPS ──────────────────────────────────────────────

  // ── LAWN CARE ──────────────────────────────────────────────────────────────
  {
    id: "lawnPropertySize",
    question: "How big is your lawn / property?",
    subtext: "Pick the closest match.",
    type: "choice",
    options: [
      "🌱 Small — under 5,000 sq ft",
      "🌿 Medium — 5,000–10,000 sq ft",
      "🌳 Large — 10,000–20,000 sq ft",
      "🏡 X-Large — 20,000+ sq ft",
      "❓ Not sure — I'll describe it",
    ],
    show: (a) => isLawnService(a),
  },
  {
    id: "lawnServices",
    question: "What services do you need?",
    subtext: "Select all that apply.",
    type: "multiselect",
    options: [
      "🌿 Mowing",
      "✂️ Trimming & Edging",
      "🍂 Leaf / Debris Removal",
      "🌱 Fertilization",
      "🌾 Overseeding",
      "✂️ Hedge Trimming",
      "Other / Custom",
    ],
    show: (a) => isLawnService(a),
  },
  {
    id: "lawnFrequency",
    question: "How often do you need service?",
    type: "choice",
    options: [
      "📅 One-Time",
      "🔄 Weekly (best rate)",
      "📆 Bi-Weekly",
      "🗓️ Monthly",
      "❓ Not sure yet",
    ],
    show: (a) => isLawnService(a),
  },
  {
    id: "lawnCondition",
    question: "What's the current condition of your lawn?",
    subtext: "This helps us estimate time and crew size.",
    type: "choice",
    options: [
      "✅ Well Maintained — regular upkeep, neat",
      "🌿 Slightly Overgrown — a bit long",
      "🌾 Overgrown — several weeks no service",
      "🌵 Heavily Overgrown — tall grass, weeds, brush",
    ],
    show: (a) => isLawnService(a),
  },

  // ── SNOW REMOVAL ─────────────────────────────────────────────────────────
  {
    id: "snowDrivewayType",
    question: "What's your driveway situation?",
    subtext: "Tap the option that best describes it.",
    type: "choice",
    options: [
      "🚗 Single car — short (1 car wide, under 40 ft)",
      "🚗 Single car — long (1 car wide, 40 ft+)",
      "🚙 Double car — short (2 cars wide, under 40 ft)",
      "🚙 Double car — long (2 cars wide, 40 ft+)",
      "📋 Custom / Commercial — need a quote",
    ],
    show: (a) => isSnowService(a),
  },
  {
    id: "snowAddons",
    question: "Any add-ons?",
    subtext: "Select all that apply.",
    type: "multiselect",
    options: [
      "🚶 Walkway + front steps",
      "🚪 Back or side door path",
      "None — driveway only",
    ],
    show: (a) => isSnowService(a) && !(a.snowDrivewayType || "").includes("Custom"),
  },

  // ── MOVE-IN/OUT CLEANING ──────────────────────────────────────────────────
  {
    id: "cleanHomeSize",
    question: "What's the size of the home?",
    type: "choice",
    options: [
      "🏠 Studio",
      "🏠 1 Bedroom",
      "🏠 2 Bedrooms",
      "🏠 3 Bedrooms",
      "🏠 4 Bedrooms+",
    ],
    show: (a) => isCleaningService(a),
  },
  {
    id: "cleanBathrooms",
    question: "How many bathrooms does the home have?",
    type: "choice",
    options: [
      "🚿 1 bathroom",
      "🚿🚿 2 bathrooms",
      "🚿🚿🚿 3 bathrooms",
      "🚿+ 4+ bathrooms",
    ],
    show: (a) => isCleaningService(a),
  },
  {
    id: "cleanAppliances",
    question: "Any appliances or cabinets we should focus on?",
    subtext: "Select all that apply — helps us estimate the scope.",
    type: "multiselect",
    options: [
      "🍳 Inside oven",
      "🧊 Inside refrigerator",
      "🍽️ Inside dishwasher",
      "🗄️ Inside kitchen cabinets",
      "None / Not sure",
    ],
    show: (a) => isCleaningService(a),
  },
  {
    id: "cleanType",
    question: "Which cleaning package fits your needs?",
    subtext: "Standard is a quick refresh. Deep and Premium go further.",
    type: "choice",
    options: [
      "🧹 Standard Clean — surface refresh, floors, bath & kitchen wipe-down",
      "✨ Deep Clean — top-to-bottom: inside appliances, baseboards, cabinets",
      "💎 Premium Clean — Deep Clean + carpet treatment + windows + garage/basement",
    ],
    show: (a) => isCleaningService(a),
  },
  {
    id: "cleanAddons",
    question: "Any add-ons?",
    subtext: "Select all that apply.",
    type: "multiselect",
    options: [
      "🛋️ Carpet cleaning",
      "🪟 Extra window cleaning",
      "🍳 Appliance cleaning (inside oven, fridge, etc.)",
      "None",
    ],
    show: (a) => isCleaningService(a),
  },

  // ── LIGHT DEMOLITION ──────────────────────────────────────────────────────
  {
    id: "demoCrewSize",
    question: "How big of a crew do you estimate needing?",
    type: "choice",
    options: [
      "👤 1 person",
      "👥 2 people",
      "👥👥 3+ people",
      "❓ Not sure — need advice",
    ],
    show: (a) => isDemoService(a),
  },
  {
    id: "demoDuration",
    question: "How long do you think the job will take?",
    type: "choice",
    options: [
      "⏱️ 2–4 hours",
      "🕐 Half day (~4–6 hrs)",
      "📅 Full day (6–8 hrs)",
      "📆 Multi-day project",
    ],
    show: (a) => isDemoService(a),
  },
  {
    id: "demoHazards",
    question: "Any hazardous conditions we should know about?",
    subtext: "Hazardous materials affect crew requirements. Select all that apply.",
    type: "multiselect",
    options: [
      "🦠 Mold present",
      "🐛 Bed bugs",
      "☢️ Asbestos suspected",
      "✅ None / Other",
    ],
    show: (a) => isDemoService(a),
  },
  {
    id: "demoWasteRemoval",
    question: "How will demo waste be handled?",
    type: "choice",
    options: [
      "🗑️ Dumpster already on site",
      "🚛 JC hauls everything away",
      "❓ Unsure — need guidance",
    ],
    show: (a) => isDemoService(a),
  },
  {
    id: "demoScope",
    question: "What's being demolished?",
    subtext: "Select all that apply.",
    type: "multiselect",
    options: [
      "🪵 Flooring",
      "🧱 Walls / Sheetrock",
      "🏠 Insulation",
      "🔲 Ceilings",
      "🏚️ Full room tearout",
      "Other",
    ],
    show: (a) => isDemoService(a),
  },

  // ── HANDYMAN ──────────────────────────────────────────────────────────────
  {
    id: "handymanScale",
    question: "How big is the project?",
    subtext: "Pick the closest match.",
    type: "choice",
    options: [
      "🔩 Tiny — about 1 hour",
      "🔧 Small — half day",
      "🛠️ Medium — 2–4 hours",
      "⚙️ Large — half day or more",
    ],
    show: (a) => isHandymanService(a),
  },
  {
    id: "handymanCategory",
    question: "What category best fits the work?",
    type: "choice",
    options: [
      "🚿 Bathroom",
      "🍳 Kitchen",
      "🏠 Exterior",
      "🛋️ Interior (general)",
      "📋 Custom / Mixed",
    ],
    show: (a) => isHandymanService(a),
  },

  // ── FLOORING ──────────────────────────────────────────────────────────────
  {
    id: "flooringOldRemoval",
    question: "Does the old flooring need to be removed first?",
    type: "choice",
    options: [
      "✅ Yes — remove existing floor",
      "❌ No — installing over subfloor",
      "❓ Not sure",
    ],
    show: (a) => isFlooringService(a),
  },
  {
    id: "flooringCurrentType",
    question: "What's the current floor type?",
    type: "choice",
    options: [
      "🪵 Hardwood",
      "🔲 Laminate / Vinyl",
      "⬛ Tile / Stone",
      "🟫 Carpet",
      "Subfloor / Bare",
      "Other",
    ],
    show: (a) => isFlooringService(a),
  },
  {
    id: "flooringNewProduct",
    question: "What type of new flooring are you installing?",
    type: "choice",
    options: [
      "🪵 Hardwood (solid or engineered)",
      "🔲 Luxury vinyl plank (LVP)",
      "⬛ Tile / Stone",
      "🟫 Carpet",
      "Other / Undecided",
    ],
    show: (a) => isFlooringService(a),
  },
  {
    id: "flooringMaterials",
    question: "Who's supplying the materials?",
    type: "choice",
    options: [
      "📦 I'm supplying the materials",
      "🏪 JC provides materials",
      "💬 Need advice on materials",
    ],
    show: (a) => isFlooringService(a),
  },
  {
    id: "flooringRoomsSqft",
    question: "How many rooms and what's the approximate square footage?",
    subtext: "Give us your best estimate — exact measurements aren't required yet.",
    type: "text",
    placeholder: "e.g. 2 rooms, ~400 sq ft",
    show: (a) => isFlooringService(a),
  },
  {
    id: "flooringHaulAway",
    question: "Should we haul away the old flooring material?",
    type: "choice",
    options: [
      "✅ Yes — haul away old material",
      "❌ No — I'll dispose of it",
    ],
    show: (a) => isFlooringService(a) && a.flooringOldRemoval === "✅ Yes — remove existing floor",
  },
  {
    id: "flooringTrim",
    question: "What about trim and baseboards?",
    type: "choice",
    options: [
      "✅ Install new trim / baseboards",
      "🔄 Reinstall existing trim",
      "❌ No trim work needed",
    ],
    show: (a) => isFlooringService(a),
  },

  // ── PAINTING ──────────────────────────────────────────────────────────────
  {
    id: "paintingIntExt",
    question: "Interior or exterior painting?",
    type: "choice",
    options: [
      "🏠 Interior",
      "🏡 Exterior",
      "🏘️ Both interior & exterior",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingType",
    question: "Painting or staining?",
    type: "choice",
    options: [
      "🎨 Painting",
      "🪵 Staining",
      "Both",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingRoomCount",
    question: "How many rooms or areas need painting?",
    type: "choice",
    options: [
      "1 room / area",
      "2–3 rooms",
      "4–5 rooms",
      "6+ rooms / whole house",
    ],
    show: (a) => isPaintingService(a) && a.paintingIntExt !== "🏡 Exterior",
  },
  {
    id: "paintingRoomSize",
    question: "What's the typical room size?",
    type: "choice",
    options: [
      "🔹 Small (under 150 sq ft)",
      "🔷 Medium (150–300 sq ft)",
      "🔶 Large (300–500 sq ft)",
      "🟠 Extra large / open concept (500+ sq ft)",
    ],
    show: (a) => isPaintingService(a) && a.paintingIntExt !== "🏡 Exterior",
  },
  {
    id: "paintingCeilings",
    question: "Are ceilings included?",
    type: "choice",
    options: [
      "✅ Yes — paint the ceilings too",
      "❌ No — walls only",
    ],
    show: (a) => isPaintingService(a) && a.paintingIntExt !== "🏡 Exterior",
  },
  {
    id: "paintingAddons",
    question: "Any add-ons?",
    subtext: "Select all that apply.",
    type: "multiselect",
    options: [
      "🚪 Doors & trim",
      "🪟 Window frames",
      "None",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingPrep",
    question: "How much prep work is needed?",
    type: "choice",
    options: [
      "✅ Minimal — walls are in great shape",
      "🔧 Some — minor patching / sanding needed",
      "⚒️ Heavy — significant repairs or stripping",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingMaterials",
    question: "Who's supplying the paint?",
    type: "choice",
    options: [
      "🪣 I'm providing the paint",
      "🏪 JC provides paint",
      "💬 Need help choosing",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingPrimer",
    question: "Will a primer coat be needed?",
    type: "choice",
    options: [
      "✅ Yes — prime before painting",
      "❌ No primer needed",
      "❓ Not sure",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingSurfaceCondition",
    question: "What's the surface condition?",
    type: "choice",
    options: [
      "✅ Good — minimal imperfections",
      "⚠️ Fair — some cracks or peeling",
      "🔴 Poor — significant damage or old paint",
    ],
    show: (a) => isPaintingService(a),
  },
  {
    id: "paintingSpecialtyAreas",
    question: "Any high or vaulted ceilings?",
    type: "choice",
    options: [
      "✅ Yes — high or vaulted ceilings",
      "❌ No — standard ceiling height",
    ],
    show: (a) => isPaintingService(a),
  },

  // ── ROOFING ───────────────────────────────────────────────────────────────
  {
    id: "roofingCurrentType",
    question: "What's the current roof type?",
    type: "choice",
    options: [
      "🔩 Metal roof",
      "🏠 Asphalt shingles",
      "🏚️ Other / Unknown",
    ],
    show: (a) => isRoofingService(a),
  },
  {
    id: "roofingStories",
    question: "How many stories is the building?",
    type: "choice",
    options: [
      "🏠 1 story",
      "🏘️ 2 stories",
      "🏗️ 2+ stories",
    ],
    show: (a) => isRoofingService(a),
  },
  {
    id: "roofingPitch",
    question: "What's the roof pitch (steepness)?",
    subtext: "If unsure, describe what you see.",
    type: "choice",
    options: [
      "🔲 Low / flat pitch",
      "📐 Medium pitch (standard residential)",
      "📐📐 Steep pitch",
      "❓ Not sure",
    ],
    show: (a) => isRoofingService(a),
  },
  {
    id: "roofingTearOff",
    question: "Is this a full replacement or repair?",
    type: "choice",
    options: [
      "🔄 Full tear-off & replacement",
      "🔧 Repair / partial replacement",
      "❓ Not sure — need an assessment",
    ],
    show: (a) => isRoofingService(a),
  },
  {
    id: "roofingWasteRemoval",
    question: "How should old roofing materials be handled?",
    type: "choice",
    options: [
      "🚛 JC hauls everything away",
      "🗑️ Dumpster already on site",
      "❓ Unsure",
    ],
    show: (a) => isRoofingService(a) && a.roofingTearOff === "🔄 Full tear-off & replacement",
  },
  {
    id: "roofingMaterials",
    question: "Who's supplying roofing materials?",
    type: "choice",
    options: [
      "📦 I'm supplying materials",
      "🏪 JC provides materials",
      "💬 Need advice on materials",
    ],
    show: (a) => isRoofingService(a),
  },

  // ── SHARED QUOTE-ONLY STEPS ───────────────────────────────────────────────
  {
    id: "jobLocation",
    question: "What's the job address?",
    subtext: "We use this to determine if a free local estimate applies.",
    type: "address",
    placeholder: "123 Main St, Ironwood, MI",
    show: (a) => isQuoteOnlyService(a),
  },
  {
    id: "moveDate",
    question: "When are you looking to get started?",
    type: "choice",
    options: [
      "🔥 ASAP / This week",
      "📅 Next week",
      "🗓️ 2–3 weeks out",
      "📆 Next month",
      "⏳ 2+ months out",
      "🌀 Flexible / Not sure",
    ],
    show: (a) => isQuoteOnlyService(a),
  },
  {
    id: "depositAcknowledged",
    question: "Estimate deposit acknowledgment",
    type: "deposit_ack",
    show: (a) => {
      if (!isQuoteOnlyService(a)) return false;
      const zip = a.jobLocation || "";
      const svc = getServiceLabel(a.serviceType || "");
      const dep = getDepositInfo(svc, zip);
      return dep.required;
    },
  },

  // ── JUMP START STEPS ─────────────────────────────────────────────────────
  {
    id: "vehicleType",
    question: "What type of vehicle needs a jump start?",
    subtext: "Darrell uses a portable jump pack — works for most vehicles.",
    type: "choice",
    options: ["🚗 Car", "🚐 Truck or Van", "🚙 SUV", "🏍️ Motorcycle", "❓ Other"],
    show: (a) => isJumpStartService(a),
  },

  // ── MOVING CREW PREFERENCE ────────────────────────────────────────────────
  {
    id: "crewPreference",
    question: "How would you like to handle your crew?",
    subtext: "Choosing your own crew lets you pick availability and movers. We can also assign the best crew for your job.",
    type: "choice",
    options: [
      "🧑‍🤝‍🧑 Choose my own crew",
      "✅ Assign the best crew for me",
    ],
    // Hidden for Moving — the movingRec recommendation cards handle crew selection
    show: (a) => false,
  },

  // ── PACKAGE SELECTION (priceable services) ────────────────────────────────
  {
    id: "selectedPackage",
    question: "Choose your crew package:",
    type: "package_select",
    show: (a) =>
      isPriceableService(a) &&
      !isQuoteOnlyService(a) &&
      (!isMovingService(a) || (a.crewPreference || "").includes("Choose my own crew")),
  },

  // ── PROMO CODE (moving & junk — after package select, near the end) ───────
  {
    id: "promoCode",
    question: "Got a promo code? Enter it here — or skip.",
    subtext: "Enter an active promo or moving package code. The final price is verified by the server before checkout.",
    type: "text",
    placeholder: "e.g. JCMOVES",
    optional: true,
    show: (a) => {
      const svc = getServiceLabel(a.serviceType || "");
      return svc === "Moving" || svc === "Junk Removal";
    },
  },

  // ── PHOTO UPLOAD (all users) ──────────────────────────────────────────────
  {
    id: "employeePhotos",
    question: "Add photos (optional)",
    subtext: "Upload photos of items, space, or anything that helps us understand the job scope. Tap to skip.",
    type: "photo_upload",
    optional: true,
  },

  // ── CONTACT + NOTES (all services) ───────────────────────────────────────
  {
    id: "contact",
    question: "Almost done! What's the best way to reach you?",
    subtext: "Your quote will be reviewed by Darrell personally before anything is sent.",
    type: "contact",
  },
  {
    id: "notes",
    question: "Anything else we should know?",
    subtext: "Narrow hallways, parking restrictions, tight deadlines, etc. Leave blank to skip.",
    type: "notes",
    optional: true,
    placeholder: "e.g. 'Moving out-of-state in 10 days, tight hallways, big sectional needs to be disassembled'",
  },
];

// ─────────────────────────────────────────────
// Moving — Bundled Recommendation Engine
// ─────────────────────────────────────────────

export interface MovingRecommendation {
  id: string;
  label: string;          // e.g. "2 movers + 15' truck"
  price: string;          // e.g. "$370"  or  "$125 promo"
  priceNote?: string;     // e.g. "2-hr minimum"
  rateNote?: string;      // e.g. "$185/hr"
  reason: string;
  isBestMatch: boolean;
  customQuote: boolean;   // Darrell follow-up instead of instant price
  crew: number;
  hours?: number;
  totalMin: number;
  totalMax: number;
  notes: string;          // written into job notes on submit
}

/** Resolve which distance bracket applies, preferring Google Maps over self-report */
export function getMovingDistanceBracket(
  distanceMiles: number,
  distanceReport: string | undefined,
): "local" | "1hr" | "2hr" | "3hr" {
  if (distanceMiles > 0) {
    return getMovingDistanceBracketFromMiles(distanceMiles);
  }
  const r = distanceReport || "";
  if (r.includes("Local")) return "local";
  if (r.includes("1 hour")) return "1hr";
  if (r.includes("2 hours")) return "2hr";
  if (r.includes("3 hours")) return "3hr";
  return "local";
}

function numberFromText(value: string | undefined, fallback = 0): number {
  const parsed = Number(String(value || "").match(/\d+/)?.[0] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStairContext(a: Answers) {
  const floorNum = (f: string | undefined) =>
    ({ "Ground Floor / 1st": 1, "2nd Floor": 2, "3rd Floor": 3, "4th Floor or Higher": 4 }[f || ""] || 1);
  const oFloor = floorNum(a.originFloor);
  const dFloor = floorNum(a.destFloor);
  const hasOriginStairs = oFloor >= 2 && (a.originElevator || "").includes("No elevator");
  const hasDestStairs = dFloor >= 2 && (a.destElevator || "").includes("No elevator");
  return {
    hasAnyStairs: hasOriginStairs || hasDestStairs,
    highStairFloors: (hasOriginStairs ? oFloor - 1 : 0) + (hasDestStairs ? dFloor - 1 : 0),
  };
}

function oversizedItemBaseFee(label: string): number {
  if (label.includes("Grand") || label.includes("Hot Tub")) return 600;
  if (label.includes("Pool Table")) return 500;
  if (label.includes("1000")) return 1000;
  if (label.includes("800+")) return 1000;
  if (label.includes("600")) return 500;
  if (label.includes("500")) return 500;
  if (label.includes("400")) return 500;
  if (label.includes("Safe")) return 300;
  if (label.includes("Upright")) return 300;
  if (label.includes("Appliance") || label.includes("Fitness")) return 100;
  return 100;
}

function getOversizedItemQuote(a: Answers) {
  const items = (a.specialItems || []).filter((s) => s !== "None of these");
  if (!items.length) {
    return { count: 0, fee: 0, multiplier: 0, note: "" };
  }
  const count = Math.max(1, numberFromText(a.oversizedItemCount, items.length));
  const base = Math.max(...items.map(oversizedItemBaseFee));
  const multiplier = 1;
  const fee = Math.round(base * count * multiplier);
  return {
    count,
    fee,
    multiplier,
    note: `${count} oversized item${count === 1 ? "" : "s"} x $${base} = $${fee}`,
  };
}

/**
 * Build 1–3 smart recommendation cards for Moving jobs.
 * Uses bundled flat rates when JC provides a truck; falls back to labor-only rates.
 */
export function buildMovingRecommendations(
  a: Answers,
  distanceMiles: number,
  stakingPerkPct = 0,
  pricingSnapshot: CanonicalPricingSnapshot = CANONICAL_PRICING_2026_08,
  insideBubble?: boolean | null,
): MovingRecommendation[] {
  const bracket = getMovingDistanceBracket(distanceMiles, a.distanceReport);
  const jobSizeText = a.jobSize || "";
  const propertyText = a.propertyType || "";
  const isTiny = jobSizeText.includes("1-2 items") || jobSizeText.includes("Single item");
  const specials = (a.specialItems || []).filter(s => s !== "None of these");
  const oversizedQuote = getOversizedItemQuote(a);
  const { hasAnyStairs } = getStairContext(a);
  const hasMajorSpecialty = specials.some(s =>
    ["🎹 Grand Piano", "🎹 Upright Piano", "🎱 Pool Table", "♨️ Hot Tub"].includes(s) || s.includes("Safe")
  );
  const truckIsJC = (a.truckSituation || "").includes("JC ON THE MOVE");
  const is26 = (a.truckSize || "").includes("26'");
  const applyPerk = (n: number) =>
    stakingPerkPct > 0 ? Math.round(n * (1 - stakingPerkPct / 100)) : n;
  const perkNote = stakingPerkPct > 0 ? ` (${stakingPerkPct}% loyalty perk applied)` : "";
  const oversizedNote = oversizedQuote.fee > 0 ? ` · ${oversizedQuote.note}` : "";

  // ── TINY JOB PATH ──────────────────────────────────────────────────────────
  if (isTiny) {
    if (hasMajorSpecialty) {
      if (bracket === "local") {
        const total = applyPerk(450);
        return [{
          id: "tiny_specialty_local",
          label: "Specialty crew — 3 movers",
          price: `$${total}`,
          priceNote: "flat rate · no truck needed",
          reason: "Piano, pool table, or safe — 3-mover specialty crew handles it safely.",
          isBestMatch: true,
          customQuote: false,
          crew: 3,
          totalMin: total,
          totalMax: total,
          notes: `Tiny specialty job · 3-mover crew · flat $450 · ${specials.join(", ")}${perkNote}`,
        }];
      }
      // 1hr travel + major specialty → custom quote
      return [{
        id: "tiny_specialty_travel_custom",
        label: "Custom quote — Darrell follows up",
        price: "Custom",
        reason: "Specialty item + travel requires a custom quote. Darrell typically responds within 1 hour.",
        isBestMatch: true,
        customQuote: true,
        crew: 3,
        totalMin: 0,
        totalMax: 0,
        notes: `Tiny specialty job · travel · custom quote · ${specials.join(", ")}`,
      }];
    }
    // Tiny — no specialty
    if (bracket === "local") {
      const twoMover = applyPerk(150);
      const threeMover = applyPerk(200);
      return [
        {
          id: "tiny_local_2mover_hour",
          label: "1-2 items - 2 movers",
          price: `$${twoMover}`,
          priceNote: "1-hour local special",
          reason: "Quick local help for one or two items with a two-person crew.",
          isBestMatch: true,
          customQuote: false,
          crew: 2,
          hours: 1,
          totalMin: twoMover,
          totalMax: twoMover,
          notes: `1-2 item local special · 2 movers · 1 hour · $${twoMover}${perkNote}`,
        },
        {
          id: "tiny_local_3mover_hour",
          label: "1-2 items - 3 movers",
          price: `$${threeMover}`,
          priceNote: "1-hour local special",
          reason: "A little more muscle for awkward items, tight entries, or faster handling.",
          isBestMatch: false,
          customQuote: false,
          crew: 3,
          hours: 1,
          totalMin: threeMover,
          totalMax: threeMover,
          notes: `1-2 item local special · 3 movers · 1 hour · $${threeMover}${perkNote}`,
        },
      ];
    }
    if (bracket === "1hr") {
      const total = applyPerk(225);
      return [{
        id: "tiny_1hr",
        label: "Single item — with travel",
        price: `$${total}`,
        priceNote: "flat · includes travel",
        reason: "~1 hour each way. Flat rate covers everything.",
        isBestMatch: true,
        customQuote: false,
        crew: 1,
        totalMin: total,
        totalMax: total,
        notes: `Tiny job · 1-hr travel · flat $${total}${perkNote}`,
      }];
    }
    // 2hr+ tiny → custom quote
    return [{
      id: "tiny_long_custom",
      label: "Custom quote — Darrell follows up",
      price: "Custom",
      reason: "Long-distance single-item moves get a custom quote. Darrell typically responds within 1 hour.",
      isBestMatch: true,
      customQuote: true,
      crew: 1,
      totalMin: 0,
      totalMax: 0,
      notes: "Tiny job · long-distance · custom quote",
    }];
  }

  // ── JC PROVIDES TRUCK ──────────────────────────────────────────────────────
  if (truckIsJC) {
    if (bracket === "local") {
      const opt2 = applyPerk(370) + oversizedQuote.fee;
      const opt3 = applyPerk(450) + oversizedQuote.fee;
      return [
        {
          id: "local_jc_2mover_15",
          label: "2 movers + 15' truck",
          price: `$${opt2}`,
          priceNote: "2-hr minimum",
          rateNote: `$185/hr${perkNote}`,
          reason: "Best for studios, 1–2 bedrooms, and smaller loads.",
          isBestMatch: !is26,
          customQuote: false,
          crew: 2,
          totalMin: opt2,
          totalMax: opt2 + 200,
          notes: `Local bundled · 2 movers + 15' truck · $185/hr · 2-hr min${perkNote}`,
        },
        {
          id: "local_jc_3mover_15",
          label: "3 movers + 15' truck",
          price: `$${opt3}`,
          priceNote: "2-hr minimum",
          rateNote: `$225/hr${perkNote}`,
          reason: "Faster for 2–3 bedrooms or homes with lots of stairs.",
          isBestMatch: is26,
          customQuote: false,
          crew: 3,
          totalMin: opt3,
          totalMax: opt3 + 300,
          notes: `Local bundled · 3 movers + 15' truck · $225/hr · 2-hr min${perkNote}`,
        },
      ];
    }
    // Traveling — table lookup
    const tables: Record<string, Record<string, { rate: number; hrs: number }>> = {
      "15'": { "1hr": { rate: 225, hrs: 4 }, "2hr": { rate: 210, hrs: 6 }, "3hr": { rate: 200, hrs: 8 } },
      "26'": { "1hr": { rate: 325, hrs: 4 }, "2hr": { rate: 310, hrs: 6 }, "3hr": { rate: 300, hrs: 8 } },
    };
    const sz = is26 ? "26'" : "15'";
    const altSz = is26 ? "15'" : "26'";
    const b = bracket;
    const { rate, hrs } = tables[sz][b];
    const { rate: altRate, hrs: altHrs } = tables[altSz][b];
    const total = applyPerk(rate * hrs) + oversizedQuote.fee;
    const altTotal = applyPerk(altRate * altHrs) + oversizedQuote.fee;
    const crew = is26 ? 3 : 2;
    const altCrew = is26 ? 2 : 3;
    const distLabel = bracket === "1hr" ? "~1 hr" : bracket === "2hr" ? "~2 hrs" : "~3+ hrs";
    return [
      {
        id: `travel_jc_${sz.replace("'", "")}`,
        label: `${crew} movers + ${sz} truck`,
        price: `$${total.toLocaleString()}`,
        priceNote: `${hrs}-hr minimum · ${distLabel} away`,
        rateNote: `$${rate}/hr · all-inclusive${perkNote}`,
        reason: `All-in bundle: crew, truck, fuel, and travel${perkNote ? " · loyalty discount applied" : ""}.`,
        isBestMatch: true,
        customQuote: false,
        crew,
        totalMin: total,
        totalMax: total + crew * hrs * 20,
        notes: `Traveling bundled · ${crew} movers + ${sz} truck · $${rate}/hr · ${hrs}-hr min · ${distLabel}${perkNote}`,
      },
      {
        id: `travel_jc_${altSz.replace("'", "")}`,
        label: `${altCrew} movers + ${altSz} truck`,
        price: `$${altTotal.toLocaleString()}`,
        priceNote: `${altHrs}-hr minimum · ${distLabel} away`,
        rateNote: `$${altRate}/hr · all-inclusive${perkNote}`,
        reason: is26 ? "Smaller truck for lighter loads." : "Larger truck for bigger homes.",
        isBestMatch: false,
        customQuote: false,
        crew: altCrew,
        totalMin: altTotal,
        totalMax: altTotal + altCrew * altHrs * 20,
        notes: `Traveling bundled · ${altCrew} movers + ${altSz} truck · $${altRate}/hr · ${altHrs}-hr min · ${distLabel}${perkNote}`,
      },
    ];
  }

  // ── LABOR ONLY ─────────────────────────────────────────────────────────────
  // Map jobSize to crew/hours, then price it through the canonical labor policy.
  const loadTypeRaw = a.loadType || "";
  const isUnloadOnly = loadTypeRaw.includes("Unload only");
  const isLoadOnly = loadTypeRaw.includes("Load only");
  const isBoth = loadTypeRaw.includes("Both") || loadTypeRaw.includes("load + unload") || loadTypeRaw.includes("Load + unload");
  const isHouse = propertyText.includes("House");
  const isLargeLoad = is26 || jobSizeText.includes("4") || (isHouse && jobSizeText.includes("3")) || (a.homeSize || "").includes("4+");
  const useMarketplaceRateCard = movingRateCardAppliesForDistance(distanceMiles, pricingSnapshot, insideBubble);
  const localLaborTotal = (crew: number, hours: number) => applyPerk(
    canonicalMovingLaborTotal(crew, hours, pricingSnapshot.labor.workerHourlyRate, pricingSnapshot),
  ) + oversizedQuote.fee;

  if (bracket === "local" && isUnloadOnly) {
    if (isLargeLoad) {
      const total2x5 = localLaborTotal(2, 5);
      const total3x3 = localLaborTotal(3, 3);
      const total4x2 = localLaborTotal(4, 2);
      const reason = `Large 26 ft unload. Drive time and gas are extra when applicable${oversizedNote}.`;
      return [
        {
          id: "unload_large_2x5",
          label: "2 movers - 5 hours",
          price: `$${total2x5}`,
          priceNote: "large local unload",
          rateNote: "26 ft truck baseline",
          reason,
          isBestMatch: !hasAnyStairs,
          customQuote: false,
          crew: 2,
          hours: 5,
          totalMin: total2x5,
          totalMax: total2x5,
          notes: `Unload only · large 26 ft · 2 movers · 5 hours · canonical labor $${total2x5}${perkNote}${oversizedNote}`,
        },
        {
          id: "unload_large_3x3",
          label: "3 movers - 3 hours",
          price: `$${total3x3}`,
          priceNote: "large local unload",
          rateNote: "faster crew",
          reason,
          isBestMatch: hasAnyStairs,
          customQuote: false,
          crew: 3,
          hours: 3,
          totalMin: total3x3,
          totalMax: total3x3,
          notes: `Unload only · large 26 ft · 3 movers · 3 hours · canonical labor $${total3x3}${perkNote}${oversizedNote}`,
        },
        {
          id: "unload_large_4x2",
          label: "4 movers - 2 hours",
          price: `$${total4x2}`,
          priceNote: "large local unload",
          rateNote: "fastest crew",
          reason,
          isBestMatch: false,
          customQuote: false,
          crew: 4,
          hours: 2,
          totalMin: total4x2,
          totalMax: total4x2,
          notes: `Unload only · large 26 ft · 4 movers · 2 hours · canonical labor $${total4x2}${perkNote}${oversizedNote}`,
        },
      ];
    }

    if (hasAnyStairs) {
      const total2x3 = localLaborTotal(2, 3);
      const total3x2 = localLaborTotal(3, 2);
      return [
        {
          id: "unload_stairs_2x3",
          label: "2 movers - 3 hours",
          price: `$${total2x3}`,
          priceNote: "stairs minimum",
          rateNote: "small/medium local unload",
          reason: `Stairs add time on unload-only jobs${oversizedNote}.`,
          isBestMatch: true,
          customQuote: false,
          crew: 2,
          hours: 3,
          totalMin: total2x3,
          totalMax: total2x3,
          notes: `Unload only · stairs · 2 movers · 3 hours · canonical labor $${total2x3}${perkNote}${oversizedNote}`,
        },
        {
          id: "unload_stairs_3x2",
          label: "3 movers - 2 hours",
          price: `$${total3x2}`,
          priceNote: "stairs minimum",
          rateNote: "faster crew",
          reason: `A third mover keeps stair carries safer and quicker${oversizedNote}.`,
          isBestMatch: false,
          customQuote: false,
          crew: 3,
          hours: 2,
          totalMin: total3x2,
          totalMax: total3x2,
          notes: `Unload only · stairs · 3 movers · 2 hours · canonical labor $${total3x2}${perkNote}${oversizedNote}`,
        },
      ];
    }

    const isMedium = jobSizeText.includes("2") || jobSizeText.includes("3") || (a.homeSize || "").includes("2") || (a.homeSize || "").includes("3");
    const hours = isMedium ? 3 : 2;
    const total = localLaborTotal(2, hours);
    return [{
      id: isMedium ? "unload_medium_local" : "unload_small_no_stairs",
      label: isMedium ? "2 movers - 3 hours" : "2 movers - 2 hours",
      price: `$${total}`,
      priceNote: isMedium ? "small/medium local minimum" : "quick local unload",
      rateNote: `$${pricingSnapshot.labor.workerHourlyRate}/mover/hr`,
      reason: isMedium
        ? `Small/medium local unload with no stairs${oversizedNote}.`
        : `Small no-stairs unloads can be quick when parking/access is easy${oversizedNote}.`,
      isBestMatch: true,
      customQuote: false,
      crew: 2,
      hours,
      totalMin: total,
      totalMax: total,
      notes: isMedium
        ? `Unload only · small/medium · no stairs · 2 movers · 3 hours · canonical labor $${total}${perkNote}${oversizedNote}`
        : `Unload only · small · no stairs · 2 movers · 2 hours · canonical labor $${total}${perkNote}${oversizedNote}`,
    }];
  }

  if (bracket === "local" && isBoth && is26) {
    const total = localLaborTotal(2, 8);
    return [{
      id: "local_26_load_unload_2x8",
      label: "2 movers - 8 hours",
      price: `$${total}`,
      priceNote: "26 ft local load + unload",
      rateNote: "local flat booking",
      reason: `Local 26 ft load + unload baseline${oversizedNote}.`,
      isBestMatch: true,
      customQuote: false,
      crew: 2,
      hours: 8,
      totalMin: total,
      totalMax: total,
      notes: `Load + unload · 26 ft · 2 movers · 8 hours · canonical labor $${total}${perkNote}${oversizedNote}`,
    }];
  }

  if (bracket === "local" && isLoadOnly) {
    const crew = hasAnyStairs ? 3 : 2;
    const hours = 4;
    const total = localLaborTotal(crew, hours);
    return [{
      id: hasAnyStairs ? "load_only_stairs_3x4" : is26 ? "load_only_26_2x4" : "load_only_15_2x4",
      label: `${crew} movers - ${hours} hours`,
      price: `$${total}`,
      priceNote: hasAnyStairs ? "stairs local load" : is26 ? "26 ft local load" : "15 ft local load",
      rateNote: "includes shrink-wrap handling time",
      reason: `Loading usually takes longer than unloading because we protect and stack items for transit${oversizedNote}.`,
      isBestMatch: true,
      customQuote: false,
      crew,
      hours,
      totalMin: total,
      totalMax: total,
      notes: `Load only · shrink-wrap/product handling factored · ${crew} movers · ${hours} hours · canonical labor $${total}${perkNote}${oversizedNote}`,
    }];
  }

  if (bracket !== "local" && isBoth && hasAnyStairs) {
    const travelCharge = useMarketplaceRateCard
      ? 0
      : distanceMiles > 0
      ? calculateMovingTravelCharge(distanceMiles).fee
      : getMovingTravelFeeForBracket(bracket);
    const travelText = travelCharge > 0 ? ` + $${travelCharge} drive/gas` : "";
    const options = [
      { id: "oot_stairs_both_2x8", crew: 2, hours: 8 },
      { id: "oot_stairs_both_3x6", crew: 3, hours: 6 },
      { id: "oot_stairs_both_4x5", crew: 4, hours: 5 },
      { id: "oot_stairs_both_5x4", crew: 5, hours: 4 },
    ];
    return options.map((opt, index) => {
      const supportedSpecialLine = useMarketplaceRateCard ? calculateRateCardLine({
        serviceCode: "load_unload",
        crewSize: opt.crew,
        hours: opt.hours,
        snapshot: pricingSnapshot,
      }) : null;
      if (useMarketplaceRateCard && !supportedSpecialLine) {
        return {
          id: opt.id,
          label: `${opt.crew} movers - ${opt.hours} hours`,
          price: "Manual review",
          priceNote: "Special-zone crew combination",
          rateNote: "Owner confirms the final rate",
          reason: `The published farther-client card supports up to four helpers; this option needs owner review${oversizedNote}.`,
          isBestMatch: false,
          customQuote: true,
          crew: opt.crew,
          hours: opt.hours,
          totalMin: 0,
          totalMax: 0,
          notes: `MovingHelper Special zone · unsupported ${opt.crew}-helper combination · manual review required${oversizedNote}`,
        };
      }
      const labor = applyPerk(canonicalMovingLaborTotal(
        opt.crew,
        opt.hours,
        pricingSnapshot.labor.workerHourlyRate,
        pricingSnapshot,
        useMarketplaceRateCard,
      ));
      const total = labor + travelCharge + oversizedQuote.fee;
      return {
        id: opt.id,
        label: `${opt.crew} movers - ${opt.hours} hours`,
        price: `$${total.toLocaleString()}`,
        priceNote: `out-of-town stairs load + unload${travelText}`,
        rateNote: useMarketplaceRateCard
          ? `MovingHelper Special-zone crew rate${perkNote}`
          : `$${CANONICAL_MOVING_RATE}/mover/hr + drive time/gas${perkNote}`,
        reason: `Out-of-town full moves with stairs need a longer booking window${oversizedNote}.`,
        isBestMatch: index === 1,
        customQuote: false,
        crew: opt.crew,
        hours: opt.hours,
        totalMin: total,
        totalMax: total,
        notes: `Out-of-town · stairs · load + unload · ${opt.crew} movers · ${opt.hours} hours · drive/gas $${travelCharge}${perkNote}${oversizedNote}`,
      };
    });
  }
  const laborSizeMap: Record<string, { crew: number; minHrs: number; maxHrs: number }> = {
    "Studio":  { crew: 2, minHrs: 2, maxHrs: 3 },
    "2–3 bed": { crew: 2, minHrs: 3, maxHrs: 5 },
    "4+ bed":  { crew: 3, minHrs: 4, maxHrs: 7 },
  };
  const sizeKey = jobSizeText.includes("Studio") ? "Studio"
    : jobSizeText.includes("2") || jobSizeText.includes("3") ? "2–3 bed"
    : jobSizeText.includes("4") ? "4+ bed"
    : "Studio";
  const { crew: lCrew, minHrs, maxHrs } = laborSizeMap[sizeKey];
  const laborRate = CANONICAL_MOVING_RATE;
  const travelCharge = useMarketplaceRateCard
    ? 0
    : distanceMiles > 0
    ? calculateMovingTravelCharge(distanceMiles).fee
    : getMovingTravelFeeForBracket(bracket);
  const laborMin = applyPerk(canonicalMovingLaborTotal(lCrew, minHrs, laborRate, pricingSnapshot, useMarketplaceRateCard)) + travelCharge + oversizedQuote.fee;
  const laborMax = applyPerk(canonicalMovingLaborTotal(lCrew, maxHrs, laborRate, pricingSnapshot, useMarketplaceRateCard)) + travelCharge + oversizedQuote.fee;
  const travelLabel = travelCharge > 0 ? ` + $${travelCharge} travel` : "";
  return [
    {
      id: "labor_only",
      label: `${lCrew} movers — labor only`,
      price: `$${laborMin.toLocaleString()}–$${laborMax.toLocaleString()}`,
      priceNote: travelCharge > 0 ? `Includes $${travelCharge} one-way travel charge` : `${minHrs}–${maxHrs}-hr estimate`,
      rateNote: useMarketplaceRateCard
        ? `MovingHelper Special-zone crew rate${perkNote}`
        : `$${laborRate}/mover/hr${perkNote}`,
      reason: "You bring your own truck or rental. We load, move, and unload.",
      isBestMatch: true,
      customQuote: false,
      crew: lCrew,
      totalMin: laborMin,
      totalMax: laborMax,
      notes: useMarketplaceRateCard
        ? `Labor only · ${lCrew} movers · MovingHelper Special-zone rate · no stacked travel surcharge${perkNote}`
        : `Labor only · ${lCrew} movers · $${laborRate}/hr · ${travelCharge > 0 ? `$${travelCharge} travel charge` : "no travel charge"}${perkNote}`,
    },
  ];
}

// ─────────────────────────────────────────────
// Moving Quote Engine
// ─────────────────────────────────────────────
export function computeMovingQuote(
  a: Answers,
  ratePerMoverHour = CANONICAL_MOVING_RATE,
  distanceMiles = 0,
  stakingPerkPct = 0,
  pricingSnapshot: CanonicalPricingSnapshot = CANONICAL_PRICING_2026_08,
  insideBubble?: boolean | null,
): MovingQuote {
  const RATE = ratePerMoverHour;
  const round5 = (n: number) => Math.ceil(n / 5) * 5;

  // ── Load type ──────────────────────────────────────────────────────────────
  const loadTypeRaw = a.loadType || "";
  const isBoth = loadTypeRaw.includes("Both");

  // ── Stairs ─────────────────────────────────────────────────────────────────
  const floorNum = (f: string | undefined) =>
    ({ "Ground Floor / 1st": 1, "2nd Floor": 2, "3rd Floor": 3, "4th Floor or Higher": 4 }[f || ""] || 1);
  const oFloor = floorNum(a.originFloor);
  const dFloor = floorNum(a.destFloor);
  const hasOriginStairs = oFloor >= 2 && a.originElevator === "🪜 No elevator — stairs only";
  const hasDestStairs   = dFloor >= 2 && a.destElevator   === "🪜 No elevator — stairs only";
  const hasAnyStairs    = hasOriginStairs || hasDestStairs;
  const highStairFloors = (hasOriginStairs ? oFloor - 1 : 0) + (hasDestStairs ? dFloor - 1 : 0);

  // ── Special items ──────────────────────────────────────────────────────────
  const specials = (a.specialItems || []).filter(s => s !== "None of these");
  const hasGrandPiano    = specials.includes("🎹 Grand Piano");
  const hasUprightPiano  = specials.includes("🎹 Upright Piano");
  const hasPoolTable     = specials.includes("🎱 Pool Table");
  const hasHotTub        = specials.includes("♨️ Hot Tub");
  const hasHeavySafe     = specials.some(s => s.includes("Safe"));
  // 200 lbs+ items: large appliance, fitness equipment, or any other heavy item declared by customer
  const hasHeavyAppliance = specials.some(s => s.includes("Large Appliance") || s.includes("Fitness"));
  const hasOtherHeavy     = specials.some(s => s.includes("Other Heavy Item") || s.includes("Heavy Item"));
  const hasMajorSpecial  = hasGrandPiano || hasUprightPiano || hasPoolTable || hasHotTub;
  // Any 200 lb+ item turns a 1-person job into a 2-person job minimum
  const hasAnyHeavy100   = hasHeavySafe || hasHeavyAppliance || hasOtherHeavy;

  // Specialty item surcharges — $400 for ≤500 lbs items, $600 for 500+ lbs items (standalone)
  let specialSurcharge = 0;
  if (hasGrandPiano)    specialSurcharge += 600; // 500+ lbs
  if (hasUprightPiano)  specialSurcharge += 300;
  if (hasPoolTable)     specialSurcharge += 500;
  if (hasHotTub)        specialSurcharge += 600; // 500+ lbs
  if (hasHeavySafe)     specialSurcharge += Math.max(...specials.filter(s => s.includes("Safe")).map(oversizedItemBaseFee));
  if (hasHeavyAppliance) specialSurcharge += 100; // 200+ lbs appliance/equipment
  if (hasOtherHeavy)    specialSurcharge += Math.max(...specials.filter(s => s.includes("Other Heavy Item") || s.includes("Heavy Item")).map(oversizedItemBaseFee));
  const oversizedQuote = getOversizedItemQuote(a);
  if (oversizedQuote.fee > 0) {
    specialSurcharge = oversizedQuote.fee;
  }

  // ── Furniture & box counts ─────────────────────────────────────────────────
  const furnCount = (a.furniture || []).filter(f => f !== "None of the above").length;
  const boxIdx = ["Under 10 boxes", "10–25 boxes", "25–50 boxes", "50–75 boxes", "75–100 boxes", "100+ boxes"]
    .indexOf(a.boxCount || "Under 10 boxes");

  // ── Size score → base tier ─────────────────────────────────────────────────
  // score: -1 = force tiny, 0-2 = small, 3-5 = medium, 6+ = large
  const sizeScore: Record<string, number> = {
    "1–2 Items (Tiny Job)": -1,
    "Studio / Single Room": 0,
    "1 Bedroom Apartment":  1,
    "2 Bedroom Apartment":  3,
    "3 Bedroom Apartment":  5,
    "4+ Bedroom Apartment": 6,
    "1–2 Bedroom House":    4,
    "3 Bedroom House":      7,
    "4+ Bedroom House":     9,
    "Commercial / Office":  8,
  };
  const movingJobSize = a.jobSize || "";
  const movingPropertyType = a.propertyType || "";
  const movingIsHouse = movingPropertyType.includes("House");
  let score = sizeScore[a.homeSize || ""] ?? 2;
  if (movingJobSize) {
    if (movingJobSize.includes("1-2 items")) score = -1;
    else if (movingJobSize.includes("Studio")) score = movingIsHouse ? 2 : 1;
    else if (movingJobSize.includes("2 bedroom")) score = movingIsHouse ? 4 : 3;
    else if (movingJobSize.includes("3 bedroom")) score = movingIsHouse ? 7 : 5;
    else if (movingJobSize.includes("4 bedroom")) score = movingIsHouse ? 9 : 6;
    if (movingPropertyType.includes("Storage")) score = Math.max(score, 2);
    if (movingPropertyType.includes("Office")) score = Math.max(score, 6);
  }

  // Adjust score for complexity
  if (isBoth)             score += 2;   // Load + Unload = more work
  if (hasAnyStairs)       score += 1;
  if (highStairFloors >= 2) score += 1; // 3rd floor or higher, or stairs at both ends
  if (furnCount >= 6)     score += 1;
  if (furnCount >= 12)    score += 1;
  if (boxIdx >= 3)        score += 1;   // 50–75 boxes
  if (boxIdx >= 5)        score += 1;   // 100+ boxes
  if (hasMajorSpecial)    score = Math.max(score, 4); // at least Medium
  if (hasGrandPiano)      score = Math.max(score, 7); // Large
  if (a.packingHelp === "🏠 Full packing service (whole home)") score += 2;
  if (a.parkingDistance === "🏃 Long carry (100 ft+)") score += 1;

  // ── Determine tier ─────────────────────────────────────────────────────────
  let tier: "tiny" | "small" | "medium" | "large";
  // Any 200 lb+ item prevents a solo/tiny job — needs at least 2 movers
  if (score === -1 && !isBoth && !hasMajorSpecial && !hasAnyHeavy100) {
    tier = "tiny";
  } else if (score <= 2) {
    tier = "small";
  } else if (score <= 5) {
    tier = "medium";
  } else {
    tier = "large";
  }

  // Special upgrade rules
  // Any 200 lb+ item + stairs → minimum Small (2 movers)
  if (tier === "tiny" && hasAnyHeavy100 && hasAnyStairs) tier = "small";
  // Load+Unload always minimum Medium
  if (isBoth && tier === "small") tier = "medium";

  // ── Crew & hours from tier ─────────────────────────────────────────────────
  let crew: number;
  let minHrs: number;
  let maxHrs: number;

  if (tier === "tiny") {
    crew   = 1;
    minHrs = 2;   // minimum is 2 mover-hours ($170) — same whether 1×2hrs or 2×1hr
    maxHrs = 2;
  } else if (tier === "small") {
    crew   = (hasAnyHeavy100 || hasMajorSpecial) && hasAnyStairs ? 3 : 2;
    minHrs = 2;
    maxHrs = isBoth ? 3 : 2;
  } else if (tier === "medium") {
    // Default 2×4; with stairs or heavy items 3×2.5
    if (hasAnyStairs || hasMajorSpecial || hasAnyHeavy100 || highStairFloors >= 2) {
      crew   = 3;
      minHrs = 2.5;
      maxHrs = 3.5;
    } else {
      crew   = 2;
      minHrs = 4;
      maxHrs = 4;
    }
  } else { // large
    if (hasGrandPiano || score >= 9) {
      crew   = 4;
      minHrs = 4;
      maxHrs = 5;
    } else {
      crew   = 3;
      minHrs = 5;
      maxHrs = 7;
    }
  }

  // ── Fine-tune hours from context ───────────────────────────────────────────
  if (hasOriginStairs && tier !== "tiny") maxHrs += (oFloor - 1) * 0.3;
  if (hasDestStairs   && tier !== "tiny") maxHrs += (dFloor - 1) * 0.3;
  if (a.parkingDistance === "🚶 Short walk (30–100 ft)") maxHrs += 0.25;
  if (a.parkingDistance === "🏃 Long carry (100 ft+)")   maxHrs += 0.75;
  if (a.packingHelp === "📦 Pack a few fragile items")       maxHrs += 0.5;
  if (a.packingHelp === "🏠 Full packing service (whole home)") { maxHrs += 2; crew = Math.max(crew, 3); }
  if (furnCount >= 8)  maxHrs += 0.5;
  if (boxIdx >= 4)     maxHrs += 0.5;

  // ── Enforce load+unload minimum 3 hrs ─────────────────────────────────────
  if (isBoth) {
    minHrs = Math.max(minHrs, 3);
    maxHrs = Math.max(maxHrs, 3);
  }

  // Round to nearest 0.5
  minHrs = Math.round(minHrs * 2) / 2;
  maxHrs = Math.max(minHrs, Math.round(maxHrs * 2) / 2);

  // ── Pricing ───────────────────────────────────────────────────────────────
  const useMarketplaceRateCard = movingRateCardAppliesForDistance(distanceMiles, pricingSnapshot, insideBubble);
  const rawMin = round5(canonicalMovingLaborTotal(
    crew,
    minHrs,
    RATE,
    pricingSnapshot,
    useMarketplaceRateCard,
  )) + specialSurcharge;
  const rawMax = round5(canonicalMovingLaborTotal(
    crew,
    maxHrs,
    RATE,
    pricingSnapshot,
    useMarketplaceRateCard,
  )) + specialSurcharge;

  // The MovingHelper Special card is a complete farther-client labor price;
  // the old travel table must not stack on it. Eligibility/minimum review is
  // still enforced by the server's canonical geographic policy.
  const travelCharge = useMarketplaceRateCard
    ? 0
    : distanceMiles > 0
    ? calculateMovingTravelCharge(distanceMiles).fee
    : getMovingTravelFeeForBracket(getMovingDistanceBracket(distanceMiles, a.distanceReport));

  // Promo and package eligibility are determined from the active database
  // record on the server. Chat estimates never invent a discount locally.
  const promoApplied = false;

  // ── Staking perk discount: auto-applied when threshold is met ────────────
  const stakingDiscount = stakingPerkPct > 0
    ? Math.round(rawMin * stakingPerkPct / 100)
    : 0;
  const stakingPerkApplied = stakingDiscount > 0;

  const baseMin = rawMin - stakingDiscount;
  const baseMax = rawMax - stakingDiscount;
  const minPrice = baseMin + travelCharge;
  const maxPrice = baseMax + travelCharge;
  const midPrice = (minPrice + maxPrice) / 2;
  const tokensEstimate = Math.round(midPrice * 50);

  return {
    type: "moving",
    tier,
    crew,
    minHrs,
    maxHrs,
    minPrice,
    maxPrice,
    tokensEstimate,
    specialSurcharge,
    promoApplied,
    promoCode:          undefined,
    rawMinPrice:        undefined,
    travelCharge:       travelCharge || undefined,
    jcmovesApplied:     undefined,
    jcmovesDiscount:    undefined,
    stakingPerkApplied: stakingPerkApplied || undefined,
    stakingPerkDiscount: stakingDiscount || undefined,
    stakingPerkPct:     stakingPerkApplied ? stakingPerkPct : undefined,
    rateSource: useMarketplaceRateCard ? "movinghelper_special" : "local_canonical",
  };
}

// ─────────────────────────────────────────────
// Junk Removal Quote Engine
// ─────────────────────────────────────────────
export function computeJunkQuote(a: Answers, ratePerMoverHour = CANONICAL_MOVING_RATE, distanceMiles = 0, stakingPerkPct = 0): JunkQuote {
  const RATE = ratePerMoverHour;
  const r5 = (n: number) => Math.ceil(n / 5) * 5;

  // Volume tier from home size
  const sizeTierMap: Record<string, "tiny" | "small" | "medium" | "large"> = {
    "1–2 Items (Tiny Job)":    "tiny",
    "Studio / Single Room":    "small",
    "1 Bedroom Apartment":     "small",
    "2 Bedroom Apartment":     "medium",
    "3 Bedroom Apartment":     "medium",
    "4+ Bedroom Apartment":    "large",
    "1–2 Bedroom House":       "medium",
    "3 Bedroom House":         "large",
    "4+ Bedroom House":        "large",
    "Commercial / Office":     "large",
  };
  const tier: "tiny" | "small" | "medium" | "large" = sizeTierMap[a.homeSize || ""] ?? "small";

  // Special items surcharge — $400 for ≤500 lbs items, $600 for 500+ lbs items (standalone)
  const specials = (a.specialItems || []).filter(s => s !== "None of these");
  let specialSurcharge = 0;
  if (specials.includes("🎹 Grand Piano"))       specialSurcharge += 600; // 500+ lbs
  if (specials.includes("🎹 Upright Piano"))     specialSurcharge += 400; // ≤500 lbs
  if (specials.includes("🎱 Pool Table"))        specialSurcharge += 500;
  if (specials.includes("♨️ Hot Tub"))           specialSurcharge += 600; // 500+ lbs
  if (specials.some(s => s.includes("Safe"))) {
    specialSurcharge += Math.max(...specials.filter(s => s.includes("Safe")).map(oversizedItemBaseFee));
  }

  // Crew and hour ranges by tier
  // Minimum is 2 mover-hours ($170) — same whether 1 mover × 2 hrs or 2 movers × 1 hr
  let crew: number, minHrs: number, maxHrs: number;
  if (tier === "tiny")        { crew = 1; minHrs = 2;   maxHrs = 2;   }
  else if (tier === "small")  { crew = 2; minHrs = 1.5; maxHrs = 2;   }
  else if (tier === "medium") { crew = 2; minHrs = 2.5; maxHrs = 3.5; }
  else                        { crew = 3; minHrs = 3;   maxHrs = 5;   }

  // Heavy items force a larger crew minimum
  if (specials.some(s => ["🎹 Grand Piano", "🎹 Upright Piano", "🎱 Pool Table", "♨️ Hot Tub"].includes(s))) {
    crew = Math.max(crew, 2);
    if (tier === "tiny") { crew = 2; minHrs = 1.5; maxHrs = 2; }
  }

  const rawMin = r5(crew * minHrs * RATE) + specialSurcharge;
  const rawMax = r5(crew * maxHrs * RATE) + specialSurcharge;

  // ── Travel charge: $50 per 25-mile band from Ironwood — all job sizes ──────
  const travelTiers = distanceMiles > 0 ? Math.floor(distanceMiles / JUNK_TRAVEL_TIER_MILES) : 0;
  const travelCharge = travelTiers * JUNK_TRAVEL_CHARGE_PER_TIER;

  // ── Staking perk discount: auto-applied when threshold is met ────────────
  const stakingDiscount = stakingPerkPct > 0
    ? Math.round(rawMin * stakingPerkPct / 100)
    : 0;
  const stakingPerkApplied = stakingDiscount > 0;

  // Task #144 — enforce $170 junk minimum globally. Apply discounts/travel
  // first, then clamp the floor so promo paths can never quote below $170.
  const JUNK_MIN_FLOOR = 170;
  const minPrice = Math.max(JUNK_MIN_FLOOR, rawMin - stakingDiscount + travelCharge);
  const maxPrice = Math.max(minPrice, rawMax - stakingDiscount + travelCharge);
  const tokensEstimate = Math.round(((minPrice + maxPrice) / 2) * 50);

  return {
    type: "junk", tier, crew, minHrs, maxHrs, minPrice, maxPrice, tokensEstimate, specialSurcharge,
    travelCharge:        travelCharge        || undefined,
    jcmovesApplied:      undefined,
    jcmovesDiscount:     undefined,
    stakingPerkApplied:  stakingPerkApplied  || undefined,
    stakingPerkDiscount: stakingDiscount     || undefined,
    stakingPerkPct:      stakingPerkApplied ? stakingPerkPct : undefined,
  };
}

// ─────────────────────────────────────────────
// Compute Quote for Any Service
// ─────────────────────────────────────────────
function computeQuoteForAnswers(
  a: Answers,
  ratePerMoverHour = CANONICAL_MOVING_RATE,
  distanceMiles = 0,
  stakingPerkPct = 0,
  pricingSnapshot: CanonicalPricingSnapshot = CANONICAL_PRICING_2026_08,
  insideBubble?: boolean | null,
): QuoteResult | null {
  const svc = getServiceLabel(a.serviceType || "");

  if (QUOTE_ONLY_SERVICES.includes(svc)) {
    const ranges: Record<string, [number, number]> = {
      "Painting":              [500,   5000],
      "Flooring":              [800,   8000],
      "Roofing":               [5000,  50000],
      "Handyman":              [75,    900],
      "Lawn Care":             [50,    400],
      "Snow Removal":          [40,    150],
      "Move-In/Out Cleaning":  [150,   600],
      "Light Demolition":      [300,   2000],
    };
    const [min, max] = ranges[svc] || [300, 3000];
    return { type: "quote_only", service: svc, minPrice: min, maxPrice: max };
  }

  if (svc === "Junk Removal") {
    return computeJunkQuote(a, ratePerMoverHour, distanceMiles, stakingPerkPct);
  }

  if (svc === "Trash Valet") {
    const canMap: Record<string, number> = { "1 can": 1, "2 cans": 2, "3 cans": 3, "4+ cans": 4 };
    const bagMap: Record<string, number> = { "No extra bags": 0, "1–4 extra bags": 2, "5–9 extra bags": 7, "10+ extra bags": 12 };
    const cans = canMap[a.trashCans || "1 can"] || 1;
    const bags = bagMap[a.trashBags || "No extra bags"] || 0;
    const recycling = (a.recyclingEnabled || "").includes("Yes");
    const planType = (a.trashPlanType || "").includes("Yearly") ? "yearly" : "monthly";
    const isOutOfArea = distanceMiles > TRASH_VALET_TRAVEL_THRESHOLD_MILES;
    const travelFeeMonthly = isOutOfArea ? 50 : 0;
    const quote = calculateTrashValetQuote({ cans, bagCount: bags, recyclingEnabled: recycling, planType });
    const rawFinal = quote.finalMonthlyPrice + travelFeeMonthly;
    const finalPrice = isOutOfArea ? Math.max(TRASH_VALET_OUT_OF_AREA_MINIMUM, rawFinal) : rawFinal;
    return {
      type: "trash_valet",
      finalMonthlyPrice: finalPrice,
      minPrice: finalPrice,
      maxPrice: finalPrice + 10,
    };
  }

  if (svc === "Window Cleaning") {
    const std = parseInt(a.standardWindows || "0") || 0;
    const lg = parseInt(a.largeWindows || "0") || 0;
    const lad = parseInt(a.ladderWindows || "0") || 0;
    const inside = (a.windowInside || "").includes("inside + outside");
    const quote = calculateWindowCleaningQuote({
      standardWindows: std,
      largeWindows: lg,
      ladderWindows: lad,
      includeInside: inside,
      includeOutside: true,
      seasonMode: "normal",
    });
    const travelFee = distanceMiles > 5 ? 50 : 0;
    return {
      type: "window_cleaning",
      paneCount: quote.paneCount,
      minPrice: quote.total + travelFee,
      maxPrice: quote.total + travelFee,
      total: quote.total + travelFee,
    };
  }

  if (svc === "Jump Start") {
    const js = calculateJumpStartQuote(distanceMiles);
    return {
      type: "jump_start",
      flatPrice: js.flatPrice,
      isCustomQuote: js.isCustomQuote,
      distanceTier: js.distanceTier,
      minPrice: js.flatPrice,
      maxPrice: js.flatPrice,
    } as JumpStartQuoteResult;
  }

  // Moving or Junk
  return computeMovingQuote(a, ratePerMoverHour, distanceMiles, stakingPerkPct, pricingSnapshot, insideBubble);
}

// ─────────────────────────────────────────────
// Build Crew Packages for priceable services
// ─────────────────────────────────────────────
export function buildCrewPackages(
  a: Answers,
  q: QuoteResult | null,
  ratePerMoverHour = CANONICAL_MOVING_RATE,
  pricingSnapshot: CanonicalPricingSnapshot = CANONICAL_PRICING_2026_08,
): CrewPackage[] {
  if (!q) return [];

  if (q.type === "junk") {
    const jq = q as JunkQuote;
    const RATE = ratePerMoverHour;
    const sur    = jq.specialSurcharge;
    const travel = jq.travelCharge || 0;
    const r5   = (n: number) => Math.ceil(n / 5) * 5;
    const price = (crew: number, hrs: number) => r5(crew * hrs * RATE) + sur;
    const travelNote = travel > 0 ? ` · +$${travel} travel fee` : "";
    const is26Truck = (a.truckSize || "").includes("26");
    const hasStairs = getStairContext(a).hasAnyStairs;
    const localPackage = (base: number) => base + sur + travel;

    if (jq.tier === "tiny") {
      // $170 minimum = 2 mover-hours. Same price either way.
      const base = price(1, 2) + travel;
      return [
        {
          id: "pkg_junk_tiny_solo",
          label: "1 Mover × 2 hrs",
          desc: `Solo mover · 2-hr minimum · pickup-truck-sized load · items under ~50 lb (trash bags, small items, organize-bag-and-dump)${travelNote}`,
          minPrice: base,
          maxPrice: base,
          crew: 1,
          hours: 2,
          tag: "Standard",
        },
        {
          id: "pkg_junk_tiny_duo",
          label: "2 Movers × 1 hr",
          desc: `Two-person crew · for queen+ mattresses, couches/loveseats, anything over 70–100 lb · same total cost${travelNote}`,
          minPrice: base,
          maxPrice: base,
          crew: 2,
          hours: 1,
          tag: "Heavy items",
        },
      ];
    }

    if (jq.tier === "small") {
      return [{
        id: "pkg_junk_small",
        label: "Small Load · 2 Movers · ~1.5–2 hrs",
        desc: `Studio or 1BR worth of junk · roughly ¼ truck load · efficient crew${travelNote}`,
        minPrice: price(2, 1.5) + travel,
        maxPrice: price(2, 2) + travel,
        crew: 2,
        hours: 2,
        tag: "Standard",
      }];
    }

    if (jq.tier === "medium") {
      return [
        {
          id: "pkg_junk_med_a",
          label: "2 Movers · ~3 hrs",
          desc: `Steady pace — great for a 2–3BR worth of junk or a garage cleanout${travelNote}`,
          minPrice: price(2, 2.5) + travel,
          maxPrice: price(2, 3.5) + travel,
          crew: 2,
          hours: 3,
        },
        {
          id: "pkg_junk_med_b",
          label: "3 Movers · ~2 hrs",
          desc: `Faster crew — best if you have heavy items or a tight time window${travelNote}`,
          minPrice: price(3, 2) + travel,
          maxPrice: price(3, 2) + travel,
          crew: 3,
          hours: 2,
          tag: "Recommended",
        },
      ];
    }

    // large
    return [
      {
        id: "pkg_junk_lg_a",
        label: "3 Movers · ~3.5 hrs",
        desc: `Standard large crew — full-house or 4BR cleanout${travelNote}`,
        minPrice: price(3, 3) + travel,
        maxPrice: price(3, 3.5) + travel,
        crew: 3,
        hours: 3.5,
      },
      {
        id: "pkg_junk_lg_b",
        label: "4 Movers · ~3 hrs",
        desc: `Bigger crew — heavy items, multiple floors, or commercial cleanouts${travelNote}`,
        minPrice: price(4, 2.5) + travel,
        maxPrice: price(4, 3) + travel,
        crew: 4,
        hours: 3,
        tag: "Recommended",
      },
      {
        id: "pkg_junk_xl",
        label: "5 Movers · ~3 hrs (XL)",
        desc: `Max crew — XL job, hoarder cleanout, multi-unit, or same-day rush${travelNote}`,
        minPrice: price(5, 2.5) + travel,
        maxPrice: price(5, 3) + travel,
        crew: 5,
        hours: 3,
        tag: "XL",
      },
    ];
  }

  if (q.type === "moving") {
    const mq = q as MovingQuote;
    const RATE = ratePerMoverHour;
    const sur    = mq.specialSurcharge;
    const travel = mq.travelCharge || 0;
    const useMarketplaceRateCard = mq.rateSource === "movinghelper_special";
    const price = (crew: number, hrs: number) => canonicalMovingLaborTotal(
      crew,
      hrs,
      RATE,
      pricingSnapshot,
      useMarketplaceRateCard,
    ) + sur;
    const travelNote = travel > 0 ? ` · +$${travel} travel fee` : "";

    const is16Truck = (a.truckSize || "").includes("16");
    const isLoadOnly = /load only/i.test(a.loadType || "");
    const hasStairs = getStairContext(a).hasAnyStairs;

    if (mq.tier === "tiny") {
      const base = price(1, 2) + travel;
      return [
        {
          id: "pkg_tiny_solo",
          label: "1 Mover × 2 hrs",
          desc: `Solo mover · 2-hr minimum · great for a couch, dresser, or 1–2 items${travelNote}`,
          minPrice: base,
          maxPrice: base,
          crew: 1,
          hours: 2,
          tag: "Standard",
        },
        {
          id: "pkg_tiny_duo",
          label: "2 Movers × 1 hr",
          desc: `Two-person team · same total cost, faster clock · in and out in ~1 hr${travelNote}`,
          minPrice: base,
          maxPrice: base,
          crew: 2,
          hours: 1,
          tag: "Quick",
        },
      ];
    }

    if (mq.tier === "small") {
      // If heavy item (300 lbs+) + stairs: crew bumped to 3 — only show 3-mover option
      if (mq.crew >= 3) {
        return [
          {
            id: "pkg_small_3crew",
            label: "3 Movers × 2 hrs (Heavy + Stairs)",
            desc: `Required for heavy items on stairs — 3 movers minimum for safe handling${travelNote}`,
            minPrice: price(3, 2) + travel,
            maxPrice: price(3, 2) + travel,
            crew: 3,
            hours: 2,
            tag: "Safety Required",
          },
        ];
      }
      return [
        {
          id: "pkg_small",
          label: "2 Movers x 4 hrs",
          desc: `Half-day local help priced from the canonical per-mover labor rate${travelNote}`,
          minPrice: price(2, 4) + travel,
          maxPrice: price(2, 4) + travel,
          crew: 2,
          hours: 4,
          tag: "Fast book",
        },
      ];
    }

    if (mq.tier === "medium") {
      const standardCrewPackage = is16Truck && isLoadOnly && !hasStairs
        ? {
            id: "pkg_med_16_load_only",
            label: "2 Movers x 2 hrs",
            desc: `15 ft truck load-only minimum · canonical two-hour labor quote${travelNote}`,
            minPrice: price(2, 2) + travel,
            maxPrice: price(2, 2) + travel,
            crew: 2,
            hours: 2,
            tag: "Fast book",
          }
        : {
            id: "pkg_med_a",
            label: "2 Movers x 4 hrs",
            desc: `Steady pace · $${RATE}/mover/hr before the canonical long-job discount · best for ground-floor or elevator access${travelNote}`,
            minPrice: price(2, 4) + travel,
            maxPrice: price(2, 4) + travel,
            crew: 2,
            hours: 4,
            tag: "Fast book",
          };
      const medPkgs: CrewPackage[] = [
        standardCrewPackage,
        {
          id: "pkg_med_b",
          label: "3 Movers x 4 hrs",
          desc: `Faster crew · same total effort · recommended with stairs or tight schedule${travelNote}`,
          minPrice: price(3, 4) + travel,
          maxPrice: price(3, 4) + travel,
          crew: 3,
          hours: 4,
          tag: hasStairs ? "Stairs" : "Upgrade",
        },
      ];
      // Enforce minimum crew from quote engine (e.g. heavy item + stairs requires 3-mover min)
      return medPkgs.filter(p => !p.crew || p.crew >= mq.crew);
    }

    // large — filter enforced below
    const largePkgs: CrewPackage[] = [
      {
        id: "pkg_lg_c",
        label: "2 Movers x 8 hrs",
        desc: `Budget option · plenty of time · best without stairs or heavy items${travelNote}`,
        minPrice: price(2, 8) + travel,
        maxPrice: price(2, 8) + travel,
        crew: 2,
        hours: 8,
        tag: "26 ft load/unload",
      },
      {
        id: "pkg_lg_b",
        label: "3 Movers x 6 hrs",
        desc: `Balanced crew · great for 3BR house or 2+ flights of stairs${travelNote}`,
        minPrice: price(3, 6) + travel,
        maxPrice: price(3, 6) + travel,
        crew: 3,
        hours: 6,
        tag: "Recommended",
      },
      {
        id: "pkg_lg_a",
        label: "4 Movers x 5 hrs",
        desc: `Power crew · fastest option · best for 4BR+ or pianos${travelNote}`,
        minPrice: price(4, 5) + travel,
        maxPrice: price(4, 5) + travel,
        crew: 4,
        hours: 5,
      },
      {
        id: "pkg_lg_d",
        label: "5 Movers x 4 hrs",
        desc: `Maximum crew · best for stairs, tight timing, or heavy access${travelNote}`,
        minPrice: price(5, 4) + travel,
        maxPrice: price(5, 4) + travel,
        crew: 5,
        hours: 4,
      },
    ];
    // Enforce minimum crew: never offer a package with fewer movers than computed minimum
    return largePkgs.filter((p) => (
      (!p.crew || p.crew >= mq.crew)
      && (!useMarketplaceRateCard || !p.crew || p.crew <= 4)
    ));
  }

  if (q.type === "trash_valet") {
    const tq = q as TrashValetQuoteResult;
    return [
      {
        id: "pkg_tv_monthly",
        label: "Monthly Plan",
        desc: "Pay month-to-month — cancel anytime.",
        minPrice: tq.finalMonthlyPrice,
        maxPrice: tq.finalMonthlyPrice,
        tag: "Flexible",
      },
      {
        id: "pkg_tv_yearly",
        label: "Yearly Plan",
        desc: "11 months charged, 12 months of service.",
        minPrice: Math.round(tq.finalMonthlyPrice * 11 / 12),
        maxPrice: Math.round(tq.finalMonthlyPrice * 11 / 12),
        tag: "Best Value",
        originalPrice: tq.finalMonthlyPrice,
      },
    ];
  }

  if (q.type === "window_cleaning") {
    const wq = q as WindowQuoteResult;
    const insideExtra = Math.round(wq.total * 0.4);
    return [
      {
        id: "pkg_wc_outside",
        label: "Outside Only",
        desc: "Streak-free exterior cleaning · $5/pane",
        minPrice: Math.round(wq.total * 0.6),
        maxPrice: Math.round(wq.total * 0.65),
        tag: "Popular",
      },
      {
        id: "pkg_wc_both",
        label: "Inside + Outside",
        desc: "Full deep clean both sides · $5/pane/side",
        minPrice: wq.total,
        maxPrice: wq.total + insideExtra,
        tag: "Best Value",
      },
    ];
  }

  if (q.type === "jump_start") {
    const jsq = q as JumpStartQuoteResult;
    if (jsq.isCustomQuote) {
      return [{
        id: "pkg_jumpstart_custom",
        label: "Custom Quote Required",
        desc: "100+ miles from Ironwood — Darrell will call to confirm pricing before dispatch.",
        minPrice: 0,
        maxPrice: 0,
        tag: "100+ mi",
        priceLabel: "Custom Quote",
      }];
    }
    return [{
      id: "pkg_jumpstart",
      label: `⚡ Jump Start — ${jsq.distanceTier}`,
      desc: `Portable jump pack · flat rate · Darrell comes to you · no membership needed`,
      minPrice: jsq.flatPrice,
      maxPrice: jsq.flatPrice,
      tag: "Flat Rate",
    }];
  }

  return [];
}

// ─────────────────────────────────────────────
// Short answer for chat bubbles
// ─────────────────────────────────────────────
function shortAnswer(stepId: string, val: string | string[]): string {
  if (Array.isArray(val)) {
    if (val.includes("None of the above") || val.includes("None of these")) {
      const others = val.filter(v => v !== "None of the above" && v !== "None of these");
      return others.length > 0 ? others.join(", ") : "None";
    }
    return val.length <= 3 ? val.join(", ") : `${val.slice(0, 2).join(", ")} +${val.length - 2} more`;
  }
  if (stepId === "depositAcknowledged") return "Deposit terms acknowledged ✓";
  if (stepId === "selectedPackage") return `Package selected: ${val}`;
  if (stepId === "promoCode") {
    const code = (val as string).toUpperCase().trim();
    return code ? `Promo code: ${code}` : "No promo code";
  }
  return val;
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
const SERVICE_SLUG_MAP: Record<string, string> = {
  moving: "📦 Moving (local or long-distance)",
  junk: "🗑️ Junk Removal",
  trash_valet: "🗑️ Trash Valet (weekly curbside)",
  "trash-valet": "🗑️ Trash Valet (weekly curbside)",
  window_cleaning: "🪟 Window Cleaning",
  window: "🪟 Window Cleaning",
  painting: "🎨 Painting",
  flooring: "🪵 Flooring",
  roofing: "🏠 Roofing",
  handyman: "🔧 Handyman",
  "lawn-care": "🌿 Lawn Care",
  lawn: "🌿 Lawn Care",
  snow: "❄️ Snow Removal",
  snow_removal: "❄️ Snow Removal",
  cleaning: "✨ Move-In/Out Cleaning",
  "move-in/out cleaning": "✨ Move-In/Out Cleaning",
  "move in/out cleaning": "✨ Move-In/Out Cleaning",
  demolition: "⚒️ Light Demolition",
  "light demolition": "⚒️ Light Demolition",
  "lawn care": "🌿 Lawn Care",
  residential: "📦 Moving (local or long-distance)",
  jumpstart: "⚡ Jump Start",
  "jump-start": "⚡ Jump Start",
  "jump_start": "⚡ Jump Start",
  "jump start": "⚡ Jump Start",
};

// Keyed by canonical service slug (normalized: lowercase, hyphens→underscores).
// All aliases in SERVICE_SLUG_MAP collapse to one of these canonical keys.
const SERVICE_OPENERS: Record<string, string> = {
  moving:      "🚛 Let's get you moved! Darrell's crew has handled 500+ moves across the Northwoods — local and long-distance. I'll build your instant quote in about 60 seconds.",
  residential: "🚛 Let's get you moved! Darrell's crew has handled 500+ moves across the Northwoods — local and long-distance. I'll build your instant quote in about 60 seconds.",
  junk:        "🗑️ Time to clear it out! We haul furniture, appliances, yard waste, and more. A few quick questions and you'll have an instant quote ready.",
  trash_valet: "🗑️ No more dragging cans to the curb. We pick up weekly right from your door — your instant quote is just a few taps away.",
  window:      "🪟 Streak-free windows, guaranteed. Let's get the details and build your instant quote.",
  window_cleaning: "🪟 Streak-free windows, guaranteed. Let's get the details and build your instant quote.",
  painting:    "🎨 Fresh paint transforms a space. Darrell will schedule a free on-site estimate — inside, outside, or both.",
  flooring:    "🪵 New floors, new look. We'll schedule a free on-site estimate to get you an accurate number.",
  roofing:     "🏠 A solid roof protects everything. Darrell will come out for a free estimate — no pressure.",
  handyman:    "🔧 No job too small! Repairs, installs, and fixes — Darrell handles it. Let's get the details for your free estimate.",
  snow:        "❄️ Don't get snowed in. We plow and shovel — fast and reliable. Let's get your free estimate on the schedule.",
  snow_removal:"❄️ Don't get snowed in. We plow and shovel — fast and reliable. Let's get your free estimate on the schedule.",
  lawn:        "🌿 A clean lawn makes the whole place shine. Let's get your free estimate on the schedule.",
  lawn_care:   "🌿 A clean lawn makes the whole place shine. Let's get your free estimate on the schedule.",
  cleaning:    "✨ Moving out? We'll leave it spotless. Moving in? We'll get it fresh and ready. Darrell will reach out to schedule your free estimate.",
  demolition:  "⚒️ Demo day! We knock it down and haul it away — safe, fast, and fully insured. Darrell will reach out to schedule your free estimate.",
  jumpstart:   "⚡ Dead battery? Darrell's on his way! We use a portable jump pack — flat rate, no membership, no wait. Tell me where you are and we'll get your price instantly.",
  jump_start:  "⚡ Dead battery? Darrell's on his way! We use a portable jump pack — flat rate, no membership, no wait. Tell me where you are and we'll get your price instantly.",
};

interface ChatPhoto {
  id: string;
  dataUrl: string;
  name: string;
}

export function BookingChatbot({ onClose, onSuccess, embedded = false, showCloseButton, className, initialService, variant = "customer" }: { onClose?: () => void; onSuccess?: () => void; embedded?: boolean; showCloseButton?: boolean; className?: string; initialService?: string; variant?: "customer" | "employee" }) {
  const isEmployee = variant === "employee";
  const showClose = showCloseButton ?? !embedded;
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // The active versioned pricing snapshot is also used by the quote and save routes.
  const { data: pricingSnapshot } = useQuery<CanonicalPricingSnapshot>({
    queryKey: ["/api/pricing/v2"],
    staleTime: 5 * 60 * 1000,
  });
  const activePricing = pricingSnapshot ?? CANONICAL_PRICING_2026_08;
  const liveRate = activePricing.labor.workerHourlyRate;

  // Fetch staking perk for auto-discount at quote time
  const { data: stakingPerk } = useQuery<{ stakedTotal: number; perkPercent: number; perkLabel: string }>({
    queryKey: ["/api/staking/my-perk"],
    enabled: !!user,
    staleTime: 60_000,
  });
  const stakingPerkPct = stakingPerk?.perkPercent ?? 0;

  const [photos, setPhotos] = useState<ChatPhoto[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [messages, setMessages] = useState<Message[]>([
    {
      from: "bot",
      text: "👋 Hello! I'm JC — Darrell's booking assistant for JC On The Move. I'll have a quote ready in about 60 seconds. No pressure, no spam.",
      ts: Date.now(),
    },
  ]);
  const [stepIdx, setStepIdx] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [contactName, setContactName] = useState(() => user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "");
  const [contactPhone, setContactPhone] = useState(() => user?.phoneNumber || "");
  const [contactEmail, setContactEmail] = useState(() => user?.email || "");
  const [submitted, setSubmitted] = useState(false);
  const [quoteVisible, setQuoteVisible] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<QuoteResult | null>(null);
  const [crewPackages, setCrewPackages] = useState<CrewPackage[]>([]);
  const [distanceMiles, setDistanceMiles] = useState(0); // fetched async when address is entered
  const [distanceInsideBubble, setDistanceInsideBubble] = useState<boolean | null>(null);
  const [selectedPackageObj, setSelectedPackageObj] = useState<CrewPackage | null>(null);
  const [depositInfo, setDepositInfo] = useState<{ required: boolean; amount: number; termsHtml: string } | null>(null);
  const [depositChecked, setDepositChecked] = useState(false);
  const [movingRecs, setMovingRecs] = useState<MovingRecommendation[]>([]);
  const [selectedMovingRec, setSelectedMovingRec] = useState<MovingRecommendation | null>(null);

  // ── localStorage session persistence ──────────────────────────────────────
  const STORAGE_KEY = `jc_chatbot_session_${initialService || "default"}`;

  useEffect(() => {
    if (initialService) return; // Don't restore if a service was pre-selected (fresh entry)
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const d = JSON.parse(saved);
      if (!d.answers || d.stepIdx == null) return;
      if (d.savedAt && Date.now() - d.savedAt > 5 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      setAnswers(d.answers);
      if (Array.isArray(d.messages) && d.messages.length > 0) setMessages(d.messages);
      setStepIdx(d.stepIdx);
      if (!user) {
        if (d.contactName)  setContactName(d.contactName);
        if (d.contactPhone) setContactPhone(d.contactPhone);
        if (d.contactEmail) setContactEmail(d.contactEmail);
      }
      if (d.pendingQuote) {
        setPendingQuote(d.pendingQuote);
        setQuoteVisible(d.quoteVisible || false);
      }
      if (Array.isArray(d.crewPackages) && d.crewPackages.length > 0) setCrewPackages(d.crewPackages);
      if (d.selectedPackageObj) setSelectedPackageObj(d.selectedPackageObj);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (submitted) { localStorage.removeItem(STORAGE_KEY); return; }
    if (stepIdx === 0 && Object.keys(answers).length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        savedAt: Date.now(),
        answers,
        messages,
        stepIdx,
        contactName,
        contactPhone,
        contactEmail,
        pendingQuote,
        quoteVisible,
        crewPackages,
        selectedPackageObj,
      }));
    } catch { /* quota exceeded — ignore */ }
  }, [answers, messages, stepIdx, contactName, contactPhone, contactEmail,
      pendingQuote, quoteVisible, crewPackages, selectedPackageObj, submitted]);

  const visibleSteps = useMemo(
    () => STEPS.filter(s => {
      if (s.employeeOnly && !isEmployee) return false;
      if (shouldSkipSmartBookingStep(s.id, answers as Record<string, unknown>)) return false;
      return !s.show || s.show(answers);
    }),
    [answers, isEmployee]
  );

  const currentStep = visibleSteps[stepIdx];

  useEffect(() => {
    if (user) {
      setContactName(prev => prev || [user.firstName, user.lastName].filter(Boolean).join(" "));
      setContactPhone(prev => prev || (user.phoneNumber || ""));
      setContactEmail(prev => prev || (user.email || ""));
    }
  }, [user]);

  useEffect(() => {
    if (!initialService) return;
    const mapped = SERVICE_SLUG_MAP[initialService.toLowerCase()];
    if (!mapped) return;
    // Pre-fill service type but keep serviceAddress blank — we ask it first
    const newAnswers: Answers = { serviceType: mapped };
    setAnswers(newAnswers);
    // Reset any stale state from previous sessions
    setCrewPackages([]);
    setSelectedPackageObj(null);
    setPendingQuote(null);
    setQuoteVisible(false);
    // Normalize slug for service opener lookup
    const slug = (initialService || "").toLowerCase().replace(/-/g, "_");
    const opener = SERVICE_OPENERS[slug] ?? `You selected: ${mapped}`;
    // Step 0 is the new serviceAddress step — always ask it first
    const addressStep = STEPS[0]; // serviceAddress
    setMessages([
      { from: "bot", text: "👋 Hello! I'm JC — Darrell's booking assistant for JC On The Move.", ts: Date.now() - 3 },
      { from: "bot", text: opener, ts: Date.now() - 2 },
      { from: "bot", text: addressStep.question + (addressStep.subtext ? `\n\n_${addressStep.subtext}_` : ""), ts: Date.now() - 1 },
    ]);
    setStepIdx(0);
  }, [initialService]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, quoteVisible]);

  // Defensive: if we're on the package_select step but crewPackages is empty
  // Recompute visible packages whenever verified distance or the published
  // pricing version changes. This also closes the async-address race where a
  // local card could otherwise remain on screen after a >50-mile lookup lands.
  useEffect(() => {
    if (!currentStep) return;
    if (currentStep.type === "package_select") {
      const q = computeQuoteForAnswers(answers, liveRate, distanceMiles, stakingPerkPct, activePricing, distanceInsideBubble);
      if (!q) return;
      setPendingQuote(q);
      setCrewPackages(buildCrewPackages(answers, q, liveRate, activePricing));
    } else if (currentStep.id === "movingRec") {
      setMovingRecs(buildMovingRecommendations(answers, distanceMiles, stakingPerkPct, activePricing, distanceInsideBubble));
      setSelectedMovingRec(null);
    }
  }, [currentStep?.id, distanceMiles, distanceInsideBubble, stakingPerkPct, activePricing.version, liveRate]);

  useEffect(() => {
    if (!quoteVisible) return;
    setPendingQuote(computeQuoteForAnswers(
      answers,
      liveRate,
      distanceMiles,
      stakingPerkPct,
      activePricing,
      distanceInsideBubble,
    ));
  }, [quoteVisible, distanceMiles, distanceInsideBubble, stakingPerkPct, activePricing.version, liveRate]);

  function botSay(text: string, delay = 0) {
    setTimeout(() => {
      setMessages(prev => [...prev, { from: "bot", text, ts: Date.now() + delay }]);
    }, delay);
  }

  function userSay(text: string) {
    setMessages(prev => [...prev, { from: "user", text, ts: Date.now() }]);
  }

  function advanceStep(stepId: string, value: string | string[]) {
    let newAnswers: Answers = { ...answers };

    if (stepId === "contact") {
      newAnswers.contactName = contactName.trim();
      newAnswers.contactPhone = contactPhone.trim();
      newAnswers.contactEmail = contactEmail.trim();
    } else if (Array.isArray(value)) {
      (newAnswers as any)[stepId] = value;
    } else {
      (newAnswers as any)[stepId] = value;
    }

    if (stepId !== "contact") {
      const smartPatch = applySmartBookingAnswer(newAnswers as Record<string, unknown>, stepId, value);
      newAnswers = smartPatch.answers as Answers;
    }

    setAnswers(newAnswers);

    if (stepId === "contact") {
      userSay(`${contactName} · ${contactPhone} · ${contactEmail}`);
    } else {
      userSay(shortAnswer(stepId, value));
    }

    // Async distance fetch: fires when any address is captured (location-first flow or traditional)
    if (stepId === "serviceAddress" || stepId === "fromZip" || stepId === "junkLocation") {
      const addr = (value as string || "").trim();
      if (addr.length >= 5) {
        fetch(`/api/utility/estimate-drive-miles?address=${encodeURIComponent(addr)}`)
          .then(r => r.json())
          .then((data: any) => {
            const miles = typeof data.miles === "number" ? data.miles : 0;
            setDistanceMiles(miles);
            setDistanceInsideBubble(typeof data.insideBubble === "boolean" ? data.insideBubble : null);
          })
          .catch(() => {
            setDistanceMiles(0);
            setDistanceInsideBubble(null);
          });
      } else {
        setDistanceMiles(0);
        setDistanceInsideBubble(null);
      }
    }

    // Active promos and packages are evaluated server-side against current
    // rate-card, distance, crew, and hours data before a booking is created.
    if (stepId === "promoCode") {
      const code = ((Array.isArray(value) ? value[0] : value) as string || "").toUpperCase().trim();
      if (code && code !== "(NONE)") {
        setTimeout(() => botSay(`We’ll verify ${code} against the current moving promos and packages before checkout.`), 200);
      }
    }

    const nextVisibleSteps = STEPS.filter(s => {
      if (s.employeeOnly && !isEmployee) return false;
      if (shouldSkipSmartBookingStep(s.id, newAnswers as Record<string, unknown>)) return false;
      return !s.show || s.show(newAnswers);
    });
    let nextIdx = stepIdx + 1;
    // If the next step is serviceType but it was pre-filled (by initialService),
    // skip it automatically so the customer isn't re-asked what they already chose.
    if (nextVisibleSteps[nextIdx]?.id === "serviceType" && newAnswers.serviceType) {
      nextIdx += 1;
    }

    if (nextIdx < nextVisibleSteps.length) {
      const nextStep = nextVisibleSteps[nextIdx];

      // When we reach the deposit step, compute deposit info
      if (nextStep.id === "depositAcknowledged") {
        const svc = getServiceLabel(newAnswers.serviceType || "");
        const zip = newAnswers.jobLocation || newAnswers.depositZip || "";
        const dep = getDepositInfo(svc, zip);
        setDepositInfo(dep);
        setDepositChecked(false);
      }

      // When we reach the package select step, compute packages
      if (nextStep.id === "selectedPackage") {
        const q = computeQuoteForAnswers(newAnswers, liveRate, distanceMiles, stakingPerkPct, activePricing, distanceInsideBubble);
        setPendingQuote(q);
        const pkgs = buildCrewPackages(newAnswers, q, liveRate, activePricing);
        setCrewPackages(pkgs);
      }

      // When we reach the moving recommendations step, compute recommendations
      if (nextStep.id === "movingRec") {
        const recs = buildMovingRecommendations(newAnswers, distanceMiles, stakingPerkPct, activePricing, distanceInsideBubble);
        setMovingRecs(recs);
        setSelectedMovingRec(null);
      }

      setTimeout(() => {
        if (nextStep.id !== "depositAcknowledged" && nextStep.id !== "selectedPackage" && nextStep.id !== "movingRec") {
          botSay(nextStep.question + (nextStep.subtext ? `\n\n_${nextStep.subtext}_` : ""));
        }
        setStepIdx(nextIdx);
        setTextInput("");
        setAddressInput("");
        setMultiSel([]);
      }, 500);
    } else {
      // All done — compute final quote & show
      setTimeout(() => {
        const q = computeQuoteForAnswers(newAnswers, liveRate, distanceMiles, stakingPerkPct, activePricing, distanceInsideBubble);
        setPendingQuote(q);

        const svc = getServiceLabel(newAnswers.serviceType || "");
        const isQuoteOnly = QUOTE_ONLY_SERVICES.includes(svc);

        if (isQuoteOnly) {
          botSay(
            `Got it! I've put together a placeholder estimate range for your ${svc} job. This is a starting point — Darrell will reach out to schedule a free on-site estimate (or a virtual one) to give you an exact number. Tap **Request My Quote** below to submit. 👇`
          );
        } else {
          botSay(
            `Perfect! Based on everything you've told me, here's your estimated quote. Hit **Submit for Review** and Darrell will finalize it personally. 👇`
          );
        }

        setTimeout(() => setQuoteVisible(true), 600);
        setStepIdx(nextVisibleSteps.length);
      }, 500);
    }
  }

  function handleChoice(opt: string) {
    if (!currentStep) return;
    advanceStep(currentStep.id, opt);
  }

  function handleTextSubmit() {
    if (!currentStep) return;
    const val = textInput.trim();
    if (!val && !currentStep.optional) return;
    advanceStep(currentStep.id, val || "(none)");
  }

  function handleAddressSubmit() {
    if (!currentStep) return;
    const val = addressInput.trim();
    if (!val) return;
    advanceStep(currentStep.id, val);
    setAddressInput("");
  }

  function handleMultiSubmit() {
    if (!currentStep) return;
    if (multiSel.length === 0) return;
    advanceStep(currentStep.id, multiSel);
    setMultiSel([]);
  }

  function toggleMulti(opt: string) {
    setMultiSel(prev => {
      const isExclusive = opt === "None of the above" || opt === "None of these";
      if (isExclusive) return [opt];
      const withoutExcl = prev.filter(x => x !== "None of the above" && x !== "None of these");
      return withoutExcl.includes(opt)
        ? withoutExcl.filter(x => x !== opt)
        : [...withoutExcl, opt];
    });
  }

  function handleContactSubmit() {
    if (!contactName.trim() || !contactPhone.trim() || !contactEmail.trim()) return;
    advanceStep("contact", "");
  }

  function handleDepositAck() {
    if (!depositChecked) return;
    advanceStep("depositAcknowledged", "acknowledged");
  }

  function handlePackageSelect(pkg: CrewPackage) {
    setSelectedPackageObj(pkg);
  }

  function handlePackageContinue() {
    if (!selectedPackageObj) return;
    advanceStep("selectedPackage", selectedPackageObj.id);
  }

  function handleMovingRecSelect(rec: MovingRecommendation) {
    setSelectedMovingRec(rec);
    // Persist label + notes in answers so the server receives them in the chatbot-quote payload
    setAnswers(prev => ({
      ...prev,
      selectedMovingRec: rec.id,
      selectedMovingRecLabel: rec.label,
      selectedMovingRecNotes: rec.notes,
      selectedMovingRecCrew: String(rec.crew),
      selectedMovingRecHours: rec.hours != null ? String(rec.hours) : undefined,
      selectedMovingRecTotalMin: String(rec.totalMin),
      selectedMovingRecTotalMax: String(rec.totalMax),
    }));
    if (!rec.customQuote) {
      // Synthesise a MovingQuote so the deposit step has a price to work with
      const syntheticQuote: MovingQuote = {
        type: "moving",
        crew: rec.crew,
        minHrs: 0,
        maxHrs: 0,
        minPrice: rec.totalMin,
        maxPrice: rec.totalMax,
        specialSurcharge: 0,
        travelCharge: 0,
        tokensEstimate: Math.round(rec.totalMin * 15),
        promoApplied: false,
        stakingPerkApplied: stakingPerkPct > 0,
        stakingPerkPct,
        stakingPerkDiscount: 0,
        jcmovesDiscount: 0,
        tier: "small",
      };
      setPendingQuote(syntheticQuote);
    }
    // Advance to the next step (fromZip / moveDate etc.)
    advanceStep("movingRec", rec.id);
  }

  function handlePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files) return;

    if (photos.length + files.length > 5) {
      toast({
        title: "Too many photos",
        description: "You can upload up to 5 photos.",
        variant: "destructive",
      });
      return;
    }

    Array.from(files).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `${file.name} is larger than 10MB.`,
          variant: "destructive",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setPhotos(prev => [...prev, { id: crypto.randomUUID(), dataUrl, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
    event.target.value = "";
  }

  function removePhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }

  function handlePhotoStepContinue() {
    const summary = photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? "s" : ""} added` : "(no photos)";
    advanceStep("employeePhotos", summary);
  }

  const [depositPaid, setDepositPaid]             = useState(false);
  const [depositInvoiceSent, setDepositInvoiceSent] = useState(false);
  const [depositInvoiceUrl, setDepositInvoiceUrl] = useState<string | null>(null);

  // Build the submit payload
  const submitMutation = useMutation({
    mutationFn: async (withDeposit: boolean) => {
      if (!pendingQuote) throw new Error("No quote");
      const svc = getServiceLabel(answers.serviceType || "");
      const isQuoteOnly = QUOTE_ONLY_SERVICES.includes(svc);
      const dep = depositInfo;
      const zip = answers.jobLocation || answers.depositZip || answers.serviceAddress || answers.junkLocation || answers.windowLocation || answers.fromZip || "";

      if (isEmployee) {
        const nameParts = (answers.contactName || "").trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        const photoPayload = photos.length > 0 ? photos.map(p => ({
          id: p.id,
          url: p.dataUrl,
          type: "before" as const,
          timestamp: new Date().toISOString(),
        })) : undefined;

        const scopeParts: string[] = [];
        if (answers.snowDrivewayType) scopeParts.push(`Driveway: ${answers.snowDrivewayType}`);
        if (answers.snowAddons?.length) scopeParts.push(`Add-ons: ${answers.snowAddons.join(", ")}`);
        if (answers.cleanHomeSize) scopeParts.push(`Home size: ${answers.cleanHomeSize}`);
        if (answers.cleanBathrooms) scopeParts.push(`Bathrooms: ${answers.cleanBathrooms}`);
        if (answers.cleanAppliances?.length) scopeParts.push(`Appliances/cabinets: ${answers.cleanAppliances.join(", ")}`);
        if (answers.cleanType) scopeParts.push(`Clean type: ${answers.cleanType}`);
        if (answers.cleanAddons?.length) scopeParts.push(`Add-ons: ${answers.cleanAddons.join(", ")}`);
        if (answers.demoCrewSize) scopeParts.push(`Crew: ${answers.demoCrewSize}`);
        if (answers.demoDuration) scopeParts.push(`Duration: ${answers.demoDuration}`);
        if (answers.demoHazards?.length) scopeParts.push(`Hazards: ${answers.demoHazards.join(", ")}`);
        if (answers.demoWasteRemoval) scopeParts.push(`Waste: ${answers.demoWasteRemoval}`);
        if (answers.demoScope?.length) scopeParts.push(`Scope: ${answers.demoScope.join(", ")}`);
        if (answers.handymanScale) scopeParts.push(`Scale: ${answers.handymanScale}`);
        if (answers.handymanCategory) scopeParts.push(`Category: ${answers.handymanCategory}`);
        if (answers.flooringOldRemoval) scopeParts.push(`Old floor removal: ${answers.flooringOldRemoval}`);
        if (answers.flooringHaulAway) scopeParts.push(`Haul away: ${answers.flooringHaulAway}`);
        if (answers.flooringCurrentType) scopeParts.push(`Current floor: ${answers.flooringCurrentType}`);
        if (answers.flooringNewProduct) scopeParts.push(`New floor: ${answers.flooringNewProduct}`);
        if (answers.flooringMaterials) scopeParts.push(`Materials: ${answers.flooringMaterials}`);
        if (answers.flooringRoomsSqft) scopeParts.push(`Rooms/sqft: ${answers.flooringRoomsSqft}`);
        if (answers.flooringTrim) scopeParts.push(`Trim: ${answers.flooringTrim}`);
        if (answers.paintingIntExt) scopeParts.push(`Painting area: ${answers.paintingIntExt}`);
        if (answers.paintingType) scopeParts.push(`Painting type: ${answers.paintingType}`);
        if (answers.paintingRoomCount) scopeParts.push(`Room count: ${answers.paintingRoomCount}`);
        if (answers.paintingRoomSize) scopeParts.push(`Room size: ${answers.paintingRoomSize}`);
        if (answers.paintingCeilings) scopeParts.push(`Ceilings: ${answers.paintingCeilings}`);
        if (answers.paintingAddons?.length) scopeParts.push(`Painting add-ons: ${answers.paintingAddons.join(", ")}`);
        if (answers.paintingSurfaceCondition) scopeParts.push(`Surface condition: ${answers.paintingSurfaceCondition}`);
        if (answers.paintingPrep) scopeParts.push(`Prep work: ${answers.paintingPrep}`);
        if (answers.paintingMaterials) scopeParts.push(`Paint materials: ${answers.paintingMaterials}`);
        if (answers.paintingPrimer) scopeParts.push(`Primer: ${answers.paintingPrimer}`);
        if (answers.paintingSpecialtyAreas) scopeParts.push(`Specialty areas: ${answers.paintingSpecialtyAreas}`);
        if (answers.roofingCurrentType) scopeParts.push(`Roof type: ${answers.roofingCurrentType}`);
        if (answers.roofingStories) scopeParts.push(`Stories: ${answers.roofingStories}`);
        if (answers.roofingPitch) scopeParts.push(`Pitch: ${answers.roofingPitch}`);
        if (answers.roofingTearOff) scopeParts.push(`Roof work: ${answers.roofingTearOff}`);
        if (answers.roofingWasteRemoval) scopeParts.push(`Waste removal: ${answers.roofingWasteRemoval}`);
        if (answers.roofingMaterials) scopeParts.push(`Roofing materials: ${answers.roofingMaterials}`);
        if (answers.jobScope) scopeParts.push(answers.jobScope);
        if (answers.crewPreference) scopeParts.push(`Crew: ${answers.crewPreference}`);
        // Moving recommendation selection — inject the bundled rate details into notes
        if (answers.selectedMovingRecLabel) {
          scopeParts.push(`Selected option: ${answers.selectedMovingRecLabel}`);
        } else if (answers.jobSize) {
          scopeParts.push(`Job size: ${answers.jobSize}`);
        }
        if (answers.propertyType) scopeParts.push(`Property type: ${answers.propertyType}`);
        if (answers.selectedMovingRecNotes) {
          scopeParts.push(answers.selectedMovingRecNotes);
        }
        if (answers.oversizedItemCount) scopeParts.push(`Oversized quantity: ${answers.oversizedItemCount}`);
        if (answers.distanceReport) scopeParts.push(`Distance: ${answers.distanceReport}`);
        if (answers.truckSituation) scopeParts.push(`Truck: ${answers.truckSituation}`);
        if (answers.truckSize) scopeParts.push(`Truck size: ${answers.truckSize}`);
        if (answers.vehicleType) scopeParts.push(`Vehicle: ${answers.vehicleType}`);
        if (answers.lawnPropertySize) scopeParts.push(`Lawn size: ${answers.lawnPropertySize}`);
        if (answers.lawnServices?.length) scopeParts.push(`Services: ${answers.lawnServices.join(", ")}`);
        if (answers.lawnFrequency) scopeParts.push(`Frequency: ${answers.lawnFrequency}`);
        if (answers.lawnCondition) scopeParts.push(`Condition: ${answers.lawnCondition}`);

        const payload = {
          firstName,
          lastName,
          email: answers.contactEmail || "",
          phone: answers.contactPhone || "",
          serviceType: svc,
          fromAddress: answers.jobLocation || answers.serviceAddress || answers.fromZip || answers.junkLocation || "",
          toAddress: answers.toZip || "",
          moveDate: answers.moveDate || "",
          details: [...scopeParts, answers.notes || ""].filter(Boolean).join(" | "),
          ...(photoPayload ? { photos: photoPayload } : {}),
        };

        const result = await apiRequest("POST", "/api/leads/employee", payload);
        return { leadId: "", message: "Lead submitted", depositInvoiceSent: false, depositInvoiceUrl: null };
      }

      const isTV = isTrashValetService(answers);
      const tvMonthly = selectedPackageObj?.minPrice ?? (pendingQuote as any)?.finalMonthlyPrice ?? 0;
      const customerPhotos = photos.length > 0 ? photos.map(p => ({
        id: p.id,
        url: p.dataUrl,
        type: "before" as const,
        timestamp: new Date().toISOString(),
      })) : undefined;
      let bookingIntake: (BookingIntakeResult & { guardrails?: Record<string, unknown> }) | null = null;
      let bookingEngineQuote: Record<string, unknown> | null = null;
      try {
        const intakeRes = await apiRequest("POST", "/api/ai/booking-intake", {
          answers,
          serviceLabel: svc,
        });
        bookingIntake = await intakeRes.json();
      } catch {
        bookingIntake = buildBookingIntakeFromChatbot(answers as Record<string, unknown>, svc);
      }
      try {
        if (bookingIntake?.bookingQuoteRequest) {
          const quoteRes = await apiRequest("POST", "/api/bookings/quote", bookingIntake.bookingQuoteRequest);
          bookingEngineQuote = await quoteRes.json();
        }
      } catch {
        bookingEngineQuote = null;
      }
      const response = await apiRequest("POST", "/api/chatbot-quote", {
        answers,
        quote: pendingQuote,
        bookingIntake,
        bookingEngineQuote,
        selectedPackage: selectedPackageObj || null,
        depositRequired: isTV ? withDeposit : (dep?.required || false),
        depositAmount: isTV ? tvMonthly : (dep?.amount || 0),
        isFirstMonthPayment: isTV && withDeposit,
        serviceLabel: svc,
        isQuoteOnly,
        customerZip: zip,
        verifiedDriveMiles: distanceMiles,
        depositPaid: withDeposit,
        ...(customerPhotos ? { photos: customerPhotos } : {}),
      });
      return await response.json() as { leadId: string; message: string; depositInvoiceSent?: boolean; depositInvoiceUrl?: string };
    },
    onSuccess: (data, withDeposit) => {
      setDepositPaid(withDeposit);
      setDepositInvoiceSent(data?.depositInvoiceSent ?? false);
      setDepositInvoiceUrl(data?.depositInvoiceUrl ?? null);
      setSubmitted(true);
      const svc = getServiceLabel(answers.serviceType || "");
      const isQuoteOnly = QUOTE_ONLY_SERVICES.includes(svc);
      if (isEmployee) {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/leads/my-jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/leads/available"] });
        botSay("✅ Lead added! The job has been saved to the system. You'll earn rewards when it's confirmed and completed.");
        onSuccess?.();
      } else if (isQuoteOnly) {
        botSay("✅ Your quote request has been submitted! Darrell will reach out to schedule your estimate. Typically within 2–4 hours during business hours.");
      } else {
        botSay("✅ Your quote request has been submitted! Darrell will review it and send you a finalized quote. Typically within 2–4 hours during business hours.");
      }
    },
    onError: (err: any) => {
      toast({ title: "Submission failed", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  function handleDepositPay() {
    // Server will create the Square invoice and email it — no need to open a URL manually
    submitMutation.mutate(true);
  }

  function handleSkipDeposit() {
    submitMutation.mutate(false);
  }

  function resetChat() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setAnswers({});
    setMessages([{
      from: "bot",
      text: "👋 Hi — I'm JC! I'll help you get a quote for any of our services in about 60 seconds. No pressure, no spam — real human review before anything is sent.",
      ts: Date.now(),
    }]);
    setStepIdx(0);
    setTextInput("");
    setAddressInput("");
    setMultiSel([]);
    setContactName(user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "");
    setContactPhone(user?.phoneNumber || "");
    setContactEmail(user?.email || "");
    setSubmitted(false);
    setQuoteVisible(false);
    setPendingQuote(null);
    setCrewPackages([]);
    setSelectedPackageObj(null);
    setDepositInfo(null);
    setDepositChecked(false);
    setPhotos([]);
  }

  const isDone = stepIdx >= visibleSteps.length;
  const progress = isDone ? 100 : Math.round((stepIdx / visibleSteps.length) * 100);

  const svc = getServiceLabel(answers.serviceType || "");
  const isQuoteOnly = QUOTE_ONLY_SERVICES.includes(svc);
  const DEPOSIT_AMOUNT = depositInfo?.amount ?? 100;
  const isTrashValet = isTrashValetService(answers);
  // For trash valet the "deposit" is actually the first month's subscription cost
  const firstMonthCost = selectedPackageObj?.minPrice ?? (pendingQuote as any)?.finalMonthlyPrice ?? 0;
  const quoteTravelCharge =
    pendingQuote && ("travelCharge" in pendingQuote)
      ? Number((pendingQuote as MovingQuote | JunkQuote).travelCharge || 0)
      : 0;
  const bookingHandoffHref = useMemo(() => {
    if (!submitted || isEmployee) return null;
    const serviceCode = isMovingService(answers) ? "moving"
      : isJunkService(answers) ? "junk_removal"
        : isTrashValetService(answers) ? "trash_valet"
          : isWindowCleaningService(answers) ? "window_cleaning"
            : isCleaningService(answers) ? "cleaning"
              : isSnowService(answers) ? "snow_removal"
                : "moving";
    const rawLoadType = String((answers as any).loadType || "").toLowerCase();
    const details: Record<string, unknown> = {
      source: "chatbot",
      jobSize: (answers as any).homeSize || (answers as any).jobSize || undefined,
      loadType: rawLoadType.includes("unload") && !rawLoadType.includes("load +")
        ? "Unload only"
        : rawLoadType.includes("both") || rawLoadType.includes("load +")
          ? "Load + unload"
          : rawLoadType ? "Load only" : undefined,
      truckNeeded: String((answers as any).truckProvider || (answers as any).truck || "").toLowerCase().includes("jc"),
      truckSize: (answers as any).truckSize || undefined,
      dropoffAddress: (answers as any).toAddress || (answers as any).toZip || undefined,
      requestedDate: (answers as any).moveDate || (answers as any).requestedDate || undefined,
      hasStairs: String((answers as any).originFloor || (answers as any).destFloor || "").toLowerCase().includes("floor"),
      specialItems: Array.isArray((answers as any).specialItems) ? (answers as any).specialItems : undefined,
      promoCode: (answers as any).promoCode || undefined,
      notes: (answers as any).notes || (answers as any).selectedMovingRecNotes || undefined,
      packageId: selectedPackageObj?.id,
      packageLabel: selectedPackageObj?.label,
      crew: selectedPackageObj?.crew,
      hours: selectedPackageObj?.hours,
      minPrice: selectedPackageObj?.minPrice,
      maxPrice: selectedPackageObj?.maxPrice,
    };
    Object.keys(details).forEach((key) => details[key] === undefined && delete details[key]);
    const address = String((answers as any).serviceAddress || (answers as any).fromAddress || (answers as any).fromZip || "").trim();
    const params = new URLSearchParams({
      services: serviceCode,
      step: address ? "configure" : "address",
      details: JSON.stringify(details),
    });
    if (address) params.set("address", address);
    return `/book?${params.toString()}`;
  }, [answers, isEmployee, selectedPackageObj, submitted]);

  const phase = submitted ? "submitted" : (quoteVisible && pendingQuote ? (isEmployee ? "employee_submit" : "deposit") : null);

  return (
    <div className={`flex flex-col h-full min-h-0 sm:min-h-[500px]${className ? " " + className : ""}`}>
      {/* Progress bar */}
      <div className="px-1 pb-1 sm:pb-2 shrink-0">
        <div className="flex items-center justify-between text-[10px] sm:text-xs text-slate-400 mb-0.5 sm:mb-1">
          <span>{isDone ? "✅ All done!" : "Takes about 60 seconds"}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1 sm:h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 sm:space-y-3 py-1.5 sm:py-2 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.from === "bot" ? "justify-start" : "justify-end"}`}>
            {m.from === "bot" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2 mt-0.5">JC</div>
            )}
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 sm:px-4 py-2 sm:py-2.5 text-sm leading-snug sm:leading-relaxed whitespace-pre-line ${
                m.from === "bot"
                  ? "bg-slate-800 text-slate-100 rounded-tl-sm"
                  : "bg-teal-600 text-white rounded-tr-sm"
              }`}
              dangerouslySetInnerHTML={{
                __html: m.text
                  .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                  .replace(/_(.*?)_/g, "<em class='text-teal-300 not-italic'>$1</em>"),
              }}
            />
          </div>
        ))}

        {/* Quote Card */}
        {quoteVisible && pendingQuote && (
          <div className="mx-1 mt-2 rounded-2xl border border-teal-500/30 bg-gradient-to-br from-teal-900/30 to-slate-900/60 overflow-hidden">
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-teal-400" />
                <span className="text-sm font-bold text-teal-300 uppercase tracking-wide">
                  {isQuoteOnly ? "Placeholder Estimate" : "Your Estimated Quote"}
                </span>
              </div>

              {isQuoteOnly && (
                <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-500/30 rounded-xl px-3 py-2 mb-3">
                  <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-200/90">
                    This is a <strong>placeholder range</strong> — a formal quote requires an in-person estimate. Darrell will contact you to schedule it.
                  </p>
                </div>
              )}

              {pendingQuote.type === "moving" && (
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-400 mb-1">Crew Size</p>
                    <p className="text-xl font-bold text-white">{(pendingQuote as MovingQuote).crew}</p>
                    <p className="text-[10px] text-slate-400">movers</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-400 mb-1">Est. Hours</p>
                    <p className="text-xl font-bold text-white">{(pendingQuote as MovingQuote).minHrs}–{(pendingQuote as MovingQuote).maxHrs}</p>
                    <p className="text-[10px] text-slate-400">hours</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-slate-400 mb-1">JCMOVES Earned</p>
                    <p className="text-lg font-bold text-yellow-400">{((pendingQuote as MovingQuote).tokensEstimate / 1000).toFixed(0)}K</p>
                    <p className="text-[10px] text-slate-400">tokens</p>
                  </div>
                </div>
              )}

              {pendingQuote.type === "trash_valet" && (
                <div className="bg-slate-800/60 rounded-xl p-3 text-center mb-3">
                  <p className="text-xs text-slate-400 mb-1">Monthly Rate</p>
                  <p className="text-2xl font-bold text-teal-300">${(pendingQuote as TrashValetQuoteResult).finalMonthlyPrice}/mo</p>
                  <p className="text-[11px] text-slate-500 mt-1">Based on your can &amp; bag count</p>
                </div>
              )}

              {pendingQuote.type === "window_cleaning" && (
                <div className="bg-slate-800/60 rounded-xl p-3 text-center mb-3">
                  <p className="text-xs text-slate-400 mb-1">{(pendingQuote as WindowQuoteResult).paneCount} panes · $5/pane</p>
                  <p className="text-2xl font-bold text-teal-300">${(pendingQuote as WindowQuoteResult).total}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Streak-free guarantee</p>
                </div>
              )}

              {pendingQuote.type === "jump_start" && (pendingQuote as JumpStartQuoteResult).isCustomQuote && (
                <div className="bg-slate-800/60 rounded-xl p-3 text-center mb-3">
                  <p className="text-xs text-slate-400 mb-1">⚡ Jump Start Pricing</p>
                  <p className="text-2xl font-bold text-amber-300">Custom Quote</p>
                  <p className="text-[11px] text-slate-500 mt-1">100+ miles — Darrell will call to confirm pricing before dispatch</p>
                </div>
              )}

              {!(pendingQuote.type === "jump_start" && (pendingQuote as JumpStartQuoteResult).isCustomQuote) && (
              <div className="bg-slate-900/60 rounded-xl p-3 text-center mb-3">
                  <p className="text-xs text-slate-400 mb-1">
                    {pendingQuote.type === "trash_valet" ? "Price Range" : "Estimated Price Range"}
                  </p>
                  <p className="text-2xl font-bold text-white">
                    {pendingQuote.minPrice === pendingQuote.maxPrice
                      ? `$${pendingQuote.minPrice.toLocaleString()}`
                      : `$${pendingQuote.minPrice.toLocaleString()} – $${pendingQuote.maxPrice.toLocaleString()}`}
                  </p>
                  {pendingQuote.type === "moving" && (pendingQuote as MovingQuote).specialSurcharge > 0 && (
                    <p className="text-xs text-orange-400 mt-1">Includes ${(pendingQuote as MovingQuote).specialSurcharge} specialty item surcharge</p>
                  )}
                  {(pendingQuote.type === "moving" || pendingQuote.type === "junk") && (pendingQuote as MovingQuote | JunkQuote).stakingPerkApplied && (
                    <div className="mt-2 inline-flex items-center gap-1.5 bg-orange-900/40 border border-orange-500/40 rounded-full px-3 py-1">
                      <span className="text-[11px] font-bold text-orange-300">🔒 Staking Perk Applied</span>
                      <span className="text-[10px] text-orange-300/80">
                        — {(pendingQuote as MovingQuote | JunkQuote).stakingPerkPct}% off · saving ${(pendingQuote as MovingQuote | JunkQuote).stakingPerkDiscount}
                      </span>
                    </div>
                  )}
                  {distanceMiles > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Drive verified from your address: ~{Math.round(distanceMiles)} miles
                      {quoteTravelCharge > 0 ? ` · includes $${quoteTravelCharge} travel / gas charge` : ""}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">Final price confirmed by Darrell after review</p>
                </div>
              )}
              </div>

            {/* Selected package summary — shown after package step is done */}
            {selectedPackageObj && (
              <div className="bg-teal-900/30 border border-teal-500/40 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">{selectedPackageObj.label}</p>
                    {selectedPackageObj.crew && selectedPackageObj.hours && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1 text-[11px] text-slate-400"><Users className="h-2.5 w-2.5" />{selectedPackageObj.crew} movers</span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-2.5 w-2.5" />{selectedPackageObj.hours} hrs</span>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-sm font-bold text-teal-300 shrink-0">
                  {selectedPackageObj.priceLabel
                    ? selectedPackageObj.priceLabel
                    : selectedPackageObj.minPrice !== selectedPackageObj.maxPrice
                      ? `$${selectedPackageObj.minPrice}–$${selectedPackageObj.maxPrice}`
                      : `$${selectedPackageObj.minPrice.toLocaleString()}`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── PHASE: Deposit ── */}
        {phase === "deposit" && pendingQuote && (
          <div className="mx-1 mt-2">
            <div className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-900/20 to-slate-900/60 overflow-hidden">
              <div className="px-4 pt-4 pb-4 space-y-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-orange-400" />
                  <span className="text-sm font-bold text-orange-300 uppercase tracking-wide">Confirm Your Appointment</span>
                </div>

                {isTrashValet ? (
                  <div className="bg-slate-900/60 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-white">${firstMonthCost}/mo</p>
                    <p className="text-sm text-slate-400 mt-1">First Month's Service</p>
                    <p className="text-xs text-slate-500 mt-2">Pay now to lock in your spot · No contract · Cancel anytime</p>
                  </div>
                ) : depositInfo?.required ? (
                  <div className="bg-slate-900/60 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-white">${DEPOSIT_AMOUNT}</p>
                    <p className="text-sm text-slate-400 mt-1">Appointment Deposit</p>
                    <p className="text-xs text-slate-500 mt-2">Applied toward your final invoice · Fully refundable if rescheduled 24 hrs in advance</p>
                  </div>
                ) : (
                  <div className="bg-slate-900/60 rounded-xl p-4 text-center">
                    <p className="text-lg font-bold text-teal-300">No Deposit Required</p>
                    <p className="text-sm text-slate-400 mt-1">Submit your request — Darrell will contact you to schedule and confirm the final price.</p>
                  </div>
                )}

                {selectedPackageObj && (
                  <div className="flex items-center justify-between bg-slate-800/60 rounded-xl px-3 py-2.5">
                    <span className="text-sm text-slate-300">{isTrashValet ? "Selected Plan" : "Selected Package"}</span>
                    <span className="text-sm font-semibold text-teal-300">{selectedPackageObj.label}</span>
                  </div>
                )}

                <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-500/20 rounded-lg px-3 py-2">
                  <span className="text-base shrink-0">🔍</span>
                  <p className="text-xs text-slate-300">
                    {isTrashValet
                      ? <>After submitting, Darrell confirms your first pickup date. <strong className="text-white">An invoice for your first month is emailed instantly.</strong> Service begins once payment clears.</>
                      : <>After submitting, Darrell reviews your request and sends a <strong className="text-white">finalized invoice to your email</strong>. Payment locks in your spot on the schedule.</>
                    }
                  </p>
                </div>

                <div className="space-y-2">
                  {!isTrashValet && !depositInfo?.required ? (
                    <Button
                      onClick={handleSkipDeposit}
                      disabled={submitMutation.isPending}
                      className="w-full bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-500 hover:to-blue-500 text-white font-bold py-3 rounded-xl text-sm"
                    >
                      {submitMutation.isPending ? "Submitting…" : <><CheckCircle2 className="h-4 w-4 mr-2" />Submit for Review</>}
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={handleDepositPay}
                        disabled={submitMutation.isPending}
                        className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-3 rounded-xl text-sm"
                      >
                        {submitMutation.isPending ? (
                          "Sending invoice…"
                        ) : isTrashValet ? (
                          <><CreditCard className="h-4 w-4 mr-2" />Pay First Month — ${firstMonthCost}</>
                        ) : (
                          <><CreditCard className="h-4 w-4 mr-2" />Send ${DEPOSIT_AMOUNT} Deposit Invoice &amp; Confirm</>
                        )}
                      </Button>
                      <p className="text-[11px] text-slate-500 text-center px-2">
                        {isTrashValet
                          ? "Invoice emailed instantly · No contract · Cancel anytime"
                          : "Invoice emailed instantly · Applied toward final balance · Refundable with 24 hr notice"
                        }
                      </p>
                      <Button
                        variant="ghost"
                        onClick={handleSkipDeposit}
                        disabled={submitMutation.isPending}
                        className="w-full text-slate-400 hover:text-slate-200 text-xs py-2"
                      >
                        {submitMutation.isPending ? "Submitting…" : isTrashValet ? "Submit without paying — we'll invoice you" : "Skip deposit — submit for review only"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE: Employee Submit ── */}
        {phase === "employee_submit" && pendingQuote && (
          <div className="mx-1 mt-2">
            <div className="rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-900/20 to-slate-900/60 overflow-hidden">
              <div className="px-4 pt-4 pb-4 space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-orange-400" />
                  <span className="text-sm font-bold text-orange-300 uppercase tracking-wide">Ready to Submit Lead</span>
                </div>
                <p className="text-xs text-slate-400">
                  Review the details above and tap below to add this lead to the system. You'll earn rewards when the job is confirmed and completed.
                </p>
                <Button
                  onClick={() => submitMutation.mutate(false)}
                  disabled={submitMutation.isPending}
                  className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-3 rounded-xl text-sm"
                >
                  {submitMutation.isPending ? "Submitting…" : "Submit Job Request"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE: Submitted ── */}
        {phase === "submitted" && (
          <div className="mx-1 mt-2">
            <div className="rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-900/20 via-slate-900/80 to-slate-900 overflow-hidden">

              {/* Hero confirmation bar */}
              <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <p className="font-extrabold text-white text-base leading-tight">
                    Request Confirmed!
                  </p>
                  <p className="text-xs text-green-300 mt-0.5">
                    {depositPaid ? "Deposit invoice is on its way to your email." : "We received your request — Darrell will be in touch soon."}
                  </p>
                </div>
              </div>

              <div className="px-4 py-4 space-y-3">

                {/* Placeholder estimate range */}
                {pendingQuote && (
                  <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-4 py-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Starting Estimate</p>
                    <p className="text-2xl font-extrabold text-white">
                      {pendingQuote.minPrice === pendingQuote.maxPrice
                        ? <>~${pendingQuote.minPrice.toLocaleString()}</>
                        : <>${pendingQuote.minPrice.toLocaleString()} – ${pendingQuote.maxPrice.toLocaleString()}</>
                      }
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Starting estimate — Darrell will confirm the final price after reviewing your request.
                    </p>
                    <div className="mt-2 bg-amber-900/20 border border-amber-500/20 rounded-lg px-3 py-2 text-left">
                      <p className="text-[10px] text-amber-400 font-semibold mb-0.5">⚠️ Things that can influence the final price:</p>
                      <p className="text-[10px] text-slate-400">
                        {isJunkService(answers)
                          ? "Tires · Mattresses · TVs · Appliances · Hazardous materials — final cost determined on-site"
                          : isMovingService(answers)
                            ? "Long distances · Extra stops · Heavy specialty items · Stairs or no elevator — all can affect the final price"
                            : isWindowCleaningService(answers)
                              ? "Second-story or hard-to-reach windows · Skylights · Heavy mineral buildup or construction residue — all can affect the final price"
                              : isHandymanService(answers)
                                ? "Deeper projects · Larger repairs · Specialty or hard-to-find materials — all can affect the final price"
                                : isPaintingService(answers)
                                  ? "Wall repairs or patching needed · High ceilings · Number of coats required · Premium paint selection — all affect the final price"
                                  : isFlooringService(answers)
                                    ? "Subfloor repairs needed · Complex patterns or layouts · Stairs or transitions · Material selection — all can affect the final price"
                                    : isRoofingService(answers)
                                      ? "Roof pitch and access · Hidden damage under existing shingles · Material type selected — final cost confirmed after inspection"
                                      : isSnowService(answers)
                                        ? "Heavy accumulation or ice buildup · Long driveways or large lots · Tight access points — all affect time and cost"
                                        : isLawnService(answers)
                                          ? "Overgrowth or neglected areas · Steep slopes · Haul-away needs · Total property size — all affect the final price"
                                          : isCleaningService(answers)
                                            ? "Current condition of the space · Number of rooms and floors · Deep-clean requirements — all affect the final price"
                                            : isDemoService(answers)
                                              ? "Structure type and materials · Debris volume · Hazardous materials · Haul-away requirements — all affect the final cost"
                                              : isTrashValetService(answers)
                                                ? "Distance from curb · Extra-heavy or oversized items · Access restrictions — can affect the monthly rate"
                                                : "Scope of work · Special materials · Site conditions — final price confirmed by Darrell"}
                      </p>
                    </div>
                  </div>
                )}

                {/* Deposit invoice link */}
                {depositInvoiceUrl && (
                  <a href={depositInvoiceUrl} target="_blank" rel="noopener noreferrer" className="block">
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-sm font-semibold text-orange-300">Open Deposit Invoice</p>
                        <p className="text-xs text-slate-400">Pay ${DEPOSIT_AMOUNT} to lock in your spot</p>
                      </div>
                      <CreditCard className="h-5 w-5 text-orange-400 shrink-0" />
                    </div>
                  </a>
                )}

                {/* What happens next */}
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/40 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2.5">What Happens Next</p>
                  <div className="space-y-2">
                    {[
                      depositPaid
                        ? "Pay the deposit invoice sent to your email — this locks in your spot"
                        : "Darrell reviews your request (typically within 2–4 hours)",
                      "We contact you to schedule a free on-site or virtual estimate",
                      "You receive a personalized quote with your confirmed price",
                      "Pay the invoice to lock in your date — crew is dispatched automatically ✅",
                    ].map((step, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-teal-500/20 text-teal-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-xs text-slate-300 leading-snug">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Contact reminder */}
                <p className="text-[11px] text-slate-500 text-center px-2">
                  Questions? Call or text us at{" "}
                  <a href="tel:+19062859312" className="text-slate-300 underline">(906) 285-9312</a>
                </p>

                {bookingHandoffHref && (
                  <a
                    href={bookingHandoffHref}
                    className="block rounded-xl bg-teal-600 hover:bg-teal-500 px-4 py-3 text-center text-sm font-bold text-white transition-colors"
                  >
                    Continue to booking <ChevronRight className="inline h-4 w-4 ml-1" />
                  </a>
                )}

                {onClose && showClose && (
                  <Button variant="outline" size="sm" onClick={onClose} className="w-full border-slate-600 text-slate-300 hover:bg-slate-800">
                    Done <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}

                {/* Service page CTA — shown when chatbot opened outside dedicated page */}
                {(isRoofingService(answers) || isDemoService(answers) || isCleaningService(answers) || isLawnService(answers)) && (
                  <a
                    href={
                      isRoofingService(answers) ? "/roofing"
                        : isDemoService(answers) ? "/demolition"
                          : isCleaningService(answers) ? "/cleaning"
                            : "/lawn-care"
                    }
                    className="block rounded-xl bg-slate-800/40 border border-slate-700/40 px-4 py-3 flex items-center justify-between hover:bg-slate-700/40 transition-colors"
                  >
                    <span className="text-sm text-slate-300">
                      View full service details &amp; packages
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                  </a>
                )}

                <BookingConfirmedTiles customerEmail={contactEmail || user?.email || undefined} />
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Input area */}
      {!isDone && currentStep && (
        <div className="shrink-0 pt-1.5 sm:pt-2 border-t border-slate-800/60">
          {stepIdx > 0 && (isFlooringService(answers) || isPaintingService(answers) || isRoofingService(answers)) && (
            <p className="text-[10px] text-slate-500 px-1 pb-1.5">50% deposit required at job start · remainder due on completion.</p>
          )}
          {/* CHOICE */}
          {currentStep.type === "choice" && (
            <div className="grid grid-cols-1 gap-1.5">
              {currentStep.options!.map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleChoice(opt)}
                  className="text-left px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-teal-800/60 border border-slate-700/60 hover:border-teal-500/60 text-sm text-slate-200 transition-all flex items-center justify-between group"
                >
                  <span>{opt}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-teal-400 transition-colors" />
                </button>
              ))}
              {currentStep.id === "serviceType" && (
                <p className="text-[11px] text-slate-500 text-center pt-1">💡 Bundle 2+ services = 10% off.</p>
              )}
            </div>
          )}

          {/* MULTISELECT */}
          {currentStep.type === "multiselect" && (
            <div>
              <div className="flex flex-wrap gap-1.5 mb-2 max-h-36 overflow-y-auto">
                {currentStep.options!.map((opt) => {
                  const sel = multiSel.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() => toggleMulti(opt)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        sel
                          ? "bg-teal-600 border-teal-500 text-white"
                          : "bg-slate-800 border-slate-700 text-slate-300 hover:border-teal-500/60"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <Button
                onClick={handleMultiSubmit}
                disabled={multiSel.length === 0}
                size="sm"
                className="w-full bg-teal-600 hover:bg-teal-500 text-white"
              >
                Continue ({multiSel.length} selected) <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          )}

          {/* ADDRESS autocomplete */}
          {currentStep.type === "address" && (
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <PlacesAutocomplete
                  value={addressInput}
                  onChange={setAddressInput}
                  onPlaceSelect={(place) => {
                    setAddressInput(place.fullAddress);
                  }}
                  placeholder={currentStep.placeholder || "Start typing an address…"}
                  onKeyDown={(e) => e.key === "Enter" && handleAddressSubmit()}
                  autoFocus
                />
              </div>
              <Button
                onClick={handleAddressSubmit}
                size="icon"
                disabled={!addressInput.trim()}
                className="bg-teal-600 hover:bg-teal-500 shrink-0 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}

          {currentStep.type === "text" && (
            <div className="flex gap-2">
              <Input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                placeholder={currentStep.placeholder || "Type your answer…"}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                autoFocus
                type={currentStep.id.includes("windows") || currentStep.id === "trashCans" ? "number" : "text"}
                min="0"
              />
              <Button onClick={handleTextSubmit} size="icon" className="bg-teal-600 hover:bg-teal-500 shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* NOTES */}
          {currentStep.type === "notes" && (
            <div className="space-y-2">
              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={currentStep.placeholder || "Type here or leave blank to skip…"}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => advanceStep(currentStep.id, "(no additional notes)")}
                  className="border-slate-600 text-slate-400 hover:bg-slate-800">
                  Skip
                </Button>
                <Button onClick={handleTextSubmit} size="sm" className="flex-1 bg-teal-600 hover:bg-teal-500 text-white">
                  Submit Notes <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* CONTACT */}
          {currentStep.type === "contact" && (
            <div className="space-y-2">
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Full name"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
              />
              <Input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Phone number"
                type="tel"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
              />
              <Input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email address"
                type="email"
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleContactSubmit()}
              />
              <Button
                onClick={handleContactSubmit}
                disabled={!contactName.trim() || !contactPhone.trim() || !contactEmail.trim()}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white"
                size="sm"
              >
                Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          )}

          {/* DEPOSIT ACKNOWLEDGMENT */}
          {currentStep.type === "deposit_ack" && depositInfo && (
            <div className="space-y-3">
              <div className="bg-orange-900/20 border border-orange-500/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-orange-400" />
                  <p className="text-sm font-bold text-orange-300">Estimate Deposit Required</p>
                </div>
                <p className="text-xs text-orange-100/60 mb-2">
                  A ${depositInfo.amount} non-refundable deposit is required to schedule your in-person estimate.
                </p>
                <p className="text-[10px] text-orange-300/50 mb-3">{depositInfo.termsHtml}</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={depositChecked}
                    onChange={(e) => setDepositChecked(e.target.checked)}
                    className="mt-0.5 shrink-0 accent-orange-500"
                  />
                  <span className="text-[11px] text-slate-400">
                    I understand and agree to the ${depositInfo.amount} non-refundable estimate deposit. This amount will be credited toward my project upon booking.
                  </span>
                </label>
              </div>
              <Button
                onClick={handleDepositAck}
                disabled={!depositChecked}
                className="w-full bg-orange-600 hover:bg-orange-500 text-white"
                size="sm"
              >
                Acknowledge & Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          )}

          {/* PHOTO UPLOAD (employee only) */}
          {currentStep.type === "photo_upload" && (
            <div className="space-y-3">
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map(photo => (
                    <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-slate-800 ring-2 ring-slate-700">
                      <img src={photo.dataUrl} alt={photo.name} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(photo.id)}
                        className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-lg"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {photos.length < 5 && (
                <label className="cursor-pointer block">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  <div className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-600 hover:border-teal-500/50 rounded-xl transition-colors">
                    <Camera className="h-5 w-5 text-slate-400" />
                    <span className="text-sm text-slate-400">
                      {photos.length === 0 ? "Tap to add photos" : `Add more (${5 - photos.length} remaining)`}
                    </span>
                  </div>
                </label>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePhotoStepContinue}
                  className="border-slate-600 text-slate-400 hover:bg-slate-800 flex-1"
                >
                  {photos.length === 0 ? "Skip — no photos" : "Continue"}
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* MOVING RECOMMENDATION CARDS */}
          {currentStep.type === "moving_recs" && movingRecs.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-200 mb-1">Your instant quote:</p>
              {movingRecs.map((rec) => {
                const isBest = rec.isBestMatch;
                const isSel = selectedMovingRec?.id === rec.id;
                if (rec.customQuote) {
                  return (
                    <div key={rec.id} className="p-3 rounded-xl border-2 border-amber-500/60 bg-amber-900/20">
                      <div className="flex items-start gap-2 mb-1">
                        <span className="text-base">📞</span>
                        <span className="text-sm font-semibold text-white">{rec.label}</span>
                      </div>
                      <p className="text-xs text-slate-400 pl-6">{rec.reason}</p>
                      <p className="text-xs text-amber-400 pl-6 mt-1">Darrell typically responds within 1 hour.</p>
                    </div>
                  );
                }
                return (
                  <button
                    key={rec.id}
                    onClick={() => handleMovingRecSelect(rec)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                      isSel
                        ? "border-teal-500 bg-teal-900/30"
                        : isBest
                        ? "border-amber-500/70 bg-amber-900/20 hover:border-amber-400"
                        : "border-slate-700/60 bg-slate-800/60 hover:border-teal-500/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-2">
                        {isSel
                          ? <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                          : <div className="h-4 w-4 rounded-full border-2 border-slate-600 shrink-0" />}
                        <span className="text-sm font-semibold text-white">{rec.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {isBest && !isSel && <Badge className="text-[10px] bg-amber-700/60 text-amber-200 border-0">⭐ Best Match</Badge>}
                        <span className="text-sm font-bold text-teal-300">{rec.price}</span>
                      </div>
                    </div>
                    {rec.priceNote && <p className="text-xs text-slate-500 pl-6">{rec.priceNote}</p>}
                    {rec.rateNote  && <p className="text-xs text-slate-500 pl-6">{rec.rateNote}</p>}
                    <p className="text-xs text-slate-400 pl-6 mt-0.5">{rec.reason}</p>
                  </button>
                );
              })}
              {movingRecs.some(r => r.customQuote) && (
                <Button
                  onClick={() => advanceStep("movingRec", "custom_quote")}
                  className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold py-2.5 rounded-xl text-sm mt-1"
                  size="sm"
                >
                  Request custom quote <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              )}
            </div>
          )}

          {/* PACKAGE SELECT */}
          {currentStep.type === "package_select" && crewPackages.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-200 mb-1">Choose your crew package:</p>
              {crewPackages.map((pkg) => {
                const isSel = selectedPackageObj?.id === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    onClick={() => handlePackageSelect(pkg)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                      isSel
                        ? "border-teal-500 bg-teal-900/30"
                        : "border-slate-700/60 bg-slate-800/60 hover:border-teal-500/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {isSel
                          ? <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                          : <div className="h-4 w-4 rounded-full border-2 border-slate-600 shrink-0" />}
                        <span className="text-sm font-semibold text-white">{pkg.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {pkg.tag && <Badge className="text-[10px] bg-teal-700/60 text-teal-200 border-0">{pkg.tag}</Badge>}
                        {pkg.originalPrice !== undefined && (
                          <span className="text-xs text-slate-500 line-through">${pkg.originalPrice}</span>
                        )}
                        <span className="text-sm font-bold text-teal-300">
                          {pkg.priceLabel
                            ? pkg.priceLabel
                            : pkg.minPrice === pkg.maxPrice
                              ? `$${pkg.minPrice}`
                              : `$${pkg.minPrice}–$${pkg.maxPrice}`}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 pl-6">{pkg.desc}</p>
                  </button>
                );
              })}
              <Button
                onClick={handlePackageContinue}
                disabled={!selectedPackageObj}
                className="w-full bg-gradient-to-r from-teal-600 to-blue-600 hover:from-teal-500 hover:to-blue-500 text-white font-semibold py-2.5 rounded-xl text-sm mt-1"
                size="sm"
              >
                Continue with {selectedPackageObj ? `"${selectedPackageObj.label}"` : "a package"} <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
