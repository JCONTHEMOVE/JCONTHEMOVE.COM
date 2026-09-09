import assert from "node:assert/strict";
import { pool } from "../../db";
import { grantWalletCreditForSource } from "../bundleBilling";

// Exercise the actual service's failure/retry contract with an isolated
// transactional stub. No provider calls or database connections are made.
const originalQuery = pool.query;
const originalConnect = pool.connect;
const statuses = new Map([["first", "pending"], ["second", "pending"]]);
const committed: string[] = [];
let failSecond = true;
let rollbacks = 0;
let releases = 0;
(pool as any).query = async () => ({ rows: [...statuses].map(([id, status]) => ({
  id, status, addon_id: "test-addon", amount_usd: "10.00", currency: "JCMOVES_USD",
  customer_email: null, customer_phone: null,
})) });
(pool as any).connect = async () => {
  let pendingId: string | undefined;
  return {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes("FOR UPDATE")) return { rows: [{ status: statuses.get(String(args[0])) }] };
      if (sql.includes("UPDATE wallet_credit_grants")) {
        pendingId = String(args[3]);
        if (pendingId === "second" && failSecond) throw new Error("injected grant failure");
      }
      if (sql === "COMMIT" && pendingId) {
        statuses.set(pendingId, "granted");
        committed.push(pendingId);
      }
      if (sql === "ROLLBACK") { pendingId = undefined; rollbacks++; }
      return { rows: [] };
    },
    release: () => { releases++; },
  };
};
try {
  const args = { sourceType: "lead" as const, sourceId: "test-only", paymentReference: "test-invoice" };
  await assert.rejects(grantWalletCreditForSource(args), /injected grant failure/);
  assert.deepEqual(committed, ["first"]);
  assert.equal(statuses.get("second"), "pending");
  assert.equal(rollbacks, 1);
  assert.equal(releases, 2);
  failSecond = false;
  const retried = await grantWalletCreditForSource(args);
  assert.deepEqual(retried.map((grant) => grant.grantId), ["second"]);
  assert.deepEqual(committed, ["first", "second"]);
  assert.deepEqual(await grantWalletCreditForSource(args), []);
  assert.equal(releases, 3);
  console.log("Shop-card grant failure propagation and retry passed");
} finally {
  pool.query = originalQuery;
  pool.connect = originalConnect;
}
