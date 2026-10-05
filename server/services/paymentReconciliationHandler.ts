import type { RequestHandler } from "express";
import type { getJobPaymentReconciliation } from "./jobPaymentReconciliation";

type ReadReport = typeof getJobPaymentReconciliation;
export function createPaymentReconciliationHandler(read: ReadReport = async (leadId) => {
  const { getJobPaymentReconciliation } = await import("./jobPaymentReconciliation");
  return getJobPaymentReconciliation(leadId);
}): RequestHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    // currentUser is populated by the existing authenticated admin middleware,
    // never by query parameters or request body.
    const role = (req as typeof req & { currentUser?: { role?: string } }).currentUser?.role;
    if (!role) { res.status(401).json({ error: "Authentication required" }); return; }
    if (role !== "admin" && role !== "business_owner") {
      res.status(403).json({ error: "Administrator access required" }); return;
    }
    const leadId = req.params.leadId;
    if (typeof leadId !== "string" || !leadId.trim() || leadId.length > 255) {
      res.status(400).json({ error: "Invalid job ID" }); return;
    }
    try {
      const report = await read(leadId);
      if (!report) { res.status(404).json({ error: "Job not found" }); return; }
      res.json(report);
    } catch {
      res.status(500).json({ error: "Payment reconciliation is unavailable" });
    }
  };
}
