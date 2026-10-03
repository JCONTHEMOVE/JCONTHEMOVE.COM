import { insightStage, type InsightJob } from './workInsights';

export type WorkerHomeJob = InsightJob & { createdAt?: string | null };

export function currentWork<T extends WorkerHomeJob>(jobs: readonly T[]): T[] {
  const seen = new Set<string>();
  return jobs.filter(job => {
    if (!job.id || seen.has(job.id) || job.archivedAt || ['finished', 'closed'].includes(insightStage(job)) || job.status === 'paid') return false;
    seen.add(job.id);
    return true;
  }).sort((a, b) => {
    const priority = (job: T) => insightStage(job) === 'working' ? 0 : insightStage(job) === 'quote' ? 1 : 2;
    return priority(a) - priority(b) || (serviceDay(a) || '9999').localeCompare(serviceDay(b) || '9999');
  });
}

export function serviceDay(job: WorkerHomeJob): string | null {
  for (const value of [job.flow?.schedule?.date, job.confirmedDate, job.moveDate]) {
    const day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const date = new Date(`${day}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day) return day;
  }
  return null;
}

export function chicagoMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}

export function workMonth(job: WorkerHomeJob): string | null {
  const day = serviceDay(job);
  if (day) return day.slice(0, 7);
  if (!job.createdAt) return null;
  const created = new Date(job.createdAt);
  return Number.isFinite(created.getTime()) ? chicagoMonth(created) : null;
}

export const monthlyStages = [
  { key: 'leads', label: 'Leads & quotes', color: 'bg-amber-400' },
  { key: 'scheduled', label: 'Scheduling & crew', color: 'bg-sky-400' },
  { key: 'working', label: 'In progress', color: 'bg-violet-400' },
  { key: 'finished', label: 'Finished', color: 'bg-emerald-400' },
  { key: 'other', label: 'Other active work', color: 'bg-zinc-400' },
] as const;
export type MonthlyStage = typeof monthlyStages[number]['key'];

export function monthlyStage(job: WorkerHomeJob): MonthlyStage {
  const stage = insightStage(job);
  if (job.status === 'paid' || stage === 'finished') return 'finished';
  if (stage === 'quote') return 'leads';
  if (stage === 'schedule' || stage === 'crew') return 'scheduled';
  if (stage === 'working') return 'working';
  return 'other';
}

export function monthlyWork(jobs: readonly WorkerHomeJob[], month: string) {
  const unique = new Map(jobs.map(job => [job.id, job]));
  const visible = [...unique.values()].filter(job => job.id && !job.archivedAt && insightStage(job) !== 'closed');
  return {
    jobs: visible.filter(job => workMonth(job) === month),
    undated: visible.filter(job => !workMonth(job)).length,
  };
}
