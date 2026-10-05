import assert from "node:assert/strict";
import { acquireJobDisbursementLock } from "../jobDisbursementLock";

function fixture(mode: "acquired" | "busy" | "acquire-error" | "unlock-error" | "not-held") {
  const calls: string[] = [];
  const releases: Array<Error | undefined> = [];
  const client = {
    query: async (sql: string, args: unknown[]) => {
      assert.deepEqual(args, [42]);
      calls.push(sql);
      if (sql.includes("pg_try")) {
        if (mode === "acquire-error") throw new Error("acquisition failed");
        return { rows: [{ acquired: mode !== "busy" }] };
      }
      if (mode === "unlock-error") throw new Error("connection lost");
      return { rows: [{ unlocked: mode !== "not-held" }] };
    },
    release: (error?: Error) => releases.push(error),
  };
  const pool = { connect: async () => client } as unknown as Parameters<typeof acquireJobDisbursementLock>[0];
  return { pool, calls, releases };
}

const owned = fixture("acquired");
const release = await acquireJobDisbursementLock(owned.pool, 42);
assert.ok(release);
assert.equal(owned.releases.length, 0, "connection remains checked out during work");
await release();
await release();
assert.equal(owned.calls.length, 2, "one acquisition and one unlock on the owned connection");
assert.deepEqual(owned.releases, [undefined]);
const busy = fixture("busy");
assert.equal(await acquireJobDisbursementLock(busy.pool, 42), null);
assert.deepEqual(busy.releases, [undefined]);
assert.equal(busy.calls.length, 1, "a caller without the lock must not unlock it");
const failed = fixture("acquire-error");
await assert.rejects(acquireJobDisbursementLock(failed.pool, 42), /acquisition failed/);
assert.ok(failed.releases[0] instanceof Error);
for (const mode of ["unlock-error", "not-held"] as const) {
  const broken = fixture(mode);
  const unlock = await acquireJobDisbursementLock(broken.pool, 42);
  assert.ok(unlock);
  if (mode === "unlock-error") await assert.rejects(unlock(), /connection lost/);
  else await unlock();
  await unlock();
  assert.equal(broken.releases.length, 1);
  assert.ok(broken.releases[0] instanceof Error, "uncertain connections must be discarded");
}
console.log("Disbursement lock connection ownership, contention and failure cleanup passed");
