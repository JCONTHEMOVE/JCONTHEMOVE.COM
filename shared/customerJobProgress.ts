/** Service progress must not imply that a deposit or completed job is fully paid. */
export function customerJobProgress(job: {
  status: string; operationalStatus?: string | null; completedAt?: string | null;
}) {
  const status=job.status.toLowerCase();
  const operational=(job.operationalStatus || '').toLowerCase();
  if (status==='cancelled' || status==='canceled') return null;
  if (status==='completed' || operational==='completed' || job.completedAt) return {index:3,serviceLabel:'Complete'};
  if (['in_progress','on_site','en_route'].includes(status) || ['in_progress','on_site','en_route','dispatched'].includes(operational)) {
    return {index:3,serviceLabel:'In Progress'};
  }
  if (['available','confirmed','accepted','dispatched'].includes(status)) return {index:3,serviceLabel:'Confirmed'};
  if (['quoted','quote_sent','invoice_sent','paid'].includes(status)) return {index:2,serviceLabel:'Service'};
  if (status==='under_review') return {index:1,serviceLabel:'Service'};
  return {index:0,serviceLabel:'Service'};
}
