/**
 * The compact, role-neutral lifecycle used by every job surface.
 *
 * `leads.status` remains the persisted business state.  This projection
 * deliberately derives a readable operational stage from the existing lead,
 * dispatch, crew, payment, and payout fields so existing integrations do not
 * need a data migration just to agree on what a job needs next.
 */

export type JobFlowStage =
  | "needs_quote"
  | "needs_schedule"
  | "ready_to_open"
  | "ready_for_crew"
  | "crew_claimed"
  | "awaiting_crew_acceptance"
  | "ready_to_dispatch"
  | "in_progress"
  | "payout_ready"
  | "payout_pending"
  | "completed"
  | "closed";

export type JobFlowActionKey =
  | "build_quote"
  | "set_schedule"
  | "open_to_crew"
  | "claim_job"
  | "confirm_crew"
  | "accept_dispatch"
  | "dispatch_crew"
  | "start_job"
  | "approve_payout"
  | "complete_payout"
  | "view_job";

export type JobPaymentSummary = {
  key: string;
  label: string;
};

export type JobPayoutSummary = {
  state: "not_ready" | "approval_required" | "pending" | "paid";
  label: string;
  calculationStatus?: string | null;
  workerPayoutCount: number;
  rewardsIssued: number;
};

export type JobFlow = {
  operations?: import("./job-workflow").JobWorkflow;
  stage: JobFlowStage;
  label: string;
  nextAction: {
    key: JobFlowActionKey;
    label: string;
    description: string;
  };
  schedule: {
    state: "scheduled" | "tbd";
    date: string | null;
    arrivalWindow: string | null;
  };
  crew: {
    needed: number;
    claimed: number;
    accepted: number;
    openSlots: number;
    isClaimed: boolean;
  };
  quote: {
    ready: boolean;
    sent: boolean;
  };
  payment: JobPaymentSummary;
  payout: JobPayoutSummary;
  canClaim: boolean;
};

export type JobFlowLeadInput = {
  status?: string | null;
  archivedAt?: unknown;
  moveDate?: string | null;
  confirmedDate?: string | null;
  arrivalWindow?: string | null;
  basePrice?: string | number | null;
  totalPrice?: string | number | null;
  confirmedHours?: number | null;
  crewSize?: number | null;
  crewMembers?: string[] | null;
  acceptedByEmployees?: string[] | null;
  dispatchState?: string | null;
  dispatchSentAt?: unknown;
  quoteSentAt?: unknown;
  completedAt?: unknown;
};

export type JobFlowOptions = {
  payment?: JobPaymentSummary;
  payout?: Partial<JobPayoutSummary>;
};

const terminalStatuses = new Set(["cancelled", "closed", "archived"]);
const quoteRequiredStatuses = new Set(["new", "contacted", "quote_requested", "chatbot_pending", "pending_quote_approval"]);
const readyForCrewStatuses = new Set(["available", "open"]);
const activeDispatchStates = new Set(["en_route", "on_site", "in_progress"]);
const dispatchOfferStates = new Set(["offered", "assigned"]);

function numberFrom(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value: string | null | undefined) {
  const raw = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? raw
    : null;
}

function action(key: JobFlowActionKey, label: string, description: string) {
  return { key, label, description };
}

export function buildJobFlow(lead: JobFlowLeadInput, options: JobFlowOptions = {}): JobFlow {
  const status = String(lead.status || "").toLowerCase();
  const dispatchState = String(lead.dispatchState || "pending").toLowerCase();
  const scheduleDate = validDate(lead.confirmedDate) || validDate(lead.moveDate);
  const needed = Math.max(1, Number(lead.crewSize || 2));
  const crew = Array.isArray(lead.crewMembers) ? Array.from(new Set(lead.crewMembers.filter(Boolean))) : [];
  const accepted = Array.isArray(lead.acceptedByEmployees)
    ? Array.from(new Set(lead.acceptedByEmployees.filter((id) => crew.includes(id))))
    : [];
  const quoteReady = (numberFrom(lead.totalPrice) > 0 || numberFrom(lead.basePrice) > 0)
    && numberFrom(lead.confirmedHours) > 0;
  const completed = status === "completed" || Boolean(lead.completedAt);
  const payment = options.payment || { key: "unknown", label: "Payment not set" };
  const payout: JobPayoutSummary = {
    state: "not_ready",
    label: "Not ready",
    workerPayoutCount: 0,
    rewardsIssued: 0,
    ...options.payout,
  };
  const schedule = {
    state: scheduleDate ? "scheduled" as const : "tbd" as const,
    date: scheduleDate,
    arrivalWindow: lead.arrivalWindow || null,
  };
  const crewSummary = {
    needed,
    claimed: crew.length,
    accepted: accepted.length,
    openSlots: Math.max(0, needed - crew.length),
    isClaimed: crew.length > 0,
  };
  const quote = { ready: quoteReady, sent: Boolean(lead.quoteSentAt) };

  const result = (stage: JobFlowStage, label: string, nextAction: JobFlow["nextAction"], canClaim = false): JobFlow => ({
    stage,
    label,
    nextAction,
    schedule,
    crew: crewSummary,
    quote,
    payment,
    payout,
    canClaim,
  });

  if (lead.archivedAt || terminalStatuses.has(status)) {
    return result("closed", "Closed", action("view_job", "View job", "This job is no longer active."));
  }

  if (completed) {
    if (payout.state === "approval_required") {
      return result("payout_ready", "Payout approval needed", action("approve_payout", "Approve payout", "Review and approve crew payout before it is released."));
    }
    if (payout.state === "pending") {
      return result("payout_pending", "Payout in progress", action("complete_payout", "View payout", "Worker payout or JCMOVES issuance is still pending."));
    }
    return result("completed", "Completed", action("view_job", "View completion", "Job, payout, and JCMOVES status are available here."));
  }

  if (activeDispatchStates.has(dispatchState) || status === "in_progress") {
    return result("in_progress", "Work in progress", action("start_job", "Open job", "Crew can update the live job status."));
  }

  if (quoteRequiredStatuses.has(status) || !quoteReady) {
    return result("needs_quote", "Quote needed", action("build_quote", "Build quote", "Set the job price, crew size, and expected hours."));
  }

  if (!scheduleDate) {
    return result("needs_schedule", "Date and time needed", action("set_schedule", "Set schedule", "Confirm the move date and arrival window before opening crew slots."));
  }

  if (dispatchOfferStates.has(dispatchState) || Boolean(lead.dispatchSentAt)) {
    if (accepted.length < Math.min(needed, crew.length)) {
      return result("awaiting_crew_acceptance", "Awaiting crew acceptance", action("accept_dispatch", "Accept dispatch", "Assigned crew must accept before work starts."));
    }
    return result("ready_to_dispatch", "Crew confirmed", action("dispatch_crew", "Dispatch crew", "Crew is ready for the scheduled job."));
  }

  if (accepted.length >= needed) {
    return result("ready_to_dispatch", "Crew confirmed", action("dispatch_crew", "Dispatch crew", "Crew is ready for the scheduled job."));
  }

  if (crew.length > 0) {
    return result("crew_claimed", "Crew claim pending", action("confirm_crew", "Confirm crew", "Review the crew claim, complete the roster, and dispatch when ready."));
  }

  if (!readyForCrewStatuses.has(status)) {
    return result("ready_to_open", "Ready to open", action("open_to_crew", "Open to crew", "The quote and schedule are set; make this job available to crew."));
  }

  return result(
    "ready_for_crew",
    "Open to crew",
    action("claim_job", "Claim job", "Claim an open crew slot; Admin will confirm and dispatch."),
    true,
  );
}
