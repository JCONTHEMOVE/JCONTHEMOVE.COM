import { and, desc, eq, sql } from "drizzle-orm";
import { leads, notifications, users } from "@shared/schema";
import type { db, DbTransaction } from "../db";

type AssignmentDatabase = Pick<typeof db, "select" | "transaction">;

export class AssignedJobRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function assignmentResponseEligible(userId: string) {
  // A board claim only adds crewMembers. Legacy dispatch additionally records
  // a job_assigned notification; tentative crew-plan notices are not offers.
  // Guided dispatch records its explicit lifecycle state before notifying.
  return sql<boolean>`
    ${leads.archivedAt} IS NULL
    AND ${leads.completedAt} IS NULL
    AND ${leads.enRouteAt} IS NULL
    AND ${leads.onSiteAt} IS NULL
    AND COALESCE(${leads.dispatchState}, 'pending') NOT IN ('offering', 'en_route', 'on_site', 'in_progress', 'completed')
    AND (
      ${leads.status} IN ('assigned', 'dispatched')
      OR (${leads.status} IN ('open', 'new', 'available') AND EXISTS (
        SELECT 1 FROM ${notifications} AS assignment_notice
        WHERE assignment_notice.user_id = ${userId}
          AND assignment_notice.type = 'job_assigned'
          AND assignment_notice.data->>'leadId' = "leads"."id"
          AND COALESCE(assignment_notice.data->>'type', 'crew_assigned') = 'crew_assigned'
      ))
    )`;
}

export function listPendingJobRequests(database: AssignmentDatabase, userId: string) {
  return database.select({
    id: leads.id,
    orderNumber: leads.orderNumber,
    serviceType: leads.serviceType,
    status: leads.status,
    confirmedDate: leads.confirmedDate,
    moveDate: leads.moveDate,
    arrivalWindow: leads.arrivalWindow,
    fromAddress: leads.fromAddress,
    details: leads.details,
    basePrice: leads.basePrice,
    crewSize: leads.crewSize,
    crewMembers: leads.crewMembers,
    acceptedByEmployees: leads.acceptedByEmployees,
    createdAt: leads.createdAt,
    archivedAt: leads.archivedAt,
  }).from(leads).where(and(
    assignmentResponseEligible(userId),
    sql`${userId} = ANY(${leads.crewMembers})`,
    sql`NOT (${userId} = ANY(COALESCE(${leads.acceptedByEmployees}, ARRAY[]::text[])))`,
  )).orderBy(desc(leads.createdAt));
}

async function lockAssignment(tx: DbTransaction, leadId: string, userId: string) {
  // Read after acquiring the lock: parallel crew responses must preserve each
  // other's acceptance and roster changes, including replacement dispatch.
  const [lead] = await tx.select({
    id: leads.id,
    status: leads.status,
    dispatchSentAt: leads.dispatchSentAt,
    archivedAt: leads.archivedAt,
    crewSize: leads.crewSize,
    crewMembers: leads.crewMembers,
    acceptedByEmployees: leads.acceptedByEmployees,
    canRespond: assignmentResponseEligible(userId),
  }).from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead || lead.archivedAt) throw new AssignedJobRequestError(404, "Job not found");
  if (!(lead.crewMembers || []).includes(userId)) {
    throw new AssignedJobRequestError(403, "Not assigned to this job");
  }
  if (!lead.canRespond) {
    throw new AssignedJobRequestError(409, "This job is no longer awaiting a response");
  }
  return lead;
}

async function saveWorkerResponse(tx: DbTransaction, leadId: string, userId: string, accepted: boolean) {
  await tx.update(users).set({ isAvailable: !accepted }).where(eq(users.id, userId));
  await tx.update(notifications).set({ read: true }).where(and(
    eq(notifications.userId, userId),
    sql`${notifications.data}->>'leadId' = ${leadId}`,
  ));
}

export function acceptAssignedJob(database: AssignmentDatabase, leadId: string, userId: string) {
  return database.transaction(async tx => {
    const lead = await lockAssignment(tx, leadId, userId);
    const accepted = lead.acceptedByEmployees || [];
    const changed = !accepted.includes(userId);
    if (changed) {
      await tx.update(leads).set({ acceptedByEmployees: [...accepted, userId] }).where(eq(leads.id, leadId));
    }
    await saveWorkerResponse(tx, leadId, userId, true);
    return changed;
  });
}

export function declineAssignedJob(
  database: AssignmentDatabase,
  leadId: string,
  userId: string,
  redispatch: (tx: DbTransaction, crewSize: number, remainingCrew: string[]) => Promise<unknown>,
) {
  return database.transaction(async tx => {
    const lead = await lockAssignment(tx, leadId, userId);
    const accepted = lead.acceptedByEmployees || [];
    if (accepted.includes(userId)) {
      throw new AssignedJobRequestError(409, "You have already accepted this job");
    }
    const remainingCrew = (lead.crewMembers || []).filter(id => id !== userId);
    const needsCrewReview = lead.status === "dispatched" || Boolean(lead.dispatchSentAt);
    await tx.update(leads).set({
      crewMembers: remainingCrew,
      acceptedByEmployees: accepted,
      // A guided plan must return to owner review without reopening dispatch
      // automatically. Quoted blocks a stale start while retaining the quote,
      // customer agreement, schedule, and payment for the replacement roster.
      status: needsCrewReview ? "quoted" : "open",
      ...(needsCrewReview ? {
        dispatchSentAt: null,
        dispatchState: "failed", // existing manual-stop state; pending would trigger the retry loop
        dispatchOfferedTo: null,
        dispatchOfferExpiresAt: null,
        assignedToUserId: sql`CASE WHEN ${leads.assignedToUserId} = ${userId} THEN NULL ELSE ${leads.assignedToUserId} END`,
        crewLeadUserId: sql`CASE WHEN ${leads.crewLeadUserId} = ${userId} THEN NULL ELSE ${leads.crewLeadUserId} END`,
        driverUserId: sql`CASE WHEN ${leads.driverUserId} = ${userId} THEN NULL ELSE ${leads.driverUserId} END`,
      } : {}),
    }).where(eq(leads.id, leadId));
    await saveWorkerResponse(tx, leadId, userId, false);
    const crewSize = lead.crewSize || 1;
    if (!needsCrewReview && remainingCrew.length < crewSize) {
      // The callback only performs database work using this transaction.
      await redispatch(tx, crewSize, remainingCrew);
    }
    return { needsCrewReview };
  });
}
