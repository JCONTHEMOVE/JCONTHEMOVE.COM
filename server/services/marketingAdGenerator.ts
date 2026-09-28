import { z } from "zod";
import {
  IRONWOOD_DAILY_DISCOUNT,
  ROUTE_DAY_CAMPAIGN_NOTE,
  ROUTE_DAY_DISCOUNT,
  ROUTE_DAY_PROMO_PACKAGES,
  ROUTE_DAY_SUMMARY,
  ROUTE_DAY_TRACKING_POINTS,
  ROUTE_DAY_TRAVEL_PRICE_NOTE,
  SERVICE_ADDRESS_DISCOUNT_NOTE,
} from "@shared/routeDays";
import { marketingCreativeSourceSchema } from "@shared/marketingCreative";
import { MARKETING_WEEKLY_NOTE, MARKETING_WEEKLY_THEMES } from "@shared/marketingWeek";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-mini";

const optionalUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().url().max(2000).optional(),
);

const optionalPhotoDataUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string()
    .regex(/^data:image\/(png|jpe?g|webp);base64,/i, "photoDataUrl must be a png, jpg, jpeg, or webp data URL")
    .max(7_000_000)
    .optional(),
);

export const marketingAdDraftSchema = z.object({
  area: z.string().trim().max(120).optional().default("Northwoods"),
  focus: z.string().trim().max(120).optional().default("moving help"),
  rawText: z.string().trim().max(900).optional().default(""),
  photoUrl: optionalUrlSchema,
  photoDataUrl: optionalPhotoDataUrlSchema,
  referralLink: z.string().url().max(2000),
  promoCode: z.string().trim().max(64).optional().default(""),
  workerName: z.string().trim().max(120).optional().default("JC crew"),
  creativeSource: marketingCreativeSourceSchema.optional().default({
    kind: "approved_photo",
    approvedPhotoKey: "crew-ramp",
  }),
});

export type MarketingAdDraftInput = z.infer<typeof marketingAdDraftSchema>;

export type MarketingAdDraftResult = {
  headline: string;
  facebookPost: string;
  shortText: string;
  hashtags: string[];
  ctaLabel: string;
  photoSuggestion: string;
  communityTargets: string[];
  followUpText: string;
  postingChecklist: string[];
  provider: "openai" | "deterministic";
  model: string;
  fallbackUsed: boolean;
  reason?: string;
};

const adDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "facebookPost",
    "shortText",
    "hashtags",
    "ctaLabel",
    "photoSuggestion",
    "communityTargets",
    "followUpText",
    "postingChecklist",
  ],
  properties: {
    headline: { type: "string" },
    facebookPost: { type: "string" },
    shortText: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    ctaLabel: { type: "string" },
    photoSuggestion: { type: "string" },
    communityTargets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
    followUpText: { type: "string" },
    postingChecklist: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
  },
} as const;

function cleanWords(value: string | undefined, fallback: string) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : fallback;
}

function isQuoteRequestCampaign(input: MarketingAdDraftInput) {
  return input.focus.trim().toLowerCase() === "crew appreciation"
    || MARKETING_WEEKLY_THEMES.some((theme) => theme === input.area);
}

export function buildApprovedMarketingFacebookPost(input: MarketingAdDraftInput) {
  const area = cleanWords(input.area, "the Northwoods");
  const focus = cleanWords(input.focus, "moving help");
  const rawNote = String(input.rawText || "").trim();
  const extra = rawNote && !/route-day scheduling:/i.test(rawNote) ? rawNote : "";
  if (isQuoteRequestCampaign(input)) {
    const appreciation = focus.toLowerCase() === "crew appreciation";
    return [
      appreciation ? "Thank you to the JC ON THE MOVE crew!" : `${area}: request a quote for ${focus}.`,
      appreciation
        ? "Your care and hard work help our customers through moving day. Thank you to every crew member and to the families who trust us with their next move."
        : "JC ON THE MOVE helps with moving, loading, unloading, packing, delivery, cleanup, and local labor.",
      extra,
      "Request a quote: send your service ZIP, preferred date, job details, and photos. Our team will confirm scope, price, and crew availability for your job.",
      input.referralLink,
      input.promoCode ? `Mention referral code ${input.promoCode}.` : "",
    ].filter(Boolean).join("\n\n");
  }
  return [
    `Need ${focus} around ${area}?`,
    "JC ON THE MOVE can help with loading, unloading, moving, delivery, junk removal, cleanup, and local labor.",
    `${ROUTE_DAY_DISCOUNT}\nRoute-day schedule: ${ROUTE_DAY_SUMMARY}.\n${IRONWOOD_DAILY_DISCOUNT}`,
    [
      "Route-day travel options:",
      ...ROUTE_DAY_PROMO_PACKAGES.map((pkg) => `• ${pkg.crew} / ${pkg.hours}: ${pkg.priceRange}`),
    ].join("\n"),
    `${ROUTE_DAY_TRAVEL_PRICE_NOTE} ${SERVICE_ADDRESS_DISCOUNT_NOTE} Surrounding-area and out-of-town requests use 1.25x travel pricing; promo-town requests on non-route days use 1.5x non-route-day pricing.`,
    "Send the address/ZIP, date, details, and photos. We will build the right quote before the crew is confirmed.",
    [input.referralLink, input.promoCode ? `Use code ${input.promoCode}.` : ""].filter(Boolean).join("\n"),
    extra,
  ].join("\n\n");
}

function fallbackDraft(input: MarketingAdDraftInput, reason?: string): MarketingAdDraftResult {
  const area = cleanWords(input.area, "the Northwoods");
  const focus = cleanWords(input.focus, "moving help");
  const facebookPost = buildApprovedMarketingFacebookPost(input);
  const quoteRequest = isQuoteRequestCampaign(input);

  return {
    headline: quoteRequest
      ? focus.toLowerCase() === "crew appreciation" ? "Thank you to our crew" : `${area}: request a quote`
      : `${focus} available in ${area}`,
    facebookPost,
    shortText: quoteRequest
      ? `Thank you for supporting JC ON THE MOVE. Request a quote: ${input.referralLink}${input.promoCode ? ` Referral code ${input.promoCode}.` : ""}`
      : `Need ${focus}? ${ROUTE_DAY_DISCOUNT} ${IRONWOOD_DAILY_DISCOUNT} Book JC ON THE MOVE: ${input.referralLink}${input.promoCode ? ` Code ${input.promoCode}.` : ""}`,
    hashtags: ["#JCONTHEMOVE", "#Northwoods", "#MovingHelp"],
    ctaLabel: "Book / Quote",
    photoSuggestion: input.photoUrl || input.photoDataUrl ? "Use the supplied photo and keep the booking link in the post." : "Use a clean crew, truck, before/after, or completed-job photo.",
    communityTargets: [
      `${area} community groups`,
      "Route-day town groups and neighborhood pages",
      "Local buy/sell/trade groups",
      "Apartment, landlord, and student housing groups",
    ],
    followUpText: `Thanks for reaching out. Send your ZIP/address, date, and a few photos here: ${input.referralLink}`,
    postingChecklist: [
      "Post with one clear photo.",
      "Keep the tracked booking link in the post.",
      "Reply to comments or messages quickly.",
    ],
    provider: "deterministic",
    model: "fallback-marketing-template",
    fallbackUsed: true,
    reason,
  };
}

function extractOutputText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;
  const chunks: string[] = [];
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}

export async function generateMarketingAdDraft(rawInput: MarketingAdDraftInput): Promise<MarketingAdDraftResult> {
  const input = marketingAdDraftSchema.parse(rawInput);
  const quoteRequest = isQuoteRequestCampaign(input);
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MARKETING_MODEL || process.env.OPENAI_BOOKING_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return fallbackDraft(input, "OPENAI_API_KEY is not configured");
  }

  const { creativeSource: _creativeSource, ...copyInput } = input;
  const modelInput = {
    ...copyInput,
    photoDataUrl: input.photoDataUrl ? "[device photo attached]" : undefined,
  };
  const userContent = input.photoDataUrl
    ? [
        { type: "input_text", text: JSON.stringify(modelInput) },
        { type: "input_image", image_url: input.photoDataUrl },
      ]
    : JSON.stringify(modelInput);

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content: [
            "You write practical local-service ads for JC ON THE MOVE.",
            "Keep posts simple, trustworthy, and community-focused.",
            "Prefer a 1-2-3 structure: need help, send details/photos, book through the tracked link.",
            ...(quoteRequest ? [
              MARKETING_WEEKLY_NOTE,
              "Lead with crew appreciation or the chosen weekday marketing theme and invite quote requests. Do not include discounts, prices, package amounts, travel multipliers, or claims of available crews.",
            ] : [
              "Lead with the selected service and area, then state the route schedule and approved 5% offer once, then package targets, travel multipliers, quote/availability disclaimer, and tracked link.",
            ]),
            "Do not repeat route-day, discount, package, or travel-language paragraphs.",
            "Never promise guaranteed availability, exact prices, financing, or same-day service.",
            "Always include the provided booking/referral link in the Facebook post and short text.",
            "Do not invent testimonials, licenses, reviews, discounts, or photos.",
            ...(!quoteRequest ? [
              `Approved offer: ${ROUTE_DAY_DISCOUNT} ${IRONWOOD_DAILY_DISCOUNT}`,
              `Approved travel package language: ${ROUTE_DAY_PROMO_PACKAGES.map((pkg) => `${pkg.title}: ${pkg.crew}, ${pkg.hours}, ${pkg.priceRange}`).join("; ")}.`,
              ROUTE_DAY_TRAVEL_PRICE_NOTE,
              "Explain route days as preferred batching windows, not hard service limits.",
              "Say customers can still request jobs outside the target area/day and the team will confirm availability.",
              "Mention 2 crews and up to 6 movers when it helps the post feel available.",
              ROUTE_DAY_CAMPAIGN_NOTE,
            ] : []),
            `Use the tracked booking link for performance reporting. The platform tracks these fields: ${ROUTE_DAY_TRACKING_POINTS.join(", ")}.`,
            "If a photo is attached, only describe what is visibly useful for the ad; if unclear, keep the copy general.",
            "Return practical communityTargets and a short followUpText a worker can send in Messenger or SMS.",
          ].join(" "),
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "jc_marketing_ad_draft",
          strict: true,
          schema: adDraftJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return fallbackDraft(input, `OpenAI ${response.status}: ${detail.slice(0, 180)}`);
  }

  try {
    const data = await response.json();
    const parsed = JSON.parse(extractOutputText(data));
    const fallback = fallbackDraft(input);
    return {
      headline: quoteRequest ? fallback.headline : String(parsed.headline || "").slice(0, 160) || fallback.headline,
      // The long-form Facebook caption is deterministic so approved pricing,
      // route-day terms, disclaimers, and tracking always stay in the same
      // order. OpenAI still assists with the headline, short reply, target
      // groups, and checklist.
      facebookPost: buildApprovedMarketingFacebookPost(input),
      shortText: quoteRequest ? fallback.shortText : String(parsed.shortText || "").slice(0, 320) || fallback.shortText,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String).slice(0, 6) : fallback.hashtags,
      ctaLabel: String(parsed.ctaLabel || "Book / Quote").slice(0, 80),
      photoSuggestion: String(parsed.photoSuggestion || fallback.photoSuggestion).slice(0, 240),
      communityTargets: Array.isArray(parsed.communityTargets)
        ? parsed.communityTargets.map(String).filter(Boolean).slice(0, 5)
        : fallback.communityTargets,
      followUpText: quoteRequest ? fallback.followUpText : String(parsed.followUpText || fallback.followUpText).slice(0, 420),
      postingChecklist: Array.isArray(parsed.postingChecklist)
        ? parsed.postingChecklist.map(String).filter(Boolean).slice(0, 5)
        : fallback.postingChecklist,
      provider: "openai",
      model,
      fallbackUsed: false,
    };
  } catch (error) {
    return fallbackDraft(input, error instanceof Error ? error.message : "OpenAI marketing response parse failed");
  }
}
