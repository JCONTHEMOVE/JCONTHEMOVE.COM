export const WORKER_ORDER_TIERS = ["worker", "bronze", "silver", "gold", "platinum"] as const;

export type WorkerOrderTier = typeof WORKER_ORDER_TIERS[number];
export type WorkerOrderContext = "board" | "claimed" | "assigned" | "task" | "admin";

const TIER_RANK: Record<WorkerOrderTier, number> = {
  worker: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
};

export type WorkerOrderVisibility = {
  tier: WorkerOrderTier;
  context: WorkerOrderContext;
  customerIdentity: boolean;
  customerContact: boolean;
  exactLocation: boolean;
  jobScope: boolean;
  pricing: boolean;
  payment: boolean;
  privateOperations: boolean;
  locked: Array<{
    key: "customer_identity" | "customer_contact" | "exact_location" | "job_scope" | "pricing" | "payment" | "private_operations";
    label: string;
    unlockAt: string;
  }>;
};

export function normalizeWorkerOrderTier(value: unknown): WorkerOrderTier {
  const normalized = String(value || "").toLowerCase();
  return WORKER_ORDER_TIERS.includes(normalized as WorkerOrderTier)
    ? normalized as WorkerOrderTier
    : "worker";
}

export function generalizeWorkerOrderLocation(address: unknown): string | null {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(", ");
  return parts[0] || null;
}

export function getWorkerOrderVisibility(
  tierValue: unknown,
  context: WorkerOrderContext,
): WorkerOrderVisibility {
  const tier = normalizeWorkerOrderTier(tierValue);
  const rank = TIER_RANK[tier];
  const isAdmin = context === "admin";
  const isAssigned = context === "assigned";
  const isClaimed = context === "claimed";
  const isTask = context === "task";

  // Crew always receives the operational address and scope after assignment.
  // Customer identity/contact and financial data remain progressive authority
  // privileges; this keeps a new worker able to perform the job without giving
  // every account access to the full customer/order record.
  const customerIdentity = isAdmin || (isAssigned && rank >= TIER_RANK.bronze) || ((isTask || isClaimed) && rank >= TIER_RANK.silver);
  const customerContact = isAdmin || (isAssigned && rank >= TIER_RANK.silver) || ((isTask || isClaimed) && rank >= TIER_RANK.silver);
  const exactLocation = isAdmin || isAssigned || ((isTask || isClaimed) && rank >= TIER_RANK.silver);
  const jobScope = isAdmin || isAssigned || ((isTask || isClaimed) && rank >= TIER_RANK.silver);
  const pricing = isAdmin
    || ((isAssigned || isClaimed) && rank >= TIER_RANK.gold)
    || (isTask && rank >= TIER_RANK.silver);
  const payment = isAdmin
    || ((isAssigned || isClaimed) && rank >= TIER_RANK.platinum)
    || (isTask && rank >= TIER_RANK.gold);
  const privateOperations = isAdmin || (isAssigned && rank >= TIER_RANK.platinum);

  const locked: WorkerOrderVisibility["locked"] = [];
  if (!customerIdentity) locked.push({ key: "customer_identity", label: "Customer identity", unlockAt: context === "board" ? "after assignment at Bronze" : "Bronze" });
  if (!customerContact) locked.push({ key: "customer_contact", label: "Customer phone and email", unlockAt: context === "board" ? "after assignment at Silver" : "Silver" });
  if (!exactLocation) locked.push({ key: "exact_location", label: "Exact service addresses", unlockAt: context === "board" ? "after assignment" : "Silver or confirmed assignment" });
  if (!jobScope) locked.push({ key: "job_scope", label: "Private scope and photos", unlockAt: context === "board" ? "after assignment" : "Silver or confirmed assignment" });
  if (!pricing) locked.push({ key: "pricing", label: "Quote and order pricing", unlockAt: context === "task" ? "Silver" : "Gold" });
  if (!payment) locked.push({ key: "payment", label: "Payment and deposit details", unlockAt: context === "task" ? "Gold" : "Platinum" });
  if (!privateOperations) locked.push({ key: "private_operations", label: "Access and private dispatch notes", unlockAt: "Platinum" });

  return {
    tier,
    context,
    customerIdentity,
    customerContact,
    exactLocation,
    jobScope,
    pricing,
    payment,
    privateOperations,
    locked,
  };
}

function withoutRawAccessCiphertext<T extends Record<string, any>>(record: T) {
  const { accessInstructionsCiphertext: _ciphertext, ...safe } = record;
  return safe as Omit<T, "accessInstructionsCiphertext">;
}

function hiddenFlow(flow: any, visibility: WorkerOrderVisibility) {
  if (!flow || typeof flow !== "object") return flow;
  return {
    ...flow,
    operations: undefined,
    ...(visibility.pricing ? {} : { quote: { ready: false, sent: false } }),
    ...(visibility.payment ? {} : { payment: { key: "restricted", label: "Payment details restricted" } }),
    ...(visibility.payment ? {} : {
      payout: {
        state: "not_ready",
        label: "Personal earnings are shown separately",
        workerPayoutCount: 0,
        rewardsIssued: 0,
      },
    }),
  };
}

/**
 * Server-authoritative projection for an assigned crew order or an authority
 * task. Hidden values are removed/nullified before JSON serialization; the UI
 * receives only the visibility explanation, never the underlying raw values.
 */
export function projectWorkerOrder<T extends Record<string, any>>(
  record: T,
  tierValue: unknown,
  context: Exclude<WorkerOrderContext, "board">,
) {
  const visibility = getWorkerOrderVisibility(tierValue, context);
  if (context === "admin") {
    return { ...withoutRawAccessCiphertext(record), workerVisibility: visibility };
  }

  const result: Record<string, any> = {
    ...withoutRawAccessCiphertext(record),
    workerVisibility: visibility,
  };
  // Operational sharing links and staff agreement notes are never part of a
  // crew order, even when that worker can see the physical work scope.
  if (result.jobPlanDetails) {
    const { customerConfirmation, quoteDelivery, paymentReceipt, ...scope } = result.jobPlanDetails;
    result.jobPlanDetails = scope;
  }

  if (!visibility.customerIdentity) {
    result.firstName = null;
    result.lastName = null;
    result.customerName = null;
    result.name = null;
    result.title = `${String(record.serviceType || "Service").replace(/[-_]/g, " ")} order`;
  }
  if (!visibility.customerContact) {
    result.email = null;
    result.phone = null;
    result.customerEmail = null;
    result.customerPhone = null;
    result.smsConsent = null;
    result.smsConsentRecordedAt = null;
    result.smsConsentSource = null;
    result.smsConsentRecordedBy = null;
  }
  if (!visibility.exactLocation) {
    result.fromAddress = generalizeWorkerOrderLocation(record.confirmedFromAddress || record.fromAddress || record.address);
    result.address = result.fromAddress;
    result.confirmedFromAddress = null;
    result.toAddress = null;
    result.confirmedToAddress = null;
    result.lat = null;
    result.lng = null;
  }
  if (!visibility.jobScope) {
    result.details = null;
    result.notes = null;
    result.jobPlanDetails = null;
    result.photos = [];
  }
  if (!visibility.pricing) {
    for (const key of [
      "basePrice", "totalPrice", "price", "estimatedTotal", "quotedPrice",
      "orderLineItems", "quoteNotes", "quoteSnapshot", "zoneSnapshot",
      "promoCode", "selectedPackageId", "bundleDiscountAmount",
      "bundleDiscountReason", "jcmovesRewardBase", "tokenAllocation",
      "hotTubFee", "heavySafeFee", "poolTableFee", "pianoFee",
      "totalSpecialItemsFee", "squareOrderId",
    ]) result[key] = null;
  }
  if (!visibility.payment) {
    for (const key of [
      "paymentPlan", "paymentPaidAt", "squarePaymentUrl", "depositRequired",
      "depositAmount", "depositPaid", "appliedCreditNote", "redemptionId",
    ]) result[key] = null;
  }
  if (!visibility.privateOperations) {
    result.dispatchNotes = null;
    result.jobAccess = null;
  }
  result.flow = hiddenFlow(result.flow, visibility);
  return result;
}

/**
 * A strict allow-list for unassigned job-board cards. This prevents a newly
 * added lead column from accidentally exposing customer or financial data.
 */
export function projectCrewBoardOrder<T extends Record<string, any>>(
  record: T,
  tierValue: unknown,
  userId: string,
) {
  const visibility = getWorkerOrderVisibility(tierValue, "board");
  return {
    id: record.id,
    orderNumber: record.orderNumber ?? null,
    serviceType: record.serviceType,
    status: record.status,
    moveDate: record.moveDate ?? null,
    confirmedDate: record.confirmedDate ?? null,
    arrivalWindow: record.arrivalWindow ?? null,
    propertySize: record.propertySize ?? null,
    crewSize: record.crewSize ?? null,
    confirmedHours: record.confirmedHours ?? null,
    truckConfig: record.truckConfig ?? null,
    truckProvider: record.truckProvider ?? null,
    truckSize: record.truckSize ?? null,
    trailerRequested: Boolean(record.trailerRequested),
    urgency: record.urgency ?? "normal",
    createdAt: record.createdAt ?? null,
    fromAddress: generalizeWorkerOrderLocation(record.confirmedFromAddress || record.fromAddress || record.address),
    toAddress: null,
    price: null,
    details: null,
    flow: hiddenFlow(record.flow, visibility),
    alreadyApplied: Boolean(record.flow?.crew?.isClaimed && Array.isArray(record.crewMembers) && record.crewMembers.includes(userId)),
    crewSlotsFilled: Number(record.flow?.crew?.claimed || 0),
    workerVisibility: visibility,
  };
}
