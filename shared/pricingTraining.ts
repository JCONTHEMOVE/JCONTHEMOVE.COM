import { z } from "zod";

export type PricingTrainingScenario = {
  id: string; batch: number; order: number; service: string; title: string; request: string; fingerprint: string;
  features: Record<string, string | number | null>;
};
export const TRAINING_REASONS = ["Heavy or awkward items", "Stairs or elevator", "Long carry / difficult access", "Volume of work", "Travel time", "Truck or equipment", "Disposal or materials", "Minimum charge", "Packing or disassembly", "Customer is not ready", "Missing information", "Specialist or unsafe conditions"] as const;
const positive = z.number().finite().positive().nullable();
export const trainingAnswerSchema = z.object({
  decision: z.enum(["quote", "information", "specialist", "decline"]).nullable().default(null),
  difficulty: z.enum(["low", "moderate", "high", "unknown"]).nullable().default(null),
  minimumCrew: z.number().int().min(1).max(12).nullable().default(null),
  recommendedCrew: z.number().int().min(1).max(12).nullable().default(null),
  minimumScheduledHours: positive.default(null),
  minimumBillableHours: positive.default(null),
  expectedElapsedHours: positive.default(null),
  price: positive.default(null),
  reasons: z.array(z.enum(TRAINING_REASONS)).max(TRAINING_REASONS.length).default([]),
  notes: z.string().max(8000).default(""),
  equipment: z.string().max(2000).default(""),
  followUp: z.string().max(2000).default(""),
}).strict();
export type TrainingAnswer = z.infer<typeof trainingAnswerSchema>;
export const emptyTrainingAnswer = () => trainingAnswerSchema.parse({});
export type SavedTrainingAnswer = { answer: TrainingAnswer; status: "draft" | "reviewed"; revision: number; updatedAt: string };
export function trainingAnswerProblems(answer: TrainingAnswer): string[] {
  const errors: string[] = [];
  if (!answer.decision) errors.push("Choose how you would handle this request.");
  if (!answer.difficulty) errors.push("Choose a difficulty level.");
  if (!answer.reasons.length && !answer.notes.trim()) errors.push("Choose a reason or add a note explaining your decision.");
  if (answer.decision === "quote") {
    if (!answer.minimumCrew || !answer.recommendedCrew) errors.push("Choose minimum and recommended crew.");
    if (answer.minimumCrew && answer.recommendedCrew && answer.recommendedCrew < answer.minimumCrew) errors.push("Recommended crew cannot be below minimum crew.");
    if (!answer.minimumScheduledHours || !answer.minimumBillableHours || !answer.expectedElapsedHours) errors.push("Choose scheduled, billed, and expected hours.");
    if (answer.minimumScheduledHours && answer.expectedElapsedHours && answer.expectedElapsedHours < answer.minimumScheduledHours) errors.push("Expected time cannot be shorter than your minimum scheduled time.");
    if (!answer.price) errors.push("Choose a price or enter your own.");
    if (answer.difficulty === "unknown") errors.push("Resolve difficulty or choose Need more information.");
  }
  return errors;
}

/** Offline replay against a reviewed example; no live rule activation or fuzzy matching. */
export function replayTrainingMinimums(saved: SavedTrainingAnswer | undefined, input: { crew: number; scheduledHours: number; billedHours: number }, existing: { minimumCrew: number; minimumHours: number }) {
  if (!saved || saved.status !== "reviewed" || trainingAnswerProblems(saved.answer).length) return { decision: "review", reason: "No complete reviewed example" };
  const a=saved.answer;
  if (a.decision === "decline") return { decision: "block", reason: "Owner declined this scenario" };
  if (a.decision !== "quote") return { decision: "review", reason: "Owner requires information or specialist review" };
  if (![input.crew,input.scheduledHours,input.billedHours,existing.minimumCrew,existing.minimumHours].every(v=>Number.isFinite(v)&&v>=0) || !Number.isInteger(input.crew)) return { decision: "block", reason: "Invalid crew or hours" };
  if(input.crew<Math.max(a.minimumCrew!,existing.minimumCrew))return {decision:"block",reason:"Crew below the minimum; extra hours cannot replace crew"};
  if(input.crew!==a.recommendedCrew)return {decision:"review",reason:"Different crew requires a separately reviewed time estimate"};
  if(input.scheduledHours<Math.max(a.minimumScheduledHours!,existing.minimumHours))return {decision:"block",reason:"Scheduled time below the minimum"};
  if(input.billedHours<a.minimumBillableHours!)return {decision:"block",reason:"Billable time below the minimum"};
  return {decision:"meets_reviewed_minimums",reason:"Example replay only; equipment and conditions still require review"};
}
