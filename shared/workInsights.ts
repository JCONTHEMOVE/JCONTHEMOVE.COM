export type InsightAudience = 'owner' | 'crew';
export type InsightJob = {
  id: string;
  orderNumber?: string | number | null;
  serviceType?: string | null;
  status?: string | null;
  archivedAt?: unknown;
  moveDate?: string | null;
  confirmedDate?: string | null;
  arrivalWindow?: string | null;
  fromAddress?: string | null;
  confirmedFromAddress?: string | null;
  details?: string | null;
  phone?: string | null;
  email?: string | null;
  crewSize?: number | null;
  flow?: { stage?: string | null; schedule?: { date?: string | null; arrivalWindow?: string | null } } | null;
  workerVisibility?: {
    customerContact?: boolean;
    exactLocation?: boolean;
    jobScope?: boolean;
  };
};

export const insightStages = [
  { key: 'quote', label: 'Quote needed' },
  { key: 'schedule', label: 'Schedule needed' },
  { key: 'crew', label: 'Crew setup' },
  { key: 'working', label: 'In progress' },
  { key: 'finished', label: 'Work finished' },
  { key: 'closed', label: 'Closed / cancelled' },
  { key: 'other', label: 'Other status' },
] as const;
export type InsightStage = typeof insightStages[number]['key'];

export const informationChecks = [
  { key: 'date', label: 'Service date', instruction: 'Confirm and save the service date.' },
  { key: 'window', label: 'Arrival window', instruction: 'Confirm and save the arrival window.' },
  { key: 'address', label: 'Service address', instruction: 'Confirm the pickup or service address.' },
  { key: 'notes', label: 'Job notes', instruction: 'Record the scope, measurements, access needs, and any photo references.' },
  { key: 'contact', label: 'Customer contact', instruction: 'Check the customer phone or email already provided.' },
  { key: 'size', label: 'Crew size', instruction: 'Confirm how many movers the job needs.' },
] as const;
export type InformationKey = typeof informationChecks[number]['key'];

const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
function validDay(value: string | null | undefined): boolean {
  const day = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function insightStage(job: InsightJob): InsightStage {
  // Use the server's lifecycle, including completion with payout still pending.
  switch (job.flow?.stage) {
    case 'needs_quote': return 'quote';
    case 'needs_schedule': return 'schedule';
    case 'ready_to_open': case 'ready_for_crew': case 'crew_claimed':
    case 'awaiting_crew_acceptance': case 'ready_to_dispatch': return 'crew';
    case 'in_progress': return 'working';
    case 'payout_ready': case 'payout_pending': case 'completed': return 'finished';
    case 'closed': return 'closed';
  }
  // Older responses may not have flow. Unknown states stay visible.
  switch (job.status) {
    case 'new': case 'contacted': case 'quote_requested': case 'chatbot_pending':
    case 'pending_quote_approval': return 'quote';
    case 'available': case 'open': return 'crew';
    case 'in_progress': return 'working';
    case 'completed': return 'finished';
    case 'cancelled': case 'closed': case 'archived': return 'closed';
    default: return 'other';
  }
}

export function missingInformation(job: InsightJob, audience: InsightAudience): InformationKey[] {
  if (job.archivedAt || ['finished', 'closed'].includes(insightStage(job))) return [];
  const missing: InformationKey[] = [];
  if (!validDay(job.flow?.schedule?.date) && !validDay(job.confirmedDate) && !validDay(job.moveDate)) missing.push('date');
  if (!hasText(job.flow?.schedule?.arrivalWindow) && !hasText(job.arrivalWindow)) missing.push('window');
  const owner = audience === 'owner';
  // A redacted field is unknown, never an instruction to collect private data.
  if ((owner || job.workerVisibility?.exactLocation === true)
      && !hasText(job.confirmedFromAddress) && !hasText(job.fromAddress)) missing.push('address');
  if ((owner || job.workerVisibility?.jobScope === true) && !hasText(job.details)) missing.push('notes');
  if (owner && !hasText(job.phone) && !hasText(job.email)) missing.push('contact');
  if (owner && (!Number.isInteger(job.crewSize) || Number(job.crewSize) < 1)) missing.push('size');
  return missing;
}

export function summarizeWork(jobs: readonly InsightJob[], audience: InsightAudience) {
  const seen = new Set<string>();
  const records = jobs.filter(job => {
    if (!job.id || job.archivedAt || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  }).map(job => ({ job, stage: insightStage(job), missing: missingInformation(job, audience) }));
  const active = records.filter(record => !['finished', 'closed'].includes(record.stage));
  return {
    records,
    activeCount: active.length,
    needsInformation: active.filter(record => record.missing.length > 0).length,
    stages: insightStages.map(stage => ({ ...stage, count: records.filter(record => record.stage === stage.key).length })),
    checks: informationChecks.filter(check => audience === 'owner' || !['contact', 'size'].includes(check.key))
      .map(check => ({ ...check, count: active.filter(record => record.missing.includes(check.key)).length })),
  };
}
