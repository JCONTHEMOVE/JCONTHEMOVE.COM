import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowUpRight, BriefcaseBusiness, CalendarDays, ChevronRight, Database, Gift, Megaphone, Plus, RefreshCw, Wallet, type LucideIcon } from 'lucide-react';
import { currentWork, serviceDay, type WorkerHomeJob } from '@shared/workerHome';
import { insightStage } from '@shared/workInsights';
import { WorkerMonthlyProgress } from '@/components/worker-monthly-progress';

type HomeJob = WorkerHomeJob & { flow?: WorkerHomeJob['flow'] & { label?: string | null } };
type Planner = { items: HomeJob[]; viewer: { canAddJob: boolean } };
const action = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400';

function WorkRow({ job, request = false }: { job: HomeJob; request?: boolean }) {
  const day = serviceDay(job);
  const date = day ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`)) : 'Date to confirm';
  return <li><Link href={`/lead/${encodeURIComponent(job.id)}?returnTo=%2Fcrew`} className="flex min-h-20 items-center gap-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
    <BriefcaseBusiness aria-hidden="true" className={`h-5 w-5 shrink-0 ${request ? 'text-amber-300' : 'text-emerald-300'}`} />
    <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold capitalize">{(job.serviceType || 'Service').replace(/[_-]/g, ' ')} <span className="font-normal text-zinc-400">#{job.orderNumber ?? job.id.slice(0, 8)}</span></span><span className="mt-1 block text-xs text-zinc-400">{date}{job.arrivalWindow ? `, ${job.arrivalWindow}` : ''}</span><span className="mt-1 block text-xs text-zinc-300">{request ? 'Your response needed' : job.flow?.label || (job.status || 'Open').replace(/[_-]/g, ' ')}</span></span>
    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-400" />
  </Link></li>;
}

function ToolLink({ href, label, detail, icon: Icon, color }: { href: string; label: string; detail: string; icon: LucideIcon; color: string }) {
  return <Link href={href} className="flex min-h-20 min-w-0 items-center gap-3 border-b border-zinc-800 py-4 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"><Icon aria-hidden="true" className={`h-5 w-5 shrink-0 ${color}`} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-relaxed text-zinc-400">{detail}</span></span><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-400" /></Link>;
}

export default function CrewHomePage() {
  const planner = useQuery<Planner>({ queryKey: ['/api/jobs/planner'], refetchOnWindowFocus: true });
  const requests = useQuery<HomeJob[]>({ queryKey: ['/api/jobs/my-pending'], refetchInterval: 30_000 });
  const [filter, setFilter] = useState<'all' | 'leads' | 'jobs'>('all');
  const [showAll, setShowAll] = useState(false);
  const pending = currentWork(requests.data || []);
  const pendingIds = new Set(pending.map(job => job.id));
  const work = currentWork(planner.data?.items || []).filter(job => !pendingIds.has(job.id));
  const filtered = work.filter(job => filter === 'all' || (filter === 'leads' ? insightStage(job) === 'quote' : insightStage(job) !== 'quote'));
  const refreshing = planner.isFetching || requests.isFetching;
  function refresh() { void planner.refetch(); void requests.refetch(); }

  return <main className="mx-auto w-full max-w-4xl px-4 pb-8 pt-5 sm:px-6" data-testid="worker-home">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium text-zinc-400">JC ON THE MOVE</p><h1 className="mt-1 text-2xl font-bold">Your workday</h1></div><Link href="/crew/calendar" className={`${action} border border-zinc-700`}><CalendarDays className="h-4 w-4" /> Calendar</Link></header>

    <section aria-labelledby="work-title" className="pb-7">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="work-title" className="text-lg font-semibold"><span className="mr-2 text-emerald-400">1</span> Work</h2><div className="flex items-center gap-1"><Link href={planner.data?.viewer.canAddJob ? '/crew/add-job' : '/book?worker=1'} className={`${action} bg-emerald-400 text-zinc-950 hover:bg-emerald-300`}><Plus className="h-4 w-4" /> {planner.data?.viewer.canAddJob ? 'Add job' : 'Job request'}</Link><button type="button" className={action} title="Refresh work" aria-label="Refresh work" disabled={refreshing} onClick={refresh}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div></div>
      <h3 className="mt-5 text-sm font-semibold text-amber-300">Job requests{requests.data ? ` (${pending.length})` : ''}</h3>
      {requests.isError && <p role="alert" className="py-3 text-sm text-amber-300">{requests.data ? 'Requests could not refresh. Showing the last loaded requests.' : 'Job requests could not load.'} <button type="button" className="min-h-11 underline" onClick={() => void requests.refetch()}>Retry requests</button></p>}
      {requests.isLoading && <p role="status" className="py-3 text-sm text-zinc-400">Loading requests...</p>}
      {requests.data && (pending.length ? <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-800">{pending.map(job => <WorkRow key={job.id} job={job} request />)}</ul> : <p className="py-3 text-sm text-zinc-400">No job requests awaiting your response.</p>)}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4"><h3 className="text-sm font-semibold">Current leads & jobs{planner.data ? ` (${work.length})` : ''}</h3><div className="flex rounded-md bg-zinc-900 p-1" role="group" aria-label="Work filter">{(['all', 'leads', 'jobs'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setShowAll(false); }} className={`min-h-10 rounded px-3 text-xs capitalize ${filter === value ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>{value}</button>)}</div></div>
      {planner.isError && <p role="alert" className="py-3 text-sm text-amber-300">{planner.data ? 'Work could not refresh. Showing the last loaded records.' : 'Current work could not load.'} <button type="button" className="min-h-11 underline" onClick={() => void planner.refetch()}>Retry work</button></p>}
      {planner.isLoading && <p role="status" className="py-3 text-sm text-zinc-400">Loading current work...</p>}
      {planner.data && (filtered.length ? <ul className="divide-y divide-zinc-800">{(showAll ? filtered : filtered.slice(0, 5)).map(job => <WorkRow key={job.id} job={job} />)}</ul> : <p className="py-5 text-sm text-zinc-400">{filter === 'leads' ? 'No current leads.' : filter === 'jobs' ? 'No current jobs.' : 'No current work available to your account.'}</p>)}
      {filtered.length > 5 && <button type="button" className={`${action} mt-2 text-emerald-300`} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `View all ${filtered.length}`}</button>}
    </section>

    <section aria-labelledby="get-work-title" className="border-t border-zinc-700 py-7"><h2 id="get-work-title" className="text-lg font-semibold"><span className="mr-2 text-sky-400">2</span> Get work</h2><div className="grid gap-x-6 sm:grid-cols-2"><ToolLink href="/crew/marketing" label="Marketing materials" detail="Approved posts, photos & referral links" icon={Megaphone} color="text-sky-400" /><ToolLink href="/crew/pricing-training" label="Pricing datasets" detail="Job scenarios & pricing contributions" icon={Database} color="text-sky-400" /></div></section>

    <section aria-labelledby="progress-title" className="border-t border-zinc-700 py-7"><h2 id="progress-title" className="mb-4 text-lg font-semibold"><span className="mr-2 text-violet-400">3</span> Monthly progress</h2><WorkerMonthlyProgress /></section>

    <section aria-labelledby="rewards-title" className="border-t border-zinc-700 py-7"><h2 id="rewards-title" className="text-lg font-semibold"><span className="mr-2 text-amber-400">4</span> Rewards & redemptions</h2><div className="grid gap-x-6 sm:grid-cols-2"><ToolLink href="/marketplace?view=crew" label="Rewards & redemptions" detail="Reward shop, claims & redemption history" icon={Gift} color="text-amber-400" /><ToolLink href="/crew/earnings" label="Earnings & balance" detail="Pay, JCMOVES & payout history" icon={Wallet} color="text-amber-400" /></div></section>
  </main>;
}
