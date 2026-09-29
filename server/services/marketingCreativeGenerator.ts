import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import {
  DEFAULT_APPROVED_MARKETING_PHOTO,
  MARKETING_CREATIVE_MAX_AI_GENERATIONS,
  type ApprovedMarketingPhotoKey,
  type MarketingCreativeResult,
  type MarketingCreativeSource,
  type MarketingCreativeVariant,
} from "@shared/marketingCreative";
import { getAppUrl } from "../appUrl";
import { ObjectStorageService } from "../objectStorage";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

export const MARKETING_CREATIVE_DIMENSIONS = {
  feed: { width: 1080, height: 1350 },
  og: { width: 1200, height: 630 },
} as const;

export type MarketingCreativeOverlay = {
  area: string;
  focus: string;
  promoCode: string;
  offerLine?: string;
  secondaryLine?: string;
  brandName?: string;
  siteLabel?: string;
};

type CreateMarketingCreativeInput = MarketingCreativeOverlay & {
  campaignId: string;
  revision: number;
  source: MarketingCreativeSource;
  previous?: Partial<MarketingCreativeResult> | null;
};

type PreparedSource = {
  buffer: Buffer;
  sourceKind: MarketingCreativeResult["sourceKind"];
  provider: MarketingCreativeResult["provider"];
  model: string;
  approvedPhotoKey: ApprovedMarketingPhotoKey;
  fallbackUsed: boolean;
  reason?: string;
  aiGenerationCount: number;
  requiresStorage: boolean;
};

function cleanText(value: string | undefined, fallback: string, maxLength = 80) {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, maxLength);
}

export function escapeMarketingCreativeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeTitleLines(overlay: MarketingCreativeOverlay) {
  const area = cleanText(overlay.area, "NORTHWOODS", 34).toUpperCase();
  const rawFocus = cleanText(overlay.focus, "MOVING HELP", 48).toUpperCase();
  const focus = /U-?HAUL/.test(rawFocus)
    ? "U-HAUL LOAD / UNLOAD HELP"
    : rawFocus;

  if (/U-?HAUL/.test(focus)) return [`${area} U-HAUL`, "LOAD / UNLOAD HELP"];
  if (`${area} ${focus}`.length <= 38) return [`${area} ${focus}`];
  return [area, focus];
}

async function svgTextLine(text: string, x: number, y: number, size: number, maxWidth: number, options: {
  fill?: string;
  anchor?: "start" | "middle";
} = {}) {
  const escapedText = escapeMarketingCreativeXml(text);
  const fontFamily = "DejaVu Sans, Arial, Helvetica, sans-serif";
  const measured = await sharp({
    text: { text: escapedText, font: `${fontFamily} Bold ${size}`, dpi: 72, rgba: true },
  }).metadata();
  // Reserve space for glyph bearings (e.g. DejaVu's J overhangs its origin)
  // as well as rasterization rounding on both sides of the layout slot.
  const fittedSize = Math.min(size, Math.floor(size * (maxWidth - 16) / (measured.width || maxWidth)));
  const textX = options.anchor === "middle" ? x : x + 6;
  return `<text x="${textX}" y="${y}" font-family="${fontFamily}" font-size="${fittedSize}" font-weight="700" fill="${options.fill || "#ffffff"}" text-anchor="${options.anchor || "start"}">${escapedText}</text>`;
}

export async function buildMarketingOverlaySvg(
  variant: MarketingCreativeVariant,
  overlay: MarketingCreativeOverlay,
) {
  const { width, height } = MARKETING_CREATIVE_DIMENSIONS[variant];
  const titleLines = normalizeTitleLines(overlay);
  const promoCode = cleanText(overlay.promoCode, "BOOK NOW", 32).toUpperCase();
  const offerLine = cleanText(overlay.offerLine, "SAVE 5% ON YOUR AREA'S ROUTE DAY", 52).toUpperCase();
  const secondaryLine = cleanText(overlay.secondaryLine, "IRONWOOD SAVES 5% EVERY DAY", 52).toUpperCase();
  const brandName = cleanText(overlay.brandName, "JC ON THE MOVE", 34).toUpperCase();
  const siteLabel = cleanText(overlay.siteLabel, "JCONTHEMOVE.COM", 38).toUpperCase();
  const footerLabel = overlay.siteLabel ? `${siteLabel} • ${promoCode}` : `${siteLabel} • CODE ${promoCode}`;

  if (variant === "og") {
    const title = titleLines.length === 1
      ? await svgTextLine(titleLines[0], 58, 267, 50, 1084)
      : `${await svgTextLine(titleLines[0], 58, 238, 48, 1084)}${await svgTextLine(titleLines[1], 58, 296, 48, 1084)}`;
    return Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#020617" stop-opacity="0.97"/>
            <stop offset="0.62" stop-color="#071a3e" stop-opacity="0.78"/>
            <stop offset="1" stop-color="#020617" stop-opacity="0.08"/>
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#shade)"/>
        <rect x="58" y="48" width="470" height="54" rx="27" fill="#2563eb"/>
        ${await svgTextLine(brandName, 293, 85, 25, 422, { anchor: "middle" })}
        <rect x="58" y="130" width="112" height="9" rx="4.5" fill="#f97316"/>
        ${title}
        <rect x="58" y="333" width="575" height="68" rx="14" fill="#f97316" fill-opacity="0.96"/>
        ${await svgTextLine(offerLine, 82, 379, 27, 527)}
        ${await svgTextLine(secondaryLine, 60, 448, 24, 1080, { fill: "#dbeafe" })}
        ${await svgTextLine(footerLabel, 60, 545, 25, 1080)}
      </svg>
    `);
  }

  const title = titleLines.length === 1
    ? await svgTextLine(titleLines[0], 62, 770, 61, 956)
    : `${await svgTextLine(titleLines[0], 62, 730, 58, 956)}${await svgTextLine(titleLines[1], 62, 800, 58, 956)}`;
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#020617" stop-opacity="0.78"/>
          <stop offset="1" stop-color="#020617" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#020617" stop-opacity="0"/>
          <stop offset="0.23" stop-color="#061b3f" stop-opacity="0.74"/>
          <stop offset="1" stop-color="#020617" stop-opacity="0.98"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="310" fill="url(#top)"/>
      <rect y="450" width="${width}" height="900" fill="url(#bottom)"/>
      <rect x="54" y="50" width="560" height="72" rx="36" fill="#2563eb"/>
      ${await svgTextLine(brandName, 334, 98, 32, 512, { anchor: "middle" })}
      <rect x="62" y="642" width="132" height="10" rx="5" fill="#f97316"/>
      ${title}
      <rect x="54" y="850" width="972" height="112" rx="22" fill="#f97316" fill-opacity="0.96"/>
      ${await svgTextLine(offerLine, 91, 922, 43, 898)}
      <rect x="54" y="986" width="972" height="86" rx="18" fill="#1d4ed8" fill-opacity="0.92"/>
      ${await svgTextLine(secondaryLine, 91, 1043, 35, 898)}
      ${await svgTextLine(footerLabel, 62, 1260, 35, 956)}
    </svg>
  `);
}

export async function renderMarketingCreativeBuffer(input: {
  sourceBuffer: Buffer;
  variant: MarketingCreativeVariant;
  overlay: MarketingCreativeOverlay;
}) {
  const { width, height } = MARKETING_CREATIVE_DIMENSIONS[input.variant];
  const background = await sharp(input.sourceBuffer, {
    failOn: "error",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize(width, height, { fit: "cover", position: "attention" })
    .modulate({ brightness: 0.92, saturation: 0.92 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return sharp(background)
    .composite([{ input: await buildMarketingOverlaySvg(input.variant, input.overlay) }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

export function marketingCreativeImageUrl(
  campaignId: string,
  variant: MarketingCreativeVariant,
  revision: number,
  appUrl = getAppUrl(),
) {
  return `${appUrl}/api/public/marketing/campaigns/${encodeURIComponent(campaignId)}/creative/${variant}.jpg?v=${revision}&render=2`;
}

export function marketingCampaignShareUrl(campaignId: string, revision: number, appUrl = getAppUrl()) {
  return `${appUrl}/c/${encodeURIComponent(campaignId)}?v=${revision}`;
}

export function marketingCreativeReadiness() {
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const objectStorageConfigured = Boolean(process.env.PUBLIC_OBJECT_SEARCH_PATHS?.trim());
  return {
    deterministicReady: true,
    openAiConfigured,
    objectStorageConfigured,
    aiReady: openAiConfigured && objectStorageConfigured,
    imageModel: process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  };
}

export function approvedMarketingPhotoPath(key: ApprovedMarketingPhotoKey = DEFAULT_APPROVED_MARKETING_PHOTO) {
  if (key !== DEFAULT_APPROVED_MARKETING_PHOTO) throw new Error("Unknown approved marketing photo");
  return path.resolve(process.cwd(), "attached_assets", "google_movers", "crew-ramp.jpg");
}

export async function loadApprovedMarketingPhoto(key: ApprovedMarketingPhotoKey = DEFAULT_APPROVED_MARKETING_PHOTO) {
  return fs.readFile(approvedMarketingPhotoPath(key));
}

function decodePhotoDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("Unsupported uploaded photo");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 6_000_000) throw new Error("Uploaded photo is too large");
  return buffer;
}

async function validateSourceImage(buffer: Buffer) {
  const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 320) {
    throw new Error("Marketing photos must be at least 320 pixels on each side");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("Marketing photos must be JPEG, PNG, or WebP");
  }
}

async function generateAiMarketingBackground(input: MarketingCreativeOverlay) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const prompt = [
    "Use case: ads-marketing",
    "Asset type: background photo for a local Facebook moving-service advertisement",
    `Primary request: a trustworthy photorealistic moving-work scene serving ${cleanText(input.area, "the Northwoods")} for ${cleanText(input.focus, "moving help")}`,
    "Scene/backdrop: a Northwoods residential driveway with a generic customer-rented white box truck open for loading or unloading",
    "Subject: two professional adult movers safely handling ordinary household boxes and wrapped furniture",
    "Style/medium: candid natural commercial photography with realistic fabric, wood, cardboard, and vehicle texture",
    "Composition/framing: square master composition; keep people and truck inside the central 55 percent so both portrait and landscape crops remain useful; leave uncluttered darkenable space around the edges",
    "Lighting/mood: bright natural daylight, capable, friendly, practical, not staged",
    "Constraints: background image only; no text; no logos; no trademarks; no phone numbers; no uniforms with invented branding; no watermark",
    "Avoid: unsafe lifting, damaged belongings, distorted hands, luxury-home staging, stock-photo gloss",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1024x1024",
        quality: "medium",
        output_format: "jpeg",
        output_compression: 88,
        n: 1,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI image ${response.status}: ${detail.slice(0, 180)}`);
    }
    const data = await response.json() as { data?: Array<{ b64_json?: string }> };
    const encoded = data.data?.[0]?.b64_json;
    if (!encoded) throw new Error("OpenAI returned no image data");
    return { buffer: Buffer.from(encoded, "base64"), model };
  } finally {
    clearTimeout(timeout);
  }
}

async function approvedFallback(reason?: string, aiGenerationCount = 0): Promise<PreparedSource> {
  return {
    buffer: await loadApprovedMarketingPhoto(),
    sourceKind: "approved_photo",
    provider: "jc_photo",
    model: "approved-crew-ramp-v1",
    approvedPhotoKey: DEFAULT_APPROVED_MARKETING_PHOTO,
    fallbackUsed: Boolean(reason),
    reason,
    aiGenerationCount,
    requiresStorage: false,
  };
}

async function prepareMarketingSource(input: CreateMarketingCreativeInput): Promise<PreparedSource> {
  const readiness = marketingCreativeReadiness();
  const previousAiCount = Math.max(0, Number(input.previous?.aiGenerationCount || 0));

  if (input.source.kind === "approved_photo") {
    return approvedFallback(undefined, previousAiCount);
  }

  if (!readiness.objectStorageConfigured) {
    return approvedFallback("Public object storage is not configured; approved JC photo used.", previousAiCount);
  }

  if (input.source.kind === "uploaded_photo") {
    if (!input.source.photoDataUrl) {
      return approvedFallback("No device photo was supplied; approved JC photo used.", previousAiCount);
    }
    try {
      const buffer = decodePhotoDataUrl(input.source.photoDataUrl);
      await validateSourceImage(buffer);
      return {
        buffer,
        sourceKind: "uploaded_photo",
        provider: "upload",
        model: "crew-upload-v1",
        approvedPhotoKey: DEFAULT_APPROVED_MARKETING_PHOTO,
        fallbackUsed: false,
        aiGenerationCount: previousAiCount,
        requiresStorage: true,
      };
    } catch (error) {
      return approvedFallback(error instanceof Error ? `${error.message}; approved JC photo used.` : "Uploaded photo failed; approved JC photo used.", previousAiCount);
    }
  }

  if (!readiness.openAiConfigured) {
    return approvedFallback("OPENAI_API_KEY is not configured; approved JC photo used.", previousAiCount);
  }
  if (previousAiCount >= MARKETING_CREATIVE_MAX_AI_GENERATIONS) {
    return approvedFallback(`AI image limit reached (${MARKETING_CREATIVE_MAX_AI_GENERATIONS} per campaign); approved JC photo used.`, previousAiCount);
  }

  const nextAiCount = previousAiCount + 1;
  try {
    const generated = await generateAiMarketingBackground(input);
    await validateSourceImage(generated.buffer);
    return {
      buffer: generated.buffer,
      sourceKind: "ai_scene",
      provider: "openai",
      model: generated.model,
      approvedPhotoKey: DEFAULT_APPROVED_MARKETING_PHOTO,
      fallbackUsed: false,
      aiGenerationCount: nextAiCount,
      requiresStorage: true,
    };
  } catch (error) {
    return approvedFallback(error instanceof Error ? `${error.message}; approved JC photo used.` : "AI image failed; approved JC photo used.", nextAiCount);
  }
}

export async function createMarketingCreative(input: CreateMarketingCreativeInput): Promise<MarketingCreativeResult> {
  const source = await prepareMarketingSource(input);
  const overlay = {
    area: input.area,
    focus: input.focus,
    promoCode: input.promoCode,
    offerLine: input.offerLine,
    secondaryLine: input.secondaryLine,
    brandName: input.brandName,
    siteLabel: input.siteLabel,
  };
  const feedBuffer = await renderMarketingCreativeBuffer({ sourceBuffer: source.buffer, variant: "feed", overlay });
  const ogBuffer = await renderMarketingCreativeBuffer({ sourceBuffer: source.buffer, variant: "og", overlay });

  let feedAssetUrl: string | undefined;
  let ogAssetUrl: string | undefined;
  let fallbackUsed = source.fallbackUsed;
  let reason = source.reason;
  let finalSource = source;

  if (source.requiresStorage) {
    try {
      const objectStorage = new ObjectStorageService();
      [feedAssetUrl, ogAssetUrl] = await Promise.all([
        objectStorage.savePublicFileBuffer(feedBuffer, "image/jpeg", "jpg", `marketing/${input.campaignId}/feed-r${input.revision}`),
        objectStorage.savePublicFileBuffer(ogBuffer, "image/jpeg", "jpg", `marketing/${input.campaignId}/og-r${input.revision}`),
      ]);
    } catch (error) {
      const storageReason = error instanceof Error ? error.message : "Creative storage failed";
      finalSource = await approvedFallback(`${storageReason}; approved JC photo used.`, source.aiGenerationCount);
      fallbackUsed = true;
      reason = finalSource.reason;
    }
  }

  return {
    feedImageUrl: marketingCreativeImageUrl(input.campaignId, "feed", input.revision),
    ogImageUrl: marketingCreativeImageUrl(input.campaignId, "og", input.revision),
    shareUrl: marketingCampaignShareUrl(input.campaignId, input.revision),
    altText: `${cleanText(input.area, "Northwoods")} ${cleanText(input.focus, "moving help")} advertisement from ${cleanText(input.brandName, "JC ON THE MOVE")}`,
    revision: input.revision,
    source: finalSource.sourceKind,
    sourceKind: finalSource.sourceKind,
    approvedPhotoKey: finalSource.approvedPhotoKey,
    provider: finalSource.provider,
    model: finalSource.model,
    fallbackUsed,
    reason,
    aiGenerationCount: finalSource.aiGenerationCount,
    generatedAt: new Date().toISOString(),
    feedAssetUrl,
    ogAssetUrl,
    overlay: {
      offerLine: input.offerLine,
      secondaryLine: input.secondaryLine,
      brandName: input.brandName,
      siteLabel: input.siteLabel,
    },
  };
}
