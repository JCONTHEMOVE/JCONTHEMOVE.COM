import crypto from "crypto";
import {
  MARKETING_BOT_SERVICES,
  MARKETING_BOT_TERRITORIES,
  MARKETING_SERVICE_LABELS,
  MARKETING_TERRITORY_LABELS,
  type MarketingBotCta,
  type MarketingBotDraftOutput,
  type MarketingBotService,
  type MarketingBotTerritory,
} from "@shared/marketingBot";

export type MarketingCandidate = {
  id: string;
  service: MarketingBotService;
  territory: MarketingBotTerritory;
  score: number;
  reasons: string[];
};

export type MarketingSignals = {
  localDate: string;
  weekday: number;
  month: number;
  availableCrew: number;
  upcomingJobs: number;
  openCapacity: number;
  weatherSummary: string;
  activePromotion?: { code: string; description: string } | null;
  prior14DayKeys: Set<string>;
  performance: Record<string, { bookings: number; leads: number; callClicks: number }>;
  workerPlans?: Array<{service:string;territories:string[];ideas:string;message:string;goals:{bookings:number;qualifiedInquiries:number}}>;
};

const WEEKDAY_SERVICE: Record<number, MarketingBotService> = {
  0: "reputation",
  1: "moving",
  2: "junk_removal",
  3: "packing",
  4: "helping_hands",
  5: "last_minute",
  6: "last_minute",
};

const TERRITORY_ROTATION: MarketingBotTerritory[] = [
  "ironwood_hurley",
  "houghton",
  "eagle_river",
  "iron_river",
  "mercer_minocqua",
  "up_northwoods",
];

export function marketingLocalParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    localDate: `${get("year")}-${get("month")}-${get("day")}`,
    month: Number(get("month")),
    weekday: Math.max(0, weekday),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function buildCampaignKey(service: MarketingBotService, territory: MarketingBotTerritory) {
  return `${service}:${territory}`;
}

export function buildCampaignCode(input: {
  localDate: string;
  service: MarketingBotService;
  territory: MarketingBotTerritory;
  suffix?: string;
}) {
  const service = input.service.replaceAll("_", "-").toUpperCase();
  const territory = input.territory.replaceAll("_", "-").toUpperCase();
  const suffix = input.suffix ? `-${input.suffix.replace(/[^a-z0-9-]/gi, "").toUpperCase()}` : "";
  return `JC-${input.localDate}-${service}-${territory}${suffix}`.slice(0, 120);
}

function seasonalAdjustment(service: MarketingBotService, month: number) {
  if (service === "lawn_seasonal") return [4, 5, 6, 7, 8, 9, 10].includes(month) ? 20 : -18;
  if (service === "packing" && [11, 12, 1, 2].includes(month)) return 5;
  if (service === "moving" && [5, 6, 7, 8].includes(month)) return 9;
  if (service === "junk_removal" && [4, 5, 9, 10].includes(month)) return 8;
  return 0;
}

export function scoreMarketingCandidates(signals: MarketingSignals): MarketingCandidate[] {
  const scheduledService = WEEKDAY_SERVICE[signals.weekday] || "moving";
  const territoryStart = Number(signals.localDate.replaceAll("-", "")) % TERRITORY_ROTATION.length;
  const candidates: MarketingCandidate[] = [];

  for (const service of MARKETING_BOT_SERVICES) {
    for (const territory of MARKETING_BOT_TERRITORIES) {
      const key = buildCampaignKey(service, territory);
      if (signals.prior14DayKeys.has(key)) continue;
      const reasons: string[] = [];
      let score = 20;

      if (service === scheduledService) {
        score += 28;
        reasons.push("Matches the weekly campaign rotation");
      }
      const territoryIndex = TERRITORY_ROTATION.indexOf(territory);
      const rotationDistance = (territoryIndex - territoryStart + TERRITORY_ROTATION.length) % TERRITORY_ROTATION.length;
      const territoryPoints = Math.max(0, 14 - rotationDistance * 2);
      score += territoryPoints;
      if (territoryPoints >= 10) reasons.push("Keeps geographic coverage rotating");

      const capacityPoints = Math.min(18, Math.max(-8, signals.openCapacity * 4));
      if (service === "last_minute" || service === "moving" || service === "helping_hands") {
        score += capacityPoints;
        if (capacityPoints > 0) reasons.push(`${signals.openCapacity} crew-capacity slot${signals.openCapacity === 1 ? "" : "s"} appear open`);
      }

      const seasonPoints = seasonalAdjustment(service, signals.month);
      score += seasonPoints;
      if (seasonPoints > 0) reasons.push("Fits the current season");

      if (signals.activePromotion) {
        score += 5;
        reasons.push(`Can use approved promotion ${signals.activePromotion.code}`);
      }

      const result = signals.performance[key] || { bookings: 0, leads: 0, callClicks: 0 };
      const plans = (signals.workerPlans || []).filter(plan => plan.service === service && plan.territories.includes(territory));
      if (plans.length) {
        score += 16;
        reasons.push('Matches a worker-selected service lane and shared area');
        if (plans.some(plan => plan.goals.bookings > result.bookings || plan.goals.qualifiedInquiries > result.leads)) {
          score += 8;
          reasons.push('Supports a worker growth target');
        }
      }
      const performancePoints = Math.min(32, result.bookings * 12 + result.leads * 3 + result.callClicks * 0.5);
      score += performancePoints;
      if (result.bookings > 0) reasons.push(`${result.bookings} confirmed booking${result.bookings === 1 ? "" : "s"} from similar campaigns`);
      if (result.bookings === 0 && result.leads === 0 && result.callClicks === 0) {
        score += 4;
        reasons.push("Exploration candidate with little prior exposure");
      }

      candidates.push({ id: key, service, territory, score: Number(score.toFixed(2)), reasons });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function actionCopy(service: MarketingBotService) {
  switch (service) {
    case "junk_removal": return "Clear the clutter without handling the heavy lifting alone.";
    case "packing": return "Get careful packing help before moving day arrives.";
    case "helping_hands": return "Need an extra set of capable hands for a local project?";
    case "heavy_item": return "Plan the safe move for the bulky item you cannot handle alone.";
    case "lawn_seasonal": return "Put seasonal outdoor work on the schedule before the week fills up.";
    case "last_minute": return "A crew opening may be available for local work.";
    case "reputation": return "Local families trust JC ON THE MOVE for practical, careful help.";
    default: return "Make moving day simpler with a regional crew that is ready to help.";
  }
}

export function buildFallbackDraft(candidate: MarketingCandidate): MarketingBotDraftOutput {
  const serviceLabel = MARKETING_SERVICE_LABELS[candidate.service];
  const territoryLabel = MARKETING_TERRITORY_LABELS[candidate.territory];
  const headline = `${serviceLabel} help in ${territoryLabel}`.slice(0, 100);
  const body = `${actionCopy(candidate.service)} JC ON THE MOVE provides scheduled regional service in ${territoryLabel}, dispatched from its Ironwood operation.`;
  return {
    selectedCandidateId: candidate.id,
    headline,
    facebookCaption: `${headline}\n\n${body}`,
    instagramCaption: `${body}\n\n#JCONTHeMOVE #Northwoods #LocalService`,
    googleBusinessSummary: `${body} Contact JC ON THE MOVE to check availability and request a quote.`,
    shortCaption: `${serviceLabel} in ${territoryLabel}. Check availability with JC ON THE MOVE.`,
    cta: candidate.service === "reputation" ? "LEARN_MORE" : "BOOK",
    visualDirection: `Use an approved JC ON THE MOVE crew image with a clean ${serviceLabel.toLowerCase()} headline and ${territoryLabel} location label.`,
    rationale: candidate.reasons.join("; ") || "Best available non-duplicate campaign candidate.",
  };
}

export function appendTrustedCampaignFacts(input: {
  draft: MarketingBotDraftOutput;
  phone: string;
  campaignUrl: string;
  promoCode?: string | null;
}) {
  const withMissingFacts = (text: string, separator: string) => {
    const facts = [
      /dispatched from (?:its |our )?Ironwood operation/i.test(text) ? "" : "Regional service is dispatched from our Ironwood operation; no local storefront is represented.",
      text.includes(input.phone) ? "" : `Call ${input.phone}.`,
      !input.promoCode || text.includes(input.promoCode) ? "" : `Use approved code ${input.promoCode}.`,
      text.includes(input.campaignUrl) ? "" : input.campaignUrl,
    ].filter(Boolean);
    return facts.length ? `${text.trim()}${separator}${facts.join(separator === "\n\n" ? " " : " • ")}` : text.trim();
  };
  return {
    ...input.draft,
    facebookCaption: withMissingFacts(input.draft.facebookCaption, "\n\n").slice(0, 2000),
    instagramCaption: withMissingFacts(input.draft.instagramCaption, "\n\n").slice(0, 2000),
    googleBusinessSummary: withMissingFacts(input.draft.googleBusinessSummary, " ").slice(0, 1500),
    shortCaption: withMissingFacts(input.draft.shortCaption, " ").slice(0, 500),
  };
}

export function validateCampaignSafety(input: {
  draft: MarketingBotDraftOutput;
  phone: string;
  campaignUrl: string;
  promoCode?: string | null;
  promotionActive: boolean;
  duplicate: boolean;
}) {
  const combined = [
    input.draft.headline,
    input.draft.facebookCaption,
    input.draft.instagramCaption,
    input.draft.googleBusinessSummary,
    input.draft.shortCaption,
  ].join("\n");
  const checks = [
    { key: "brand", ok: /JC ON THE MOVE/i.test(combined), label: "Approved branding present" },
    { key: "phone", ok: combined.includes(input.phone), label: "Correct company phone present" },
    { key: "url", ok: combined.includes(input.campaignUrl), label: "Tracked campaign URL present" },
    { key: "promotion", ok: !input.promoCode || input.promotionActive, label: "Promotion is active" },
    { key: "promo_code", ok: !input.promoCode || combined.includes(input.promoCode), label: "Approved promo code present" },
    { key: "duplicate", ok: !input.duplicate, label: "No same service/location campaign in 14 days" },
    { key: "length", ok: input.draft.facebookCaption.length <= 2000 && input.draft.instagramCaption.length <= 2000 && input.draft.googleBusinessSummary.length <= 1500, label: "Channel length limits pass" },
    { key: "price", ok: !/\$\s*\d|\d+\s*%\s*off/i.test(combined), label: "No unverified price claim" },
    { key: "regional_disclosure", ok: /dispatched from (?:its |our )?Ironwood operation/i.test(combined), label: "Regional-service disclosure present" },
    { key: "no_fake_office", ok: !/(?:our|the)\s+(?:Houghton|Eagle River|Iron River|Mercer|Minocqua|Northwoods)\s+(?:office|location|storefront)/i.test(combined), label: "No unsupported local office claim" },
  ];
  return { passed: checks.every((check) => check.ok), checks };
}

export function buildVariantCode(campaignCode: string, label: string) {
  const suffix = label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, 24);
  return `${campaignCode}-${suffix}`.slice(0, 150);
}

export function shortStableId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8).toUpperCase();
}

export function ctaLabel(cta: MarketingBotCta) {
  return ({ BOOK: "Book", CALL: "Call", GET_QUOTE: "Get Quote", LEARN_MORE: "Learn More" } as const)[cta];
}
