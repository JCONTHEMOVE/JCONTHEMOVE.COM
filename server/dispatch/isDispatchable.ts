import { checkWorkflowDispatch } from "../services/jobWorkflow";
export interface DispatchabilityCheck { ok: boolean; reason?: string }
/** Offers fill open slots; full rosters are required only for staff dispatch. */
export async function isDispatchable(leadId: string): Promise<DispatchabilityCheck> {
  try {
    const blockers = await checkWorkflowDispatch(leadId, false);
    return blockers.length ? { ok: false, reason: blockers.map(b => b.message).join(" ") } : { ok: true };
  } catch (error) {
    console.warn("[isDispatchable] Readiness unavailable; failing closed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "Job readiness could not be verified" };
  }
}
