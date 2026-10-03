import { z } from "zod";
import { JOB_SCHEDULE_OPTIONS, JC_OPERATIONS_TIME_ZONE } from "./jcOperations";

export const PROJECT_SERVICES = [
  { code: "moving", label: "Moving", hint: "A whole home or a few things" },
  { code: "delivery", label: "Delivery", hint: "Furniture and store pickups" },
  { code: "junk_removal", label: "Junk removal", hint: "Make room for what's next" },
  { code: "labor", label: "Extra hands", hint: "Loading, unloading and lifting" },
  { code: "painting", label: "Painting", hint: "A fresh start for your space" },
  { code: "flooring", label: "Flooring", hint: "Removal and project help" },
  { code: "roofing", label: "Roofing", hint: "Tell us what your roof needs" },
  { code: "lawn_care", label: "Yard care", hint: "A little help outside" },
  { code: "snow_removal", label: "Snow care", hint: "Seasonal help close to home" },
  { code: "cleaning", label: "Cleaning", hint: "Move-outs and fresh starts" },
  { code: "handyman", label: "Home projects", hint: "Repairs and assembly" },
  { code: "window_cleaning", label: "Window cleaning", hint: "A clearer view" },
  { code: "demolition", label: "Light demolition", hint: "Clear the way for a project" },
  { code: "trash_valet", label: "Trash valet", hint: "Help with your trash bins" },
  { code: "custom", label: "Something else", hint: "Just ask — we'll talk it through" },
] as const;
export const EXTRA_SERVICE_CODES = ["painting", "roofing", "flooring", "lawn_care", "snow_removal"] as const;
export function projectServiceLabel(code: string) {
  return PROJECT_SERVICES.find(service => service.code === code)?.label || code.replace(/_/g, " ");
}

export function projectEntry(search: string, referrer = "") {
  const params = new URLSearchParams(search);
  const aliases: Record<string, string> = { move: "moving", movers: "moving", residential: "moving", uhaul: "moving", "u-haul": "moving", load: "moving", unload: "moving", junk: "junk_removal", hauling: "junk_removal", cleanup: "cleaning", cleanout: "cleaning", move_cleaning: "cleaning", snow: "snow_removal", lawn: "lawn_care", yard: "lawn_care", window: "window_cleaning", windows: "window_cleaning", demo: "demolition", other: "custom", justask: "custom", "just-ask": "custom", "something-else": "custom" };
  const normalize = (code: string) => aliases[code.toLowerCase().trim()] || code.toLowerCase().trim().replace(/-/g, "_");
  const focus = params.get("jc_focus") || params.get("utm_campaign") || "";
  const inferred = /junk|cleanout|trash|dump/i.test(focus) ? "junk_removal" : /deliver|pickup/i.test(focus) ? "delivery" : /snow|plow/i.test(focus) ? "snow_removal" : /lawn|yard|mow/i.test(focus) ? "lawn_care" : /roof/i.test(focus) ? "roofing" : /paint/i.test(focus) ? "painting" : /floor/i.test(focus) ? "flooring" : /clean/i.test(focus) ? "cleaning" : /handyman|repair|assembly/i.test(focus) ? "handyman" : "moving";
  const codes = [...new Set([params.get("service"), ...(params.get("services") || "").split(",")].filter(Boolean).map(code => normalize(code!)))];
  const primary = codes[0] || inferred;
  const serviceCode = PROJECT_SERVICES.some(service => service.code === primary) ? primary : "custom";
  const marketingTracking: Record<string, string> = { referrer };
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "jc_campaign", "jc_area", "jc_focus", "jc_route_city", "jc_route_state", "jc_route_zip", "jc_route_day", "jc_route_key", "jc_promo_type", "jc_package", "jc_crew_target", "jc_hours_target", "jc_price_band", "fbclid"]) {
    marketingTracking[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = (params.get(key) || "").trim();
  }
  return { serviceCode, additionalServices: codes.slice(1).filter(code => PROJECT_SERVICES.some(service => service.code === code)), address: params.get("address") || "", date: params.get("date") || params.get("requestedDate") || params.get("moveDate") || "", attribution: { promoCode: (params.get("promo") || params.get("promoCode") || "").trim().toUpperCase(), referralSlug: (params.get("rep") || params.get("ref") || "").trim().toLowerCase(), marketingCampaignId: marketingTracking.jcCampaign || marketingTracking.utmContent || "", marketingTracking } };
}
export function centralDateTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: JC_OPERATIONS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
export function projectScheduleError(preference?: string, date?: string, time?: string, now = new Date()): string | null {
  if (preference === "callback") return null;
  if (preference !== "preferred_time") return "Choose a preferred time or request a scheduling call.";
  const parsed = date ? new Date(`${date}T12:00:00Z`) : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "Choose a valid project date.";
  const current = centralDateTime(now);
  if (date < current.date) return "Choose today or a future project date.";
  if (!JOB_SCHEDULE_OPTIONS.some(option => option.start && option.start === time)) return "Choose a preferred arrival window.";
  if (date === current.date && time! <= current.time) return "That arrival window has passed. Choose a later time or request a scheduling call.";
  return null;
}

export const projectIntakeSchema = z.object({
  version: z.literal(1),
  serviceCode: z.string().refine(code => PROJECT_SERVICES.some(service => service.code === code), "Choose a service."),
  additionalServices: z.array(z.string().refine(code => PROJECT_SERVICES.some(service => service.code === code))).max(15),
  serviceAddress: z.string().trim().min(3).max(500),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
  destinationAddress: z.string().trim().max(500),
  schedulingPreference: z.enum(["preferred_time", "callback"]),
  preferredDate: z.string().optional(),
  preferredStartTime: z.string().optional(),
  timeZone: z.literal("America/Chicago"),
});
export type ProjectIntake = z.infer<typeof projectIntakeSchema>;

export function readProjectIntake(details?: string | null): ProjectIntake | null {
  try {
    const result = projectIntakeSchema.safeParse(JSON.parse(details || "{}").projectIntake);
    return result.success ? result.data : null;
  } catch { return null; }
}

export function projectScheduleLabel(intake: Pick<ProjectIntake, "schedulingPreference" | "preferredDate" | "preferredStartTime">) {
  if (intake.schedulingPreference === "callback") return "Call to schedule";
  const window = JOB_SCHEDULE_OPTIONS.find(option => option.start === intake.preferredStartTime)?.label || intake.preferredStartTime;
  return `${intake.preferredDate} · ${window} Central — requested`;
}
