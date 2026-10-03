import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link, useSearch } from 'wouter';
import { chicagoMonth, monthlyStage, monthlyStages, monthlyWork, type MonthlyStage, type WorkerHomeJob } from '@shared/workerHome';

const control = 'min-h-11 rounded-md px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400';

export function WorkerMonthlyProgress() {
  const search = useSearch();
  const [month, setMonth] = useState(() => {
    const requested = new URLSearchParams(search).get('month') || '';
    return /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(requested) ? requested : chicagoMonth();
  });
  const [selection, setSelection] = useState<MonthlyStage | null>(null);
  const planner = useQuery<{ items: WorkerHomeJob[] }>({ queryKey: ['/api/jobs/planner'] });
  const history = useQuery<WorkerHomeJob[]>({ queryKey: ['/api/leads/my-jobs'] });
  const report = useMemo(() => monthlyWork([...(planner.data?.items || []), ...(history.data || [])], month), [planner.data, history.data, month]);
  const loaded = planner.data !== undefined && history.data !== undefined;
  const failed = planner.isError || history.isError;
  const refreshing = planner.isFetching || history.isFetching;
  const matching = report.jobs.filter(job => !selection || monthlyStage(job) === selection);
  function changeMonth(value: string) { setMonth(value); setSelection(null); }
  function moveMonth(delta: number) {
    const [year, number] = month.split('-').map(Number);
    const next = new Date(Date.UTC(year, number - 1 + delta, 1));
    changeMonth(next.toISOString().slice(0, 7));
  }
  function refresh() { void planner.refetch(); void history.refetch(); }

  return <div className="min-w-0" data-testid="monthly-progress">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" className={control} aria-label="Previous month" title="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft className="h-4 w-4" /></button>
        <input type="month" aria-label="Progress month" value={month} onChange={event => { if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) changeMonth(event.target.value); }} className="h-11 w-44 max-w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-white [color-scheme:dark]" />
        <button type="button" className={control} aria-label="Next month" title="Next month" onClick={() => moveMonth(1)}><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-1">
        {month !== chicagoMonth() && <button type="button" className={`${control} text-emerald-300`} onClick={() => changeMonth(chicagoMonth())}>This month</button>}
        <button type="button" className={control} aria-label="Refresh monthly progress" title="Refresh monthly progress" disabled={refreshing} onClick={refresh}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
      </div>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-zinc-400">Jobs visible to you, by service month. Undated requests use the month received.</p>
    {failed && <p role="alert" className="mt-3 text-sm text-amber-300">{loaded ? 'Refresh failed. Showing the last loaded records.' : 'Monthly progress could not load.'} <button type="button" className="min-h-11 underline" onClick={refresh}>Retry</button></p>}
    {!loaded && !failed && <p role="status" className="py-5 text-sm text-zinc-400">Loading monthly progress...</p>}
    {loaded && <>
      <div role="group" aria-label="Monthly job stages" className="mt-4 grid gap-2 sm:grid-cols-2">
        {monthlyStages.map(stage => {
          const count = report.jobs.filter(job => monthlyStage(job) === stage.key).length;
          if (stage.key === 'other' && !count) return null;
          return <button type="button" key={stage.key} aria-pressed={selection === stage.key} aria-controls="monthly-job-results" aria-label={`${stage.label}: ${count} ${count === 1 ? 'job' : 'jobs'}`} onClick={() => setSelection(selection === stage.key ? null : stage.key)} className={`min-w-0 rounded-md p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${selection === stage.key ? 'bg-zinc-800 ring-1 ring-zinc-500' : 'hover:bg-zinc-900'}`}>
            <span className="flex items-center justify-between gap-3 text-sm"><span>{stage.label}</span><strong className="tabular-nums">{count}</strong></span>
            <span aria-hidden="true" className="mt-2 block h-2 overflow-hidden rounded-sm bg-zinc-800"><span className={`block h-full ${stage.color}`} style={{ width: `${report.jobs.length ? count / report.jobs.length * 100 : 0}%` }} /></span>
          </button>;
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-400">{report.jobs.length} jobs this month{report.undated ? `; ${report.undated} without a date excluded` : ''}</p>
      <div id="monthly-job-results" aria-live="polite">
        {!report.jobs.length && <p className="py-3 text-sm text-zinc-300">No jobs recorded for this month.</p>}
        {selection && <div className="mt-4 border-t border-zinc-800 pt-3">
          <h3 className="text-sm font-semibold">{monthlyStages.find(stage => stage.key === selection)!.label} ({matching.length})</h3>
          {!matching.length && <p className="py-3 text-sm text-zinc-400">No jobs in this stage.</p>}
          <ul className="max-h-64 overflow-y-auto divide-y divide-zinc-800">{matching.map(job => <li key={job.id}><Link className="flex min-h-11 items-center justify-between gap-3 py-3 text-sm text-emerald-300 hover:underline" href={`/lead/${encodeURIComponent(job.id)}?returnTo=${encodeURIComponent(`/crew/progress?month=${month}`)}`}><span className="break-words">{(job.serviceType || 'Service').replace(/[_-]/g, ' ')} <span className="text-zinc-400">#{job.orderNumber ?? job.id.slice(0, 8)}</span></span><ChevronRight className="h-4 w-4 shrink-0" /></Link></li>)}</ul>
        </div>}
      </div>
    </>}
  </div>;
}
