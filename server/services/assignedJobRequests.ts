import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { leads, notifications, users } from "@shared/schema";
import type { db, DbTransaction } from "../db";

type AssignmentDatabase = Pick<typeof db, "select" | "transaction">;

export class AssignedJobRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
    isNull(leads.archivedAt),
    sql`${userId} = ANY(${leads.crewMembers})`,
    sql`NOT (${userId} = ANY(COALESCE(${leads.acceptedByEmployees}, ARRAY[]::text[])))`,
    inArray(leads.status, ["assigned", "open"]),
  )).orderBy(desc(leads.createdAt));
}

async function lockAssignment(tx: DbTransaction, leadId: string, userId: string) {
  // Read after acquiring the lock: parallel crew responses must preserve each
  // other's acceptance and roster changes, including replacement dispatch.
  const [lead] = await tx.select({
    id: leads.id,
    status: leads.status,
    archivedAt: leads.archivedAt,
    crewSize: leads.crewSize,
    crewMembers: leads.crewMembers,
    acceptedByEmployees: leads.acceptedByEmployees,
  }).from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead || lead.archivedAt) throw new AssignedJobRequestError(404, "Job not found");
  if (!(lead.crewMembers || []).includes(userId)) {
    throw new AssignedJobRequestError(403, "Not assigned to this job");
  }
  if (!["assigned", "open"].includes(lead.status)) {
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
    await tx.update(leads).set({
      crewMembers: remainingCrew,
      acceptedByEmployees: accepted,
      status: "open",
    }).where(eq(leads.id, leadId));
    await saveWorkerResponse(tx, leadId, userId, false);
    const crewSize = lead.crewSize || 1;
    if (remainingCrew.length < crewSize) {
      // The callback only performs database work using this transaction.
      await redispatch(tx, crewSize, remainingCrew);
    }
  });
}
