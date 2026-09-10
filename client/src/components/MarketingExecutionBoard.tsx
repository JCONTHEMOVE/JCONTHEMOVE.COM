import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Copy, ExternalLink, Link2, Mail, Megaphone, Send, Target } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Action = {
  id: string;
  title: string;
  description: string;
  status: string;
  proof_url: string | null;
  proof_notes: string | null;
};

type Rep = {
  id: string;
  slug: string;
  display_name: string;
  brand_name: string;
  promo_code: string;
  service_focus: string[];
  territory: string;
  audience: string;
  booked_revenue: number;
  accountLinked: boolean;
  attributionLinked: boolean;
  profileUrl: string;
  onboardingTask: string | null;
  actions: Action[];
  linked_first_name: string | null;
  linked_last_name: string | null;
};

type Goal = {
  id: string;
  label: string;
  target_revenue: string | number;
  credited_revenue: number;
  progressPercent: number;
  daysRemaining: number;
  remaining: number;
  dailyPace: number;
  currentRequiredDailyPace: number;
  suggestedRepShare: number;
};

type EligibleUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string | null;
};

type Overview = {
  siteUrl: string;
  discordInviteUrl: string;
  reps: Rep[];
  goals: Goal[];
  routes: Array<{ key: string; label: string; day: string; area: string; nearbyAreas?: string[] }>;
  eligibleUsers: EligibleUser[];
  invites: Array<{ id: string; recipient_name: string; rep_name: string | null; delivery_channel: string; status: string; delivery_note: string | null; created_at: string }>;
  launch: { total: number; completed: number; pendingAttribution: number };
};

const money = (value: number | string | null | undefined) => Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function MarketingExecutionBoard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [inviteRepId, setInviteRepId] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteChannel, setInviteChannel] = useState<"in_app" | "email" | "sms" | "manual">("manual");
  const [lastInvite, setLastInvite] = useState<{ message: string; inviteUrl: string } | null>(null);

  const overview = useQuery<Overview>({
    queryKey: ["/api/admin/marketing-execution/overview"],
    refetchInterval: 60000,
  });
  const data = overview.data;

  const completeAction = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/admin/marketing-execution/actions/${id}/complete`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-execution/overview"] });
      toast({ title: "Launch action completed" });
    },
    onError: (error: Error) => toast({ title: "Could not update action", description: error.message, variant: "destructive" }),
  });

  const linkRep = useMutation({
    mutationFn: async ({ repId, userId }: { repId: string; userId: string }) => {
      const response = await apiRequest("POST", "/api/admin/marketing-execution/link-rep", { repId, userId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-execution/overview"] });
      toast({ title: "Marketing profile linked", description: "Promo attribution will now follow the crew account." });
    },
    onError: (error: Error) => toast({ title: "Could not link profile", description: error.message, variant: "destructive" }),
  });

  const createInvite = useMutation({
    mutationFn: async ({ sendNow }: { sendNow: boolean }) => {
      const response = await apiRequest("POST", "/api/admin/marketing-execution/invites", {
        repId: inviteRepId || null,
        recipientUserId: inviteUserId || null,
        recipientName: inviteName.trim() || "Crew member",
        recipientEmail: inviteEmail.trim(),
        recipientPhone: invitePhone.trim(),
        deliveryChannel: inviteChannel,
        sendNow,
      });
      return response.json();
    },
    onSuccess: (result) => {
      setLastInvite({ message: result.message, inviteUrl: result.inviteUrl });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-execution/overview"] });
      toast({ title: result.invite?.status === "sent" ? "Invitation sent" : "Invitation created", description: result.invite?.delivery_note });
    },
    onError: (error: Error) => toast({ title: "Could not create invitation", description: error.message, variant: "destructive" }),
  });

  const launchPercent = useMemo(() => {
    if (!data?.launch.total) return 0;
    return Math.round((data.launch.completed / data.launch.total) * 100);
  }, [data?.launch]);

  function selectInviteUser(userId: string) {
    setInviteUserId(userId);
    const user = data?.eligibleUsers.find((item) => item.id === userId);
    if (!user) return;
    setInviteName(user.name);
    setInviteEmail(user.email || "");
    setInvitePhone(user.phone || "");
  }

  function copy(value: string, label: string) {
    navigator.clipboard?.writeText(value)
      .then(() => toast({ title: `${label} copied` }))
      .catch(() => toast({ title: "Copy failed", description: value, variant: "destructive" }));
  }

  if (overview.isLoading) return <p className="text-sm text-zinc-400">Loading marketing execution plan…</p>;
  if (!data) return <p className="text-sm text-red-300">Marketing execution data is unavailable.</p>;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <Card className="border-amber-400/25 bg-gradient-to-br from-amber-400/10 via-zinc-950 to-zinc-950">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">25-action launch</p>
                <h2 className="mt-1 text-2xl font-black text-white">One family. Five local faces.</h2>
                <p className="mt-2 max-w-2xl text-sm text-zinc-300">Every profile works the shared route calendar with a distinct specialty, promo code, and tracked booking link.</p>
              </div>
              <Megaphone className="h-7 w-7 shrink-0 text-amber-300" />
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${launchPercent}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-zinc-400"><span>{data.launch.completed} of {data.launch.total} actions complete{data.launch.pendingAttribution ? ` (${data.launch.pendingAttribution} awaiting attribution)` : ""}</span><span>{launchPercent}%</span></div>
          </CardContent>
        </Card>
        <Card className="border-indigo-400/25 bg-indigo-500/10">
          <CardContent className="p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-200">Crew communication</p>
            <p className="mt-2 text-sm text-zinc-100">Every invite includes the website onboarding path and the crew Discord.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="border-indigo-300/35" onClick={() => copy(data.discordInviteUrl, "Discord invite")}><Copy className="mr-2 h-3.5 w-3.5" />Copy Discord</Button>
              <a href={data.discordInviteUrl} target="_blank" rel="noreferrer"><Button size="sm" className="bg-indigo-500 hover:bg-indigo-400"><ExternalLink className="mr-2 h-3.5 w-3.5" />Open Discord</Button></a>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {data.goals.map((goal) => (
          <Card key={goal.id} className="border-white/10 bg-white/[0.04]">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3"><Target className="h-5 w-5 text-emerald-300" /><span className="text-xs font-mono text-zinc-500">{goal.daysRemaining} days left</span></div>
              <p className="mt-3 text-sm font-black text-white">{goal.label}</p>
              <p className="mt-1 text-2xl font-black text-emerald-300">{money(goal.credited_revenue)} <span className="text-sm text-zinc-500">/ {money(goal.target_revenue)}</span></p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${goal.progressPercent}%` }} /></div>
              <p className="mt-3 text-xs text-zinc-400">Need {money(goal.remaining)} more - plan {money(goal.dailyPace)}/day - required now {money(goal.currentRequiredDailyPace)}/day - suggested {money(goal.suggestedRepShare)} each</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2"><CalendarDaysIcon /><div><h2 className="font-black text-white">Shared route-day calendar</h2><p className="text-xs text-zinc-500">Every profile can market every route; choose the service angle that fits the day.</p></div></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {data.routes.map((route) => (
            <Card key={route.key} className="border-white/10 bg-zinc-900/70"><CardContent className="p-3"><p className="text-sm font-black text-amber-200">{route.label}</p><p className="mt-1 text-xs text-zinc-400">{route.day} · {route.area}</p><p className="mt-2 text-[11px] text-zinc-500">{route.nearbyAreas?.join(", ")}</p></CardContent></Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {data.reps.map((rep) => {
          const complete = rep.actions.filter((action) => action.status === "completed").length;
          const linkedName = [rep.linked_first_name, rep.linked_last_name].filter(Boolean).join(" ");
          return (
            <Card key={rep.id} className="border-white/10 bg-white/[0.04]">
              <CardHeader className="pb-2"><CardTitle className="flex items-start justify-between gap-3"><span><span className="block text-lg">{rep.brand_name}</span><span className="mt-1 block text-xs font-mono text-amber-300">{rep.promo_code}</span></span><span className="text-right text-xs text-emerald-300">{money(rep.booked_revenue)} booked</span></CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-zinc-300">{rep.service_focus.join(" · ")}</p>
                <p className="text-xs text-zinc-500">{rep.audience}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 ${rep.accountLinked ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-200"}`}>{rep.accountLinked ? `Account: ${linkedName || "linked"}` : "Account linking needed"}</span>
                  <span className={`rounded-full px-2 py-1 ${rep.attributionLinked ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-200"}`}>{rep.attributionLinked ? "Promo attribution ready" : "Promo attribution blocked"}</span>
                  <Link href={`/network/${rep.slug}`}><span className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-blue-500/15 px-2 py-1 text-blue-200"><Link2 className="h-3 w-3" />Rep page</span></Link>
                </div>
                {!rep.attributionLinked && (
                  <div className="flex flex-wrap gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
                    <p className="w-full text-xs text-amber-100">{rep.onboardingTask} Actions stay pending until the account and promo attribution are linked.</p>
                    <select value={linkTargets[rep.id] || ""} onChange={(event) => setLinkTargets((current) => ({ ...current, [rep.id]: event.target.value }))} className="min-w-48 flex-1 rounded-md border border-white/10 bg-zinc-950 px-2 text-xs text-white">
                      <option value="">Link a crew account…</option>
                      {data.eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}
                    </select>
                    <Button size="sm" disabled={!linkTargets[rep.id] || linkRep.isPending} onClick={() => linkRep.mutate({ repId: rep.id, userId: linkTargets[rep.id] })}>Link profile</Button>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-400"><span>Launch actions</span><span>{complete}/{rep.actions.length}</span></div>
                  {rep.actions.map((action) => (
                    <div key={action.id} className="flex gap-3 rounded-lg border border-white/10 bg-zinc-950/55 p-3">
                      <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${action.status === "completed" ? "text-emerald-300" : "text-zinc-600"}`} />
                      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">{action.title}</p><p className="mt-1 text-xs text-zinc-400">{action.description}</p></div>
                      {action.status !== "completed" && <Button size="sm" variant="outline" disabled={completeAction.isPending} onClick={() => completeAction.mutate(action.id)}>Done</Button>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="border-white/10 bg-white/[0.04]"><CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-amber-300" />Crew marketing invite</CardTitle></CardHeader><CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Marketing profile</Label><select value={inviteRepId} onChange={(event) => setInviteRepId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-white"><option value="">General crew invite</option>{data.reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.display_name} · {rep.promo_code}</option>)}</select></div>
            <div><Label>Existing crew account</Label><select value={inviteUserId} onChange={(event) => selectInviteUser(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-white"><option value="">Manual recipient</option>{data.eligibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Name</Label><Input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Crew member" className="mt-1 bg-zinc-950" /></div><div><Label>Delivery</Label><select value={inviteChannel} onChange={(event) => setInviteChannel(event.target.value as typeof inviteChannel)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm text-white"><option value="manual">Copy / manual</option><option value="in_app">In-app notification</option><option value="email">Email</option><option value="sms">SMS</option></select></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label>Email</Label><Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="crew@example.com" className="mt-1 bg-zinc-950" /></div><div><Label>Phone</Label><Input type="tel" value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} placeholder="(906) 555-0123" className="mt-1 bg-zinc-950" /></div></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={createInvite.isPending} onClick={() => createInvite.mutate({ sendNow: false })}>Create copyable invite</Button><Button className="bg-amber-400 text-zinc-950 hover:bg-amber-300" disabled={createInvite.isPending || inviteChannel === "manual"} onClick={() => createInvite.mutate({ sendNow: true })}>{createInvite.isPending ? "Working…" : "Send invite"}</Button></div>
          {lastInvite && <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3"><p className="text-xs font-bold text-emerald-100">Invite ready</p><p className="mt-1 break-all text-xs text-zinc-200">{lastInvite.inviteUrl}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => copy(lastInvite.message, "Invite message")}><Copy className="mr-2 h-3.5 w-3.5" />Copy message</Button></div>}
        </CardContent></Card>
        <Card className="border-white/10 bg-white/[0.04]"><CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-sky-300" />Invite activity</CardTitle></CardHeader><CardContent className="space-y-2">{data.invites.length === 0 ? <p className="text-sm text-zinc-500">No marketing invites yet.</p> : data.invites.slice(0, 8).map((invite) => <div key={invite.id} className="rounded-lg border border-white/10 bg-zinc-950/55 p-3"><div className="flex justify-between gap-2"><p className="text-sm font-semibold text-white">{invite.recipient_name}</p><span className="text-xs text-amber-200">{invite.status.replace(/_/g, " ")}</span></div><p className="mt-1 text-xs text-zinc-400">{invite.rep_name || "General"} · {invite.delivery_channel}</p>{invite.delivery_note && <p className="mt-1 text-xs text-zinc-500">{invite.delivery_note}</p>}</div>)}</CardContent></Card>
      </section>
    </div>
  );
}

function CalendarDaysIcon() {
  return <CalendarDays className="h-5 w-5 text-amber-300" />;
}
