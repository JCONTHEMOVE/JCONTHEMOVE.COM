import { useLocation } from "wouter";
import { useState, type ReactNode } from "react";
import { CalendarDays, Briefcase, Calendar, Coins, Star, Settings2, PlusCircle, ChevronRight, Megaphone, GraduationCap, ShieldCheck, Users } from "lucide-react";
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
  { label: "Job Planner", description: "Calendar, open work, and job details", icon: Briefcase, path: "/crew" },
  { label: "Schedule", description: "Availability and blocked days", icon: Calendar, path: "/crew/schedule" },
  { label: "Reviews", description: "Customer feedback and rating", icon: Star, path: "/crew/reviews" },
  { label: "Marketing", description: "Create tracked local ads", icon: Megaphone, path: "/crew/marketing" },
  { label: "Earnings", description: "Payouts, JCMOVES, history", icon: Coins, path: "/crew/earnings" },
  { label: "Tutorials", description: "Step-by-step app walkthroughs", icon: GraduationCap, path: "/crew/tutorials" },
  { label: "Pricing Training", description: "Help finish 500 requests and earn JCMOVES", icon: Users, path: "/crew/pricing-training" },
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
  const tasksActive = location === "/crew" || location === "/crew/" || location.startsWith("/crew/jobs");
  const optionsActive = location.startsWith("/crew/schedule") || location.startsWith("/crew/reviews") || location.startsWith("/crew/earnings") || location.startsWith("/crew/marketing") || location.startsWith("/crew/tutorials") || location.startsWith("/crew/add-job") || location.startsWith("/crew/pricing-training");

  function go(path: string) {
    setOptionsOpen(false);
    setLocation(path);
  }

  function returnToAdmin() {
    setCrewPreview(false);
    setOptionsOpen(false);
    setLocation("/admin/ops-board");
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white pb-20">
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
      {children}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700/50 safe-area-bottom">
        <div className="grid h-16 grid-cols-2">
          <button
            type="button"
            onClick={() => go("/crew")}
            aria-label="Tasks"
            className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
              tasksActive ? "text-blue-400" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <CalendarDays className={`h-5 w-5 ${tasksActive ? "stroke-[2.5]" : ""}`} />
            <span className={`text-[10px] ${tasksActive ? "font-bold" : "font-medium"}`}>Tasks</span>
          </button>
          <button
            type="button"
            onClick={() => setOptionsOpen(true)}
            aria-label="Options"
            className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
              optionsActive || optionsOpen ? "text-blue-400" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Settings2 className={`h-5 w-5 ${optionsActive || optionsOpen ? "stroke-[2.5]" : ""}`} />
            <span className={`text-[10px] ${optionsActive || optionsOpen ? "font-bold" : "font-medium"}`}>Options</span>
          </button>
        </div>
      </nav>
      <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
        <SheetContent side="bottom" className="border-slate-700 bg-slate-950 text-white">
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
