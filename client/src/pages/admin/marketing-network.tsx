import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CalendarDays, Copy, DollarSign, Download, Edit3, Eye, Megaphone, Phone, Plus, Save, Tag, Users } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MarketingExecutionBoard } from "@/components/MarketingExecutionBoard";

const REFERRAL_COMMISSION_RATE = 0.05;

type MarketingRep = {
  id: string;
  slug: string;
  displayName: string;
  brandName: string;
  tagline: string;
  promoCode: string;
  serviceFocus: string[];
  territory: string;
  audience: string;
  ctaLabel: string;
  phoneNumber: string;
  contentStrategy?: {
    facebookPersonality?: string;
    weeklyPrompts?: string[];
  };
  isActive: boolean;
  sortOrder: number;
};

type RepStats = {
  rep: MarketingRep;
  calls: number;
  estimates: number;
  booked: number;
  revenue: number;
  commissionPaid: number;
  roi: number;
  split: {
    referralSource: number;
    crewLaborLow: number;
    crewLaborHigh: number;
    truckFuel: number;
    marketingFund: number;
    companyProfitLow: number;
    companyProfitHigh: number;
  };
};

const emptyForm = {
  slug: "",
  displayName: "",
  brandName: "",
  tagline: "",
  promoCode: "",
  serviceFocus: "",
  territory: "",
  audience: "",
  ctaLabel: "Get Quote",
  phoneNumber: "19062859312",
  facebookPersonality: "",
  weeklyPrompts: "",
  isActive: true,
  sortOrder: 100,
};

function money(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function ratio(value: number) {
  return value > 0 ? `${value.toFixed(1)}x` : "0.0x";
}

function percent(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "0.0%";
}

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map(row => row.map(csvEscape).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function weekNumber() {
  const start = new Date(new Date().getFullYear(), 0, 1);
  const diff = Date.now() - start.getTime();
  return Math.min(52, Math.max(1, Math.ceil((diff / 86400000 + start.getDay() + 1) / 7)));
}

export default function AdminMarketingNetworkPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"plan" | "performance" | "calendar" | "reps">("plan");
  const [repId, setRepId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<MarketingRep | null>(null);
  const [form, setForm] = useState(emptyForm);

  const query = new URLSearchParams();
  if (repId) query.set("repId", repId);
  if (serviceType) query.set("serviceType", serviceType);
  if (status) query.set("status", status);
  if (from) query.set("from", from);
  if (to) query.set("to", to);

  const { data: reps = [] } = useQuery<MarketingRep[]>({
    queryKey: ["/api/admin/marketing-network/reps"],
  });

  const { data: statsData, isLoading } = useQuery<{ reps: RepStats[] }>({
    queryKey: [`/api/admin/marketing-network/stats${query.toString() ? `?${query.toString()}` : ""}`],
  });

  const stats = statsData?.reps || [];
  const totals = useMemo(() => stats.reduce((acc, row) => ({
    calls: acc.calls + row.calls,
    estimates: acc.estimates + row.estimates,
    booked: acc.booked + row.booked,
    revenue: acc.revenue + row.revenue,
    commissionPaid: acc.commissionPaid + row.commissionPaid,
  }), { calls: 0, estimates: 0, booked: 0, revenue: 0, commissionPaid: 0 }), [stats]);

  const totalRoi = totals.commissionPaid > 0 ? totals.revenue / totals.commissionPaid : 0;
  const totalConversionRate = totals.estimates > 0 ? (totals.booked / totals.estimates) * 100 : 0;
  const averageBookedRevenue = totals.booked > 0 ? totals.revenue / totals.booked : 0;

  function repPublicUrl(rep: MarketingRep) {
    if (typeof window === "undefined") return `/network/${rep.slug}`;
    return `${window.location.origin}/network/${rep.slug}`;
  }

  async function copyRepLink(rep: MarketingRep) {
    const url = repPublicUrl(rep);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Rep link copied", description: rep.displayName });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  }

  function exportPerformanceCsv() {
    const rows = stats.map(row => {
      const conversionRate = row.estimates > 0 ? (row.booked / row.estimates) * 100 : 0;
      const averageRevenue = row.booked > 0 ? row.revenue / row.booked : 0;
      return [
        row.rep.displayName,
        row.rep.brandName,
        row.rep.slug,
        repPublicUrl(row.rep),
        row.rep.promoCode,
        row.rep.territory,
        row.rep.serviceFocus?.join(" | ") || "",
        row.calls,
        row.estimates,
        row.booked,
        conversionRate.toFixed(1),
        row.revenue.toFixed(2),
        averageRevenue.toFixed(2),
        row.commissionPaid.toFixed(2),
        row.roi.toFixed(2),
        row.split.referralSource.toFixed(2),
        row.split.crewLaborLow.toFixed(2),
        row.split.crewLaborHigh.toFixed(2),
        row.split.truckFuel.toFixed(2),
        row.split.marketingFund.toFixed(2),
        row.split.companyProfitLow.toFixed(2),
        row.split.companyProfitHigh.toFixed(2),
      ];
    });
    downloadCsv(
      `jc-marketing-network-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Rep Name",
        "Brand Name",
        "Slug",
        "Public Link",
        "Promo Code",
        "Territory",
        "Service Focus",
        "Calls",
        "Leads Generated",
        "Booked Jobs",
        "Lead Conversion %",
        "Revenue Generated",
        "Average Booked Job",
        "Estimated Commission",
        "ROI",
        "Referral Source Split",
        "Crew Labor Low",
        "Crew Labor High",
        "Truck Fuel",
        "Marketing Fund",
        "Company Profit Low",
        "Company Profit High",
      ],
      rows
    );
  }

  const saveRep = useMutation({
    mutationFn: async () => {
      const payload = {
        slug: form.slug,
        displayName: form.displayName,
        brandName: form.brandName,
        tagline: form.tagline,
        promoCode: form.promoCode,
        serviceFocus: form.serviceFocus.split("\n").map(s => s.trim()).filter(Boolean),
        territory: form.territory,
        audience: form.audience,
        ctaLabel: form.ctaLabel,
        phoneNumber: form.phoneNumber,
        contentStrategy: {
          facebookPersonality: form.facebookPersonality,
          weeklyPrompts: form.weeklyPrompts.split("\n").map(s => s.trim()).filter(Boolean),
        },
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 100,
      };
      const url = editing ? `/api/admin/marketing-network/reps/${editing.id}` : "/api/admin/marketing-network/reps";
      const method = editing ? "PATCH" : "POST";
      return apiRequest(method, url, payload).then(r => r.json());
    },
    onSuccess: () => {
      toast({ title: editing ? "Rep updated" : "Rep created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-network/reps"] });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/api/admin/marketing-network/stats") });
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (error: any) => toast({ title: "Could not save rep", description: error.message, variant: "destructive" }),
  });

  function startEdit(rep: MarketingRep) {
    setEditing(rep);
    setForm({
      slug: rep.slug,
      displayName: rep.displayName,
      brandName: rep.brandName,
      tagline: rep.tagline,
      promoCode: rep.promoCode,
      serviceFocus: (rep.serviceFocus || []).join("\n"),
      territory: rep.territory,
      audience: rep.audience,
      ctaLabel: rep.ctaLabel,
      phoneNumber: rep.phoneNumber,
      facebookPersonality: rep.contentStrategy?.facebookPersonality || "",
      weeklyPrompts: (rep.contentStrategy?.weeklyPrompts || []).join("\n"),
      isActive: rep.isActive,
      sortOrder: rep.sortOrder,
    });
    setTab("reps");
  }

  const currentWeek = weekNumber();

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-300 font-black">JC ON THE MOVE LLC</p>
            <h1 className="text-2xl md:text-3xl font-black flex items-center gap-3 mt-1">
              <Megaphone className="h-7 w-7 text-amber-300" />
              Marketing Network
            </h1>
          </div>
          <div className="flex gap-2">
            {(["plan", "performance", "calendar", "reps"] as const).map((key) => (
              <Button key={key} variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)} className="capitalize">
                {key}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {[
            { label: "Calls", value: totals.calls, icon: Phone, color: "text-sky-300" },
            { label: "Leads Generated", value: totals.estimates, icon: Users, color: "text-violet-300" },
            { label: "Booked Jobs", value: totals.booked, icon: CalendarDays, color: "text-emerald-300" },
            { label: "Lead Conversion", value: percent(totalConversionRate), icon: BarChart3, color: "text-blue-300" },
            { label: "Revenue Generated", value: money(totals.revenue), icon: BarChart3, color: "text-amber-300" },
            { label: "Avg Booked Job", value: money(averageBookedRevenue), icon: DollarSign, color: "text-green-300" },
            { label: "Est. Commission", value: money(totals.commissionPaid), icon: Tag, color: "text-rose-300" },
            { label: "ROI", value: ratio(totalRoi), icon: BarChart3, color: "text-lime-300" },
          ].map((item) => (
            <Card key={item.label} className="bg-white/[0.04] border-white/10">
              <CardContent className="p-4">
                <item.icon className={`h-5 w-5 ${item.color} mb-2`} />
                <p className={`text-2xl font-black ${item.color}`}>{item.value}</p>
                <p className="text-xs text-zinc-500">{item.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {tab === "plan" && <MarketingExecutionBoard />}

        {tab === "performance" && (
          <div className="space-y-4">
            <Card className="bg-white/[0.04] border-white/10">
              <CardContent className="p-4 grid md:grid-cols-6 gap-3">
                <select value={repId} onChange={e => setRepId(e.target.value)} className="bg-zinc-900 border border-white/10 rounded-md px-3 py-2 text-sm">
                  <option value="">All reps</option>
                  {reps.map(rep => <option key={rep.id} value={rep.id}>{rep.displayName}</option>)}
                </select>
                <Input placeholder="Service type" value={serviceType} onChange={e => setServiceType(e.target.value)} className="bg-zinc-900 border-white/10" />
                <Input placeholder="Status" value={status} onChange={e => setStatus(e.target.value)} className="bg-zinc-900 border-white/10" />
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-zinc-900 border-white/10" />
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-zinc-900 border-white/10" />
                <Button type="button" variant="outline" onClick={exportPerformanceCsv} disabled={!stats.length}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <p className="md:col-span-6 text-xs text-zinc-500">
                  Commission is estimated at {REFERRAL_COMMISSION_RATE * 100}% of booked attributed revenue until the payout is finalized.
                </p>
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-4">
              {isLoading ? <p className="text-zinc-400">Loading marketing stats...</p> : stats.map(row => {
                const conversionRate = row.estimates > 0 ? (row.booked / row.estimates) * 100 : 0;
                const averageRevenue = row.booked > 0 ? row.revenue / row.booked : 0;
                return (
                <Card key={row.rep.id} className="bg-white/[0.04] border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-3">
                      <span>{row.rep.brandName}</span>
                      <span className="text-sm font-mono text-amber-300">{row.rep.promoCode}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-center">
                      <div><p className="text-xl font-black text-sky-300">{row.calls}</p><p className="text-[11px] text-zinc-500">Calls</p></div>
                      <div><p className="text-xl font-black text-violet-300">{row.estimates}</p><p className="text-[11px] text-zinc-500">Leads</p></div>
                      <div><p className="text-xl font-black text-emerald-300">{row.booked}</p><p className="text-[11px] text-zinc-500">Booked</p></div>
                      <div><p className="text-xl font-black text-blue-300">{percent(conversionRate)}</p><p className="text-[11px] text-zinc-500">Convert</p></div>
                      <div><p className="text-xl font-black text-amber-300">{money(row.revenue)}</p><p className="text-[11px] text-zinc-500">Revenue</p></div>
                      <div><p className="text-xl font-black text-green-300">{money(averageRevenue)}</p><p className="text-[11px] text-zinc-500">Avg Job</p></div>
                      <div><p className="text-xl font-black text-lime-300">{ratio(row.roi)}</p><p className="text-[11px] text-zinc-500">ROI</p></div>
                    </div>
                    <div className="rounded-lg bg-zinc-900/70 border border-white/10 p-3 text-sm space-y-1">
                      <div className="flex justify-between"><span>Estimated referral commission {REFERRAL_COMMISSION_RATE * 100}%</span><span>{money(row.split.referralSource)}</span></div>
                      <div className="flex justify-between"><span>Crew labor 35-45%</span><span>{money(row.split.crewLaborLow)} - {money(row.split.crewLaborHigh)}</span></div>
                      <div className="flex justify-between"><span>Truck/fuel 10%</span><span>{money(row.split.truckFuel)}</span></div>
                      <div className="flex justify-between"><span>Marketing fund 5%</span><span>{money(row.split.marketingFund)}</span></div>
                      <div className="flex justify-between text-zinc-300"><span>Company profit estimate</span><span>{money(row.split.companyProfitLow)} - {money(row.split.companyProfitHigh)}</span></div>
                      <div className="flex justify-between text-lime-300"><span>Revenue ROI</span><span>{ratio(row.roi)}</span></div>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/network/${row.rep.slug}`}><Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />Page</Button></Link>
                      <Button size="sm" variant="outline" onClick={() => copyRepLink(row.rep)}><Copy className="h-4 w-4 mr-1" />Copy Link</Button>
                      <Button size="sm" variant="outline" onClick={() => startEdit(row.rep)}><Edit3 className="h-4 w-4 mr-1" />Edit</Button>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          </div>
        )}

        {tab === "calendar" && (
          <div className="grid lg:grid-cols-2 gap-4">
            {reps.filter(r => r.isActive).map(rep => {
              const prompts = rep.contentStrategy?.weeklyPrompts || [];
              return (
                <Card key={rep.id} className="bg-white/[0.04] border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{rep.displayName}</span>
                      <span className="text-xs text-amber-300 font-mono">{rep.promoCode}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-zinc-400">{rep.contentStrategy?.facebookPersonality}</p>
                    {[0, 1, 2, 3].map(offset => {
                      const week = ((currentWeek - 1 + offset) % 52) + 1;
                      return (
                        <div key={week} className="rounded-lg border border-white/10 bg-zinc-900/70 p-3">
                          <p className="text-xs text-amber-300 font-black">Week {week}</p>
                          <p className="text-sm text-zinc-200 mt-1">{prompts[week - 1] || "Add a weekly prompt for this rep."}</p>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "reps" && (
          <div className="grid lg:grid-cols-[420px_1fr] gap-5">
            <Card className="bg-white/[0.04] border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-amber-300" />
                  {editing ? "Edit Rep" : "Add Rep"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                  <div><Label>Sort</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} className="bg-zinc-900 border-white/10" /></div>
                </div>
                <div><Label>Display name</Label><Input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div><Label>Brand name</Label><Input value={form.brandName} onChange={e => setForm({ ...form, brandName: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div><Label>Tagline</Label><Input value={form.tagline} onChange={e => setForm({ ...form, tagline: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Promo code</Label><Input value={form.promoCode} onChange={e => setForm({ ...form, promoCode: e.target.value.toUpperCase() })} className="bg-zinc-900 border-white/10 font-mono" /></div>
                  <div><Label>Phone</Label><Input type="tel" value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                </div>
                <div><Label>CTA label</Label><Input value={form.ctaLabel} onChange={e => setForm({ ...form, ctaLabel: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div><Label>Service focus, one per line</Label><Textarea value={form.serviceFocus} onChange={e => setForm({ ...form, serviceFocus: e.target.value })} className="bg-zinc-900 border-white/10 min-h-24" /></div>
                <div><Label>Territory</Label><Textarea value={form.territory} onChange={e => setForm({ ...form, territory: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div><Label>Audience</Label><Textarea value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div><Label>Facebook personality</Label><Textarea value={form.facebookPersonality} onChange={e => setForm({ ...form, facebookPersonality: e.target.value })} className="bg-zinc-900 border-white/10" /></div>
                <div><Label>Weekly prompts, one per line</Label><Textarea value={form.weeklyPrompts} onChange={e => setForm({ ...form, weeklyPrompts: e.target.value })} className="bg-zinc-900 border-white/10 min-h-32" /></div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 p-3">
                  <span className="text-sm font-bold">Active</span>
                  <Switch checked={form.isActive} onCheckedChange={checked => setForm({ ...form, isActive: checked })} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => saveRep.mutate()} disabled={saveRep.isPending} className="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black">
                    <Save className="h-4 w-4 mr-2" />
                    Save Rep
                  </Button>
                  {editing && <Button variant="outline" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancel</Button>}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {reps.map(rep => (
                <Card key={rep.id} className="bg-white/[0.04] border-white/10">
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black">{rep.brandName}</h3>
                        {!rep.isActive && <span className="text-xs rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-400">Inactive</span>}
                      </div>
                      <p className="text-sm text-zinc-400">{rep.tagline}</p>
                      <p className="text-xs text-amber-300 font-mono mt-1"><Tag className="inline h-3 w-3 mr-1" />{rep.promoCode}</p>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/network/${rep.slug}`}><Button size="sm" variant="outline">View</Button></Link>
                      <Button size="sm" variant="outline" onClick={() => copyRepLink(rep)}>Copy Link</Button>
                      <Button size="sm" onClick={() => startEdit(rep)}>Edit</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
