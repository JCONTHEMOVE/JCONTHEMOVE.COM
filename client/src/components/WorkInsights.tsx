import { useId, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { informationChecks, insightStages, summarizeWork, type InsightAudience, type InsightJob, type InsightStage, type InformationKey } from '@shared/workInsights';

type Props = {
  jobs?: readonly InsightJob[];
  audience: InsightAudience;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  updatedAt?: number;
  onRefresh: () => void;
};
type Selection = { kind: 'all' } | { kind: 'missing' } | { kind: 'stage'; key: InsightStage } | { kind: 'check'; key: InformationKey };
const control = 'min-h-11 rounded-lg px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300';

function ChartBar({ label, count, total, selected, onClick, controls, color }: {
  label: string; count: number; total: number; selected: boolean; onClick: () => void; controls: string; color: string;
}) {
  return <button type="button" onClick={onClick} aria-pressed={selected} aria-controls={controls}
    aria-label={`${label}: ${count} ${count === 1 ? 'job' : 'jobs'}`}
    className={`${control} w-full text-left ${selected ? 'bg-slate-700 text-white' : 'text-slate-200 hover:bg-slate-800'}`}>
    <span className="mb-2 flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{count}</span></span>
    <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-slate-800">
      <span className={`block h-full rounded-full ${color} motion-safe:transition-[width] motion-safe:duration-300`} style={{ width: `${total > 0 ? count / total * 100 : 0}%` }} />
    </span>
  </button>;
}

export function WorkInsights({ jobs, audience, isLoading, isError, isFetching, updatedAt, onRefresh }: Props) {
  const id = useId();
  const [selection, setSelection] = useState<Selection>({ kind: 'missing' });
  const [showAll, setShowAll] = useState(false);
  const summary = useMemo(() => summarizeWork(jobs || [], audience), [jobs, audience]);
  const selectedCheck = selection.kind === 'check' ? informationChecks.find(check => check.key === selection.key) : undefined;
  const selectedLabel = selection.kind === 'all' ? 'All jobs' : selection.kind === 'missing' ? 'Information to gather'
    : selection.kind === 'stage' ? insightStages.find(stage => stage.key === selection.key)!.label : selectedCheck!.label;
  const matching = summary.records.filter(record => selection.kind === 'all'
    || (selection.kind === 'missing' && record.missing.length > 0)
    || (selection.kind === 'stage' && record.stage === selection.key)
    || (selection.kind === 'check' && record.missing.includes(selection.key)));
  const select = (value: Selection) => { setSelection(value); setShowAll(false); };
  const hasData = jobs !== undefined;
  return <section aria-labelledby={`${id}-title`} className="my-5 min-w-0 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 p-4">
      <div>
        <p className="mb-1 text-sm text-cyan-300">{audience === 'owner' ? 'Team overview' : 'Jobs you can view'}</p>
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-xl font-bold"><BarChart3 className="h-5 w-5" aria-hidden="true" /> Work in focus</h2>
        <p className="mt-1 text-sm text-slate-300">Tap a bar to find the jobs behind the number.</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={isFetching} className={`${control} flex items-center gap-2 border border-slate-600 disabled:opacity-60`}>
        <RefreshCw className={`h-4 w-4 ${isFetching ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />{isFetching ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
    {isError && <p role="alert" className="m-4 rounded-lg bg-amber-950 p-3 text-sm text-amber-100">{hasData ? 'Refresh failed. Showing the last saved view; refresh to check for changes.' : 'Could not load jobs. Refresh to try again.'}</p>}
    {!hasData ? (!isError && <p role="status" className="p-4 text-slate-300">{isLoading ? 'Loading your job information…' : 'Job information is not available yet.'}</p>) : <>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <button type="button" className={`${control} ${selection.kind === 'missing' ? 'bg-cyan-300 text-slate-950' : 'bg-slate-800'}`} aria-pressed={selection.kind === 'missing'} aria-controls={`${id}-results`} onClick={() => select({ kind: 'missing' })}>
          <strong className="tabular-nums">{summary.needsInformation}</strong> need information
        </button>
        <button type="button" className={`${control} ${selection.kind === 'all' ? 'bg-cyan-300 text-slate-950' : 'bg-slate-800'}`} aria-pressed={selection.kind === 'all'} aria-controls={`${id}-results`} onClick={() => select({ kind: 'all' })}>All {summary.records.length} jobs</button>
        <p className="text-sm text-slate-300">{updatedAt ? `Updated ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(updatedAt)} CT` : 'Saved job records'}</p>
      </div>
      {summary.records.length === 0 ? <p className="p-4 text-slate-300">{audience === 'owner' ? 'Job charts will appear when the first job is saved.' : 'Jobs available to your account will appear here.'}</p> : <>
        <div className="grid gap-5 p-4 lg:grid-cols-2">
          <div role="group" aria-label="Job stage chart">
            <h3 className="font-semibold">Jobs by stage</h3><p className="mb-2 text-sm text-slate-400">Count of jobs · scale 0–{summary.records.length}</p>
            {summary.stages.filter(stage => stage.key !== 'other' || stage.count > 0).map(stage => <ChartBar key={stage.key} label={stage.label} count={stage.count} total={summary.records.length} color="bg-cyan-300" selected={selection.kind === 'stage' && selection.key === stage.key} controls={`${id}-results`} onClick={() => select({ kind: 'stage', key: stage.key })} />)}
          </div>
          <div role="group" aria-label="Missing job information chart">
            <h3 className="font-semibold">Information to gather</h3><p className="mb-2 text-sm text-slate-400">Active jobs · scale 0–{summary.activeCount || 0}</p>
            {summary.checks.map(check => <ChartBar key={check.key} label={check.label} count={check.count} total={summary.activeCount} color="bg-amber-300" selected={selection.kind === 'check' && selection.key === check.key} controls={`${id}-results`} onClick={() => select({ kind: 'check', key: check.key })} />)}
            <p className="mt-3 text-sm text-slate-400">One job can need several details.{audience === 'crew' ? ' Only fields visible to your account are checked.' : ''} These checks show saved fields, not dispatch approval.</p>
          </div>
        </div>
        <div id={`${id}-results`} className="border-t border-slate-700 p-4">
          <h3 className="font-semibold" aria-live="polite">{selectedLabel} · {matching.length} {matching.length === 1 ? 'job' : 'jobs'}</h3>
          {selectedCheck && <p className="mt-1 text-sm text-slate-300">{selectedCheck.instruction}</p>}
          {matching.length === 0 ? <p className="mt-3 text-sm text-slate-300">No jobs match this selection.</p> : <ul className="mt-3 space-y-2">
            {(showAll ? matching : matching.slice(0, 5)).map(({ job, missing, stage }) => <li key={job.id}>
              <Link href={`/lead/${encodeURIComponent(job.id)}?returnTo=${encodeURIComponent(audience === 'owner' ? '/admin/schedule' : '/crew')}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-slate-950 p-3 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                <span className="min-w-0">
                  <span className="block break-words font-semibold">{(job.serviceType || 'Service').replace(/[_-]/g, ' ')} · #{job.orderNumber ?? job.id.slice(0, 8)}</span>
                  <span className="mt-1 block text-sm text-slate-300">{missing.length ? `Gather: ${missing.map(key => informationChecks.find(check => check.key === key)!.label.toLowerCase()).join(', ')}` : insightStages.find(item => item.key === stage)!.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm text-cyan-300">Open <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></span>
              </Link>
            </li>)}
          </ul>}
          {matching.length > 5 && <button type="button" className={`${control} mt-3 text-cyan-300 underline`} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer jobs' : `Show all ${matching.length} jobs`}</button>}
        </div>
      </>}
    </>}
  </section>;
}
