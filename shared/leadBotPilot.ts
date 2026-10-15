import { z } from "zod";
import { normalizeCustomerPhone, phoneError } from "./phone";
import { marketingBotTerritorySchema } from "./marketingBot";

// Deterministic inquiry configuration. Prices, capacity and bookings remain in
// the canonical quote / booking workflow.
export const LEAD_BOT_SERVICES = {
  moving: { label: "Moving", intake: "moving" },
  packing: { label: "Packing", intake: "labor" },
  junk_removal: { label: "Junk removal", intake: "junk_removal" },
  helping_hands: { label: "Helping hands", intake: "handyman" },
  heavy_item: { label: "Heavy-item moving", intake: "moving" },
  lawn_seasonal: { label: "Yard / seasonal work", intake: "lawn_care" },
} as const;
export const LEAD_BOT_QUESTIONS = {
  access: "Are there stairs, narrow doors or parking restrictions?",
  items: "Which large or heavy items should we know about?",
  destination: "Where will the items be delivered?",
} as const;
export const leadBotConfigSchema = z.object({
  name: z.string().trim().min(3).max(80),
  representativeId: z.string().uuid(),
  campaignId: z.string().uuid(),
  variantId: z.string().uuid(),
  service: z.enum(["moving", "packing", "junk_removal", "helping_hands", "heavy_item", "lawn_seasonal"]),
  territory: marketingBotTerritorySchema,
  // Explicit towns avoid pretending the broad marketing territory is a
  // geocoder. Customers outside this list can still ask the main office.
  towns: z.array(z.object({ city: z.string().trim().min(2).max(80), state: z.enum(["MI", "WI", "MN"]) }).strict()).min(1).max(12),
  promotionId: z.string().uuid().nullable(),
  questions: z.array(z.enum(["access", "items", "destination"])).max(3)
    .refine(value => new Set(value).size === value.length, "Choose each question once."),
}).strict();
export type LeadBotConfig = z.infer<typeof leadBotConfigSchema>;

export const leadBotAnswersSchema = z.object({
  serviceAddress: z.string().trim().min(3).max(300),
  city: z.string().trim().min(2).max(80),
  state: z.enum(["MI", "WI", "MN"]),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, "Enter a five-digit ZIP code."),
  scope: z.string().trim().min(10, "Tell us a little more about the project.").max(1000),
  timing: z.string().trim().min(3).max(200),
  timeZone: z.enum(["America/Chicago", "America/Detroit"]),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255),
  phone: z.string().max(40).superRefine((value, ctx) => {
    const error = phoneError(value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }).transform(value => normalizeCustomerPhone(value)!),
  answers: z.object({ access: z.string().trim().max(200).optional(), items: z.string().trim().max(200).optional(), destination: z.string().trim().max(200).optional() }).strict(),
  consent: z.literal(true, { errorMap: () => ({ message: "Please confirm that we may review your inquiry." }) }),
}).strict();
export const leadBotSubmissionSchema = z.object({
  leadBotId: z.string().uuid(), revision: z.number().int().positive(),
  submissionKey: z.string().uuid(), visitorId: z.string().uuid(),
  inquiry: leadBotAnswersSchema,
}).strict();
export type LeadBotSubmission = z.infer<typeof leadBotSubmissionSchema>;
export type LeadBotAnswers = z.infer<typeof leadBotAnswersSchema>;

export function inquiryQualification(config: LeadBotConfig, input: LeadBotAnswers): string | null {
  if (!config.towns.some(town => town.city.toLowerCase() === input.city.toLowerCase() && town.state === input.state)) {
    return "This campaign covers the listed towns. Please contact the main office for other locations.";
  }
  if (Object.keys(input.answers).some(key => !config.questions.includes(key as keyof typeof LEAD_BOT_QUESTIONS))) return "The questions changed. Please reopen the link.";
  if (config.questions.some(key => !input.answers[key]?.trim())) return "Please answer each project question. You can say ‘not sure’.";
  return null;
}

export type LeadBotPublic = {
  id: string; revision: number; name: string; representative: string;
  service: LeadBotConfig["service"]; territory: LeadBotConfig["territory"];
  towns: LeadBotConfig["towns"]; questions: LeadBotConfig["questions"];
  promotion: { code: string; description: string } | null;
  preview: boolean; sharePath: string;
};
