import { canLeaveTask } from "@/components/task-ui";
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Radio, Briefcase, Users, Wallet, Sliders, ChevronRight, LogOut,
  Menu, X, CalendarDays, FileBarChart, Rocket, AlertTriangle,
  ClipboardList, Megaphone, Lightbulb, Store, GraduationCap, MapPinned, Coins,
  Bot,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, clearTokens, queryClient } from "@/lib/queryClient";
import { TutorialInviteDialog } from "@/components/tutorial-invite-dialog";
import { Switch } from "@/components/ui/switch";
import { useAdminViewMode } from "@/hooks/useAdminViewMode";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationList } from "@/components/notification-list";

// Task #196 — Lead funnel outage banner. Shown across every admin page
// when the customer-quote submission rate drops to zero during a window
// where it should not be zero (Mercer-style outage).
type LeadFunnelAlert = {
  id: number;
  startedAt: string;
  windowMinutes: number;
  previousCount: number;
};

function LeadFunnelOutageBanner() {
  const { data } = useQuery<{ alert: LeadFunnelAlert | null }>({
    queryKey: ["/api/admin/lead-funnel-alert"],
    refetchInterval: 60_000,
  });
  const alert = data?.alert;
  if (!alert) return null;
  let startedDisplay = alert.startedAt;
  try {
    startedDisplay = new Date(alert.startedAt).toLocaleString();
  } catch {}
  return (
    <div
      className="mx-3 md:mx-6 mt-3 md:mt-4 mb-2 flex items-start gap-3 px-4 py-3 bg-red-500/15 border border-red-500/40 rounded-lg"
      data-testid="banner-lead-funnel-outage"
    >
      <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-red-200 font-semibold text-sm">
          Lead funnel down — 0 customer quote submissions in the last {alert.windowMinutes} minutes
        </p>
        <p className="text-red-300/80 text-xs mt-0.5 leading-snug">
          The previous {alert.windowMinutes}-minute window had {alert.previousCount}. Detected{" "}
          {startedDisplay}. Check the public quote form and recent server errors.
        </p>
      </div>
    </div>
  );
}

// Task #171 — Admin sidebar has two sections:
//   "Tasks" = the pages operators use to move jobs right now.
//   "Options" = settings, reports, marketplace, money, and launch tools.
// Keep this list in sync with the routes wired in client/src/App.tsx.
const TASKS = [
  { label: "Job Planner", icon: CalendarDays, path: "/admin/schedule" },
  { label: "Chief of Staff", icon: Bot, path: "/admin/chief-of-staff" },
  { label: "Ops Board", icon: ClipboardList, path: "/admin/ops-board" },
  { label: "Dispatch", icon: Radio, path: "/admin/dispatch" },
];

const OPTIONS = [
  { label: "Pricing", icon: Sliders, path: "/admin/pricing" },
  { label: "People", icon: Users, path: "/admin/people" },
  { label: "Finance", icon: Wallet, path: "/admin/finance" },
  { label: "Gift Bonuses", icon: Coins, path: "/admin/gift-card-bonuses" },
  { label: "Funnel", icon: FileBarChart, path: "/admin/booking-analytics" },
  { label: "Regional", icon: MapPinned, path: "/admin/regional-automation" },
  { label: "Northwoods Bot", icon: Megaphone, path: "/admin/marketing" },
  { label: "Marketplace", icon: Store, path: "/admin/marketplace" },
  { label: "Playbook", icon: Lightbulb, path: "/admin/marketplace-playbook" },
  { label: "Tutorials", icon: GraduationCap, path: "/admin/tutorials" },
  { label: "Launch", icon: Rocket, path: "/admin/launch-checklist" },
];

function NavButton({ label, Icon, path, active, onClick }: {
  label: string; Icon: any; path: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      key={path}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active
          ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
          : "text-slate-400 hover:text-white hover:bg-white/5"
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {active && <ChevronRight className="h-3 w-3 text-blue-400" />}
    </button>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const { isCrewPreview, setCrewPreview } = useAdminViewMode();

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      clearTokens();
      queryClient.clear();
      window.location.href = "/";
    }
  };

  const isActive = (path: string) =>
    path === "/admin"
      ? (location === "/admin" || location === "/admin/")
      : (location === path || location.startsWith(`${path}/`));

  const go = (p: string) => { if (canLeaveTask()) setLocation(p); setMobileOpen(false); };
  const setCrewView = (enabled: boolean) => {
    if (!canLeaveTask()) return;
    setCrewPreview(enabled);
    if (enabled) {
      setLocation("/crew");
      setMobileOpen(false);
    }
  };

  const optionsContainsActive = OPTIONS.some(c => isActive(c.path));

  const renderCrewPreviewToggle = () => (
    <div className="mx-2 mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">Crew View</p>
          <p className="text-[11px] leading-tight text-cyan-100/70">See the worker app</p>
        </div>
        <Switch
          checked={isCrewPreview}
          onCheckedChange={setCrewView}
          aria-label="Toggle crew view"
          className="data-[state=checked]:bg-cyan-500"
          data-testid="switch-admin-crew-view"
        />
      </div>
    </div>
  );

  const renderNav = (onSelect: (p: string) => void) => (
    <>
      <div className="px-2 space-y-0.5">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 px-3 mb-1">Tasks</p>
        {TASKS.map(({ label, icon: Icon, path }) => (
          <NavButton key={path} label={label} Icon={Icon} path={path}
            active={isActive(path)} onClick={() => onSelect(path)} />
        ))}
      </div>

      <div className="mt-4 px-2">
        <button
          onClick={() => setOptionsOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          data-testid="button-toggle-admin-options"
        >
          <span className="flex-1 text-left">Options</span>
          {optionsContainsActive && !optionsOpen && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          )}
          <ChevronRight className={`h-3 w-3 transition-transform ${optionsOpen ? "rotate-90" : ""}`} />
        </button>
        {(optionsOpen || optionsContainsActive) && (
          <div className="mt-1 space-y-0.5">
            {OPTIONS.map(({ label, icon: Icon, path }) => (
              <NavButton key={path} label={label} Icon={Icon} path={path}
                active={isActive(path)} onClick={() => onSelect(path)} />
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex flex-col w-56 min-h-screen border-r border-slate-800/60 bg-slate-950/80 fixed left-0 top-0 bottom-0 z-40 pt-6 overflow-y-auto">
          <div className="px-4 mb-6">
            <div className="inline-block px-3 py-1 bg-blue-600/20 border border-blue-500/30 rounded-full mb-2">
              <span className="text-blue-300 text-xs font-semibold uppercase tracking-wider">Admin</span>
            </div>
            <h2 className="text-lg font-black text-white">IN GOD WE TRUST</h2>
          </div>
          {renderCrewPreviewToggle()}
          <nav className="flex-1">
            {renderNav(go)}
          </nav>
          <div className="px-2 pb-6 pt-2">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/20 hover:border-white/40 text-white transition-all"
              data-testid="button-admin-logout"
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              Logout
            </button>
          </div>
        </aside>

        {/* Mobile header w/ hamburger */}
        <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800/60 h-12 flex items-center px-3 gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open admin menu"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-white/5"
            data-testid="button-mobile-admin-menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-white">Admin</span>
          <div className="ml-auto"><NotificationBell onClick={() => setNotificationOpen(true)} /></div>
          <button
            type="button"
            onClick={() => setCrewView(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-xs font-semibold text-cyan-100"
            data-testid="button-mobile-crew-view"
          >
            <Users className="h-3.5 w-3.5" />
            Crew
          </button>
        </header>

        {/* Mobile drawer */}
        {mobileOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 bg-black/60 z-50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="md:hidden fixed left-0 top-0 bottom-0 w-72 max-w-[85vw] z-50 bg-slate-950 border-r border-slate-800/60 pt-4 overflow-y-auto">
              <div className="px-4 mb-4 flex items-center justify-between">
                <h2 className="text-base font-black text-white">IN GOD WE TRUST</h2>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-1.5 rounded-lg text-slate-300 hover:bg-white/5"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {renderCrewPreviewToggle()}
              <nav>{renderNav(go)}</nav>
              <div className="px-2 py-4 mt-2 border-t border-slate-800/60">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </aside>
          </>
        )}

        {/* Main content */}
        <main className="min-w-0 w-full flex-1 md:ml-56 pt-12 md:pt-0 pb-6">
          <div className="fixed right-4 top-4 z-40 hidden md:block rounded-full border border-slate-700 bg-slate-950/90 shadow-xl"><NotificationBell onClick={() => setNotificationOpen(true)} /></div>
          <LeadFunnelOutageBanner />
          {children}
        </main>
        <NotificationList open={notificationOpen} onOpenChange={setNotificationOpen} />
        <TutorialInviteDialog audience="admin" currentPath={location} onNavigate={go} />
      </div>
    </div>
  );
}
