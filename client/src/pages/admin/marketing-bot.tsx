import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Loader2,
  Megaphone,
  MousePointerClick,
  PhoneCall,
  RefreshCw,
  Send,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Publication = {
  id: string;
  channel: string;
  status: string;
  external_url?: string | null;
  error_message?: string | null;
  attempts: number;
  target_page_id?: string | null;
  target_page_name?: string | null;
};

type Campaign = {
  id: string;
  campaign_code: string;
  brand?: string;
  local_date: string;
  service: string;
  territory: string;
  status: string;
  score: string | number;
  rationale: string;
  headline: string;
  facebook_caption: string;
  instagram_caption: string;
  google_business_summary: string;
  short_caption: string;
  cta: string;
  campaign_url: string;
  feed_image_url?: string | null;
  promo_code?: string | null;
  safety?: { passed?: boolean; checks?: Array<{ key: string; ok: boolean; label: string }> };
  ai_fallback: boolean;
  revision: number;
  approved_at?: string | null;
  created_at: string;
  share_kit_count?: number;
  publications?: Publication[];
};

type Variant = {
  id: string;
  variant_code: string;
  channel: string;
  rep_slug?: string | null;
  promo_code?: string | null;
  is_company: boolean;
  caption: string;
  destination_url: string;
  image_url: string;
};

type CampaignDetail = Campaign & { variants: Variant[]; publications: Publication[] };

type Metrics = {
  days: number;
  totals: { campaigns: number; views: number; bookingClicks: number; callClicks: number; messageClicks: number; leads: number; bookings: number };
  bookingConversionRate: number;
  campaigns: Array<Campaign & { views: number; booking_clicks: number; call_clicks: number; message_clicks: number; leads: number; bookings: number }>;
};

type Dashboard = {
  active: Campaign | null;
  campaigns: Campaign[];
  metrics: Metrics;
  reports: Array<{ id: string; period_end: string; summary: string; recommendations: string[]; email_sent: boolean }>;
  readiness: Array<{ channel: string; ready: boolean; missing: string[]; note: string }>;
  scheduler: { enabled: boolean; proposalTime: string; autoPublish: boolean };
  ai: { model: string; ready: boolean };
  companyConnections: Array<{
    id: string;
    pageId: string;
    pageName: string;
    status: string;
    connectedAt: string;
    lastVerifiedAt?: string | null;
    lastError?: string | null;
  }>;
  representatives: Array<{
    id: string;
    slug: string;
    displayName: string;
    promoCode?: string | null;
    pilotAllowed: boolean;
    connection: { status: string; pageId: string; pageName: string; lastVerifiedAt?: string | null; lastError?: string | null; authorizedForPilot?: boolean } | null;
    publications: { published: number; failed: number; lastPublishedAt?: string | null };
  }>;
  metaPilot: {
    configured: boolean;
    state: "owner_setup_required" | "awaiting_matt_oauth" | "ready" | "reauthorization_required" | "authorized_page_mismatch";
    missing: string[];
    configurationErrors: string[];
    repSlug: string;
    authorizedPageId?: string | null;
    authorizedPageName?: string | null;
    redirectUri?: string | null;
    requiredScopes: string[];
    channel: "facebook";
    brand: "northwoods_moving";
    instagramEnabled: false;
    otherRepresentativesEnabled: false;
  };
};

const serviceLabels: Record<string, string> = {
  moving: "Moving",
  packing: "Packing",
  junk_removal: "Junk Removal",
  helping_hands: "Helping Hands",
  heavy_item: "Heavy Items",
  lawn_seasonal: "Lawn / Seasonal",
  last_minute: "Last-Minute Availability",
  reputation: "Reviews / Reputation",
};

const territoryLabels: Record<string, string> = {
  ironwood_hurley: "Ironwood / Hurley",
  houghton: "Houghton",
  eagle_river: "Eagle River",
  iron_river: "Iron River",
  mercer_minocqua: "Mercer / Minocqua",
  up_northwoods: "UP / Northwoods",
};

const channelLabels: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  google_business: "Google Business",
};

const primaryCompanyFacebookPageId = "912756211920086";

const jcCompanyFacebookPages = [
  { pageId: "912756211920086", pageName: "JC On The MOVE : CoM" },
  { pageId: "201994456322276", pageName: "JC on the MOVE. com" },
  { pageId: "111004651273433", pageName: "JC onthe Move .com" },
] as const;

const blankEdit = {
  headline: "",
  facebookCaption: "",
  instagramCaption: "",
  googleBusinessSummary: "",
  shortCaption: "",
  cta: "BOOK",
};

function StatusBadge({ status }: { status: string }) {
  const ready = status === "published" || status === "approved";
  const failed = status === "failed" || status === "partially_published";
  return (
    <Badge className={ready ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" : failed ? "bg-amber-500/15 text-amber-200 border-amber-500/30" : "bg-blue-500/15 text-blue-200 border-blue-500/30"}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: number | string; detail: string; icon: typeof BarChart3 }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-xs font-black uppercase tracking-widest">{label}</span>
        <Icon className="h-4 w-4 text-blue-300" />
      </div>
      <p className="mt-2 text-3xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export default function AdminMarketingBotPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState(blankEdit);
  const [generateService, setGenerateService] = useState("auto");
  const [generateTerritory, setGenerateTerritory] = useState("auto");
  const [attributionVariant, setAttributionVariant] = useState("");
  const [attributionNote, setAttributionNote] = useState("");
  const [selectedFacebookConnectionIds, setSelectedFacebookConnectionIds] = useState<string[]>([]);
  const [companyPageTokens, setCompanyPageTokens] = useState<Record<string, string>>({});
  const [companyImportPending, setCompanyImportPending] = useState(false);

  const dashboardQuery = useQuery<Dashboard>({
    queryKey: ["/api/admin/marketing-bot/dashboard"],
    refetchInterval: 30_000,
  });
  const dashboard = dashboardQuery.data;
  const connectedFacebookPages = useMemo(
    () => (dashboard?.companyConnections || []).filter((connection) => connection.status === "connected"),
    [dashboard?.companyConnections],
  );
  const connectedFacebookPageKey = connectedFacebookPages.map((connection) => connection.id).join(",");

  useEffect(() => {
    const available = new Set(connectedFacebookPages.map((connection) => connection.id));
    setSelectedFacebookConnectionIds((current) => {
      const retained = current.filter((id) => available.has(id));
      return retained.length > 0 ? retained : connectedFacebookPages
        .filter((connection) => connection.pageId === primaryCompanyFacebookPageId)
        .map((connection) => connection.id);
    });
  }, [connectedFacebookPageKey]);

  useEffect(() => {
    if (!selectedId && dashboard?.active?.id) setSelectedId(dashboard.active.id);
  }, [dashboard?.active?.id, selectedId]);

  const detailQuery = useQuery<{ campaign: CampaignDetail }>({
    queryKey: [`/api/admin/marketing-bot/campaigns/${selectedId}`],
    enabled: Boolean(selectedId),
  });
  const campaign = detailQuery.data?.campaign;

  useEffect(() => {
    if (!campaign) return;
    setEdit({
      headline: campaign.headline,
      facebookCaption: campaign.facebook_caption,
      instagramCaption: campaign.instagram_caption,
      googleBusinessSummary: campaign.google_business_summary,
      shortCaption: campaign.short_caption,
      cta: campaign.cta,
    });
  }, [campaign?.id, campaign?.revision]);

  useEffect(() => {
    const firstVariant = campaign?.variants[0]?.variant_code || "";
    if (firstVariant && !campaign?.variants.some((variant) => variant.variant_code === attributionVariant)) {
      setAttributionVariant(firstVariant);
    }
  }, [campaign?.id, campaign?.variants, attributionVariant]);

  const refresh = async (nextId?: string) => {
    if (nextId) setSelectedId(nextId);
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-bot/dashboard"] });
    if (nextId || selectedId) await queryClient.invalidateQueries({ queryKey: [`/api/admin/marketing-bot/campaigns/${nextId || selectedId}`] });
  };

  const action = useMutation({
    mutationFn: async (input: { method: string; url: string; body?: unknown; success: string }) => {
      const response = await apiRequest(input.method, input.url, input.body);
      return { data: await response.json(), success: input.success };
    },
    onSuccess: async ({ data, success }) => {
      const nextId = data.campaign?.id || data.campaign?.campaign?.id;
      await refresh(nextId);
      toast({ title: success });
    },
    onError: (error: Error) => toast({ title: "Marketing Bot action failed", description: error.message, variant: "destructive" }),
  });

  const generate = () => action.mutate({
    method: "POST",
    url: "/api/admin/marketing-bot/generate",
    body: {
      service: generateService === "auto" ? undefined : generateService,
      territory: generateTerritory === "auto" ? undefined : generateTerritory,
    },
    success: "New campaign proposal generated",
  });

  const importCompanyFacebookPages = async () => {
    const pages = jcCompanyFacebookPages.map(({ pageId }) => ({
      pageId,
      accessToken: companyPageTokens[pageId]?.trim() || "",
    })).filter((page) => page.accessToken.length > 0);
    if (pages.length === 0) {
      toast({ title: "Enter a token for the Page you want to connect", variant: "destructive" });
      return;
    }

    setCompanyImportPending(true);
    try {
      const response = await apiRequest("POST", "/api/admin/marketing-bot/meta/connections/import", { pages });
      await response.json();
      setCompanyPageTokens({});
      await refresh();
      toast({ title: "JC Facebook Pages connected securely" });
    } catch (error) {
      toast({
        title: "Facebook Pages could not be connected",
        description: error instanceof Error ? error.message : "Secure import failed",
        variant: "destructive",
      });
    } finally {
      setCompanyImportPending(false);
    }
  };

  const companyVariants = campaign?.variants.filter((variant) => variant.is_company) || [];
  const shareKits = campaign?.variants.filter((variant) => !variant.is_company) || [];
  const facebookReady = connectedFacebookPages.length > 0;
  const dirty = Boolean(campaign) && (
    edit.headline !== campaign?.headline ||
    edit.facebookCaption !== campaign?.facebook_caption ||
    edit.instagramCaption !== campaign?.instagram_caption ||
    edit.googleBusinessSummary !== campaign?.google_business_summary ||
    edit.shortCaption !== campaign?.short_caption ||
    edit.cta !== campaign?.cta
  );
  const safetyChecks = campaign?.safety?.checks || [];
  const latestReport = dashboard?.reports[0];

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copied` });
  };

  const publicationByChannel = useMemo(() => new Map((campaign?.publications || []).filter((publication) => publication.channel !== "facebook").map((publication) => [publication.channel, publication])), [campaign?.publications]);
  const facebookPublicationByPage = useMemo(() => new Map(
    (campaign?.publications || [])
      .filter((publication) => publication.channel === "facebook" && publication.target_page_id)
      .map((publication) => [publication.target_page_id as string, publication]),
  ), [campaign?.publications]);
  const representativeBySlug = useMemo(() => new Map((dashboard?.representatives || []).map((rep) => [rep.slug, rep])), [dashboard?.representatives]);
  const selectedFacebookPublications = connectedFacebookPages
    .filter((page) => selectedFacebookConnectionIds.includes(page.id))
    .map((page) => facebookPublicationByPage.get(page.pageId));
  const selectedFacebookPublished = selectedFacebookConnectionIds.length > 0
    && selectedFacebookPublications.length === selectedFacebookConnectionIds.length
    && selectedFacebookPublications.every((publication) => publication?.status === "published");
  const selectedFacebookFailed = selectedFacebookPublications.some((publication) => publication?.status === "failed");
  const isNorthwoodsCampaign = campaign?.brand === "northwoods_moving";

  if (dashboardQuery.isLoading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-blue-400" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl px-3 py-5 md:px-6 md:py-7">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-blue-200">
            <Sparkles className="h-3.5 w-3.5" /> JC Marketing Bot
          </div>
          <h1 className="mt-3 text-3xl font-black text-white md:text-4xl">Campaign command center</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Decides what to advertise, creates channel-ready copy and creative, waits for approval, publishes, and learns from confirmed bookings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="border-slate-700 bg-slate-950/40" onClick={() => dashboardQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-500" onClick={generate} disabled={action.isPending}>
            {action.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Generate now
          </Button>
        </div>
      </header>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tracked views" value={dashboard?.metrics.totals.views || 0} detail="Campaign landing views" icon={BarChart3} />
        <StatCard label="Calls + messages" value={(dashboard?.metrics.totals.callClicks || 0) + (dashboard?.metrics.totals.messageClicks || 0)} detail="Tap-to-call and message intent" icon={PhoneCall} />
        <StatCard label="Leads" value={dashboard?.metrics.totals.leads || 0} detail="Attributed or staff tagged" icon={Users} />
        <StatCard label="Confirmed bookings" value={dashboard?.metrics.totals.bookings || 0} detail={`${dashboard?.metrics.bookingConversionRate || 0}% view-to-booking`} icon={CheckCircle2} />
      </div>

      <div className="mb-5 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <Label className="text-slate-300">Service override</Label>
          <Select value={generateService} onValueChange={setGenerateService}>
            <SelectTrigger className="mt-2 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">Let the bot decide</SelectItem>{Object.entries(serviceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-300">Territory override</Label>
          <Select value={generateTerritory} onValueChange={setGenerateTerritory}>
            <SelectTrigger className="mt-2 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">Let the bot decide</SelectItem>{Object.entries(territoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-xs text-slate-400">
            <div className="font-bold text-white">Daily proposal</div>
            {dashboard?.scheduler.proposalTime}<br />Approval always required
          </div>
        </div>
      </div>

      <Tabs defaultValue="queue">
        <TabsList className="mb-4 h-auto flex-wrap justify-start bg-slate-900 p-1">
          <TabsTrigger value="queue">Approval queue</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="share-kits">Employee share kits</TabsTrigger>
          <TabsTrigger value="analytics">Learning</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-0">
          {!campaign ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
              <Megaphone className="mx-auto h-9 w-9 text-slate-500" />
              <h2 className="mt-3 text-xl font-bold text-white">No campaign selected</h2>
              <p className="mt-1 text-sm text-slate-400">Generate a proposal or choose one from the calendar.</p>
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
              <aside className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                  {campaign.feed_image_url && <img src={campaign.feed_image_url} alt={campaign.headline} className="aspect-[4/5] w-full object-cover" />}
                  <div className="p-4">
                    <div className="flex flex-wrap items-center gap-2"><StatusBadge status={campaign.status} /><Badge variant="outline" className="border-slate-700">score {Number(campaign.score).toFixed(0)}</Badge>{campaign.ai_fallback && <Badge variant="outline" className="border-amber-500/30 text-amber-200">deterministic fallback</Badge>}</div>
                    <p className="mt-3 text-sm font-bold text-white">{serviceLabels[campaign.service]} · {territoryLabels[campaign.territory]}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{campaign.rationale}</p>
                    <p className="mt-3 break-all font-mono text-[11px] text-slate-500">{campaign.campaign_code}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <h3 className="font-bold text-white">Safety checks</h3>
                  <div className="mt-3 space-y-2">
                    {safetyChecks.map((check) => <div key={check.key} className="flex items-start gap-2 text-sm">{check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}<span className={check.ok ? "text-slate-300" : "text-red-200"}>{check.label}</span></div>)}
                  </div>
                </div>
              </aside>

              <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-6">
                <div className="grid gap-4">
                  <div><Label>Headline</Label><Input value={edit.headline} onChange={(event) => setEdit((current) => ({ ...current, headline: event.target.value }))} className="mt-2 border-slate-700 bg-slate-950" /></div>
                  <div><Label>Facebook post</Label><Textarea value={edit.facebookCaption} onChange={(event) => setEdit((current) => ({ ...current, facebookCaption: event.target.value }))} className="mt-2 min-h-40 border-slate-700 bg-slate-950" /></div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div><Label>Instagram caption {isNorthwoodsCampaign && <span className="text-amber-300">· disabled for pilot</span>}</Label><Textarea value={edit.instagramCaption} disabled={isNorthwoodsCampaign} onChange={(event) => setEdit((current) => ({ ...current, instagramCaption: event.target.value }))} className="mt-2 min-h-36 border-slate-700 bg-slate-950" /></div>
                    <div><Label>Google Business post {isNorthwoodsCampaign && <span className="text-amber-300">· disabled for pilot</span>}</Label><Textarea value={edit.googleBusinessSummary} disabled={isNorthwoodsCampaign} onChange={(event) => setEdit((current) => ({ ...current, googleBusinessSummary: event.target.value }))} className="mt-2 min-h-36 border-slate-700 bg-slate-950" /></div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                    <div><Label>Short caption</Label><Input value={edit.shortCaption} onChange={(event) => setEdit((current) => ({ ...current, shortCaption: event.target.value }))} className="mt-2 border-slate-700 bg-slate-950" /></div>
                    <div><Label>CTA</Label><Select value={edit.cta} onValueChange={(value) => setEdit((current) => ({ ...current, cta: value }))}><SelectTrigger className="mt-2 border-slate-700 bg-slate-950"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="BOOK">Book</SelectItem><SelectItem value="CALL">Call</SelectItem><SelectItem value="GET_QUOTE">Get Quote</SelectItem><SelectItem value="LEARN_MORE">Learn More</SelectItem></SelectContent></Select></div>
                  </div>
                </div>

                <div className="mt-6 border-t border-slate-800 pt-5">
                  {isNorthwoodsCampaign ? (
                    <div className={`mb-4 rounded-xl border p-4 ${dashboard?.metaPilot.state === "ready" ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                      <h3 className="text-sm font-bold text-white">Matt Facebook Page handoff</h3>
                      <p className="mt-1 text-xs text-slate-300">Approval makes this campaign available to Matt; it does not publish. Matt alone can publish it to {dashboard?.metaPilot.authorizedPageName || dashboard?.metaPilot.authorizedPageId || "the configured pilot Page"}.</p>
                      <p className="mt-2 text-xs text-slate-400">Company publishing, Instagram, Google Business, other Pages, and every other representative are blocked by the server.</p>
                    </div>
                  ) : (
                    <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-white">JC Facebook Page targets</h3>
                        <p className="mt-1 text-xs text-blue-100/70">Each checked Page requires its own explicit publish result and permalink.</p>
                      </div>
                      <Badge variant="outline" className="border-blue-400/30 text-blue-100">{selectedFacebookConnectionIds.length} selected</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {connectedFacebookPages.map((page) => {
                        const publication = facebookPublicationByPage.get(page.pageId);
                        const checked = selectedFacebookConnectionIds.includes(page.id);
                        return (
                          <label key={page.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-blue-400/15 bg-slate-950/40 p-3">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => setSelectedFacebookConnectionIds((current) => value
                                ? [...new Set([...current, page.id])]
                                : current.filter((id) => id !== page.id))}
                              aria-label={`Publish to ${page.pageName}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-white">{page.pageName}</span>
                              <span className="mt-1 block text-[11px] text-slate-400">Page {page.pageId}</span>
                              {publication?.status === "published" && <span className="mt-1 block text-[11px] text-emerald-300">Already published for revision {campaign.revision}</span>}
                              {publication?.status === "failed" && <span className="mt-1 block text-[11px] text-amber-200">Retry available</span>}
                            </span>
                          </label>
                        );
                      })}
                      {!connectedFacebookPages.length && <p className="text-sm text-amber-200">No healthy JC Facebook Page connection is available.</p>}
                    </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="border-slate-700" disabled={!dirty || action.isPending || campaign.status === "published"} onClick={() => action.mutate({ method: "PATCH", url: `/api/admin/marketing-bot/campaigns/${campaign.id}`, body: edit, success: "Edits saved; approval reset" })}>Save edits</Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-500" disabled={action.isPending || Boolean(campaign.approved_at) || campaign.status === "published"} onClick={() => action.mutate({ method: "POST", url: `/api/admin/marketing-bot/campaigns/${campaign.id}/approve`, success: "Campaign approved" })}><Check className="mr-2 h-4 w-4" />Approve</Button>
                  <Button variant="outline" className="border-slate-700" disabled={action.isPending || campaign.status === "published"} onClick={() => action.mutate({ method: "POST", url: `/api/admin/marketing-bot/campaigns/${campaign.id}/skip`, body: { reason: "Skipped from approval queue" }, success: "Campaign skipped" })}>Skip</Button>
                  {!isNorthwoodsCampaign && <Button className="bg-blue-600 hover:bg-blue-500" disabled={action.isPending || !campaign.approved_at || !facebookReady || selectedFacebookConnectionIds.length === 0 || selectedFacebookPublished} onClick={() => action.mutate({ method: "POST", url: `/api/admin/marketing-bot/campaigns/${campaign.id}/publish`, body: { channels: ["facebook"], facebookConnectionIds: selectedFacebookConnectionIds }, success: "Selected JC Facebook Pages published" })}><Send className="mr-2 h-4 w-4" />Post to selected JC Pages</Button>}
                  {!isNorthwoodsCampaign && selectedFacebookFailed ? <Button variant="outline" className="border-amber-500/40 text-amber-100" disabled={action.isPending || selectedFacebookConnectionIds.length === 0} onClick={() => action.mutate({ method: "POST", url: `/api/admin/marketing-bot/campaigns/${campaign.id}/retry`, body: { channels: ["facebook"], facebookConnectionIds: selectedFacebookConnectionIds }, success: "Selected Facebook Page failures retried" })}><RefreshCw className="mr-2 h-4 w-4" />Retry selected Pages</Button> : null}
                  </div>
                </div>
                {!isNorthwoodsCampaign && !facebookReady && <p className="mt-3 flex items-start gap-2 text-xs text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Configure the JC Facebook Page connection before publishing. Instagram and Google are not required for this rollout.</p>}

                {!isNorthwoodsCampaign && <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {companyVariants.filter((variant) => variant.channel !== "facebook").map((variant) => {
                    const publication = publicationByChannel.get(variant.channel);
                    return <div key={variant.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-white">{channelLabels[variant.channel]}</span><StatusBadge status={publication?.status || "not posted"} /></div>{publication?.error_message && <p className="mt-2 text-xs text-red-300">{publication.error_message}</p>}{publication?.external_url && <a className="mt-2 inline-flex items-center gap-1 text-xs text-blue-300" href={publication.external_url} target="_blank" rel="noreferrer">Open post <ExternalLink className="h-3 w-3" /></a>}</div>;
                  })}
                  {connectedFacebookPages.map((page) => {
                    const publication = facebookPublicationByPage.get(page.pageId);
                    return <div key={page.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-white">{page.pageName}</span><StatusBadge status={publication?.status || "not posted"} /></div>{publication?.error_message && <p className="mt-2 text-xs text-red-300">{publication.error_message}</p>}{publication?.external_url && <a className="mt-2 inline-flex items-center gap-1 text-xs text-blue-300" href={publication.external_url} target="_blank" rel="noreferrer">Open post <ExternalLink className="h-3 w-3" /></a>}</div>;
                  })}
                </div>}
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-0">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
            {(dashboard?.campaigns || []).map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className="grid w-full gap-2 border-b border-slate-800 px-4 py-4 text-left last:border-0 hover:bg-white/5 md:grid-cols-[120px_1fr_160px_130px] md:items-center"><span className="text-sm text-slate-400">{String(item.local_date).slice(0, 10)}</span><span><span className="block font-bold text-white">{item.headline}</span><span className="text-xs text-slate-500">{serviceLabels[item.service]} · {territoryLabels[item.territory]}</span></span><span className="font-mono text-xs text-slate-500">score {Number(item.score).toFixed(0)}</span><span><StatusBadge status={item.status} /></span></button>)}
            {!dashboard?.campaigns.length && <div className="p-8 text-center text-slate-400">No campaigns yet.</div>}
          </div>
        </TabsContent>

        <TabsContent value="share-kits" className="mt-0">
          <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-100"><Users className="mr-2 inline h-4 w-4" />Each kit has a unique tracked URL and the employee's promo code. These are for employee sharing; company channels publish only the canonical company versions.</div>
          <div className="grid gap-4 lg:grid-cols-2">
            {shareKits.map((variant) => {
              const representative = variant.rep_slug ? representativeBySlug.get(variant.rep_slug) : null;
              return <article key={variant.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-white">{variant.rep_slug || "Employee"}</h3><p className="text-xs text-slate-500">Code {variant.promo_code || "none"}</p>{representative?.pilotAllowed && <p className="mt-1 text-xs text-blue-300">{representative.connection?.status === "connected" ? `Connected: ${representative.connection.pageName}` : "Matt pilot: Page not connected"} · {representative.publications.published} published</p>}</div><Button size="sm" variant="outline" className="border-slate-700" onClick={() => copyText(variant.caption, variant.rep_slug || "Share kit")}><Clipboard className="mr-2 h-3.5 w-3.5" />Copy</Button></div><p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{variant.caption}</p></article>;
            })}
            {!shareKits.length && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Select a campaign with active marketing representatives.</div>}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-0 space-y-5">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-start gap-3">
              <MousePointerClick className="mt-0.5 h-5 w-5 text-orange-300" />
              <div><h2 className="font-bold text-white">Staff attribution</h2><p className="mt-1 text-sm text-slate-400">When a caller mentions a campaign or employee code, attach the lead or confirmed booking here.</p></div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]">
              <Select value={attributionVariant} onValueChange={setAttributionVariant} disabled={!campaign?.variants.length}>
                <SelectTrigger className="border-slate-700 bg-slate-950"><SelectValue placeholder="Select campaign variant" /></SelectTrigger>
                <SelectContent>{(campaign?.variants || []).map((variant) => <SelectItem key={variant.id} value={variant.variant_code}>{variant.rep_slug ? `${variant.rep_slug} · ` : "Company · "}{channelLabels[variant.channel]}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={attributionNote} onChange={(event) => setAttributionNote(event.target.value)} placeholder="Optional caller / source note" className="border-slate-700 bg-slate-950" />
              <Button variant="outline" className="border-slate-700" disabled={!attributionVariant || action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/marketing-bot/events", body: { variantCode: attributionVariant, eventType: "lead", sourceNote: attributionNote || undefined }, success: "Lead attributed" })}>Tag lead</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-500" disabled={!attributionVariant || action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/marketing-bot/events", body: { variantCode: attributionVariant, eventType: "booking", sourceNote: attributionNote || undefined }, success: "Confirmed booking attributed" })}>Tag booking</Button>
            </div>
          </section>
          {latestReport && <section className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold text-white">Weekly report · {String(latestReport.period_end).slice(0, 10)}</h2><Badge variant="outline" className="border-blue-400/30 text-blue-100">{latestReport.email_sent ? "emailed" : "dashboard only"}</Badge></div><p className="mt-3 text-sm leading-relaxed text-blue-50">{latestReport.summary}</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-blue-100">{latestReport.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></section>}
          <div className="flex justify-end"><Button variant="outline" className="border-slate-700" disabled={action.isPending} onClick={() => action.mutate({ method: "POST", url: "/api/admin/marketing-bot/reports/generate", success: "Weekly report generated" })}><Sparkles className="mr-2 h-4 w-4" />Generate weekly report</Button></div>
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-3">Campaign</th><th className="p-3">Views</th><th className="p-3">Calls</th><th className="p-3">Messages</th><th className="p-3">Leads</th><th className="p-3">Bookings</th></tr></thead><tbody>{(dashboard?.metrics.campaigns || []).map((item) => <tr key={item.id} className="border-t border-slate-800"><td className="p-3"><span className="font-semibold text-white">{serviceLabels[item.service]}</span><span className="block text-xs text-slate-500">{territoryLabels[item.territory]}</span></td><td className="p-3">{item.views}</td><td className="p-3">{item.call_clicks}</td><td className="p-3">{item.message_clicks}</td><td className="p-3">{item.leads}</td><td className="p-3 font-black text-emerald-300">{item.bookings}</td></tr>)}</tbody></table></div>
        </TabsContent>

        <TabsContent value="connections" className="mt-0">
          <div className={`mb-5 rounded-2xl border p-5 ${dashboard?.metaPilot.state === "ready" ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-blue-200">Matt Facebook Page pilot</p>
                <h3 className="mt-1 text-lg font-black text-white">{dashboard?.metaPilot.state.replaceAll("_", " ")}</h3>
                <p className="mt-2 text-sm text-slate-300">Authorized Page: {dashboard?.metaPilot.authorizedPageName ? `${dashboard.metaPilot.authorizedPageName} (${dashboard.metaPilot.authorizedPageId})` : dashboard?.metaPilot.authorizedPageId || "not configured"}</p>
                <p className="mt-1 text-xs text-slate-400">Northwoods Facebook only. Instagram is disabled. Other representatives are disabled. Approval never auto-publishes.</p>
              </div>
              {dashboard?.metaPilot.state === "ready" ? <CheckCircle2 className="h-6 w-6 text-emerald-300" /> : <AlertTriangle className="h-6 w-6 text-amber-300" />}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3"><p className="text-xs font-bold text-white">OAuth callback</p><p className="mt-1 break-all font-mono text-[11px] text-slate-400">{dashboard?.metaPilot.redirectUri || "META_OAUTH_REDIRECT_URI missing"}</p></div>
              <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3"><p className="text-xs font-bold text-white">Required permissions</p><p className="mt-1 text-[11px] text-slate-400">{dashboard?.metaPilot.requiredScopes.join(", ")}</p></div>
            </div>
            {Boolean(dashboard?.metaPilot.missing.length || dashboard?.metaPilot.configurationErrors.length) && <div className="mt-3 flex flex-wrap gap-1.5">{[...(dashboard?.metaPilot.missing || []), ...(dashboard?.metaPilot.configurationErrors || [])].map((item) => <code key={item} className="rounded bg-slate-950 px-2 py-1 text-[11px] text-amber-100">{item}</code>)}</div>}
          </div>
          <div className="mb-5 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-white">Legacy company Facebook Pages (non-Northwoods)</h3>
                <p className="mt-1 text-sm text-blue-100/70">Company credentials are encrypted separately from Matt’s Page connection. Northwoods campaigns cannot use these Pages, and tokens are never shown here.</p>
              </div>
              <Badge variant="outline" className="border-blue-400/30 text-blue-100">{connectedFacebookPages.length} connected</Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(dashboard?.companyConnections || []).map((connection) => (
                <div key={connection.id} className="rounded-xl border border-blue-400/15 bg-slate-950/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-white">{connection.pageName}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Page {connection.pageId}</p>
                    </div>
                    <StatusBadge status={connection.status} />
                  </div>
                  {connection.lastVerifiedAt && <p className="mt-3 text-xs text-slate-400">Verified {new Date(connection.lastVerifiedAt).toLocaleString()}</p>}
                  {connection.lastError && <p className="mt-2 text-xs text-amber-200">{connection.lastError}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="border-slate-700" disabled={action.isPending || connection.status === "disconnected"} onClick={() => action.mutate({ method: "POST", url: `/api/admin/marketing-bot/meta/connections/${connection.id}/verify`, success: `${connection.pageName} verified` })}>Verify</Button>
                    <Button size="sm" variant="outline" className="border-red-500/30 text-red-200" disabled={action.isPending || connection.status === "disconnected"} onClick={() => action.mutate({ method: "DELETE", url: `/api/admin/marketing-bot/meta/connections/${connection.id}`, success: `${connection.pageName} disconnected` })}>Disconnect</Button>
                  </div>
                </div>
              ))}
              {!dashboard?.companyConnections.length && <p className="text-sm text-amber-200">No company Facebook Pages are connected yet.</p>}
            </div>
            <div className="mt-5 rounded-xl border border-blue-400/15 bg-slate-950/50 p-4">
              <div>
                <h4 className="font-bold text-white">Secure one-time Page connection</h4>
                <p className="mt-1 text-xs text-slate-400">Enter a token only for each Page you want to reconnect. JC On The MOVE : CoM is the main publishing Page. Tokens are verified by Meta, encrypted on the server, and cleared from this form after import.</p>
              </div>
              <div className="mt-4 grid gap-3">
                {jcCompanyFacebookPages.map((page) => (
                  <div key={page.pageId} className="grid gap-2 md:grid-cols-[240px_1fr] md:items-center">
                    <Label htmlFor={`company-page-token-${page.pageId}`} className="text-slate-300">
                      {page.pageName}
                      <span className="mt-0.5 block text-[11px] font-normal text-slate-500">Page {page.pageId}</span>
                    </Label>
                    <Input
                      id={`company-page-token-${page.pageId}`}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={companyPageTokens[page.pageId] || ""}
                      onChange={(event) => setCompanyPageTokens((current) => ({ ...current, [page.pageId]: event.target.value }))}
                      placeholder="Meta Page access token"
                      className="border-slate-700 bg-slate-950"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  className="bg-blue-600 hover:bg-blue-500"
                  disabled={companyImportPending || !jcCompanyFacebookPages.some((page) => companyPageTokens[page.pageId]?.trim())}
                  onClick={importCompanyFacebookPages}
                >
                  {companyImportPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Connect entered Pages
                </Button>
                <p className="text-xs text-slate-500">Available only while the temporary server import gate is enabled.</p>
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {(dashboard?.readiness || []).map((connection) => {
              const pilotDisabled = connection.channel !== "facebook";
              const pilotNote = connection.channel === "instagram"
                ? "Disabled for the Matt Page pilot. No Instagram product, token, or publishing path is enabled."
                : connection.channel === "google_business"
                  ? "Disabled for the Matt Page pilot. Northwoods approval routes only to Matt’s authorized Facebook Page."
                  : connection.note;
              return <div key={connection.channel} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-bold text-white">{channelLabels[connection.channel]}</h3>{pilotDisabled ? <Badge variant="outline" className="border-slate-600 text-slate-300">Pilot disabled</Badge> : connection.ready ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-amber-400" />}</div><p className="mt-3 text-sm text-slate-400">{pilotNote}</p>{!pilotDisabled && connection.missing.length > 0 && <div className="mt-3 space-y-1">{connection.missing.map((name) => <code key={name} className="block rounded bg-slate-950 px-2 py-1 text-[11px] text-slate-400">{name}</code>)}</div>}</div>;
            })}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h3 className="font-bold text-white">AI campaign planner</h3><p className="mt-2 text-sm text-slate-400">Model: {dashboard?.ai.model}</p><p className="mt-1 text-sm text-slate-400">{dashboard?.ai.ready ? "AI Gateway connected" : "AI key missing; deterministic campaign copy remains available"}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h3 className="font-bold text-white">Autopilot guardrail</h3><p className="mt-2 text-sm text-slate-400">Scheduler: {dashboard?.scheduler.enabled ? "on" : "off"}</p><p className="mt-1 text-sm text-slate-400">Automatic publishing: off. Every campaign requires owner/admin approval.</p></div></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
