import { z } from "zod";
import { leadPhoneNumberSchema } from "@shared/schema";
import { projectIntakeSchema, projectScheduleError } from "@shared/projectRequest";

type IntakeInput = {
  serviceCode: string; additionalServices: string[]; serviceAddress: string;
  city: string; state: string; zip: string; destinationAddress: string;
  schedulingPreference?: "preferred_time" | "callback";
  preferredDate?: string; preferredStartTime?: string;
};
export function projectIntakeInput(value: IntakeInput) {
  return {
    version: 1 as const, serviceCode: value.serviceCode,
    additionalServices: [...new Set(value.additionalServices)].filter(code => code !== value.serviceCode).sort(),
    serviceAddress: value.serviceAddress, city: value.city, state: value.state.toUpperCase(), zip: value.zip,
    destinationAddress: ["moving", "delivery"].includes(value.serviceCode) ? value.destinationAddress : "",
    schedulingPreference: value.schedulingPreference,
    preferredDate: value.schedulingPreference === "preferred_time" ? value.preferredDate : undefined,
    preferredStartTime: value.schedulingPreference === "preferred_time" ? value.preferredStartTime : undefined,
    timeZone: "America/Chicago" as const,
  };
}
export const quickRequestSchema = z.object({
    requestType: z.enum(["callback", "scheduled", "project"]).optional().default("callback"),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.union([z.string().trim().email().max(255), z.literal("")]).optional().default(""),
    phone: leadPhoneNumberSchema,
    serviceCode: z.string().trim().min(1).max(80),
    serviceAddress: z.string().trim().max(500).optional().default(""),
    zip: z.string().trim().max(12).optional().default(""),
    additionalServices: z.array(z.string().max(80)).max(15).optional().default([]),
    city: z.string().trim().max(100).optional().default(""),
    state: z.string().trim().max(2).optional().default(""),
    destinationAddress: z.string().trim().max(500).optional().default(""),
    schedulingPreference: z.enum(["preferred_time", "callback"]).optional(),
    workScope: z.string().trim().max(1500).optional().default(""),
    sizingBasis: z.enum(["square_footage", "truck"]).optional(),
    squareFootage: z.number().int().min(1).max(100000).optional(),
    truckSize: z.enum(["pickup_van_10", "15_ft", "20_ft", "26_ft"]).optional(),
    selectedCrewSize: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    preferredStartTime: z.string().regex(/^\d{2}:00$/).optional(),
    notes: z.string().trim().max(2500).optional().default(""),
    mediaLink: z.string().trim().max(1000).optional().default(""),
    promoCode: z.string().trim().max(50).optional().default(""),
    referralSlug: z.string().trim().max(80).optional().default(""),
    marketingCampaignId: z.string().trim().max(120).optional().default(""),
    marketingTracking: z.record(z.any()).optional().default({}),
    photos: z.array(z.object({
      name: z.string().max(255),
      type: z.string().max(100).optional().default(""),
      mimeType: z.string().max(100).optional().default(""),
      size: z.number().optional().default(0),
      url: z.string().max(4_500_000).optional().default(""),
    }).superRefine((photo, ctx) => {
      if (photo.url && !photo.url.startsWith("data:image/")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "Quick request photos must be image data URLs.",
        });
      }
      if ((photo.size || 0) > 3 * 1024 * 1024) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["size"],
          message: "Quick request photos must be 3 MB or smaller.",
        });
      }
    })).max(5).optional().default([]),
  }).superRefine((value, ctx) => {
    if (value.requestType === "project") {
      if (value.photos.reduce((total, photo) => total + Math.max(photo.size, Math.ceil(photo.url.length * 0.75)), 0) > 10 * 1024 * 1024) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["photos"], message: "Keep project photos under 10 MB total." });
      }
      const result = projectIntakeSchema.safeParse(projectIntakeInput(value));
      if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: issue.path });
      const message = projectScheduleError(value.schedulingPreference, value.preferredDate, value.preferredStartTime);
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["preferredDate"], message });
      return;
    }
    if (value.requestType !== "scheduled") return;
    const required: Array<[keyof typeof value, unknown, string]> = [
      ["email", value.email, "Enter your email"],
      ["serviceAddress", value.serviceAddress, "Enter the service address"],
      ["zip", value.zip, "Enter the service ZIP code"],
      ["workScope", value.workScope, "Describe the work"],
      ["sizingBasis", value.sizingBasis, "Choose home size or truck size"],
      ["preferredDate", value.preferredDate, "Choose a preferred date"],
      ["preferredStartTime", value.preferredStartTime, "Choose a preferred start time"],
    ];
    for (const [field, current, message] of required) {
      if (!current) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
    if (value.sizingBasis === "square_footage" && !value.squareFootage) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["squareFootage"], message: "Enter the approximate home square footage" });
    }
    if (value.sizingBasis === "truck" && !value.truckSize) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["truckSize"], message: "Choose the truck size" });
    }
  });
