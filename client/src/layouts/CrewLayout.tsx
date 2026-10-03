import { canLeaveTask } from "@/components/task-ui";
import { useLocation } from "wouter";
import { useState, type ReactNode } from "react";
import { BarChart3, Briefcase, Calendar, Coins, Gift, Star, Settings2, PlusCircle, ChevronRight, Megaphone, GraduationCap, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCrewGpsBeacon } from "@/hooks/useCrewGpsBeacon";
import { TutorialInviteDialog } from "@/components/tutorial-invite-dialog";
import { Switch } from "@/components/ui/switch";
import { useAdminViewMode } from "@/hooks/useAdminViewMode";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const optionLinks = [
  { label: "Work", description: "Current leads and job requests", icon: Briefcase, path: "/crew" },
  { label: "Job Planner", description: "Full job calendar", icon: Calendar, path: "/crew/calendar" },
  { label: "Get work", description: "Marketing materials and referral links", icon: Megaphone, path: "/crew/marketing" },
  { label: "Pricing datasets", description: "Job scenarios and pricing contributions", icon: Users, path: "/crew/pricing-training" },
  { label: "Monthly progress", description: "Job stages and tracking", icon: BarChart3, path: "/crew/progress" },
  { label: "Rewards & redemptions", description: "Reward shop and redemption history", icon: Gift, path: "/crew/rewards" },
  { label: "Schedule", description: "Availability and blocked days", icon: Calendar, path: "/crew/schedule" },
  { label: "Reviews", description: "Customer feedback and rating", icon: Star, path: "/crew/reviews" },
  { label: "Earnings", description: "Payouts, JCMOVES, history", icon: Coins, path: "/crew/earnings" },
  { label: "Tutorials", description: "Step-by-step app walkthroughs", icon: GraduationCap, path: "/crew/tutorials" },
  { label: "Add Job", description: "Create a job on the shared calendar", icon: PlusCircle, path: "/crew/add-job" },
];

export default function CrewLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { user } = useAuth();
  const { isCrewPreview, setCrewPreview } = useAdminViewMode();
  const isAdminUser = user?.role === "admin" || user?.role === "business_owner";
  // Task #173 — GPS beacon at the app-shell layer so tracking continues
  // across every /crew/* tab while the worker is on duty, not just on
  // the Today page. Duty is derived from the user's isAvailable +
  // availableUntil fields (same source that drives go-online / offline).
  const isOnDuty = Boolean(
    user?.isAvailable &&
      user?.availableUntil &&
      new Date(user.availableUntil).getTime() > Date.now(),
  );
  useCrewGpsBeacon({ enabled: isOnDuty });
  const mainLinks = [
    { label: "Work", path: "/crew", icon: Briefcase, active: ["/crew", "/crew/", "/crew/calendar", "/crew/jobs", "/crew/add-job", "/crew/schedule"].includes(location) },
    { label: "Get work", path: "/crew/marketing", icon: Megaphone, active: ["/crew/marketing", "/crew/pricing-training"].includes(location) },
    { label: "Progress", path: "/crew/progress", icon: BarChart3, active: location === "/crew/progress" },
    { label: "Rewards", path: "/crew/rewards", icon: Gift, active: location === "/crew/rewards" || location.startsWith("/crew/rewards?") },
  ];

  function go(path: string) {
    if (!canLeaveTask()) return;
    setOptionsOpen(false);
    setLocation(path);
  }

  function returnToAdmin() {
    if (!canLeaveTask()) return;
    setCrewPreview(false);
    setOptionsOpen(false);
    setLocation("/admin/ops-board");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-20">
      {isAdminUser && (
        <div className="sticky top-0 z-40 border-b border-cyan-500/20 bg-slate-950/95 px-3 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
              {isCrewPreview ? <Users className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">
                {isCrewPreview ? "Crew View" : "Crew Tools"}
              </p>
              <p className="truncate text-[11px] text-cyan-100/70">
                {isCrewPreview ? "Previewing the worker app" : "Admin account"}
              </p>
            </div>
            <Switch
              checked={isCrewPreview}
              onCheckedChange={(checked) => {
                if (checked) setCrewPreview(true);
                else returnToAdmin();
              }}
              aria-label="Toggle crew view"
              className="data-[state=checked]:bg-cyan-500"
              data-testid="switch-crew-preview"
            />
            <button
              type="button"
              onClick={returnToAdmin}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-white"
              data-testid="button-return-admin-view"
            >
              Admin
            </button>
          </div>
        </div>
      )}
      <div className="mx-auto flex max-w-4xl justify-end px-4 pt-2 sm:px-6"><button type="button" onClick={() => setOptionsOpen(true)} title="More crew options" aria-label="More crew options" className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white"><Settings2 className="h-5 w-5" /></button></div>
      {children}
      <nav aria-label="Worker navigation" className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm safe-area-bottom">
        <div className="mx-auto grid h-16 max-w-4xl grid-cols-4">
          {mainLinks.map(({ label, path, icon: Icon, active }) => <button key={path} type="button" onClick={() => go(path)} aria-current={active ? 'page' : undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${active ? 'font-semibold text-emerald-300' : 'text-zinc-400 hover:text-white'}`}><Icon aria-hidden="true" className="h-5 w-5" /><span>{label}</span></button>)}
        </div>
      </nav>
      <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto border-slate-700 bg-slate-950 text-white">
          <SheetHeader className="text-left">
            <SheetTitle className="text-white">Options</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid gap-2">
            {optionLinks.map(({ label, description, icon: Icon, path }) => (
              <button
                key={path}
                type="button"
                onClick={() => go(path)}
                className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-900"
              >
                <Icon className="h-5 w-5 text-blue-300" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">{label}</span>
                  <span className="block truncate text-xs text-slate-400">{description}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <TutorialInviteDialog audience="crew" currentPath={location} onNavigate={go} />
    </div>
  );
}
