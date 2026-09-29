import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { leads } from "@shared/schema";
import { serviceDay } from "@shared/workerHome";
import { buildJobFlow } from "@shared/job-flow";
import { projectJobWorkflow } from "@shared/job-workflow";
import {
  acceptAssignedJob,
  AssignedJobRequestError,
  declineAssignedJob,
  listPendingJobRequests,
} from "../assignedJobRequests";
import { projectWorkerOrder } from "../workerOrderVisibility";

// Exercise the production Drizzle queries against isolated PostgreSQL fixtures.
// No application database or outbound notification provider is imported.
const pg = new PGlite();
const database = drizzle(pg) as unknown as Parameters<typeof acceptAssignedJob>[0];
const query = (text: string, values: any[] = []) => pg.query<any>(text, values);
const seed = async (id: string, options: { status?: string; crew?: string[]; accepted?: string[] | null; archived?: boolean; date?: string | null; notice?: false | "crew_assigned" | "crew_plan_saved" } = {}) => {
  await query(`INSERT INTO leads(id,service_type,status,confirmed_date,move_date,arrival_window,from_address,details,base_price,crew_size,crew_members,accepted_by_employees,archived_at)
    VALUES($1,'junk',$2,$3,'2099-10-01','9 AM - noon','123 Main St, Ironwood, MI','Pickup two chairs',150,3,$4,$5,$6)`,
  [id, options.status || "assigned", options.date === undefined ? "2099-10-02" : options.date,
    options.crew || ["worker-a", "worker-b", "owner"], options.accepted === undefined ? [] : options.accepted,
    options.archived ? new Date() : null]);
  for (const userId of options.notice === false ? [] : options.crew || ["worker-a", "worker-b", "owner"]) {
    await query("INSERT INTO notifications(user_id,type,data) VALUES($1,'job_assigned',$2)", [userId, { leadId: id, ...(options.notice ? { type: options.notice } : {}) }]);
  }
};
const job = async (id: string) => (await query("SELECT * FROM leads WHERE id=$1", [id])).rows[0];
const state = async (id: string, userId: string) => ({
  job: await job(id),
  user: (await query("SELECT * FROM users WHERE id=$1", [userId])).rows[0],
  notification: (await query("SELECT * FROM notifications WHERE user_id=$1 AND data->>'leadId'=$2", [userId, id])).rows[0],
});
const rejects = (work: () => Promise<unknown>, status: number) => assert.rejects(work, error => error instanceof AssignedJobRequestError && error.status === status);
let dispatchCalls = 0;
const redispatch: Parameters<typeof declineAssignedJob>[3] = async (tx, crewSize, remainingCrew) => {
  dispatchCalls++;
  const replacement = ["replacement-a", "replacement-b"].find(id => !remainingCrew.includes(id))!;
  const crew = [...remainingCrew, replacement];
  await tx.update(leads).set({ crewMembers: crew, status: crew.length >= crewSize ? "assigned" : "open" }).where(eq(leads.id, "decline"));
};

try {
  await pg.exec(`
    CREATE TABLE users(id varchar PRIMARY KEY,is_available boolean DEFAULT true);
    INSERT INTO users(id) VALUES('worker-a'),('worker-b'),('owner'),('outsider'),('replacement-a'),('replacement-b');
    CREATE TABLE leads(id varchar PRIMARY KEY,order_number serial,service_type text,status text,confirmed_date text,move_date text,
      arrival_window text,from_address text,details text,base_price numeric,crew_size int,crew_members text[],accepted_by_employees text[],
      created_at timestamp DEFAULT now(),archived_at timestamp,completed_at timestamp,en_route_at timestamp,on_site_at timestamp,
      dispatch_sent_at timestamp,dispatch_state text DEFAULT 'pending',dispatch_offered_to varchar,dispatch_offer_expires_at timestamp,
      assigned_to_user_id varchar,crew_lead_user_id varchar,driver_user_id varchar,
      quote_snapshot jsonb DEFAULT '{"quote":"preserve"}',job_plan_details jsonb DEFAULT '{"customerConfirmation":{"snapshotHash":"confirmed"}}',
      payment_paid_at timestamp,deposit_paid boolean DEFAULT true,dispatch_notes text DEFAULT 'Keep gate instructions');
    CREATE TABLE notifications(id serial,user_id varchar,type text,data jsonb,read boolean DEFAULT false);
  `);
  await seed("scheduled");
  await seed("null-acceptance", { accepted: null, status: "open", date: null });
  await seed("archived", { archived: true });
  await seed("accepted", { accepted: ["worker-a", "owner"] });
  await seed("other-crew", { crew: ["outsider"] });
  for (const status of ["in_progress", "completed", "cancelled", "paid", "closed"]) await seed(status, { status });
  for (const status of ["open", "new", "available"]) {
    await seed(`claim-${status}`, { status, notice: false });
    await seed(`tentative-${status}`, { status, notice: "crew_plan_saved" });
    await seed(`legacy-${status}`, { status });
  }
  await seed("explicit-offer", { status: "open", notice: "crew_assigned" });
  await seed("teammate-offer", { status: "open", notice: false });
  await query("INSERT INTO notifications(user_id,type,data) VALUES('worker-b','job_assigned','{\"leadId\":\"teammate-offer\"}')");
  for (const marker of ["completed_at", "en_route_at", "on_site_at"]) {
    await seed(`stale-${marker}`);
    await pg.exec(`UPDATE leads SET ${marker}=NOW() WHERE id='stale-${marker}'`);
  }
  for (const dispatchState of ["offering", "en_route", "on_site", "in_progress", "completed"]) {
    await seed(`dispatch-${dispatchState}`);
    await query("UPDATE leads SET dispatch_state=$2 WHERE id=$1", [`dispatch-${dispatchState}`, dispatchState]);
  }

  for (const userId of ["worker-a", "owner"]) {
    const pending = await listPendingJobRequests(database, userId);
    assert.deepEqual(pending.map(row => row.id).sort(), ["explicit-offer", "legacy-available", "legacy-new", "legacy-open", "null-acceptance", "scheduled"]);
    const scheduled = pending.find(row => row.id === "scheduled")!;
    assert.equal(scheduled.orderNumber, (await job("scheduled")).order_number);
    assert.equal(scheduled.confirmedDate, "2099-10-02");
    assert.equal(scheduled.moveDate, "2099-10-01");
    assert.equal(scheduled.arrivalWindow, "9 AM - noon");
    assert.equal(serviceDay(scheduled as any), "2099-10-02");
    assert.equal(serviceDay(pending.find(row => row.id === "null-acceptance") as any), "2099-10-01");
    const restricted = projectWorkerOrder(scheduled, "worker", "assigned");
    assert.equal(restricted.basePrice, null, "request metadata must not unlock worker pricing");
    assert.equal(restricted.fromAddress, scheduled.fromAddress, "assigned crew keep operational location");
    assert.equal(projectWorkerOrder(scheduled, "platinum", "assigned").basePrice, "150");
  }
  console.log("Pending requests retain order/schedule fields and exclude archived, accepted, terminal, and unrelated jobs.");

  // Stale responses leave the entire job, availability and notification untouched.
  for (const id of ["archived", "in_progress", "completed", "cancelled", "paid", "closed"]) {
    const before = await state(id, "worker-a");
    const status = id === "archived" ? 404 : 409;
    await rejects(() => acceptAssignedJob(database, id, "worker-a"), status);
    await rejects(() => declineAssignedJob(database, id, "worker-a", redispatch), status);
    assert.deepEqual(await state(id, "worker-a"), before);
  }
  await rejects(() => acceptAssignedJob(database, "missing", "worker-a"), 404);
  await rejects(() => acceptAssignedJob(database, "scheduled", "outsider"), 403);
  await rejects(() => declineAssignedJob(database, "scheduled", "outsider", redispatch), 403);
  assert.equal(dispatchCalls, 0);
  for (const id of ["claim-open", "claim-new", "claim-available", "tentative-open", "tentative-new", "tentative-available", "teammate-offer",
    "stale-completed_at", "stale-en_route_at", "stale-on_site_at", "dispatch-offering", "dispatch-en_route", "dispatch-on_site", "dispatch-in_progress", "dispatch-completed"]) {
    const before = await state(id, "worker-a");
    await rejects(() => acceptAssignedJob(database, id, "worker-a"), 409);
    await rejects(() => declineAssignedJob(database, id, "worker-a", redispatch), 409);
    assert.deepEqual(await state(id, "worker-a"), before);
  }
  for (const id of ["legacy-open", "legacy-new", "legacy-available", "explicit-offer"]) {
    assert.equal(await acceptAssignedJob(database, id, "worker-a"), true, "legacy explicit assignment remains actionable");
  }

  const workflowLead = (row: any) => ({
    id: row.id, status: row.status, archivedAt: row.archived_at, completedAt: row.completed_at,
    firstName: "Test", lastName: "Customer", email: "customer@example.test", phone: "9065550123",
    serviceType: row.service_type, fromAddress: row.from_address, details: row.details,
    confirmedDate: row.confirmed_date, arrivalWindow: "9:00 AM - 11:00 AM", confirmedHours: 2,
    basePrice: row.base_price, totalPrice: row.base_price, crewSize: row.crew_size,
    crewMembers: row.crew_members, acceptedByEmployees: row.accepted_by_employees,
    dispatchSentAt: row.dispatch_sent_at, dispatchState: row.dispatch_state,
    jobPlanDetails: row.job_plan_details, paymentPaidAt: row.payment_paid_at, depositPaid: row.deposit_paid,
  });
  await seed("guided-accept", { status: "dispatched", accepted: ["worker-b", "owner"], notice: false });
  await query("UPDATE leads SET dispatch_sent_at=NOW() WHERE id='guided-accept'");
  assert.equal(buildJobFlow(workflowLead(await job("guided-accept"))).stage, "awaiting_crew_acceptance");
  assert.ok((await listPendingJobRequests(database, "worker-a")).some(row => row.id === "guided-accept"), "guided dispatch is actionable even before notification delivery");
  assert.equal(await acceptAssignedJob(database, "guided-accept", "worker-a"), true);
  assert.equal(buildJobFlow(workflowLead(await job("guided-accept"))).crew.accepted, 3);

  await seed("guided-decline", { status: "dispatched", accepted: ["owner"] });
  await query(`UPDATE leads SET dispatch_sent_at=NOW(),dispatch_state='assigned',payment_paid_at=NOW(),
    assigned_to_user_id='worker-a',crew_lead_user_id='owner',driver_user_id='worker-a' WHERE id='guided-decline'`);
  const guidedBefore = await job("guided-decline");
  assert.deepEqual(await declineAssignedJob(database, "guided-decline", "worker-a", redispatch), { needsCrewReview: true });
  const guidedAfter = await job("guided-decline");
  assert.equal(dispatchCalls, 0, "guided dispatch must not enter legacy automatic replacement");
  assert.equal(guidedAfter.status, "quoted", "owner must review roster before starting again");
  assert.equal(guidedAfter.dispatch_state, "failed", "manual-stop state excludes the automatic pending retry loop");
  assert.equal(guidedAfter.dispatch_sent_at, null);
  assert.deepEqual(guidedAfter.crew_members, ["worker-b", "owner"]);
  assert.deepEqual(guidedAfter.accepted_by_employees, ["owner"]);
  assert.equal(guidedAfter.assigned_to_user_id, null);
  assert.equal(guidedAfter.driver_user_id, null);
  assert.equal(guidedAfter.crew_lead_user_id, "owner");
  for (const key of ["quote_snapshot", "job_plan_details", "payment_paid_at", "deposit_paid", "base_price", "confirmed_date", "arrival_window", "dispatch_notes"]) {
    assert.deepEqual(guidedAfter[key], guidedBefore[key], `${key} survives crew review`);
  }
  const reviewedWorkflow = projectJobWorkflow({
    lead: workflowLead(guidedAfter), version: "test", confirmationHash: "confirmed", capabilities: { approve: true, manage: true, sms: false },
    quote: { id: "quote", revision: 1, status: "approved", total: 150, subtotal: 150, discount: 0,
      lines: [{ name: "Junk removal", quantity: 1, unitPrice: 150, total: 150 }], requiresOwner: false, reasons: [], matches: true },
  });
  assert.ok(reviewedWorkflow.blockers.some(blocker => blocker.code === "crew_roster"));
  assert.equal(reviewedWorkflow.stage, "dispatch", "the remaining crew cannot start an incomplete guided plan");
  assert.equal(reviewedWorkflow.nextAction.target, "crew", "the owner is directed to repair the roster");
  assert.ok(!(await listPendingJobRequests(database, "worker-b")).some(row => row.id === "guided-decline"), "remaining pending crew wait for reviewed redispatch");
  await rejects(() => acceptAssignedJob(database, "guided-decline", "worker-b"), 409);
  console.log("Guided dispatch accepts responses; provisional claims stay pending owner review; guided declines preserve the paid plan for replacement review.");

  // PGlite queues transactions on its single connection. Overlapping calls
  // exercise the locked read/modify/write path without any lost array entries.
  await seed("accept");
  assert.deepEqual(await Promise.all([
    acceptAssignedJob(database, "accept", "worker-a"),
    acceptAssignedJob(database, "accept", "worker-b"),
    acceptAssignedJob(database, "accept", "owner"),
  ]), [true, true, true]);
  assert.deepEqual((await job("accept")).accepted_by_employees.sort(), ["owner", "worker-a", "worker-b"]);
  assert.equal(await acceptAssignedJob(database, "accept", "worker-a"), false, "duplicate acceptance is idempotent");
  const acceptedState = await state("accept", "worker-a");
  assert.equal(acceptedState.user.is_available, false);
  assert.equal(acceptedState.notification.read, true);
  assert.equal((await state("scheduled", "worker-a")).notification.read, false, "other job notifications stay unread");
  await rejects(() => declineAssignedJob(database, "accept", "worker-a", redispatch), 409);
  assert.deepEqual(await state("accept", "worker-a"), acceptedState, "a stale decline cannot undo acceptance");
  assert.equal((await listPendingJobRequests(database, "worker-a")).some(row => row.id === "accept"), false);

  await seed("decline", { accepted: ["owner"] });
  await Promise.all([
    declineAssignedJob(database, "decline", "worker-a", redispatch),
    declineAssignedJob(database, "decline", "worker-b", redispatch),
  ]);
  const declined = await job("decline");
  assert.deepEqual(declined.crew_members.sort(), ["owner", "replacement-a", "replacement-b"]);
  assert.deepEqual(declined.accepted_by_employees, ["owner"], "remaining crew acceptance is preserved");
  assert.equal(declined.status, "assigned");
  assert.equal(dispatchCalls, 2);
  await rejects(() => declineAssignedJob(database, "decline", "worker-a", redispatch), 403);
  assert.equal(dispatchCalls, 2, "duplicate declines cannot dispatch again");
  assert.equal((await state("decline", "worker-a")).user.is_available, true);
  assert.equal((await state("decline", "worker-a")).notification.read, true);
  assert.equal((await listPendingJobRequests(database, "worker-a")).some(row => row.id === "decline"), false);

  await seed("rollback");
  const beforeFailure = await state("rollback", "owner");
  await assert.rejects(() => declineAssignedJob(database, "rollback", "owner", async (tx) => {
    await tx.update(leads).set({ crewMembers: ["replacement-a"] }).where(eq(leads.id, "rollback"));
    throw new Error("injected dispatch failure");
  }), /injected dispatch failure/);
  assert.deepEqual(await state("rollback", "owner"), beforeFailure, "a failed redispatch rolls back roster, availability and notification");
  console.log("Assignment responses preserve concurrent crew changes, reject stale requests, and roll back failed dispatch.");
} finally {
  await pg.close();
}
