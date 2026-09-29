import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { leads } from "@shared/schema";
import { serviceDay } from "@shared/workerHome";
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
const seed = async (id: string, options: { status?: string; crew?: string[]; accepted?: string[] | null; archived?: boolean; date?: string | null } = {}) => {
  await query(`INSERT INTO leads(id,service_type,status,confirmed_date,move_date,arrival_window,from_address,details,base_price,crew_size,crew_members,accepted_by_employees,archived_at)
    VALUES($1,'junk',$2,$3,'2099-10-01','9 AM - noon','123 Main St, Ironwood, MI','Pickup two chairs',150,3,$4,$5,$6)`,
  [id, options.status || "assigned", options.date === undefined ? "2099-10-02" : options.date,
    options.crew || ["worker-a", "worker-b", "owner"], options.accepted === undefined ? [] : options.accepted,
    options.archived ? new Date() : null]);
  for (const userId of options.crew || ["worker-a", "worker-b", "owner"]) {
    await query("INSERT INTO notifications(user_id,data) VALUES($1,$2)", [userId, { leadId: id }]);
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
      created_at timestamp DEFAULT now(),archived_at timestamp);
    CREATE TABLE notifications(id serial,user_id varchar,data jsonb,read boolean DEFAULT false);
  `);
  await seed("scheduled");
  await seed("null-acceptance", { accepted: null, status: "open", date: null });
  await seed("archived", { archived: true });
  await seed("accepted", { accepted: ["worker-a", "owner"] });
  await seed("other-crew", { crew: ["outsider"] });
  for (const status of ["in_progress", "completed", "cancelled", "paid", "closed"]) await seed(status, { status });

  for (const userId of ["worker-a", "owner"]) {
    const pending = await listPendingJobRequests(database, userId);
    assert.deepEqual(pending.map(row => row.id).sort(), ["null-acceptance", "scheduled"]);
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
