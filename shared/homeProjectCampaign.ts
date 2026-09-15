import { z } from "zod";
export const HOME_PROJECT_CAMPAIGN = {
  id: "holiday-home-projects-2026", path: "/carpet-removal", origin: "https://www.jconthemove.com",
  goal: 100, startsOn: "2026-09-14", endsOn: "2026-12-14",
  storageKey: "jc_home_project_referral_v1", attributionDays: 90,
} as const;
export const HOME_PROJECT_SERVICES = {
  carpet_removal: { label: "Carpet removal", serviceType: "flooring" },
  light_demolition: { label: "Light demolition", serviceType: "demolition" },
  flooring: { label: "Flooring prep, repair or installation", serviceType: "flooring" },
} as const;
export const homeProjectPhotoSchema = z.object({
  name: z.string().min(1).max(255), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(3 * 1024 * 1024),
  url: z.string().max(4_200_000).regex(/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/),
});
const trackingSchema = z.object({
  utmSource: z.string().trim().max(120).optional(), utmMedium: z.string().trim().max(120).optional(),
  utmContent: z.string().trim().max(120).optional(),
});
export const homeProjectRequestSchema = z.object({
  requestId: z.string().uuid(),
  firstName: z.string().trim().min(1, "Enter your first name").max(80).regex(/^[^<>]+$/, "Enter a name without markup"),
  lastName: z.string().trim().min(1, "Enter your last name").max(80).regex(/^[^<>]+$/, "Enter a name without markup"),
  email: z.union([z.string().trim().email().max(255), z.literal("")]).optional().default(""),
  phone: z.string().trim().max(30).regex(/^[+\d().\s-]+$/, "Enter a valid phone number").refine(v => /^(1)?\d{10}$/.test(v.replace(/\D/g, "")), "Enter a valid phone number"),
  projectType: z.enum(["carpet_removal", "light_demolition", "flooring"]),
  address: z.string().trim().min(3, "Enter the project address or city").max(500),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid ZIP code"),
  scope: z.string().trim().min(10, "Tell us a little more about the project").max(1500),
  squareFootage: z.number().int().min(1).max(100000).optional(),
  preferredDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid completion date").optional(),
  accessNotes: z.string().trim().max(1000).optional().default(""),
  haulAway: z.boolean().default(false), furnitureHelp: z.boolean().default(false),
  repSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64).optional(),
  tracking: trackingSchema.default({}),
  photos: z.array(homeProjectPhotoSchema).max(5).refine(photos => photos.reduce((sum, p) => sum + p.url.length, 0) <= 12 * 1024 * 1024, "Choose smaller photos or remove one before sending.").default([]),
}).strict();
export type HomeProjectRequest = z.infer<typeof homeProjectRequestSchema>;
export type HomeProjectReferral = { repSlug?: string; capturedAt: number; tracking: HomeProjectRequest["tracking"] };
export function homeProjectLink(repSlug?: string, source = "facebook"): string {
  const url = new URL(HOME_PROJECT_CAMPAIGN.path, HOME_PROJECT_CAMPAIGN.origin);
  if (repSlug) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(repSlug) || repSlug.length > 64) throw new Error("Invalid representative");
    url.searchParams.set("rep", repSlug);
  }
  url.searchParams.set("utm_source", source.slice(0, 120));
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", HOME_PROJECT_CAMPAIGN.id);
  url.searchParams.set("jc_campaign", HOME_PROJECT_CAMPAIGN.id);
  return url.toString();
}
// Keep the original representative through homepage navigation and later links.
// Store attribution only, never customer form contents.
export function captureHomeProjectReferral(search: string, saved: unknown, now = Date.now()): HomeProjectReferral {
  const old = saved as Partial<HomeProjectReferral> | null;
  const validAge = typeof old?.capturedAt === "number" && now >= old.capturedAt && now - old.capturedAt < HOME_PROJECT_CAMPAIGN.attributionDays * 86400000;
  const oldTracking = trackingSchema.safeParse(old?.tracking);
  if (validAge && typeof old?.repSlug === "string" && old.repSlug.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(old.repSlug) && oldTracking.success) {
    return { capturedAt: old.capturedAt!, repSlug: old.repSlug, tracking: oldTracking.data };
  }
  const params = new URLSearchParams(search);
  const slug = (params.get("rep") || params.get("ref") || "").trim().toLowerCase();
  const tracking: HomeProjectRequest["tracking"] = {};
  for (const [key, field] of [["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_content", "utmContent"]] as const) {
    const value = params.get(key)?.trim().slice(0, 120);
    if (value) tracking[field] = value;
  }
  return { capturedAt: now, ...(slug ? { repSlug: slug } : {}), tracking };
}
export const HOME_PROJECT_BOOKED_STATUSES = ["booked", "confirmed", "assigned", "in_progress", "completed"] as const;
