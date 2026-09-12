import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Target, CalendarDays, Clock, TrendingUp, Calendar, Trophy, CheckCircle2, X,
  Loader2, Users, Edit3, Settings2, Ban, Briefcase, ChevronLeft, ChevronRight,
  BellRing, MessageCircle, ExternalLink,
} from "lucide-react";
import type { User } from "@shared/schema";
import { useAdminViewMode } from "@/hooks/useAdminViewMode";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const SERVICE_ICONS: Record<string, string> = {
  residential: "🚛", commercial: "🏢", junk: "🗑️", snow: "❄️",
  cleaning: "✨", handyman: "🔧", demolition: "⚒️", flooring: "🪵", painting: "🎨",
};

const SERVICE_LABELS: Record<string, string> = {
  residential: "Residential Move", commercial: "Commercial Move",
  junk: "Junk Removal", snow: "Snow Removal", cleaning: "Cleaning",
  handyman: "Handyman", demolition: "Demolition", flooring: "Flooring", painting: "Painting",
};

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function isCompletedJob(job: { status?: string | null }) {
  return String(job.status || "").toLowerCase() === "completed";
}

type CalendarJob = {
  id: string;
  serviceType: string;
  fromAddress: string | null;
  confirmedDate: string | null;
  moveDate: string | null;
  effectiveDate: string | null;
  confirmedFromAddress: string | null;
  status: string;
  confirmedHours: number | null;
  assignedToUserId: string | null;
};

type CalendarData = {
  jobs: CalendarJob[];
  blocks: { id: number; date: string; reason: string | null }[];
  hourOverrides: { id: number; date: string; startHour: number; endHour: number; note: string | null }[];
  schedule: { dayOfWeek: number; startHour: number | null; endHour: number | null; isAvailable: boolean | null }[];
};

type MyAvailability = {
  blocks: { id: number; date: string; reason: string | null }[];
  schedule: { dayOfWeek: number; startHour: number | null; endHour: number | null; isAvailable: boolean | null }[];
  goals: { weeklyJobGoal: number | null; monthlyJobGoal: number | null; preferredJobSize: string | null } | null;
  stats: { thisWeek: number; thisMonth: number; allTime: number };
  acceptedJobTypes: string[];
  notificationPreference: "in_app" | "discord" | "both";
  discordInviteUrl: string;
};

type DayModalState = {
  date: string;
  isBlocked: boolean;
  blockId?: number;
  blockReason?: string;
  hasJob: boolean;
  jobs: CalendarJob[];
  hourOverride?: { id: number; startHour: number; endHour: number; note: string | null };
  defaultSchedule?: { startHour: number; endHour: number; isAvailable: boolean };
  forWeek: boolean;
};

export default function CrewSchedulePage() {
  const { user } = useAuth();
  const { isCrewPreview } = useAdminViewMode();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = ["admin", "business_owner"].includes(user?.role || "") && !isCrewPreview;

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [viewMode, setViewMode] = useState<"settings" | "week">("settings");
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayModal, setDayModal] = useState<DayModalState | null>(null);

  const [blockReasonInput, setBlockReasonInput] = useState("");
  const [overrideStart, setOverrideStart] = useState(8);
  const [overrideEnd, setOverrideEnd] = useState(17);
  const [overrideNote, setOverrideNote] = useState("");
  const [modalAction, setModalAction] = useState<"block" | "hours" | null>(null);

  const [goalWeekly, setGoalWeekly] = useState(0);
  const [goalMonthly, setGoalMonthly] = useState(0);
  const [goalJobSize, setGoalJobSize] = useState("any");
  const [adminGoalTarget, setAdminGoalTarget] = useState<string | null>(null);
  const [adminGoalWeekly, setAdminGoalWeekly] = useState(0);
  const [adminGoalMonthly, setAdminGoalMonthly] = useState(0);

  const ALL_JOB_TYPES = [
    { key: "moving", label: "Moving", icon: "🚛" },
    { key: "junk", label: "Junk Removal", icon: "🗑️" },
    { key: "snow", label: "Snow Removal", icon: "❄️" },
    { key: "handyman", label: "Handyman", icon: "🔧" },
    { key: "labor", label: "Labor Only", icon: "💪" },
    { key: "cleaning", label: "Cleaning", icon: "✨" },
    { key: "demolition", label: "Demolition", icon: "⚒️" },
  ];
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[] | null>(null);

  const { data: myAvailability, refetch: refetchAvailability } = useQuery<MyAvailability>({
    queryKey: ["/api/workers/my-availability"],
  });

  const weekDays = useMemo(() => {
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const weekMonthKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of weekDays) {
      keys.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
    }
    return Array.from(keys).map(k => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m };
    });
  }, [weekDays]);

  async function fetchCalendarMonth(year: number, month: number): Promise<CalendarData> {
    const res = await fetch(`/api/workers/calendar?year=${year}&month=${month}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch calendar");
    return res.json();
  }

  function mergeCalendarData(datasets: CalendarData[]): CalendarData {
    const jobsMap = new Map<string, CalendarJob>();
    const blocksMap = new Map<string, CalendarData["blocks"][0]>();
    const overridesMap = new Map<string, CalendarData["hourOverrides"][0]>();
    const scheduleMap = new Map<number, CalendarData["schedule"][0]>();
    for (const d of datasets) {
      for (const j of d.jobs) { if (!jobsMap.has(j.id)) jobsMap.set(j.id, j); }
      for (const b of d.blocks) { blocksMap.set(b.date, b); }
      for (const o of d.hourOverrides) { overridesMap.set(o.date, o); }
      for (const s of d.schedule) { scheduleMap.set(s.dayOfWeek, s); }
    }
    return {
      jobs: Array.from(jobsMap.values()),
      blocks: Array.from(blocksMap.values()),
      hourOverrides: Array.from(overridesMap.values()),
      schedule: Array.from(scheduleMap.values()),
    };
  }

  const calendarQueryKey = ["/api/workers/calendar", viewYear, viewMonth];
  const { data: calendarData, isLoading: calendarLoading, refetch: refetchCalendar } = useQuery<CalendarData>({
    queryKey: calendarQueryKey,
    queryFn: () => fetchCalendarMonth(viewYear, viewMonth),
  });

  const weekDataQueryKey = ["/api/workers/calendar/week", ...weekMonthKeys.map(k => `${k.year}-${k.month}`)];
  const { data: weekCalendarData, isLoading: weekCalendarLoading, refetch: refetchWeekCalendar } = useQuery<CalendarData>({
    queryKey: weekDataQueryKey,
    queryFn: async () => {
      const datasets = await Promise.all(weekMonthKeys.map(k => fetchCalendarMonth(k.year, k.month)));
      return mergeCalendarData(datasets);
    },
    enabled: viewMode === "week",
  });

  const { data: allWorkersAvail = [] } = useQuery<{
    user: User & { isAvailable?: boolean };
    goals: { weeklyJobGoal: number | null; monthlyJobGoal: number | null } | null;
    thisWeek: number; thisMonth: number; blockedDates: string[];
  }[]>({
    queryKey: ["/api/workers/all-availability"],
    enabled: isAdmin,
  });

  const addDayBlockMutation = useMutation({
    mutationFn: async ({ date, reason }: { date: string; reason: string }) => {
      const res = await apiRequest("POST", "/api/workers/day-blocks", { date, reason });
      return res.json();
    },
    onSuccess: () => {
      refetchAvailability();
      refetchCalendar();
      refetchWeekCalendar();
      setDayModal(null);
      toast({ title: "Day blocked" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeDayBlockMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/workers/day-blocks/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      refetchAvailability();
      refetchCalendar();
      refetchWeekCalendar();
      setDayModal(null);
      toast({ title: "Day unblocked" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateScheduleMutation = useMutation({
    mutationFn: async (payload: { dayOfWeek: number; startHour: number; endHour: number; isAvailable: boolean }) => {
      const res = await apiRequest("PUT", "/api/workers/schedule", payload);
      return res.json();
    },
    onSuccess: () => { refetchAvailability(); refetchCalendar(); refetchWeekCalendar(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveGoalsMutation = useMutation({
    mutationFn: async (payload: { weeklyJobGoal: number; monthlyJobGoal: number; preferredJobSize: string }) => {
      const res = await apiRequest("PUT", "/api/workers/goals/my", payload);
      return res.json();
    },
    onSuccess: () => { refetchAvailability(); toast({ title: "Goals saved!" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveJobTypesMutation = useMutation({
    mutationFn: async (jobTypes: string[]) => {
      const res = await apiRequest("PUT", "/api/workers/job-types", { jobTypes });
      return res.json();
    },
    onSuccess: () => { refetchAvailability(); toast({ title: "✅ Job preferences saved!" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveNotificationPreferenceMutation = useMutation({
    mutationFn: async (preference: MyAvailability["notificationPreference"]) => {
      const res = await apiRequest("PUT", "/api/workers/notification-preferences", { preference });
      return res.json();
    },
    onSuccess: () => {
      refetchAvailability();
      toast({ title: "Job alert preference saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setAdminGoalsMutation = useMutation({
    mutationFn: async ({ userId, weeklyJobGoal, monthlyJobGoal }: { userId: string; weeklyJobGoal: number; monthlyJobGoal: number }) => {
      const res = await apiRequest("PUT", `/api/workers/${userId}/goals`, { weeklyJobGoal, monthlyJobGoal });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers/all-availability"] });
      setAdminGoalTarget(null);
      toast({ title: "Goals set!" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const upsertHourOverrideMutation = useMutation({
    mutationFn: async ({ date, startHour, endHour, note }: { date: string; startHour: number; endHour: number; note?: string }) => {
      const res = await apiRequest("PUT", "/api/workers/hour-overrides", { date, startHour, endHour, note });
      return res.json();
    },
    onSuccess: () => {
      refetchCalendar();
      refetchWeekCalendar();
      setDayModal(null);
      toast({ title: "Hours updated for this date" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteHourOverrideMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/workers/hour-overrides/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      refetchCalendar();
      refetchWeekCalendar();
      setDayModal(null);
      toast({ title: "Hour override removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function goToPrevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); }
    else setViewMonth(m => m - 1);
  }
  function goToNextMonth() {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); }
    else setViewMonth(m => m + 1);
  }

  const calendarGrid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  function dateToStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function getDayStr(day: number) {
    return `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function getActiveData(forWeek = false): CalendarData | undefined {
    return forWeek ? weekCalendarData : calendarData;
  }

  function getEffectiveDate(j: CalendarJob): string | null {
    const raw = j.effectiveDate || j.confirmedDate || j.moveDate || null;
    if (!raw) return null;
    return raw.slice(0, 10);
  }

  function getJobsForDate(dateStr: string, forWeek = false) {
    const data = getActiveData(forWeek);
    if (!data) return [];
    return data.jobs.filter(j => getEffectiveDate(j) === dateStr);
  }

  function getBlockForDate(dateStr: string, forWeek = false) {
    const data = getActiveData(forWeek);
    if (!data) return undefined;
    return data.blocks.find(b => b.date === dateStr);
  }

  function getHourOverrideForDate(dateStr: string, forWeek = false) {
    const data = getActiveData(forWeek);
    if (!data) return undefined;
    return data.hourOverrides.find(o => o.date === dateStr);
  }

  function getDefaultSchedule(dayOfWeek: number, forWeek = false) {
    const data = getActiveData(forWeek);
    const s = data?.schedule.find(s => s.dayOfWeek === dayOfWeek);
    return s ? { startHour: s.startHour ?? 8, endHour: s.endHour ?? 17, isAvailable: s.isAvailable ?? true } : undefined;
  }

  function openDayModal(dateStr: string, forWeek = false) {
    const d = new Date(dateStr + "T12:00:00");
    const dow = d.getDay();
    const block = getBlockForDate(dateStr, forWeek);
    const jobs = getJobsForDate(dateStr, forWeek);
    const hourOverride = getHourOverrideForDate(dateStr, forWeek);
    const defaultSchedule = getDefaultSchedule(dow, forWeek);

    setBlockReasonInput(block?.reason ?? "");
    setOverrideStart(hourOverride?.startHour ?? defaultSchedule?.startHour ?? 8);
    setOverrideEnd(hourOverride?.endHour ?? defaultSchedule?.endHour ?? 17);
    setOverrideNote(hourOverride?.note ?? "");
    setModalAction(null);

    setDayModal({
      date: dateStr,
      isBlocked: !!block,
      blockId: block?.id,
      blockReason: block?.reason ?? undefined,
      hasJob: jobs.length > 0,
      jobs,
      hourOverride: hourOverride ? { id: hourOverride.id, startHour: hourOverride.startHour, endHour: hourOverride.endHour, note: hourOverride.note } : undefined,
      defaultSchedule,
      forWeek,
    });
  }

  const todayStr = dateToStr(today);

  function getJobTimeWindow(job: CalendarJob, forWeek = false) {
    const data = getActiveData(forWeek);
    const sched = data?.schedule;
    const dateStr = getEffectiveDate(job);
    if (!dateStr || !sched) return null;
    const hourOverride = getHourOverrideForDate(dateStr, forWeek);
    if (hourOverride) return `${formatHour(hourOverride.startHour)} – ${formatHour(hourOverride.endHour)}`;
    const dow = new Date(dateStr + "T12:00:00").getDay();
    const schedRow = sched.find(s => s.dayOfWeek === dow);
    if (schedRow && schedRow.isAvailable) {
      return `${formatHour(schedRow.startHour ?? 8)} – ${formatHour(schedRow.endHour ?? 17)}`;
    }
    return null;
  }

  function DayCell({ dateStr, compact = false, forWeek = false }: { dateStr: string; compact?: boolean; forWeek?: boolean }) {
    const d = new Date(dateStr + "T12:00:00");
    const block = getBlockForDate(dateStr, forWeek);
    const jobs = getJobsForDate(dateStr, forWeek);
    const hourOverride = getHourOverrideForDate(dateStr, forWeek);
    const dow = d.getDay();
    const sched = getDefaultSchedule(dow, forWeek);
    const isScheduledOff = sched && !sched.isAvailable;
    const isToday = dateStr === todayStr;
    const isPast = dateStr < todayStr;

    let bg = "bg-slate-800/30 hover:bg-slate-700/40 border-slate-700/30";
    if (block) bg = "bg-red-950/50 border-red-800/50 hover:bg-red-900/50";
    else if (jobs.length > 0 && jobs.every(isCompletedJob)) bg = "bg-emerald-950/35 border-emerald-700/40 hover:bg-emerald-900/40";
    else if (jobs.length > 0) bg = "bg-blue-950/50 border-blue-700/40 hover:bg-blue-900/50";
    else if (hourOverride) bg = "bg-amber-950/40 border-amber-700/30 hover:bg-amber-900/40";
    else if (isScheduledOff) bg = "bg-slate-900/30 border-slate-800/30 opacity-40";

    const cellTimeWindow = jobs.length === 1 ? getJobTimeWindow(jobs[0], forWeek) : null;
    return (
      <button
        onClick={() => openDayModal(dateStr, forWeek)}
        className={`relative rounded-lg border p-1 w-full ${compact ? "min-h-[56px]" : "min-h-[72px]"} flex flex-col items-center transition-colors ${bg} ${isToday ? "ring-1 ring-cyan-500" : ""} ${isPast ? "opacity-70" : ""}`}
      >
        <span className={`text-xs font-semibold ${isToday ? "text-cyan-400" : block ? "text-red-300" : "text-slate-200"}`}>
          {d.getDate()}
        </span>
        <div className="flex flex-wrap gap-0.5 justify-center mt-0.5">
          {block && <Ban className="h-3 w-3 text-red-400" />}
          {!block && jobs.map((j, ji) => (
            isCompletedJob(j) ? (
              <CheckCircle2 key={ji} className="h-3 w-3 text-emerald-400" />
            ) : (
              <span key={ji} className="text-[10px] leading-none">{SERVICE_ICONS[j.serviceType] || "📦"}</span>
            )
          ))}
          {hourOverride && !block && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-0.5" />}
        </div>
        {jobs.length > 0 && !block && (
          <p className="text-[8px] text-blue-300 mt-0.5 text-center leading-tight truncate w-full px-0.5">
            {jobs.every(isCompletedJob) ? "Done" : SERVICE_LABELS[jobs[0].serviceType]?.split(" ")[0] || "Job"}
            {jobs.length > 1 ? ` +${jobs.length - 1}` : ""}
          </p>
        )}
        {jobs.length > 0 && !block && (() => {
          const addr = jobs[0].confirmedFromAddress || jobs[0].fromAddress;
          return addr ? (
            <p className="text-[7px] text-slate-500 leading-tight truncate w-full px-0.5 text-center">
              {addr.split(",")[0]}
            </p>
          ) : null;
        })()}
        {cellTimeWindow && !block && (
          <p className="text-[7px] text-cyan-600 leading-tight truncate w-full px-0.5 text-center">
            {cellTimeWindow}
          </p>
        )}
      </button>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Schedule Settings</h1>
          <p className="text-slate-400 text-sm">Availability, goals & job preferences</p>
        </div>
        <Settings2 className="h-5 w-5 text-slate-500" />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "This Week", val: myAvailability?.stats.thisWeek ?? 0, icon: TrendingUp, color: "text-cyan-400" },
          { label: "This Month", val: myAvailability?.stats.thisMonth ?? 0, icon: Calendar, color: "text-blue-400" },
          { label: "All Time", val: myAvailability?.stats.allTime ?? 0, icon: Trophy, color: "text-yellow-400" },
        ].map(s => (
          <div key={s.label} className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3 text-center">
            <s.icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
            <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
            <p className="text-[10px] text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4">
          {/* Goal Progress */}
          {myAvailability?.goals && (myAvailability.goals.weeklyJobGoal ?? 0) > 0 && (
            <div className="bg-slate-800/40 border border-cyan-500/20 rounded-xl p-3 space-y-2">
              <p className="text-xs text-cyan-300 font-semibold flex items-center gap-1"><Target className="h-3 w-3" /> Goal Progress</p>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Weekly: {myAvailability.stats.thisWeek} / {myAvailability.goals.weeklyJobGoal} jobs</span>
                  <span>{Math.round((myAvailability.stats.thisWeek / (myAvailability.goals.weeklyJobGoal || 1)) * 100)}%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (myAvailability.stats.thisWeek / (myAvailability.goals.weeklyJobGoal || 1)) * 100)}%` }} />
                </div>
              </div>
              {(myAvailability.goals.monthlyJobGoal ?? 0) > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Monthly: {myAvailability.stats.thisMonth} / {myAvailability.goals.monthlyJobGoal} jobs</span>
                    <span>{Math.round((myAvailability.stats.thisMonth / (myAvailability.goals.monthlyJobGoal || 1)) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (myAvailability.stats.thisMonth / (myAvailability.goals.monthlyJobGoal || 1)) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* My Goals */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-white flex items-center gap-2"><Target className="h-4 w-4 text-cyan-400" /> My Job Goals</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider">Weekly Goal</label>
                <Input
                  type="number" min="0" max="50"
                  value={goalWeekly || myAvailability?.goals?.weeklyJobGoal || 0}
                  onChange={e => setGoalWeekly(parseInt(e.target.value) || 0)}
                  className="mt-1 h-8 text-sm bg-slate-700/50 border-slate-600 text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase tracking-wider">Monthly Goal</label>
                <Input
                  type="number" min="0" max="200"
                  value={goalMonthly || myAvailability?.goals?.monthlyJobGoal || 0}
                  onChange={e => setGoalMonthly(parseInt(e.target.value) || 0)}
                  className="mt-1 h-8 text-sm bg-slate-700/50 border-slate-600 text-white"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider">Preferred Job Size</label>
              <Select value={goalJobSize || myAvailability?.goals?.preferredJobSize || "any"} onValueChange={setGoalJobSize}>
                <SelectTrigger className="mt-1 h-8 text-sm bg-slate-700/50 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {["any", "small", "medium", "large"].map(s => (
                    <SelectItem key={s} value={s} className="text-white capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm"
              onClick={() => saveGoalsMutation.mutate({
                weeklyJobGoal: goalWeekly || myAvailability?.goals?.weeklyJobGoal || 0,
                monthlyJobGoal: goalMonthly || myAvailability?.goals?.monthlyJobGoal || 0,
                preferredJobSize: goalJobSize || myAvailability?.goals?.preferredJobSize || "any"
              })}
              disabled={saveGoalsMutation.isPending}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white h-8 text-sm"
            >
              {saveGoalsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />} Save Goals
            </Button>
          </div>

          {/* Job Types I Accept */}
          {!isAdmin && (
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-white flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-cyan-400" /> Job Alert Channels
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Choose personal in-app alerts, the shared crew Discord channel, or both.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "in_app", label: "In-app", icon: BellRing },
                  { key: "discord", label: "Discord", icon: MessageCircle },
                  { key: "both", label: "Both", icon: CheckCircle2 },
                ] as const).map(({ key, label, icon: Icon }) => {
                  const selected = (myAvailability?.notificationPreference || "both") === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => saveNotificationPreferenceMutation.mutate(key)}
                      disabled={saveNotificationPreferenceMutation.isPending}
                      className={`rounded-lg border p-2.5 text-center transition-colors ${selected ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-700 bg-slate-900/30 text-slate-400 hover:border-slate-600"}`}
                    >
                      <Icon className="h-4 w-4 mx-auto mb-1" />
                      <span className="text-xs font-semibold">{label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                Discord alerts are posted to the shared crew channel. Join that channel before selecting Discord-only.
              </p>
              <a
                href={myAvailability?.discordInviteUrl || "https://discord.gg/8zVq5dxKQ"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
              >
                Open crew Discord <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {!isAdmin && (() => {
            const effectiveJobTypes = selectedJobTypes ?? myAvailability?.acceptedJobTypes ?? ALL_JOB_TYPES.map(t => t.key);
            const toggleJobType = (key: string) => {
              setSelectedJobTypes(prev => {
                const current = prev ?? (myAvailability?.acceptedJobTypes ?? ALL_JOB_TYPES.map(t => t.key));
                return current.includes(key) ? current.filter(k => k !== key) : [...current, key];
              });
            };
            return (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-white flex items-center gap-2">✅ Job Types I Accept</p>
                <p className="text-xs text-slate-500">Only jobs matching these types will be offered to you</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedJobTypes(ALL_JOB_TYPES.map(t => t.key))}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                  >Select All</button>
                  <span className="text-slate-600 text-[10px]">·</span>
                  <button
                    onClick={() => setSelectedJobTypes([])}
                    className="text-[10px] text-slate-400 hover:text-slate-300 underline"
                  >Clear All</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_JOB_TYPES.map(({ key, label, icon }) => {
                    const checked = effectiveJobTypes.includes(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggleJobType(key)}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${checked ? "border-cyan-600/50 bg-cyan-600/10" : "border-slate-700/40 bg-slate-900/30 opacity-50"}`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-cyan-600 border-cyan-600" : "border-slate-500"}`}>
                          {checked && <span className="text-white text-[9px] font-bold">✓</span>}
                        </div>
                        <span className="text-xs text-slate-300">{icon} {label}</span>
                      </button>
                    );
                  })}
                </div>
                <Button size="sm"
                  onClick={() => saveJobTypesMutation.mutate(effectiveJobTypes)}
                  disabled={saveJobTypesMutation.isPending}
                  className="w-full bg-cyan-600 hover:bg-cyan-700 text-white h-8 text-sm"
                >
                  {saveJobTypesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />} Save Job Types
                </Button>
              </div>
            );
          })()}

          {/* Weekly Availability */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-white flex items-center gap-2"><Clock className="h-4 w-4 text-blue-400" /> Weekly Availability</p>
            <p className="text-xs text-slate-500">Set your default available hours for each day of the week.</p>
            <div className="space-y-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, dow) => {
                const existing = (myAvailability?.schedule ?? []).find(s => s.dayOfWeek === dow);
                const avail = existing?.isAvailable ?? true;
                return (
                  <div key={dow} className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${avail ? "border-slate-700/40 bg-slate-800/30" : "border-slate-800/30 bg-slate-900/50 opacity-50"}`}>
                    <button
                      onClick={() => updateScheduleMutation.mutate({ dayOfWeek: dow, startHour: existing?.startHour ?? 8, endHour: existing?.endHour ?? 17, isAvailable: !avail })}
                      className={`w-8 h-5 rounded-full transition-colors shrink-0 ${avail ? "bg-cyan-600" : "bg-slate-600"}`}
                    >
                      <div className={`w-3.5 h-3.5 bg-white rounded-full mx-auto transition-transform ${avail ? "translate-x-1.5" : "-translate-x-1.5"}`} />
                    </button>
                    <span className="text-xs font-medium text-slate-300 w-7">{day}</span>
                    {avail && (
                      <>
                        <select
                          value={existing?.startHour ?? 8}
                          onChange={e => updateScheduleMutation.mutate({ dayOfWeek: dow, startHour: parseInt(e.target.value), endHour: existing?.endHour ?? 17, isAvailable: true })}
                          className="text-xs bg-slate-700 border-0 text-white rounded px-1 py-0.5 flex-1"
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{formatHour(h)}</option>
                          ))}
                        </select>
                        <span className="text-slate-500 text-xs">to</span>
                        <select
                          value={existing?.endHour ?? 17}
                          onChange={e => updateScheduleMutation.mutate({ dayOfWeek: dow, startHour: existing?.startHour ?? 8, endHour: parseInt(e.target.value), isAvailable: true })}
                          className="text-xs bg-slate-700 border-0 text-white rounded px-1 py-0.5 flex-1"
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>{formatHour(h)}</option>
                          ))}
                        </select>
                      </>
                    )}
                    {!avail && <span className="text-xs text-slate-500 ml-1">Off</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Admin: all workers */}
          {isAdmin && allWorkersAvail.length > 0 && (
            <div className="bg-slate-800/40 border border-purple-500/20 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-white flex items-center gap-2"><Users className="h-4 w-4 text-purple-400" /> Crew Availability Overview</p>
              {adminGoalTarget && (
                <div className="flex gap-2 items-end bg-slate-700/40 rounded-xl p-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-400 uppercase">Weekly Goal</label>
                    <Input type="number" value={adminGoalWeekly} onChange={e => setAdminGoalWeekly(parseInt(e.target.value) || 0)} className="h-7 text-xs bg-slate-700/50 border-slate-600 text-white mt-0.5" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-400 uppercase">Monthly Goal</label>
                    <Input type="number" value={adminGoalMonthly} onChange={e => setAdminGoalMonthly(parseInt(e.target.value) || 0)} className="h-7 text-xs bg-slate-700/50 border-slate-600 text-white mt-0.5" />
                  </div>
                  <Button size="sm" onClick={() => setAdminGoalsMutation.mutate({ userId: adminGoalTarget, weeklyJobGoal: adminGoalWeekly, monthlyJobGoal: adminGoalMonthly })} disabled={setAdminGoalsMutation.isPending} className="h-7 bg-purple-600 text-white text-xs">Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdminGoalTarget(null)} className="h-7 text-slate-400"><X className="h-3.5 w-3.5" /></Button>
                </div>
              )}
              <div className="space-y-2">
                {allWorkersAvail.map(w => {
                  const isBlocked = w.blockedDates.includes(todayStr);
                  return (
                    <div key={w.user.id} className={`rounded-lg border p-3 ${isBlocked ? "border-red-800/30 bg-red-950/20" : "border-slate-700/30 bg-slate-800/20"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${w.user.isAvailable && !isBlocked ? "bg-green-400" : "bg-red-400"}`} />
                          <span className="text-sm font-medium text-white">{w.user.firstName} {w.user.lastName || ""}</span>
                          {isBlocked && <Badge className="bg-red-900/50 text-red-300 border-red-700/30 text-[10px]">Day Off</Badge>}
                        </div>
                        <button onClick={() => { setAdminGoalTarget(w.user.id); setAdminGoalWeekly(w.goals?.weeklyJobGoal || 0); setAdminGoalMonthly(w.goals?.monthlyJobGoal || 0); }} className="text-slate-400 hover:text-white">
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                        <span>Week: <strong className="text-cyan-300">{w.thisWeek}</strong>{(w.goals?.weeklyJobGoal ?? 0) > 0 ? ` / ${w.goals?.weeklyJobGoal}` : ""} jobs</span>
                        <span>Month: <strong className="text-blue-300">{w.thisMonth}</strong>{(w.goals?.monthlyJobGoal ?? 0) > 0 ? ` / ${w.goals?.monthlyJobGoal}` : ""} jobs</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
      </div>

      {/* Day detail modal */}
      <Dialog open={!!dayModal} onOpenChange={open => !open && setDayModal(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-cyan-400" />
              {dayModal && (() => {
                const d = new Date(dayModal.date + "T12:00:00");
                return `${DAY_NAMES_FULL[d.getDay()]}, ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
              })()}
            </DialogTitle>
          </DialogHeader>

          {dayModal && (
            <div className="space-y-4">
              {/* Jobs on this day */}
              {dayModal.jobs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5 text-blue-400" /> Assigned Jobs
                  </p>
                  {dayModal.jobs.map(j => {
                    const timeWindow = getJobTimeWindow(j, dayModal.forWeek);
                    const pickup = j.confirmedFromAddress || j.fromAddress;
                    return (
                      <div key={j.id} className={`${isCompletedJob(j) ? "bg-emerald-950/30 border-emerald-700/30" : "bg-blue-950/40 border-blue-700/30"} border rounded-lg p-3 space-y-1.5`}>
                        <div className="flex items-center gap-2">
                          {isCompletedJob(j) ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          ) : (
                            <span className="text-lg">{SERVICE_ICONS[j.serviceType] || "📦"}</span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">{SERVICE_LABELS[j.serviceType] || j.serviceType}</p>
                            <Badge className={`text-[10px] ${isCompletedJob(j) ? "bg-emerald-900/60 text-emerald-300 border-emerald-700/30" : "bg-blue-900/60 text-blue-300 border-blue-700/30"}`}>
                              {j.status.replace(/_/g, " ")}
                            </Badge>
                          </div>
                        </div>
                        {timeWindow && (
                          <div className="flex items-center gap-1.5 text-xs text-cyan-400">
                            <Clock className="h-3 w-3" />
                            <span>Your availability: {timeWindow}</span>
                          </div>
                        )}
                        {j.confirmedHours && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Clock className="h-3 w-3 opacity-50" />
                            <span>Est. duration: ~{j.confirmedHours}h</span>
                          </div>
                        )}
                        {pickup && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <span className="text-slate-500">📍</span>
                            <span className="truncate">{pickup}</span>
                          </div>
                        )}
                        <Link
                          href={`/lead/${j.id}`}
                          className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 underline underline-offset-2 mt-0.5"
                          onClick={() => setDayModal(null)}
                        >
                          View job details →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Current status */}
              {dayModal.isBlocked && (
                <div className="bg-red-950/40 border border-red-800/30 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Ban className="h-4 w-4 text-red-400" />
                    <div>
                      <p className="text-sm text-red-300 font-medium">Day blocked</p>
                      {dayModal.blockReason && <p className="text-xs text-slate-400">{dayModal.blockReason}</p>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost"
                    onClick={() => dayModal.blockId && removeDayBlockMutation.mutate(dayModal.blockId)}
                    disabled={removeDayBlockMutation.isPending}
                    className="text-red-400 hover:text-red-300 text-xs h-7"
                  >
                    {removeDayBlockMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Unblock"}
                  </Button>
                </div>
              )}

              {dayModal.hourOverride && !dayModal.isBlocked && (
                <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-400" />
                    <div>
                      <p className="text-sm text-amber-300 font-medium">Custom hours</p>
                      <p className="text-xs text-slate-400">{formatHour(dayModal.hourOverride.startHour)} – {formatHour(dayModal.hourOverride.endHour)}</p>
                      {dayModal.hourOverride.note && <p className="text-xs text-slate-500">{dayModal.hourOverride.note}</p>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost"
                    onClick={() => dayModal.hourOverride && deleteHourOverrideMutation.mutate(dayModal.hourOverride.id)}
                    disabled={deleteHourOverrideMutation.isPending}
                    className="text-amber-400 hover:text-amber-300 text-xs h-7"
                  >
                    {deleteHourOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reset"}
                  </Button>
                </div>
              )}

              {/* Show default schedule if no override */}
              {!dayModal.isBlocked && !dayModal.hourOverride && dayModal.defaultSchedule && (
                <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-400 font-medium">Default hours</p>
                    <p className="text-xs text-slate-500">
                      {dayModal.defaultSchedule.isAvailable
                        ? `${formatHour(dayModal.defaultSchedule.startHour)} – ${formatHour(dayModal.defaultSchedule.endHour)}`
                        : "Day off (weekly schedule)"}
                    </p>
                  </div>
                </div>
              )}

              {/* Actions */}
              {!dayModal.isBlocked && (
                <div className="space-y-2">
                  {/* Block day */}
                  {modalAction !== "hours" && (
                    <div>
                      {modalAction !== "block" ? (
                        <Button size="sm" variant="outline"
                          onClick={() => setModalAction("block")}
                          className="w-full border-red-700/40 text-red-400 hover:bg-red-950/40 h-9"
                        >
                          <Ban className="h-3.5 w-3.5 mr-2" /> Block this day off
                        </Button>
                      ) : (
                        <div className="space-y-2 bg-red-950/20 border border-red-800/30 rounded-lg p-3">
                          <p className="text-xs text-red-300 font-semibold">Block {dayModal.date}</p>
                          {dayModal.hasJob && (
                            <div className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-700/30 rounded p-2">
                              <span className="mt-0.5">⚠️</span>
                              <span>You have {dayModal.jobs.length} job{dayModal.jobs.length > 1 ? "s" : ""} assigned on this day. Blocking it does not cancel the job — contact admin if needed.</span>
                            </div>
                          )}
                          <Input
                            value={blockReasonInput}
                            onChange={e => setBlockReasonInput(e.target.value)}
                            placeholder="Reason (optional)"
                            className="h-8 text-sm bg-slate-700/50 border-slate-600 text-white"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1 bg-red-700 hover:bg-red-600 text-white h-8"
                              onClick={() => addDayBlockMutation.mutate({ date: dayModal.date, reason: blockReasonInput })}
                              disabled={addDayBlockMutation.isPending}
                            >
                              {addDayBlockMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm Block"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setModalAction(null)} className="h-8 text-slate-400">Cancel</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Set custom hours */}
                  {modalAction !== "block" && (
                    <div>
                      {modalAction !== "hours" ? (
                        <Button size="sm" variant="outline"
                          onClick={() => setModalAction("hours")}
                          className="w-full border-amber-700/40 text-amber-400 hover:bg-amber-950/40 h-9"
                        >
                          <Clock className="h-3.5 w-3.5 mr-2" /> Set custom hours
                        </Button>
                      ) : (
                        <div className="space-y-2 bg-amber-950/20 border border-amber-700/30 rounded-lg p-3">
                          <p className="text-xs text-amber-300 font-semibold">Custom hours for {dayModal.date}</p>
                          <div className="flex items-center gap-2">
                            <select
                              value={overrideStart}
                              onChange={e => setOverrideStart(parseInt(e.target.value))}
                              className="flex-1 text-xs bg-slate-700 border-0 text-white rounded px-2 py-1.5"
                            >
                              {Array.from({ length: 24 }, (_, h) => (
                                <option key={h} value={h}>{formatHour(h)}</option>
                              ))}
                            </select>
                            <span className="text-slate-500 text-xs">to</span>
                            <select
                              value={overrideEnd}
                              onChange={e => setOverrideEnd(parseInt(e.target.value))}
                              className="flex-1 text-xs bg-slate-700 border-0 text-white rounded px-2 py-1.5"
                            >
                              {Array.from({ length: 24 }, (_, h) => (
                                <option key={h} value={h}>{formatHour(h)}</option>
                              ))}
                            </select>
                          </div>
                          <Input
                            value={overrideNote}
                            onChange={e => setOverrideNote(e.target.value)}
                            placeholder="Note (optional)"
                            className="h-8 text-sm bg-slate-700/50 border-slate-600 text-white"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1 bg-amber-700 hover:bg-amber-600 text-white h-8"
                              onClick={() => {
                                if (overrideStart >= overrideEnd) {
                                  toast({ title: "Invalid hours", description: "Start time must be before end time", variant: "destructive" });
                                  return;
                                }
                                upsertHourOverrideMutation.mutate({ date: dayModal.date, startHour: overrideStart, endHour: overrideEnd, note: overrideNote || undefined });
                              }}
                              disabled={upsertHourOverrideMutation.isPending || overrideStart >= overrideEnd}
                            >
                              {upsertHourOverrideMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Hours"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setModalAction(null)} className="h-8 text-slate-400">Cancel</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {dayModal.jobs.length === 0 && !dayModal.isBlocked && !dayModal.hourOverride && !modalAction && (
                <p className="text-xs text-slate-500 text-center py-1">Open day — tap an option above to manage</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="h-2" />
    </div>
  );
}
