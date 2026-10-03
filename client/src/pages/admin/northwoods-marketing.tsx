import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarCheck, Check, ExternalLink, Inbox, Loader2, MailCheck,
  MapPinned, Megaphone, RefreshCw, Save, ScanSearch, Sparkles, Users, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import AdminMarketingBotPage from "./marketing-bot";

type Market = {
  id: string; slug: string; city: string; state_code: string; postal_code: string; profile_url: string;
  verification_status: string; ads_enabled: boolean; active: boolean; priority: number;
  two_hour_rate_cents?: number | null; additional_hour_rate_cents?: number | null;
  piano_fee_cents?: number | null; safe_fee_cents?: number | null; rating?: string | number | null;
  review_count?: number | null; provider_count?: number | null; price_rank?: number | null; snapshot_captured_at?: string | null;
  next_service_date?: string | null; next_availability_status?: string | null; next_open_slots?: number | null;
};

type Scan = { id: string; target_date: string; status: string; market_ids: string[]; created_at: string; error_message?: string | null };

type Reservation = {
  id: string; external_order_id: string; status: string; customer_first_name?: string | null; customer_last_name?: string | null;
  customer_email?: string | null; customer_phone?: string | null; service_date?: string | null; start_time?: string | null;
  duration_hours?: string | number | null; crew_size?: number | null; from_address?: string | null; to_address?: string | null;
  market_id?: string | null; market_city?: string | null; market_slug?: string | null; focus?: string | null;
  quoted_amount_cents?: number | null; notes?: string | null; pending_changes?: Record<string, unknown>; linked_lead_id?: string | null;
  last_received_at?: string | null;
};

type ImportIssue = {
  id: string; gmail_message_id: string; sender?: string | null; subject?: string | null;
  received_at?: string | null; parse_status: "error" | "unmatched"; parse_errors?: string[];
  external_order_id?: string | null;
};

type Dashboard = {
  providerId: string;
  markets: Market[];
  availability: Array<Record<string, unknown>>;
  scans: Scan[];
  reservations: Reservation[];
  importIssues: ImportIssue[];
  activeCampaign?: { id: string; headline: string; status: string } | null;
  metrics: { confirmedOpenings: number; advertisingMarkets: number; newReservations: number; pendingScans: number; importIssues: number };
  gmail: { configured: boolean; enabled: boolean; query: string; allowedSenders: string[]; missing: string[]; pollMinutes: number; last_processed_at?: string | null; processed_24h?: number };
  scanner: { enabled: boolean; mode: string };
  scheduler: { enabled: boolean; autoPublish: boolean; proposalTime: string };
};

const services = ["loading", "unloading", "u_box", "packing", "piano", "safe"] as const;
const labels: Record<string, string> = {
  loading: "Loading", unloading: "Unloading", u_box: "U-Box", packing: "Packing", piano: "Piano", safe: "Safe",
  piano_safe: "Piano / Safe", auto: "Best opportunity",
};

function localDate(days = 0) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function money(cents?: number | null) {
  return cents === null || cents === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function when(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function statusBadge(status: string) {
  const good = ["approved", "confirmed", "open", "verified"].includes(status);
  const warning = ["new", "needs_review", "changed", "pending_review", "limited", "pending"].includes(status);
  const failed = ["error", "unmatched", "failed"].includes(status);
  return <Badge className={good ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200" : warning ? "border-amber-500/30 bg-amber-500/15 text-amber-100" : failed ? "border-red-500/30 bg-red-500/15 text-red-100" : "border-slate-600 bg-slate-700/50 text-slate-200"}>{status.replaceAll("_", " ")}</Badge>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Users; label: string; value: number; detail: string }) {
  return (
    <Card className="border-slate-800 bg-slate-900/70">
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-slate-400"><span className="text-xs font-black uppercase tracking-widest">{label}</span><Icon className="h-4 w-4 text-emerald-300" /></div>
        <p className="mt-2 text-3xl font-black text-white">{value}</p><p className="text-xs text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

export default function NorthwoodsMarketingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [marketId, setMarketId] = useState("");
  const [scanDate, setScanDate] = useState(localDate(7));
  const [availability, setAvailability] = useState({ serviceDate: localDate(1), startTime: "08:00", endTime: "17:00", plannedCrewSize: 2, openSlots: 1, status: "open", services: ["loading", "unloading"] as string[], notes: "" });
  const [manual, setManual] = useState({ rate: "", extra: "", piano: "", safe: "", rating: "", reviews: "" });
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);
  const [reservationEdit, setReservationEdit] = useState<Record<string, string>>({});

  const dashboardQuery = useQuery<Dashboard>({ queryKey: ["/api/admin/northwoods-marketing/dashboard"], refetchInterval: 30_000 });
  const dashboard = dashboardQuery.data;
  const selectedReservation = dashboard?.reservations.find((item) => item.id === selectedReservationId) || null;

  useEffect(() => {
    if (!marketId && dashboard?.markets[0]?.id) setMarketId(dashboard.markets[0].id);
  }, [dashboard?.markets, marketId]);

  useEffect(() => {
    if (!selectedReservation) return;
    setReservationEdit({
      customerFirstName: selectedReservation.customer_first_name || "", customerLastName: selectedReservation.customer_last_name || "",
      customerEmail: selectedReservation.customer_email || "", customerPhone: selectedReservation.customer_phone || "",
      serviceDate: String(selectedReservation.service_date || "").slice(0, 10), startTime: selectedReservation.start_time || "",
      durationHours: String(selectedReservation.duration_hours || ""), crewSize: String(selectedReservation.crew_size || ""),
      fromAddress: selectedReservation.from_address || "", toAddress: selectedReservation.to_address || "",
      marketId: selectedReservation.market_id || "", focus: selectedReservation.focus || "loading",
      quotedAmount: selectedReservation.quoted_amount_cents == null ? "" : String(selectedReservation.quoted_amount_cents / 100), notes: selectedReservation.notes || "",
    });
  }, [selectedReservation?.id, selectedReservation?.last_received_at]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/admin/northwoods-marketing/dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-bot/dashboard"] }),
    ]);
  };

  const action = useMutation({
    mutationFn: async (input: { method: string; url: string; body?: unknown; success: string }) => {
      const response = await apiRequest(input.method, input.url, input.body);
      return { data: await response.json(), success: input.success };
    },
    onSuccess: async ({ success }) => { await refresh(); toast({ title: success }); },
    onError: (error: Error) => toast({ title: "Northwoods action failed", description: error.message, variant: "destructive" }),
  });

  const toggleService = (service: string, checked: boolean) => setAvailability((current) => ({
    ...current,
    services: checked ? [...new Set([...current.services, service])] : current.services.filter((item) => item !== service),
  }));

  const saveAvailability = () => action.mutate({ method: "PUT", url: `/api/admin/northwoods-marketing/markets/${marketId}/availability`, body: availability, success: "Crew availability confirmed" });

  const saveReservation = () => {
    if (!selectedReservation) return;
    action.mutate({
      method: "PATCH", url: `/api/admin/northwoods-marketing/reservations/${selectedReservation.id}`,
      body: {
        ...reservationEdit,
        durationHours: reservationEdit.durationHours ? Number(reservationEdit.durationHours) : null,
        crewSize: reservationEdit.crewSize ? Number(reservationEdit.crewSize) : null,
        quotedAmountCents: reservationEdit.quotedAmount ? Math.round(Number(reservationEdit.quotedAmount) * 100) : null,
        quotedAmount: undefined,
      },
      success: "Reservation corrections saved",
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-emerald-200"><Sparkles className="h-3.5 w-3.5" />Northwoods Marketing Bot</div>
          <h1 className="text-3xl font-black text-white">Marketplace demand into crew-ready jobs</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">Provider {dashboard?.providerId || "404EEC12FC5143"}. Market data, email reservations, and ads stay behind review gates.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["auto", "u_box", "loading", "piano_safe"].map((focus) => <Button key={focus} variant={focus === "auto" ? "default" : "outline"} className={focus === "auto" ? "bg-emerald-600 hover:bg-emerald-500" : "border-slate-700"} disabled={action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/northwoods-marketing/campaigns/generate", body: { focus }, success: `${labels[focus]} ad proposal created` })}>{focus === "auto" ? <Megaphone className="mr-2 h-4 w-4" /> : null}{labels[focus]}</Button>)}
        </div>
      </div>

      {dashboardQuery.isError ? <Card className="border-red-500/30 bg-red-500/10"><CardContent className="flex items-center gap-3 p-4 text-red-100"><AlertTriangle className="h-5 w-5" />The dashboard could not load. Check database readiness and your admin session.</CardContent></Card> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={CalendarCheck} label="Openings" value={dashboard?.metrics.confirmedOpenings || 0} detail="Confirmed in the next 14 days" />
        <Metric icon={MapPinned} label="Ad markets" value={dashboard?.metrics.advertisingMarkets || 0} detail="Verified and advertising enabled" />
        <Metric icon={Inbox} label="U-Haul jobs" value={dashboard?.metrics.newReservations || 0} detail="Waiting for owner review" />
        <Metric icon={AlertTriangle} label="Import issues" value={dashboard?.metrics.importIssues || 0} detail="Errors or unmatched emails" />
        <Metric icon={ScanSearch} label="Scan reviews" value={dashboard?.metrics.pendingScans || 0} detail="Not used until approved" />
      </div>

      <Tabs defaultValue="today" className="space-y-4">
        <TabsList className="h-auto flex-wrap bg-slate-900 p-1">
          <TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="markets">Markets</TabsTrigger><TabsTrigger value="jobs">U-Haul Jobs</TabsTrigger><TabsTrigger value="campaigns">Campaigns</TabsTrigger><TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="grid gap-4 xl:grid-cols-2">
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader><CardTitle className="text-white">Confirm an opening</CardTitle><CardDescription>Only confirmed capacity can generate a Northwoods ad.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Market</Label><Select value={marketId} onValueChange={setMarketId}><SelectTrigger><SelectValue placeholder="Choose market" /></SelectTrigger><SelectContent>{dashboard?.markets.map((market) => <SelectItem key={market.id} value={market.id}>{market.city}, {market.state_code}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Date</Label><Input type="date" value={availability.serviceDate} onChange={(event) => setAvailability({ ...availability, serviceDate: event.target.value })} /></div>
                <div><Label>Start</Label><Input type="time" value={availability.startTime} onChange={(event) => setAvailability({ ...availability, startTime: event.target.value })} /></div>
                <div><Label>End</Label><Input type="time" value={availability.endTime} onChange={(event) => setAvailability({ ...availability, endTime: event.target.value })} /></div>
                <div><Label>Crew size</Label><Input type="number" min={1} max={12} value={availability.plannedCrewSize} onChange={(event) => setAvailability({ ...availability, plannedCrewSize: Number(event.target.value) })} /></div>
                <div><Label>Open slots</Label><Input type="number" min={0} max={20} value={availability.openSlots} onChange={(event) => setAvailability({ ...availability, openSlots: Number(event.target.value) })} /></div>
              </div>
              <div><Label className="mb-2 block">Services crew can perform</Label><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{services.map((service) => <label key={service} className="flex items-center gap-2 rounded-lg border border-slate-700 p-2 text-sm text-slate-200"><Checkbox checked={availability.services.includes(service)} onCheckedChange={(value) => toggleService(service, value === true)} />{labels[service]}</label>)}</div></div>
              <Textarea placeholder="Operational notes" value={availability.notes} onChange={(event) => setAvailability({ ...availability, notes: event.target.value })} />
              <Button className="w-full bg-emerald-600 hover:bg-emerald-500" disabled={!marketId || !availability.services.length || action.isPending} onClick={saveAvailability}><Check className="mr-2 h-4 w-4" />Confirm availability</Button>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader><CardTitle className="text-white">Current operating picture</CardTitle><CardDescription>Review gates determine what the bot is allowed to do.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {dashboard?.markets.map((market) => <div key={market.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div><p className="font-bold text-white">{market.city}, {market.state_code}</p><p className="text-xs text-slate-500">{market.next_service_date ? `${String(market.next_service_date).slice(0, 10)} · ${market.next_open_slots} slot(s)` : "No confirmed opening"}</p></div><div className="flex gap-2">{statusBadge(market.verification_status)}{market.ads_enabled ? <Badge className="bg-blue-500/15 text-blue-200">ads on</Badge> : null}</div></div>)}
              {!dashboard?.markets.length ? <p className="text-sm text-slate-500">Loading configured markets…</p> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="markets" className="space-y-4">
          <Card className="border-slate-800 bg-slate-900/70">
            <CardHeader className="flex-row items-start justify-between"><div><CardTitle className="text-white">Market intelligence</CardTitle><CardDescription>Approved snapshots are staff-only. Customer pages never show cached rates.</CardDescription></div><div>{dashboard?.scanner.enabled ? statusBadge("enabled") : statusBadge("manual")}</div></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]"><Select value={marketId} onValueChange={setMarketId}><SelectTrigger><SelectValue placeholder="All markets" /></SelectTrigger><SelectContent>{dashboard?.markets.map((market) => <SelectItem key={market.id} value={market.id}>{market.city}, {market.state_code}</SelectItem>)}</SelectContent></Select><Input type="date" value={scanDate} onChange={(event) => setScanDate(event.target.value)} /><Button disabled={!dashboard?.scanner.enabled || action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/northwoods-marketing/scans", body: { marketIds: marketId ? [marketId] : undefined, targetDate: scanDate }, success: "Marketplace scan staged for review" })}><RefreshCw className="mr-2 h-4 w-4" />Refresh official listing</Button></div>
              {!dashboard?.scanner.enabled ? <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">Automated public-page scanning is disabled. Enter a verified manual snapshot below, or enable the scanner after policy review.</p> : null}
              <div className="overflow-x-auto rounded-xl border border-slate-800"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-950/70 text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Market</th><th>2 hours</th><th>Extra hour</th><th>Piano</th><th>Safe</th><th>Rating</th><th>Position</th><th>Snapshot</th></tr></thead><tbody>{dashboard?.markets.map((market) => <tr key={market.id} className="border-t border-slate-800 text-slate-200"><td className="p-3"><a className="font-bold text-emerald-300 hover:underline" href={market.profile_url} target="_blank" rel="noreferrer">{market.city}, {market.state_code} <ExternalLink className="inline h-3 w-3" /></a></td><td>{money(market.two_hour_rate_cents)}</td><td>{money(market.additional_hour_rate_cents)}</td><td>{money(market.piano_fee_cents)}</td><td>{money(market.safe_fee_cents)}</td><td>{market.rating || "—"}{market.review_count != null ? ` (${market.review_count})` : ""}</td><td>{market.price_rank && market.provider_count ? `${market.price_rank} of ${market.provider_count}` : "—"}</td><td>{when(market.snapshot_captured_at)}</td></tr>)}</tbody></table></div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="text-white">Review queue</CardTitle><CardDescription>No scan becomes campaign input until approved.</CardDescription></CardHeader><CardContent className="space-y-2">{dashboard?.scans.map((scan) => <div key={scan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 p-3"><div><div className="flex items-center gap-2"><span className="font-bold text-white">{scan.target_date}</span>{statusBadge(scan.status)}</div><p className="text-xs text-slate-500">{scan.market_ids.length} market(s) · {when(scan.created_at)}</p></div>{scan.status === "pending_review" ? <div className="flex gap-2"><Button size="sm" className="bg-emerald-600" onClick={() => action.mutate({ method: "POST", url: `/api/admin/northwoods-marketing/scans/${scan.id}/approve`, success: "Snapshot approved" })}><Check className="h-4 w-4" /></Button><Button size="sm" variant="outline" className="border-red-500/40 text-red-200" onClick={() => action.mutate({ method: "POST", url: `/api/admin/northwoods-marketing/scans/${scan.id}/reject`, success: "Snapshot rejected" })}><X className="h-4 w-4" /></Button></div> : null}</div>)}{!dashboard?.scans.length ? <p className="text-sm text-slate-500">No scans yet.</p> : null}</CardContent></Card>
            <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="text-white">Manual Northwoods snapshot</CardTitle><CardDescription>Use values you personally verified on the official listing.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Input placeholder="Two-hour rate ($)" inputMode="decimal" value={manual.rate} onChange={(e) => setManual({ ...manual, rate: e.target.value })} /><Input placeholder="Additional hour ($)" inputMode="decimal" value={manual.extra} onChange={(e) => setManual({ ...manual, extra: e.target.value })} /><Input placeholder="Piano fee ($)" inputMode="decimal" value={manual.piano} onChange={(e) => setManual({ ...manual, piano: e.target.value })} /><Input placeholder="Safe fee ($)" inputMode="decimal" value={manual.safe} onChange={(e) => setManual({ ...manual, safe: e.target.value })} /><Input placeholder="Rating (0–5)" inputMode="decimal" value={manual.rating} onChange={(e) => setManual({ ...manual, rating: e.target.value })} /><Input placeholder="Review count" inputMode="numeric" value={manual.reviews} onChange={(e) => setManual({ ...manual, reviews: e.target.value })} /><Button className="sm:col-span-2" disabled={!marketId || !manual.rate || action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/northwoods-marketing/scans/manual", body: { marketId, targetDate: scanDate, twoHourRateCents: Math.round(Number(manual.rate) * 100), additionalHourRateCents: manual.extra ? Math.round(Number(manual.extra) * 100) : null, pianoFeeCents: manual.piano ? Math.round(Number(manual.piano) * 100) : null, safeFeeCents: manual.safe ? Math.round(Number(manual.safe) * 100) : null, rating: manual.rating ? Number(manual.rating) : null, reviewCount: manual.reviews ? Number(manual.reviews) : null }, success: "Manual snapshot staged for review" })}><Save className="mr-2 h-4 w-4" />Stage manual snapshot</Button></CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-4">
          {(dashboard?.importIssues.length || 0) > 0 ? <Card className="border-red-500/30 bg-red-500/[0.06]"><CardHeader><CardTitle className="flex items-center gap-2 text-red-100"><AlertTriangle className="h-5 w-5" />Reservation import issues</CardTitle><CardDescription>These messages did not create a reviewable job. Correct the provider filter or inspect the email format, then sync again.</CardDescription></CardHeader><CardContent className="space-y-2">{dashboard?.importIssues.map((issue) => <div key={issue.id} className="rounded-xl border border-red-500/20 bg-slate-950/50 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-white">{issue.subject || "Reservation email without a subject"}</p>{statusBadge(issue.parse_status)}</div><p className="mt-1 break-all text-xs text-slate-400">{issue.sender || "Sender unavailable"} · {when(issue.received_at)}</p>{issue.parse_errors?.length ? <p className="mt-2 text-xs text-red-200">{issue.parse_errors.join(" · ")}</p> : <p className="mt-2 text-xs text-amber-100">No provider order number could be matched. This email remains unprocessed.</p>}</div>)}</CardContent></Card> : null}
          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="text-white">Reservation inbox</CardTitle><CardDescription>One confirmation creates the operational dispatch job.</CardDescription></CardHeader><CardContent className="space-y-2">{dashboard?.reservations.map((reservation) => <button key={reservation.id} type="button" onClick={() => setSelectedReservationId(reservation.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedReservationId === reservation.id ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-800 hover:bg-slate-800/50"}`}><div className="flex items-center justify-between gap-2"><span className="font-bold text-white">{reservation.customer_first_name || "Unknown"} {reservation.customer_last_name || "customer"}</span>{statusBadge(reservation.status)}</div><p className="mt-1 text-xs text-slate-400">{reservation.external_order_id} · {String(reservation.service_date || "Date missing").slice(0, 10)}</p></button>)}{!dashboard?.reservations.length ? <p className="text-sm text-slate-500">No imported reservation emails.</p> : null}</CardContent></Card>
          <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="text-white">{selectedReservation ? `Review ${selectedReservation.external_order_id}` : "Select a reservation"}</CardTitle><CardDescription>Imported data is editable before it reaches Workers Central. This confirmation does not accept anything in U-Haul and creates no invoice, payment, payroll, or token event.</CardDescription></CardHeader>{selectedReservation ? <CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Input aria-label="First name" placeholder="First name" value={reservationEdit.customerFirstName || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, customerFirstName: e.target.value })} /><Input aria-label="Last name" placeholder="Last name" value={reservationEdit.customerLastName || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, customerLastName: e.target.value })} /><Input type="email" placeholder="Email" value={reservationEdit.customerEmail || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, customerEmail: e.target.value })} /><Input type="tel" placeholder="Phone" value={reservationEdit.customerPhone || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, customerPhone: e.target.value })} /><Input type="date" value={reservationEdit.serviceDate || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, serviceDate: e.target.value })} /><Input type="time" value={reservationEdit.startTime || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, startTime: e.target.value })} /><Input type="number" step="0.5" min="0.5" placeholder="Hours" value={reservationEdit.durationHours || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, durationHours: e.target.value })} /><Input type="number" min="1" placeholder="Crew size" value={reservationEdit.crewSize || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, crewSize: e.target.value })} /><Select value={reservationEdit.marketId || ""} onValueChange={(value) => setReservationEdit({ ...reservationEdit, marketId: value })}><SelectTrigger><SelectValue placeholder="Market" /></SelectTrigger><SelectContent>{dashboard?.markets.map((market) => <SelectItem key={market.id} value={market.id}>{market.city}, {market.state_code}</SelectItem>)}</SelectContent></Select><Select value={reservationEdit.focus || "loading"} onValueChange={(value) => setReservationEdit({ ...reservationEdit, focus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{services.map((service) => <SelectItem key={service} value={service}>{labels[service]}</SelectItem>)}</SelectContent></Select><PlacesAutocomplete className="sm:col-span-2" aria-label="Service address" placeholder="Service address" value={reservationEdit.fromAddress || ""} onChange={(value) => setReservationEdit(current => ({ ...current, fromAddress: value }))} /><PlacesAutocomplete className="sm:col-span-2" aria-label="Destination address" placeholder="Destination address (optional)" value={reservationEdit.toAddress || ""} onChange={(value) => setReservationEdit(current => ({ ...current, toAddress: value }))} /><Input placeholder="Marketplace amount ($, staff only)" value={reservationEdit.quotedAmount || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, quotedAmount: e.target.value })} /></div><Textarea placeholder="Operational notes" value={reservationEdit.notes || ""} onChange={(e) => setReservationEdit({ ...reservationEdit, notes: e.target.value })} />{selectedReservation.status === "changed" ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">A newer email contains changes. Review the staged values before applying them to the linked job.</div> : null}<div className="flex flex-wrap gap-2"><Button variant="outline" className="border-slate-700" onClick={saveReservation}><Save className="mr-2 h-4 w-4" />Save corrections</Button>{!selectedReservation.linked_lead_id && !["ignored", "cancelled"].includes(selectedReservation.status) ? <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={() => action.mutate({ method: "POST", url: `/api/admin/northwoods-marketing/reservations/${selectedReservation.id}/confirm`, success: "Workers Central job created; U-Haul acceptance remains manual" })}><Check className="mr-2 h-4 w-4" />Confirm into Workers Central</Button> : null}{selectedReservation.status === "changed" ? <Button className="bg-amber-600 hover:bg-amber-500" onClick={() => action.mutate({ method: "POST", url: `/api/admin/northwoods-marketing/reservations/${selectedReservation.id}/apply-changes`, success: "Reservation changes applied" })}>Apply emailed changes</Button> : null}{!selectedReservation.linked_lead_id && !["ignored", "cancelled"].includes(selectedReservation.status) ? <Button variant="ghost" className="text-slate-400" onClick={() => action.mutate({ method: "POST", url: `/api/admin/northwoods-marketing/reservations/${selectedReservation.id}/ignore`, success: "Reservation ignored" })}>Ignore</Button> : null}</div></CardContent> : null}</Card>
          </div>
        </TabsContent>

        <TabsContent value="campaigns"><AdminMarketingBotPage /></TabsContent>

        <TabsContent value="connections" className="grid gap-4 lg:grid-cols-3">
          <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="flex items-center gap-2 text-white"><MailCheck className="h-5 w-5 text-emerald-300" />Dedicated Gmail</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-slate-300"><div className="flex justify-between"><span>OAuth configured</span>{statusBadge(dashboard?.gmail.configured ? "verified" : "pending")}</div><div className="flex justify-between"><span>Polling enabled</span>{statusBadge(dashboard?.gmail.enabled ? "enabled" : "disabled")}</div><p className="text-xs text-slate-500">Last message: {when(dashboard?.gmail.last_processed_at)}</p><Button className="w-full" variant="outline" disabled={!dashboard?.gmail.configured || action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/northwoods-marketing/email/sync", success: "Dedicated inbox synced" })}><RefreshCw className="mr-2 h-4 w-4" />Sync now</Button></CardContent></Card>
          <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="flex items-center gap-2 text-white"><ScanSearch className="h-5 w-5 text-blue-300" />Market scanner</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-slate-300"><div className="flex justify-between"><span>Public-page fetch</span>{statusBadge(dashboard?.scanner.enabled ? "enabled" : "disabled")}</div><p className="text-xs text-slate-500">Official U-Haul/Moving Help URLs only. Every result requires owner approval.</p></CardContent></Card>
          <Card className="border-slate-800 bg-slate-900/70"><CardHeader><CardTitle className="flex items-center gap-2 text-white"><Megaphone className="h-5 w-5 text-purple-300" />Daily proposal</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-slate-300"><div className="flex justify-between"><span>Scheduler</span>{statusBadge(dashboard?.scheduler.enabled ? "enabled" : "disabled")}</div><div className="flex justify-between"><span>Automatic publish</span>{statusBadge("disabled")}</div><p className="text-xs text-slate-500">{dashboard?.scheduler.proposalTime}. Owner approval is always required before posting.</p></CardContent></Card>
        </TabsContent>
      </Tabs>

      {action.isPending ? <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white shadow-xl"><Loader2 className="h-4 w-4 animate-spin" />Working…</div> : null}
    </div>
  );
}
