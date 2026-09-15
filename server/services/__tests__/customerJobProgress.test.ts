import assert from "node:assert/strict";
import { customerJobProgress } from "../../../shared/customerJobProgress";

// Completion survives a stale operational state; it never asserts payment.
assert.deepEqual(customerJobProgress({ status: "completed", operationalStatus: "pending" }), { index: 3, serviceLabel: "Complete" });
// Paying before the move must not mark service complete.
assert.deepEqual(customerJobProgress({ status: "paid" }), { index: 2, serviceLabel: "Service" });
assert.deepEqual(customerJobProgress({ status: "paid", operationalStatus: "en_route" }), { index: 3, serviceLabel: "In Progress" });
// Closeout/payment review must not obscure independent completion evidence.
for (const status of ["balance_due", "awaiting_customer", "owner_review", "refund_review"]) {
  assert.deepEqual(customerJobProgress({ status, completedAt: "2026-09-15T12:00:00Z" }), { index: 3, serviceLabel: "Complete" });
}
assert.deepEqual(customerJobProgress({ status: "new", operationalStatus: "dispatched" }), { index: 3, serviceLabel: "Confirmed" });
assert.deepEqual(customerJobProgress({ status: "confirmed", operationalStatus: "on_site" }), { index: 3, serviceLabel: "In Progress" });
assert.deepEqual(customerJobProgress({ status: "quoted" }), { index: 2, serviceLabel: "Service" });
assert.deepEqual(customerJobProgress({ status: "new" }), { index: 0, serviceLabel: "Service" });
assert.equal(customerJobProgress({ status: "cancelled", completedAt: "2026-09-15" }), null);
assert.equal(customerJobProgress({ status: "new", operationalStatus: "canceled" }), null);
console.log("Customer service progress regression checks passed");
