import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { JobOrderTicket, type JobOrderTicketData } from "@/components/job-order-ticket";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlannerView = "month" | "week" | "day";
type PlannerJob = JobOrderTicketData & {
  id: string;
  archivedAt?: string | null;
  flow?: JobOrderTicketData["flow"] & {
    schedule?: { date?: string | null };
    crew?: { needed?: number; openSlots?: number };
  };
};

type PlannerResponse = {
  items: PlannerJob[];
  viewer: { isAdmin: boolean; canAddJob: boolean };
};

type SafetyResponse = { leads: Array<{ lead_id: string; age_hours: string | number; red_flag: number; reminder: number }> };
type QuickBookHealth = { enabled: boolean; canComplete: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthTitle = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function localDate(value: string | null | undefined) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function beginningOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function jobDate(job: PlannerJob) {
  return localDate(job.flow?.schedule?.date || job.confirmedDate || job.moveDate);
}

function pageTitle(view: PlannerView, anchor: Date) {
  if (view === "month") return monthTitle.format(anchor);
  if (view === "day") return dayTitle.format(anchor);
  const start = beginningOfWeek(anchor);
  const end = addDays(start, 6);
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start)} – ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(end)}`;
}

function describeDate(job: PlannerJob) {
  const date = jobDate(job);
  if (!date) return "No date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export default function JobPlannerPage({ audience }: { audience: "admin" | "crew" }) {
  const [, navigate] = useLocation();
  const [view, setView] = useState<PlannerView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const { data, isLoading, isError, refetch, isFetching } = useQuery<PlannerResponse>({
    queryKey: ["/api/jobs/planner"],
  });
  const { data: safetyData } = useQuery<SafetyResponse>({
    queryKey: ["/api/admin/lead-safety/status"],
    enabled: audience === "admin",
    refetchInterval: 30_000,
  });
  const { data: quickBookHealth } = useQuery<QuickBookHealth>({
    queryKey: ["/api/quick-book/health"],
    enabled: Boolean(data?.viewer.canAddJob),
    retry: false,
    staleTime: 60_000,
  });
  const jobs = useMemo(() => {
    const safety = new Map((safetyData?.leads || []).map((item) => [String(item.lead_id), item]));
    return (data?.items || []).map((job) => {
      const alert = safety.get(String(job.id));
      return alert ? { ...job, leadSafety: { ageHours: Number(alert.age_hours || 0), redFlag: Boolean(alert.red_flag), reminder: Boolean(alert.reminder) } } : job;
    });
  }, [data?.items, safetyData?.leads]);
  const unscheduled = useMemo(() => jobs.filter((job) => !jobDate(job)), [jobs]);
  const scheduled = useMemo(() => jobs.filter((job) => Boolean(jobDate(job))), [jobs]);
  const scheduledByDate = useMemo(() => {
    const result = new Map<string, PlannerJob[]>();
    for (const job of scheduled) {
      const date = jobDate(job);
      if (!date) continue;
      const key = dateKey(date);
      result.set(key, [...(result.get(key) || []), job]);
    }
    return result;
  }, [scheduled]);
  const plannerPath = audience === "admin" ? "/admin/schedule" : "/crew";

  const openJob = (job: PlannerJob) => {
    navigate(`/lead/${encodeURIComponent(job.id)}?returnTo=${encodeURIComponent(plannerPath)}`);
  };

  const moveWindow = (direction: -1 | 1) => {
    if (view === "month") setAnchor((date) => new Date(date.getFullYear(), date.getMonth() + direction, 1));
    else if (view === "week") setAnchor((date) => addDays(date, direction * 7));
    else setAnchor((date) => addDays(date, direction));
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-5 pb-24 sm:px-5 md:py-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">JC ON THE MOVE</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Job Planner</h1>
          <p className="mt-1 text-sm text-slate-400">One calendar for what needs attention, what is upcoming, and what is confirmed.</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.viewer.canAddJob && quickBookHealth?.enabled ? (
            <Button onClick={() => navigate("/quick-book")} className="gap-1.5 bg-emerald-400 font-black text-slate-950 hover:bg-emerald-300" data-testid="button-quick-book">
              <Sparkles className="h-4 w-4" /> Quick Book
            </Button>
          ) : null}
          {data?.viewer.canAddJob ? (
            <Button onClick={() => navigate("/crew/add-job")} className="gap-1.5 bg-cyan-500 text-slate-950 hover:bg-cyan-400" data-testid="button-add-planner-job">
              <Plus className="h-4 w-4" /> Add job
            </Button>
          ) : null}
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh planner" className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white">
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <section className="mb-4 rounded-xl border border-slate-700/80 bg-slate-900/70 p-2 shadow-sm" aria-label="Calendar view controls">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg bg-slate-950 p-1">
            {(["month", "week", "day"] as PlannerView[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-bold capitalize transition",
                  view === option ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white",
                )}
                data-testid={`button-planner-${option}`}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => moveWindow(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
            <button type="button" className="min-w-44 px-1 text-center text-sm font-bold text-white hover:text-cyan-300" onClick={() => setAnchor(new Date())}>{pageTitle(view, anchor)}</button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => moveWindow(1)} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </section>

      {unscheduled.length > 0 ? (
        <section className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-3 sm:p-4" aria-label="Needs attention">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.12em] text-amber-200">Needs attention</h2>
              <p className="mt-0.5 text-xs text-amber-100/65">These orders need a quote or a confirmed date before they can take a place on the calendar.</p>
            </div>
            <span className="rounded-full border border-amber-300/25 px-2 py-1 text-xs font-bold text-amber-200">{unscheduled.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {unscheduled.map((job) => <JobOrderTicket key={job.id} order={job} viewer={audience} compact onClick={() => openJob(job)} />)}
          </div>
        </section>
      ) : null}

      {isLoading ? <PlannerState message="Loading your job calendar…" /> : null}
      {isError ? <PlannerState message="The job calendar could not load. Refresh and try again." action={<Button onClick={() => refetch()}>Try again</Button>} /> : null}
      {!isLoading && !isError ? (
        <section className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/70 shadow-sm" data-testid="job-planner-calendar">
          {view === "month" ? <MonthCalendar anchor={anchor} scheduledByDate={scheduledByDate} onOpen={openJob} viewer={audience} /> : null}
          {view === "week" ? <WeekCalendar anchor={anchor} scheduledByDate={scheduledByDate} onOpen={openJob} viewer={audience} /> : null}
          {view === "day" ? <DayCalendar anchor={anchor} scheduledByDate={scheduledByDate} onOpen={openJob} viewer={audience} /> : null}
        </section>
      ) : null}
    </main>
  );
}

function MonthCalendar({ anchor, scheduledByDate, onOpen, viewer }: { anchor: Date; scheduledByDate: Map<string, PlannerJob[]>; onOpen: (job: PlannerJob) => void; viewer: "admin" | "crew" }) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const first = addDays(start, -start.getDay());
  const today = dateKey(new Date());
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
      <div className="grid grid-cols-7 border-b border-slate-700/80 bg-slate-950/55">
        {Array.from({ length: 7 }, (_, index) => shortDay.format(addDays(first, index))).map((day) => <div key={day} className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">{day}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = dateKey(date);
          const jobs = scheduledByDate.get(key) || [];
          const currentMonth = date.getMonth() === anchor.getMonth();
          return (
            <div key={key} className={cn("min-h-40 border-b border-r border-slate-700/60 p-1.5", !currentMonth && "bg-slate-950/35")}>
              <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold", key === today ? "bg-cyan-400 text-slate-950" : currentMonth ? "text-slate-200" : "text-slate-600")}>{date.getDate()}</div>
              <div className="space-y-1.5">
                {jobs.slice(0, 2).map((job) => <JobOrderTicket key={job.id} order={job} viewer={viewer} compact onClick={() => onOpen(job)} />)}
                {jobs.length > 2 ? <p className="px-1 text-[11px] font-bold text-cyan-300">+{jobs.length - 2} more</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function WeekCalendar({ anchor, scheduledByDate, onOpen, viewer }: { anchor: Date; scheduledByDate: Map<string, PlannerJob[]>; onOpen: (job: PlannerJob) => void; viewer: "admin" | "crew" }) {
  const start = beginningOfWeek(anchor);
  const today = dateKey(new Date());
  return (
    <div className="overflow-x-auto">
    <div className="grid min-w-[720px] grid-cols-7">
      {Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((date) => {
        const key = dateKey(date);
        const jobs = scheduledByDate.get(key) || [];
        return <div className="min-h-[480px] border-r border-slate-700/60 p-2 last:border-r-0" key={key}>
          <div className={cn("mb-3 flex items-center justify-between border-b border-slate-700/60 pb-2", key === today && "text-cyan-300")}><span className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">{shortDay.format(date)}</span><span className="text-lg font-black">{date.getDate()}</span></div>
          <div className="space-y-2">{jobs.map((job) => <JobOrderTicket key={job.id} order={job} viewer={viewer} compact onClick={() => onOpen(job)} />)}</div>
        </div>;
      })}
    </div>
    </div>
  );
}

function DayCalendar({ anchor, scheduledByDate, onOpen, viewer }: { anchor: Date; scheduledByDate: Map<string, PlannerJob[]>; onOpen: (job: PlannerJob) => void; viewer: "admin" | "crew" }) {
  const jobs = scheduledByDate.get(dateKey(anchor)) || [];
  return (
    <div className="p-4 sm:p-5">
      <p className="mb-4 text-sm font-bold text-slate-300">{dayTitle.format(anchor)}</p>
      {jobs.length ? <div className="grid gap-3 md:grid-cols-2">{jobs.map((job) => <JobOrderTicket key={job.id} order={job} viewer={viewer} onClick={() => onOpen(job)} />)}</div> : <PlannerState message="No scheduled jobs for this day." />}
    </div>
  );
}

function PlannerState({ message, action }: { message: string; action?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-slate-400"><p>{message}</p>{action}</div>;
}
