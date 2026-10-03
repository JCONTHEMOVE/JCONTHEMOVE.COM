import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { WorkInsights } from '@/components/WorkInsights';
import type { InsightJob } from '@shared/workInsights';
import {
  Users, Activity, Coins, TrendingUp, Wallet, Bitcoin, ChevronRight, Handshake, BarChart2, CalendarDays
} from "lucide-react";

interface AdminStats {
  totalLeads: number;
  activeLeads: number;
  totalUsers: number;
  jcmovesBurned: number;
  jcmovesFundBalance: number;
  completedJobs: number;
  pendingLeads: number;
}

interface TrafficTotals {
  this_month_views: string;
  this_month_unique: string;
}

interface Payout {
  id: string;
  status: string;
  amount: string;
}

interface BtcPayment {
  id: string;
  status: string;
  amount: string;
}

export default function AdminOverviewPage() {
  const { user } = useAuth();
  const jobs = useQuery<InsightJob[]>({
    queryKey: ['/api/jobs/flow?scope=admin'],
    refetchInterval: 30000,
    enabled: ['admin', 'business_owner'].includes(user?.role || ''),
  });

  const { data: adminStats } = useQuery<AdminStats>({ queryKey: ["/api/admin/stats"] });
  const { data: trafficData } = useQuery<{ totals: TrafficTotals }>({ queryKey: ["/api/admin/analytics/traffic"], refetchInterval: 60000 });
  const { data: liveBalance } = useQuery<{ balance: number }>({ queryKey: ["/api/solana/balance"], refetchInterval: 30000 });
  const { data: pendingPayouts } = useQuery<{ payouts: Payout[] }>({ queryKey: ["/api/admin/payouts/pending"] });
  const { data: btcPayments } = useQuery<BtcPayment[]>({ queryKey: ["/api/admin/btc-payments"] });
  const { data: projection } = useQuery<{ projectedToday: number; sampleCount: number }>({
    queryKey: ["/api/admin/revenue-projection"],
    refetchInterval: 60000,
  });

  const pendingPayoutCount = pendingPayouts?.payouts?.length || 0;
  const pendingBtcCount = btcPayments?.filter((p: BtcPayment) => p.status === "pending").length || 0;

  return (
    <div className="max-w-5xl mx-auto px-4 pt-8 pb-8">
      <div className="text-center mb-8">
        <div className="inline-block mb-3 px-3 py-1 bg-blue-600/20 border border-blue-500/30 rounded-full">
          <span className="text-blue-300 text-xs font-semibold uppercase tracking-wider">Admin</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-text text-transparent mb-2">
          IN GOD WE TRUST
        </h1>
        <p className="text-slate-400">Command Center — {user?.firstName}</p>
      </div>

      <WorkInsights jobs={jobs.data} audience="owner" isLoading={jobs.isLoading} isError={jobs.isError}
        isFetching={jobs.isFetching} updatedAt={jobs.dataUpdatedAt} onRefresh={() => { void jobs.refetch(); }} />

      {/* Live Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { icon: Coins, label: "JCMOVES Balance", value: (liveBalance?.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }), color: "text-purple-400" },
          { icon: TrendingUp, label: "JCMOVES Burned", value: (adminStats?.jcmovesBurned || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }), color: "text-green-400" },
          { icon: Activity, label: "Active Leads", value: String(adminStats?.activeLeads ?? "—"), color: "text-blue-400" },
          { icon: Users, label: "Total Users", value: String(adminStats?.totalUsers ?? "—"), color: "text-orange-400" },
          { icon: BarChart2, label: "Views This Month", value: Number(trafficData?.totals?.this_month_views || 0).toLocaleString(), color: "text-cyan-400" },
          { icon: Users, label: "Visitors This Month", value: Number(trafficData?.totals?.this_month_unique || 0).toLocaleString(), color: "text-teal-400" },
          {
            icon: TrendingUp,
            label: `Projected Today${projection?.sampleCount ? ` (${projection.sampleCount}w avg)` : ""}`,
            value: projection ? `$${Math.round(projection.projectedToday).toLocaleString()}` : "—",
            color: "text-emerald-400",
          },
        ].map(s => (
          <Card key={s.label} className="border-white/5 bg-white/[0.03]">
            <CardContent className="p-4 text-center">
              <s.icon className={`h-5 w-5 ${s.color} mx-auto mb-1.5`} />
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending Alerts */}
      {(pendingPayoutCount > 0 || pendingBtcCount > 0) && (
        <div className="flex flex-wrap gap-2 mb-6">
          {pendingPayoutCount > 0 && (
            <Link href="/admin/finance">
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/20 border border-amber-500/40 rounded-lg cursor-pointer hover:bg-amber-500/30 transition-colors">
                <Wallet className="h-4 w-4 text-amber-400" />
                <span className="text-amber-300 text-sm font-semibold">{pendingPayoutCount} pending payout{pendingPayoutCount !== 1 ? "s" : ""}</span>
                <ChevronRight className="h-3 w-3 text-amber-500" />
              </div>
            </Link>
          )}
          {pendingBtcCount > 0 && (
            <Link href="/admin/finance">
              <div className="flex items-center gap-2 px-3 py-2 bg-orange-500/20 border border-orange-500/40 rounded-lg cursor-pointer hover:bg-orange-500/30 transition-colors">
                <Bitcoin className="h-4 w-4 text-orange-400" />
                <span className="text-orange-300 text-sm font-semibold">{pendingBtcCount} BTC payment{pendingBtcCount !== 1 ? "s" : ""}</span>
                <ChevronRight className="h-3 w-3 text-orange-500" />
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Quick Links Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { href: "/admin/ops-board", label: "Ops Board", desc: "Quote stack, month view & fast quotes", color: "from-blue-600 to-cyan-700", icon: Activity },
          { href: "/admin/jobs", label: "Jobs", desc: "All leads, pipeline & job management", color: "from-amber-600 to-orange-600", icon: Activity },
          { href: "/admin/schedule", label: "Schedule", desc: "Weekly calendar — dispatch crew emails", color: "from-blue-600 to-indigo-700", icon: CalendarDays },
          { href: "/admin/people", label: "People", desc: "Users, roles, employees", color: "from-orange-600 to-orange-700", icon: Users },
          { href: "/admin/finance", label: "Finance", desc: "Treasury, transfers, payouts", color: "from-emerald-600 to-green-700", icon: Activity },
          { href: "/admin/marketplace", label: "Marketplace", desc: "Rewards, lottery, promo codes", color: "from-purple-600 to-purple-700", icon: Activity },
          { href: "/admin/sponsors", label: "Sponsors", desc: "Manage sponsor sign-ups & tiers", color: "from-yellow-600 to-amber-700", icon: Handshake },
          { href: "/admin/system", label: "System", desc: "System check, Square, config", color: "from-slate-500 to-slate-700", icon: Activity },
          { href: "/admin/analytics", label: "Analytics", desc: "Traffic, page views & visitor stats", color: "from-cyan-600 to-teal-700", icon: BarChart2 },
          { href: "/crew", label: "Team Hub", desc: "Today's jobs, crew status, inspiration", color: "from-blue-600 to-blue-700", icon: Activity },
        ].map(item => (
          <Link key={item.href} href={item.href}>
            <div className="group flex items-center gap-3 border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 rounded-xl p-4 cursor-pointer transition-all">
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${item.color} flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                <item.icon className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm">{item.label}</p>
                <p className="text-slate-500 text-xs leading-snug truncate">{item.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
