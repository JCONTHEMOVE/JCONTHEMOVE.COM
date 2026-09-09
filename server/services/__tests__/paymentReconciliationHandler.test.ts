import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { createPaymentReconciliationHandler } from "../paymentReconciliationHandler";

let reads = 0;
const app = express();
// Identity injection belongs only to this isolated test app. Production uses
// isAuthenticated + requireAdmin and ignores this test header entirely.
app.get("/report/:leadId", (req, _res, next) => {
  const role = req.headers["x-test-role"];
  if (typeof role === "string") (req as any).currentUser = { role };
  next();
}, createPaymentReconciliationHandler(async (id) => {
  reads++;
  if (id === "missing") return null;
  if (id === "failure") throw new Error("private database detail");
  return { enabled: false as const };
}));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const request = (id: string, role?: string) => fetch(`http://127.0.0.1:${address.port}/report/${id}`, {
  headers: role ? { "x-test-role": role } : {},
});
try {
  assert.equal((await request("job")).status, 401);
  for (const role of ["employee", "customer", "owner", "unknown"]) assert.equal((await request("job", role)).status, 403);
  assert.equal(reads, 0);
  for (const role of ["admin", "business_owner"]) {
    const response = await request("job", role);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { enabled: false });
  }
  assert.equal((await request("x".repeat(256), "admin")).status, 400);
  assert.equal(reads, 2);
  assert.equal((await request("missing", "admin")).status, 404);
  const failure = await request("failure", "admin");
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "Payment reconciliation is unavailable" });
  console.log("Reconciliation HTTP role boundaries, validation, no-store and safe errors passed");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
