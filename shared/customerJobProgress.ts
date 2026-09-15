/** Payment and closeout review states are not evidence of service completion. */
export function customerJobProgress(job: {
  status: string;
  operationalStatus?: string | null;
  completedAt?: string | null;
}) {
  const status = job.status.toLowerCase();
  const operational = (job.operationalStatus || "").toLowerCase();
  if ([status, operational].some(value => ["cancelled", "canceled"].includes(value))) return null;
  if (status === "completed" || operational === "completed" || job.completedAt) {
    return { index: 3, serviceLabel: "Complete" };
  }
  if ([status, operational].some(value => ["in_progress", "on_site", "en_route"].includes(value))) {
    return { index: 3, serviceLabel: "In Progress" };
  }
  if ([status, operational].some(value => ["available", "confirmed", "accepted", "dispatched"].includes(value))) {
    return { index: 3, serviceLabel: "Confirmed" };
  }
  if (["quoted", "quote_sent", "invoice_sent", "paid"].includes(status)) {
    return { index: 2, serviceLabel: "Service" };
  }
  if (status === "under_review") return { index: 1, serviceLabel: "Service" };
  return { index: 0, serviceLabel: "Service" };
}
