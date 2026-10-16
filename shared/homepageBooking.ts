import { z } from "zod";
import { estimateJobDuration } from "./jcOperations";

// Planning only. Prices and deposits remain owned by the existing quote services.
export const movePlanSchema = z.object({
  sizingBasis: z.enum(["square_footage", "truck"]),
  squareFootage: z.number().int().min(1).max(100000).optional(),
  truckSize: z.enum(["pickup_van_10", "15_ft", "20_ft", "26_ft"]).optional(),
  scope: z.enum(["load", "unload", "load_unload", "move"]),
  inventory: z.string().trim().min(3).max(1500),
  access: z.enum(["standard", "stairs", "special", "unknown"]).default("unknown"),
  selectedCrewSize: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  selectedHours: z.number().min(1).max(12).multipleOf(0.5).optional(),
  overrideReason: z.string().trim().max(500).default(""),
}).superRefine((value, ctx) => {
  if (value.sizingBasis === "truck" ? !value.truckSize : !value.squareFootage) {
    ctx.addIssue({ code: "custom", path: [value.sizingBasis === "truck" ? "truckSize" : "squareFootage"], message: "Tell us the size of the move." });
  }
});
export type MovePlan = z.infer<typeof movePlanSchema>;

export function recommendMove(plan: MovePlan) {
  const recommended = estimateJobDuration({ ...plan, selectedCrewSize: undefined });
  const selected = estimateJobDuration(plan);
  const hours = plan.selectedHours ?? selected.planningHours;
  const overridden = selected.selectedCrewSize !== recommended.recommendedCrewSize || hours !== recommended.planningHours;
  return {
    version: 1,
    basis: recommended.label,
    crewSize: recommended.recommendedCrewSize,
    minimumHours: recommended.minimumHours,
    maximumHours: recommended.maximumHours,
    selectedCrewSize: selected.selectedCrewSize,
    selectedHours: hours,
    overridden,
    // Free-text inventory is retained for the crew to review, never interpreted
    // as a guaranteed duration. Both-end work and overrides require staff review.
    reviewRequired: recommended.manualReview || overridden || plan.access !== "standard"
      || /\b(piano|safe|hot tub|pool table|heavy|stairs)\b/i.test(plan.inventory)
      || ["load_unload", "move"].includes(plan.scope),
    explanation: "Planning estimate from the existing home/truck size guide. Inventory, travel, stairs and access can change the time. The team reviews your scope; duration is not guaranteed.",
  };
}

export const bookingTimeZoneSchema = z.enum(["America/Chicago", "America/Detroit"]);
export type BookingTimeZone = z.infer<typeof bookingTimeZoneSchema>;
export function validBookingDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function bookingDateTimeToUtc(date: string, time: string, timeZone: BookingTimeZone = "America/Chicago") {
  if (!validBookingDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choose a valid date and time.");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let utc = target;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let pass = 0; pass < 3; pass++) {
    const parts = formatter.formatToParts(new Date(utc));
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    utc += target - Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  }
  return new Date(utc);
}
export function bookingTimeLabel(instant: string | Date, timeZone: BookingTimeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(instant));
}

export type PublicBookingStatus = {
  success: true;
  kind: "callback" | "hold";
  leadId: string;
  bookingId: string | null;
  holdId: string | null;
  status: string;
  expiresAt: string | null;
  startAt: string | null;
  paymentState: "unpaid" | "deposit_paid" | "paid";
  paymentUrl: string | null;
  depositAmount: number | null;
  quoteRevision: number | null;
  customerTotal: number | null;
  message: string;
};
