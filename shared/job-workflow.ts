import { customerNotesFromDetails } from "./leadDetails";
import { isHourlyJobArrivalWindow, isLegacyJobArrivalWindow } from "./jcOperations";

export function businessDateString() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type RepairTarget = "customer" | "details" | "schedule" | "quote" | "confirmation" | "payment" | "crew";
export type WorkflowBlocker = { code: string; message: string; target: RepairTarget; field?: string };
export type DeliveryOutcome = { status: "not_requested" | "pending" | "sent" | "failed" | "unavailable" | "unknown"; message?: string; reference?: string };
export type WorkflowQuote = {
  id: string | null; revision: number; status: string; total: number; subtotal: number;
  discount: number; lines: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  requiresOwner: boolean; reasons: string[]; matches: boolean;
};
export type JobWorkflow = {
  version: string;
  stage: "details" | "quote" | "confirmation" | "dispatch" | "work" | "closeout" | "closed";
  label: string;
  nextAction: { key: string; label: string; target?: RepairTarget };
  blockers: WorkflowBlocker[];
  quote: WorkflowQuote;
  confirmation: { current: boolean; recordedAt?: string; method?: string };
  payment: { ready: boolean; label: string };
  crew: { needed: number; selected: number; accepted: number };
  capabilities: { approve: boolean; manage: boolean; sms: boolean };
  delivery?: { email?: DeliveryOutcome; sms?: DeliveryOutcome; invoice?: DeliveryOutcome; quoteAccessUrl?: string };
};

/** Only customer-agreed terms belong here. Changing staff notes or crew names
 * must not invalidate agreement; changing the work, price or timing must. */
export function customerAgreementSnapshot(lead: any, quoteId: string | null) {
  const plan = lead.jobPlanDetails || {};
  return {
    customer: [lead.firstName || "", lead.lastName || "", lead.email || "", lead.phone || ""],
    quoteId, total: cents(lead.totalPrice ?? lead.basePrice), service: lead.serviceType || "",
    from: lead.confirmedFromAddress || lead.fromAddress || "", to: lead.confirmedToAddress || lead.toAddress || "",
    date: lead.confirmedDate || "", window: lead.arrivalWindow || "",
    hours: Number(lead.confirmedHours || 0), crewSize: Number(lead.crewSize || 0),
    truck: lead.truckConfig || "", trailer: Boolean(lead.trailerRequested),
    scope: plan.workScope || "", customerNotes: customerNotesFromDetails(lead.details), additionalInterests: plan.projectIntake?.additionalServices || [], stairs: plan.stairsFlights || 0, elevator: Boolean(plan.hasElevator),
    specialItems: plan.specialItemsNotes || "", stops: plan.additionalStops || [],
  };
}

export function cents(value: unknown) { return Math.round((Number(value) || 0) * 100); }

export function quoteTerms(lead: any) { return customerAgreementSnapshot(lead, null); }

export function validServiceDate(value: unknown) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function workflowDetailsBlockers(lead: any): WorkflowBlocker[] {
  const result: WorkflowBlocker[] = [];
  if (!lead.firstName?.trim() || !lead.lastName?.trim()) result.push({ code: "customer_name", message: "Add the customer's name.", target: "customer", field: !lead.firstName?.trim() ? "setup-first-name" : "setup-last-name" });
  if (!lead.phone?.trim()) result.push({ code: "customer_phone", message: "Add a customer phone number.", target: "customer", field: "setup-phone" });
  if (!(lead.fromAddress || "").trim()) result.push({ code: "service_address", message: "Add the pickup or project address.", target: "details", field: "setup-from-address" });
  if (/(moving|residential|commercial|delivery)/i.test(lead.serviceType || "") && !lead.toAddress?.trim()) result.push({ code: "destination", message: "Add the destination for this job.", target: "details", field: "setup-to-address" });
  return result;
}

export function dispatchBlockers(lead: any, quote: WorkflowQuote, confirmed: boolean, fullRoster = true): WorkflowBlocker[] {
  const result = workflowDetailsBlockers(lead);
  if (lead.archivedAt || ["completed", "closed", "cancelled", "archived", "customer_approved", "payout_calculated", "payout_sent", "in_progress"].includes(lead.status)) result.push({ code: "dispatch_stage", message: "This job has already started or closed. Review its history instead of dispatching it again.", target: "details" });
  if (!quote.matches || !["approved", "sent"].includes(quote.status)) result.push({ code: "quote_approval", message: "Review and approve the current quote.", target: "quote" });
  if (!confirmed) result.push({ code: "customer_confirmation", message: "Record the customer's agreement to the current job details.", target: "confirmation" });
  if (!validServiceDate(lead.confirmedDate) || String(lead.confirmedDate).slice(0, 10) < businessDateString()) result.push({ code: "service_date", message: "Choose a current or future service date. Past jobs use closeout.", target: "schedule", field: "job-setup-schedule" });
  if (!lead.arrivalWindow || (!isHourlyJobArrivalWindow(lead.arrivalWindow) && !isLegacyJobArrivalWindow(lead.arrivalWindow))) result.push({ code: "arrival_window", message: "Choose a valid arrival window.", target: "schedule", field: "setup-arrival-window" });
  const end = String(lead.arrivalWindow || "").match(/[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (end && String(lead.confirmedDate).slice(0, 10) === businessDateString()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const endMinutes = (Number(end[1]) % 12 + (end[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(end[2]);
    if (Number(parts.hour) * 60 + Number(parts.minute) >= endMinutes) result.push({ code: "elapsed_window", message: "This arrival window has passed. Review the agreed schedule.", target: "schedule", field: "setup-arrival-window" });
  }
  const needed = Number(lead.crewSize || 0);
  const crew = new Set<string>((lead.crewMembers || []).filter(Boolean));
  if (needed < 1 || !Number.isInteger(needed) || (fullRoster && crew.size < needed)) result.push({ code: "crew_roster", message: "Select the full named crew for this job.", target: "crew", field: "setup-named-crew" });
  const fullPaid = Boolean(lead.paymentPaidAt);
  const depositSatisfied = lead.depositRequired && lead.depositPaid;
  const deferred = ["pay_on_completion", "cash_or_btc"].includes(lead.paymentPlan);
  // Existing documented deposit overrides do not bypass quote, agreement or schedule checks.
  const override = Boolean(lead.dispatchOverrideReason);
  if (!fullPaid && !(lead.depositRequired ? depositSatisfied || override : deferred || override || !fullRoster)) result.push({ code: "payment_required", message: lead.depositRequired ? "Record the required deposit before dispatch." : "Record payment or review the existing payment arrangement before dispatch.", target: "payment" });
  return result;
}

export function projectJobWorkflow(input: { lead: any; quote: WorkflowQuote; version: string; confirmationHash: string; capabilities: JobWorkflow["capabilities"]; delivery?: JobWorkflow["delivery"] }): JobWorkflow {
  const { lead, quote, capabilities } = input;
  const confirmation = lead.jobPlanDetails?.customerConfirmation;
  const current = Boolean(confirmation?.snapshotHash && confirmation.snapshotHash === input.confirmationHash && quote.matches && ["approved", "sent"].includes(quote.status));
  const blockers = dispatchBlockers(lead, quote, current);
  const selected = new Set<string>((lead.crewMembers || []).filter(Boolean));
  const accepted = new Set<string>((lead.acceptedByEmployees || []).filter((id: string) => selected.has(id)));
  const result: JobWorkflow = {
    version: input.version, stage: "details", label: "Details needed", nextAction: { key: "edit", label: "Complete job details", target: "customer" },
    blockers, quote, confirmation: { current, recordedAt: confirmation?.recordedAt, method: confirmation?.method },
    payment: { ready: !blockers.some(b => b.code === "payment_required"), label: lead.paymentPaidAt ? "Paid in full" : lead.depositPaid ? "Deposit recorded" : lead.paymentPlan === "pay_on_completion" ? "Pay on completion" : lead.paymentPlan === "cash_or_btc" ? "Cash on site" : "Payment pending" },
    crew: { needed: Number(lead.crewSize || 0), selected: selected.size, accepted: accepted.size }, capabilities, delivery: input.delivery,
  };
  const set = (stage: JobWorkflow["stage"], label: string, key: string, action: string, target?: RepairTarget) => Object.assign(result, { stage, label, nextAction: { key, label: action, target } });
  if (lead.archivedAt || ["closed", "cancelled", "archived"].includes(lead.status)) return set("closed", "Closed", "done", "View history");
  if (lead.completedAt || ["completed", "customer_approved", "payout_calculated", "payout_sent"].includes(lead.status)) return set("closeout", "Work completed", "closeout", "Review closeout");
  if (validServiceDate(lead.confirmedDate || lead.moveDate) && String(lead.confirmedDate || lead.moveDate).slice(0, 10) < businessDateString()) return set("closeout", "Past job", "closeout", "Review closeout");
  if (["in_progress", "dispatched", "accepted"].includes(lead.status)) return set("work", lead.status === "in_progress" ? "Work in progress" : "Crew dispatched", lead.status === "in_progress" ? "complete" : "start", lead.status === "in_progress" ? "Complete job" : "Start job");
  const details = workflowDetailsBlockers(lead);
  if (details.length) return set("details", "Details needed", "edit", "Complete job details", details[0].target);
  if (!quote.matches || !["approved", "sent"].includes(quote.status)) return set("quote", capabilities.approve ? "Quote review needed" : "Awaiting approval", "review", capabilities.approve ? "Review quote" : "View quote", "quote");
  if (!capabilities.manage) return set("confirmation", "Staff coordination pending", "done", "Awaiting staff coordination");
  if (!current) return set("confirmation", "Awaiting customer agreement", "confirm", "Record customer confirmation", "confirmation");
  if (blockers.length) return set("dispatch", "Finish dispatch setup", "fix", "Finish dispatch setup", blockers[0].target);
  return set("dispatch", "Ready to dispatch", "dispatch", "Dispatch crew");
}
