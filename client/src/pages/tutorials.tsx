import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BadgeCheck,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardList,
  DollarSign,
  ExternalLink,
  GraduationCap,
  Megaphone,
  PlayCircle,
  Radio,
  Search,
  ShieldCheck,
  Sliders,
  Star,
  Target,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { MARKETING_WEEKLY_SUMMARY } from "@shared/marketingWeek";

type TutorialRole = "worker" | "admin";

type TutorialStep = {
  id: string;
  title: string;
  detail: string;
  route?: string;
  routeLabel?: string;
};

type Tutorial = {
  id: string;
  role: TutorialRole;
  title: string;
  summary: string;
  icon: typeof Briefcase;
  accent: string;
  minutes: number;
  steps: TutorialStep[];
};

const tutorials: Tutorial[] = [
  {
    id: "worker-start-shift",
    role: "worker",
    title: "Start a worker shift",
    summary: "Get on duty, check today's work, and keep your status clean.",
    icon: PlayCircle,
    accent: "border-blue-500/35 bg-blue-500/10 text-blue-200",
    minutes: 4,
    steps: [
      { id: "open-today", title: "Open Today", detail: "Review weather, availability, open work, and today's assigned jobs.", route: "/crew", routeLabel: "Open Today" },
      { id: "go-online", title: "Go online", detail: "Use the duty control when you are ready to receive assignments and GPS tracking is allowed." },
      { id: "check-job-list", title: "Scan the job list", detail: "Look for urgent work, missing crew, and jobs that need status updates.", route: "/crew/jobs", routeLabel: "Open Jobs" },
      { id: "confirm-schedule", title: "Confirm schedule", detail: "Review blocked days and upcoming work before accepting anything new.", route: "/crew/schedule", routeLabel: "Open Schedule" },
    ],
  },
  {
    id: "worker-accept-complete-job",
    role: "worker",
    title: "Accept and complete a job",
    summary: "Move a job from open work to completed without losing payout context.",
    icon: Briefcase,
    accent: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
    minutes: 6,
    steps: [
      { id: "open-board", title: "Open the job board", detail: "Find jobs that match your schedule, location, and skills.", route: "/crew/jobs", routeLabel: "Open Job Board" },
      { id: "review-card", title: "Review the job card", detail: "Check service type, date, arrival window, estimated hours, route, pay, and notes." },
      { id: "accept-work", title: "Accept only when ready", detail: "Accept when you can actually make the time window and complete the work." },
      { id: "follow-status", title: "Use the job status buttons", detail: "Start work when the job begins and mark complete only after photos, notes, and customer handoff are done." },
      { id: "check-earnings", title: "Check payout history", detail: "After completion, confirm the job appears in earnings or payout review.", route: "/crew/earnings", routeLabel: "Open Earnings" },
    ],
  },
  {
    id: "worker-create-lead",
    role: "worker",
    title: "Create a customer request",
    summary: "Capture a customer lead from the field so admin can price and schedule it.",
    icon: Megaphone,
    accent: "border-orange-500/35 bg-orange-500/10 text-orange-200",
    minutes: 5,
    steps: [
      { id: "open-add-job", title: "Open Add Job", detail: "Use the staff job form when someone asks for help in person, by phone, or by text.", route: "/leads?tab=add", routeLabel: "Open Add Job" },
      { id: "choose-service", title: "Choose the right service", detail: "Pick moving, junk, labor, cleaning, lawn, snow, or the closest matching service." },
      { id: "capture-contact", title: "Capture contact and address", detail: "Save customer name, phone, email if available, pickup address, drop-off address, and requested date." },
      { id: "add-proof", title: "Add notes or photos", detail: "Include item count, stairs, parking, heavy pieces, and any photo or album link." },
      { id: "submit-lead", title: "Submit once", detail: "Submit once and let admin quote from the ops board instead of creating duplicates." },
    ],
  },
  {
    id: "worker-marketing-launch",
    role: "worker",
    title: "Launch your marketing profile",
    summary: "Turn your JC ON THE MOVE profile, promo code, and local posts into trackable booked work.",
    icon: Megaphone,
    accent: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
    minutes: 8,
    steps: [
      { id: "open-marketing", title: "Open Marketing", detail: "Start at the crew marketing screen and confirm your profile is linked to the right rep code.", route: "/crew/marketing", routeLabel: "Open Marketing" },
      { id: "choose-route", title: "Choose a weekly marketing focus", detail: `Match your service angle to ${MARKETING_WEEKLY_SUMMARY}, or a confirmed Ironwood/Northwoods opening. Confirm service dates and crew availability for each job.` },
      { id: "build-tracked-ad", title: "Build a tracked ad", detail: "Use the ad builder to choose the area and service focus, then keep the promo and booking link attached." },
      { id: "share-ad", title: "Share useful local help", detail: "Post only truthful, useful content in allowed groups, texts, or partner channels. Save a proof link or note on your launch action." },
      { id: "capture-followup", title: "Capture and follow up", detail: "Send interested people to the website request path, respond quickly, and log the result so booked value is credited to the team." },
    ],
  },
  {
    id: "admin-text-lead-booking",
    role: "admin",
    title: "Book a text-message lead",
    summary: "Turn a small text lead into a priced job in one pass.",
    icon: ClipboardList,
    accent: "border-cyan-500/35 bg-cyan-500/10 text-cyan-200",
    minutes: 5,
    steps: [
      { id: "open-ops-board", title: "Open Ops Board", detail: "Use the quote stack to find new, contacted, quote-requested, or chatbot leads.", route: "/admin/ops-board", routeLabel: "Open Ops Board" },
      { id: "open-fast-quote", title: "Open Fast Quote", detail: "Select the lead card and use the right-side fast quote drawer." },
      { id: "clean-price", title: "Clean the price fields", detail: "Paste a range or enter a final amount. The drawer stores decimal pricing and itemized lines." },
      { id: "prep-eta", title: "Prep ETA notes", detail: "Confirm address, item path, stairs, parking, and customer text timing before booking." },
      { id: "book-today", title: "Book Today when ready", detail: "For simple text leads, use the fast path to set today, ASAP/text ETA, quote notes, and available status." },
    ],
  },
  {
    id: "admin-dispatch-job",
    role: "admin",
    title: "Dispatch a job",
    summary: "Schedule the work, assign crew, and make sure field notes are visible.",
    icon: Radio,
    accent: "border-violet-500/35 bg-violet-500/10 text-violet-200",
    minutes: 7,
    steps: [
      { id: "open-jobs", title: "Open Jobs", detail: "Find the lead or assigned job and confirm status, price, date, and customer info.", route: "/admin/jobs", routeLabel: "Open Jobs" },
      { id: "check-calendar", title: "Check schedule", detail: "Use the schedule view to avoid double booking and crew conflicts.", route: "/admin/schedule", routeLabel: "Open Schedule" },
      { id: "assign-crew", title: "Assign crew", detail: "Choose enough workers for the crew size and confirm they are available." },
      { id: "send-details", title: "Send job details", detail: "Dispatch notes should include route, timing, item path, access, and customer expectations.", route: "/admin/dispatch", routeLabel: "Open Dispatch" },
      { id: "watch-state", title: "Watch job state", detail: "Track available, accepted, dispatched, in progress, completed, and payout stages." },
    ],
  },
  {
    id: "admin-money-systems",
    role: "admin",
    title: "Money, people, and system checks",
    summary: "Keep payouts, pricing, people, and launch health in order.",
    icon: ShieldCheck,
    accent: "border-amber-500/35 bg-amber-500/10 text-amber-200",
    minutes: 8,
    steps: [
      { id: "review-finance", title: "Review finance", detail: "Check pending payouts, wallet ledger, cashouts, BTC payments, and revenue movement.", route: "/admin/finance", routeLabel: "Open Finance" },
      { id: "tune-pricing", title: "Tune pricing", detail: "Use pricing tools when packages, labor hours, travel, or add-on rules need adjustment.", route: "/admin/pricing", routeLabel: "Open Pricing" },
      { id: "manage-people", title: "Manage people", detail: "Approve workers, verify roles, and keep crew availability aligned with operations.", route: "/admin/people", routeLabel: "Open People" },
      { id: "check-funnel", title: "Check the funnel", detail: "Use analytics to spot booking drops, source issues, and forms that need attention.", route: "/admin/booking-analytics", routeLabel: "Open Funnel" },
      { id: "run-launch", title: "Run launch checks", detail: "Use launch checklist and system views before deploys, campaigns, or busy weekends.", route: "/admin/launch-checklist", routeLabel: "Open Launch" },
    ],
  },
  {
    id: "admin-marketing-command",
    role: "admin",
    title: "Run the marketing command center",
    summary: "Link each rep, assign the 25-action launch, invite crew, and watch booked revenue move toward the bands goals.",
    icon: Target,
    accent: "border-amber-500/35 bg-amber-500/10 text-amber-200",
    minutes: 9,
    steps: [
      { id: "open-command", title: "Open Plan & Goals", detail: "Use the Marketing Network Plan tab as the source of truth for route days, actions, rep health, and revenue pace.", route: "/admin/marketing-network", routeLabel: "Open Marketing Network" },
      { id: "link-profiles", title: "Link accounts and promo codes", detail: "Connect every active marketing profile to the correct crew account before using the profile for attribution or action credit." },
      { id: "launch-actions", title: "Review the 25 launch actions", detail: "Each of the five reps owns profile verification, a tracked campaign, a share, outreach, and follow-up proof." },
      { id: "send-invites", title: "Invite the crew", detail: "Send or copy the onboarding invitation with the website, marketing tutorial, and Discord server link. Check delivery status before assuming it arrived." },
      { id: "review-bands", title: "Review booked revenue pace", detail: "Use booked marketing-attributed revenue to manage the July $10K, September $50K, and December $100K milestones." },
    ],
  },
];

const roleLabels: Record<TutorialRole, string> = {
  worker: "Worker",
  admin: "Admin",
};

function ProgressPill({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="min-w-32">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-300">{pct}%</span>
        <span className="text-slate-500">{done}/{total}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function TutorialsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const defaultRole: TutorialRole = location.startsWith("/admin") || user?.role === "admin" || user?.role === "business_owner" ? "admin" : "worker";
  const [role, setRole] = useState<TutorialRole>(defaultRole);
  const [query, setQuery] = useState("");
  const { data: storedProgress = { completed: [] as string[] } } = useQuery<{ completed: string[] }>({ queryKey: ["/api/tutorial-progress"] });
  const completed = useMemo(() => new Set(storedProgress.completed), [storedProgress.completed]);

  const progressMutation = useMutation({
    mutationFn: async ({ tutorialId, stepId, complete }: { tutorialId: string; stepId: string; complete: boolean }) => {
      const response = await apiRequest("PUT", `/api/tutorial-progress/${tutorialId}/${stepId}`, { complete });
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tutorial-progress"] }),
  });
  const resetMutation = useMutation({
    mutationFn: async (tutorialIds: string[]) => {
      const response = await apiRequest("DELETE", `/api/tutorial-progress?tutorialIds=${encodeURIComponent(tutorialIds.join(","))}`);
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tutorial-progress"] }),
  });

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tutorials.filter((tutorial) => {
      if (tutorial.role !== role) return false;
      if (!term) return true;
      return [
        tutorial.title,
        tutorial.summary,
        ...tutorial.steps.flatMap((step) => [step.title, step.detail]),
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [query, role]);

  const roleTutorials = tutorials.filter((tutorial) => tutorial.role === role);
  const totalSteps = roleTutorials.reduce((sum, tutorial) => sum + tutorial.steps.length, 0);
  const doneSteps = roleTutorials.reduce((sum, tutorial) => (
    sum + tutorial.steps.filter((step) => completed.has(`${tutorial.id}:${step.id}`)).length
  ), 0);

  function toggleStep(tutorialId: string, stepId: string) {
    const key = `${tutorialId}:${stepId}`;
    progressMutation.mutate({ tutorialId, stepId, complete: !completed.has(key) });
  }

  function resetRoleProgress() {
    resetMutation.mutate(roleTutorials.map((tutorial) => tutorial.id));
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-10 pt-6">
      <section className="mb-5 rounded-[8px] border border-slate-800 bg-slate-900/75 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blue-200">
              <GraduationCap className="h-3.5 w-3.5" />
              Training
            </div>
            <h1 className="mt-3 text-3xl font-black text-white">How-To Tutorials</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Step-by-step walkthroughs for daily worker actions and admin operations.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 rounded-[8px] border border-slate-700 bg-slate-950 p-1">
              {(["worker", "admin"] as TutorialRole[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={`rounded-[6px] px-4 py-2 text-sm font-semibold transition-colors ${
                    role === item ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {roleLabels[item]}
                </button>
              ))}
            </div>
            <ProgressPill done={doneSteps} total={totalSteps} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tutorials"
              className="border-slate-700 bg-slate-950 pl-9 text-white"
            />
          </div>
          <Button variant="outline" className="border-slate-700 text-slate-200" onClick={resetRoleProgress} disabled={resetMutation.isPending}>
            Reset {roleLabels[role]} Progress
          </Button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {filtered.map((tutorial) => {
          const Icon = tutorial.icon;
          const tutorialDone = tutorial.steps.filter((step) => completed.has(`${tutorial.id}:${step.id}`)).length;
          return (
            <Card key={tutorial.id} className="border-slate-800 bg-slate-900/80">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className={`grid h-11 w-11 place-items-center rounded-[8px] border ${tutorial.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge className="border-slate-700 bg-slate-950 text-slate-300">
                    {tutorial.minutes} min
                  </Badge>
                </div>
                <div>
                  <CardTitle className="text-lg text-white">{tutorial.title}</CardTitle>
                  <p className="mt-1 text-sm leading-snug text-slate-400">{tutorial.summary}</p>
                </div>
                <ProgressPill done={tutorialDone} total={tutorial.steps.length} />
              </CardHeader>
              <CardContent className="space-y-2">
                {tutorial.steps.map((step, index) => {
                  const key = `${tutorial.id}:${step.id}`;
                  const checked = completed.has(key);
                  return (
                    <div key={step.id} className="rounded-[8px] border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => toggleStep(tutorial.id, step.id)}
                          className="mt-0.5 text-slate-500 transition-colors hover:text-emerald-300"
                          aria-label={checked ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
                        >
                          {checked ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <Circle className="h-5 w-5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                              Step {index + 1}
                            </span>
                            {checked && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                                <BadgeCheck className="h-3 w-3" />
                                Done
                              </span>
                            )}
                          </div>
                          <h2 className="mt-0.5 text-sm font-black text-white">{step.title}</h2>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">{step.detail}</p>
                          {step.route && (
                            <Link href={step.route}>
                              <Button size="sm" variant="outline" className="mt-3 h-8 border-slate-700 text-slate-200">
                                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                {step.routeLabel || "Open Screen"}
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </section>

      {filtered.length === 0 && (
        <div className="rounded-[8px] border border-slate-800 bg-slate-900 p-8 text-center">
          <Star className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm font-semibold text-slate-300">No tutorials match that search.</p>
          <p className="mt-1 text-xs text-slate-500">Clear the search or switch roles.</p>
        </div>
      )}

      <section className="mt-5 grid gap-3 md:grid-cols-3">
        {[
          { icon: CalendarDays, label: "Daily rhythm", value: role === "admin" ? "Quote, schedule, dispatch" : "Online, accept, complete" },
          { icon: DollarSign, label: "Money flow", value: role === "admin" ? "Price, invoice, payout" : "Hours, bonus, earnings" },
          { icon: Sliders, label: "When stuck", value: role === "admin" ? "Use Launch and System" : "Ask admin before guessing" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 rounded-[8px] border border-slate-800 bg-slate-900/70 p-3">
            <item.icon className="h-5 w-5 text-blue-300" />
            <div>
              <div className="text-xs text-slate-500">{item.label}</div>
              <div className="text-sm font-bold text-white">{item.value}</div>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
