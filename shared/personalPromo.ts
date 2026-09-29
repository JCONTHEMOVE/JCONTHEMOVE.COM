import { z } from "zod";

export const personalPromoNameSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, "Use 3-20 letters or numbers, without spaces.");

const amount = z.coerce.number().finite().min(0).max(1_000_000);
export const personalPromoTermsSchema = z.object({
  description: z.string().trim().max(500).default(""),
  discountPercent: z.coerce.number().finite().min(0).max(100),
  discountPercentJewelry: z.coerce.number().finite().min(0).max(100),
  rewardTokens: amount,
  referralRewardTokens: amount,
  maxUses: z.number().int().positive().nullable(),
  expiresAt: z.string().datetime().nullable(),
}).strict();

export const personalPromoReviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reject"), feedback: z.string().trim().min(1).max(500) }).strict(),
  z.object({
    action: z.literal("approve"), code: z.string().trim().toUpperCase().min(1).max(100),
    existingPromoId: z.string().min(1).optional(),
    terms: personalPromoTermsSchema.optional(),
    feedback: z.string().trim().max(500).default(""),
  }).strict(),
]).refine(value => value.action === "reject" || Boolean(value.existingPromoId) !== Boolean(value.terms), {
  message: "Select an existing code or provide the new code's terms.",
}).refine(value => value.action === "reject" || Boolean(value.existingPromoId) || personalPromoNameSchema.safeParse(value.code).success, {
  message: "New codes must use 3-20 letters or numbers, without spaces.",
});

export type PersonalPromoTerms = z.infer<typeof personalPromoTermsSchema>;
export type PersonalPromoReview = z.infer<typeof personalPromoReviewSchema>;
export type PersonalPromoCopy = { offerLine: string; secondaryLine: string; caption: string };
export type PersonalPromo = {
  id: string; code: string; description: string; discountPercent: string;
  discountPercentJewelry: string; rewardTokens: string; referralRewardTokens: string;
  maxUses: number | null; usesCount: number; expiresAt: string | null;
  isActive: boolean; jobOffer: unknown; unavailableReason: string | null; needsOwnershipApproval?: boolean;
};
export type PersonalPromoRequest = {
  id: string; userId: string; workerName: string; requestedCode: string;
  status: "pending" | "approved" | "rejected"; feedback: string;
  approvedCode: string | null; reviewedByUserId: string | null;
  createdAt: string; reviewedAt: string | null;
};
export type PersonalPromoState = {
  status: "ready" | "unassigned" | "conflict" | "unavailable";
  reason: string | null; promo: PersonalPromo | null; candidates: PersonalPromo[];
  suggestions: string[]; request: PersonalPromoRequest | null;
  repSlug: string | null; bookingPath: string | null; offer: PersonalPromoCopy | null;
};
export type PersonalPromoReviewItem = PersonalPromoRequest & { candidates: PersonalPromo[] };

export function personalPromoSuggestions(firstName: string, lastName = "") {
  const letters = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");
  const name = letters(firstName).slice(0, 12);
  if (name.length < 2) return [];
  const initial = letters(lastName).slice(0, 1);
  return [...new Set([`${name}MOVES`, `${name}HELPS`, `${name}CREW`, `${name}${initial}MOVES`, `${name}${initial}HELPS`, `${name}LOCAL`])];
}

export function personalPromoCopy(promo: Pick<PersonalPromo, "code" | "discountPercent" | "jobOffer">): PersonalPromoCopy {
  const percent = Number(promo.discountPercent);
  const offerLine = promo.jobOffer
    ? "ASK ABOUT YOUR PERSONAL SERVICE OFFER"
    : percent > 0 ? `SAVE ${percent}% ON ELIGIBLE SERVICES` : "LOCAL MOVING AND LABOR HELP";
  const caption = promo.jobOffer
    ? `Ask about the service offer for code ${promo.code}. The team will confirm the package requirements and final quote.`
    : percent > 0 ? `Save ${percent}% on eligible services with code ${promo.code}. The team will confirm eligibility and the final quote.`
      : `Mention personal code ${promo.code} when requesting your quote.`;
  return { offerLine, secondaryLine: "FINAL QUOTE CONFIRMS ELIGIBILITY", caption: `${caption} One offer per job; discounts do not stack.` };
}
