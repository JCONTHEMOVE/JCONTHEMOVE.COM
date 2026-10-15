import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { LEAD_BOT_QUESTIONS, LEAD_BOT_SERVICES, leadBotConfigSchema, type LeadBotConfig } from "@shared/leadBotPilot";
import { MARKETING_TERRITORY_LABELS } from "@shared/marketingBot";

const endpoint = "/api/admin/marketing-bot/lead-bot-pilot";
type Dashboard = {
  representatives: Array<{ id: string; user_id: string | null; display_name: string }>;
  campaigns: Array<{ id: string; headline: string; service: string; territory: string; variant_id: string; rep_id: string }>;
  promotions: Array<{ id: string; code: string; description: string; referral_user_id: string | null }>;
  bot: { id: string; revision: number; status: string; config: LeadBotConfig } | null;
  metrics: { views: number; inquiries: number }; publicEnabled: boolean; reviewIssue: string | null;
};
const initial: LeadBotConfig = {
  name: "Northwoods inquiry pilot", representativeId: "", campaignId: "", variantId: "", service: "junk_removal",
  territory: "ironwood_hurley", towns: [{ city: "Ironwood", state: "MI" }, { city: "Hurley", state: "WI" }, { city: "Bessemer", state: "MI" }, { city: "Wakefield", state: "MI" }],
  promotionId: null, questions: ["access", "items"],
};
const selectClass = "mt-1 min-h-11 w-full rounded-md border border-slate-600 bg-slate-950 px-3 text-white";

export default function LeadBotBuilder() {
  const client = useQueryClient();
  const query = useQuery<Dashboard>({ queryKey: [endpoint], queryFn: async () => (await apiRequest("GET", endpoint)).json() });
  const [config, setConfig] = useState<LeadBotConfig>(initial);
  const [towns, setTowns] = useState("Ironwood, MI\nHurley, WI\nBessemer, MI\nWakefield, MI");
  const [notice, setNotice] = useState("");
  const data = query.data;
  useEffect(() => {
    if (data?.bot) { setConfig(data.bot.config); setTowns(data.bot.config.towns.map(t => `${t.city}, ${t.state}`).join("\n")); }
  }, [data?.bot?.id, data?.bot?.revision]);
  const mutation = useMutation({
    mutationFn: async ({ path, body }: { path: string; body: unknown }) => (await apiRequest("POST", path, body)).json(),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: [endpoint] }); setNotice("Saved. Publishing and customer messaging remain disabled."); },
    onError: (error: Error) => setNotice(error.message),
  });
  const field = <K extends keyof LeadBotConfig>(key: K, value: LeadBotConfig[K]) => { setConfig(current => ({ ...current, [key]: value })); setNotice(""); };
  const availableCampaigns = data?.campaigns.filter(c => c.rep_id === config.representativeId && c.service === config.service && c.territory === config.territory) || [];
  const rep = data?.representatives.find(r => r.id === config.representativeId);
  const promotions = data?.promotions.filter(p => !p.referral_user_id || p.referral_user_id === rep?.user_id) || [];
  const townRows = towns.split("\n").filter(line => line.trim()).map(line => {
    const [city, state, ...extra] = line.split(",").map(part => part.trim());
    return { city: extra.length ? "" : city, state: state?.toUpperCase() };
  });
  const parsed = leadBotConfigSchema.safeParse({ ...config, towns: townRows });
  const dirty = !data?.bot || !parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(data.bot.config);
  if (query.isLoading) return <p role="status">Loading the lead-bot builder…</p>;
  if (query.isError) return <div role="alert">The builder could not load. <Button onClick={() => query.refetch()}>Try again</Button></div>;

  return <section className="space-y-6 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-slate-100 sm:p-6">
    <header className="space-y-2"><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">JC ON THE MOVE LLC · Controlled pilot</p>
      <h2 className="text-2xl font-bold">Representative lead-bot builder</h2>
      <p className="max-w-2xl text-sm text-slate-300">Create one short conversation for an existing approved campaign. Inquiries enter the owner’s lead queue with the selected representative’s credit.</p>
    </header>
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      {data?.publicEnabled ? "The approved campaign link is open." : "Public intake is closed. Owner approval prepares the configuration; opening it requires a separate release approval."}
      <p className="mt-1">Publishing and customer messaging are disabled. Preview answers are never submitted.</p>
    </div>
    {data?.reviewIssue && <p role="alert" className="text-amber-200">{data.reviewIssue}</p>}
    <form onSubmit={event => {
      event.preventDefault();
      if (!parsed.success) { setNotice(parsed.error.issues[0]?.message || "Review the configuration."); return; }
      mutation.mutate({ path: endpoint, body: { ...(data?.bot ? { id: data.bot.id, revision: data.bot.revision } : {}), config: parsed.data } });
    }} className="space-y-5">
      <label className="block text-sm">Bot name<Input className="mt-1" value={config.name} maxLength={80} onChange={e => field("name", e.target.value)} required /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">Representative<select className={selectClass} value={config.representativeId} required onChange={e => { field("representativeId", e.target.value); field("variantId", ""); field("campaignId", ""); field("promotionId", null); }}>
          <option value="">Choose a representative</option>{data?.representatives.map(r => <option key={r.id} value={r.id} disabled={!r.user_id}>{r.display_name}{!r.user_id ? " — link a user first" : ""}</option>)}
        </select></label>
        <label className="block text-sm">Service<select className={selectClass} value={config.service} onChange={e => { field("service", e.target.value as LeadBotConfig["service"]); field("campaignId", ""); field("variantId", ""); }}>
          {Object.entries(LEAD_BOT_SERVICES).map(([value, service]) => <option key={value} value={value}>{service.label}</option>)}
        </select></label>
        <label className="block text-sm">Territory<select className={selectClass} value={config.territory} onChange={e => { field("territory", e.target.value as LeadBotConfig["territory"]); field("campaignId", ""); field("variantId", ""); }}>
          {Object.entries(MARKETING_TERRITORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="block text-sm">Approved promotion<select className={selectClass} value={config.promotionId || ""} onChange={e => field("promotionId", e.target.value || null)}>
          <option value="">No promotion</option>{promotions.map(p => <option key={p.id} value={p.id}>{p.code} — {p.description}</option>)}
        </select></label>
      </div>
      <label className="block text-sm">Approved campaign<select className={selectClass} value={config.variantId} required onChange={e => { const campaign = availableCampaigns.find(c => c.variant_id === e.target.value); field("variantId", campaign?.variant_id || ""); field("campaignId", campaign?.id || ""); }}>
        <option value="">Choose the campaign for this pilot</option>{availableCampaigns.map(c => <option key={c.variant_id} value={c.variant_id}>{c.headline}</option>)}
      </select></label>
      {!availableCampaigns.length && <p className="text-sm text-slate-300">Choose a representative, service and territory with an approved campaign in the Campaigns tab. No sample campaign will be added to your live records.</p>}
      <label className="block text-sm">Included towns — one “City, State” per line<textarea className={`${selectClass} min-h-28 py-2`} value={towns} onChange={e => setTowns(e.target.value)} required maxLength={1200} />
        <span className="mt-1 block text-xs text-slate-400">These towns are checked at submission. Review them for the selected territory.</span>
      </label>
      <fieldset className="space-y-3 rounded-xl border border-slate-700 p-4"><legend className="px-2 font-semibold">Lead-capture questions</legend>
        <p className="text-sm text-slate-300">Always included: location, project scope, preferred timing and contact details.</p>
        {Object.entries(LEAD_BOT_QUESTIONS).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={config.questions.includes(key as keyof typeof LEAD_BOT_QUESTIONS)} onChange={e => field("questions", e.target.checked ? [...config.questions, key as keyof typeof LEAD_BOT_QUESTIONS] : config.questions.filter(q => q !== key))} />{label}</label>)}
      </fieldset>
      <Button type="submit" disabled={mutation.isPending || !dirty}>Save draft</Button>
    </form>
    {data?.bot && <div className="space-y-3 border-t border-slate-700 pt-5">
      <p className="text-sm">Revision {data.bot.revision} · <strong>{data.bot.status}</strong> · {data.metrics.views} visits · {data.metrics.inquiries} inquiries</p>
      <p className="text-xs text-slate-400">Counts represent distinct visits and saved inquiries, not bookings or revenue.</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline"><a href={`/lead-bot/${data.bot.id}?preview=1`} target="_blank" rel="noreferrer">Preview saved conversation</a></Button>
        <Button disabled={dirty || mutation.isPending} onClick={() => mutation.mutate({ path: `${endpoint}/${data.bot!.id}/decision`, body: { revision: data.bot!.revision, decision: "approve" } })}>Approve saved configuration</Button>
        <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `${endpoint}/${data.bot!.id}/decision`, body: { revision: data.bot!.revision, decision: "pause" } })}>Pause</Button>
      </div>
      <label className="block text-sm">Customer link {data.publicEnabled ? "" : "(inactive)"}<Input className="mt-1" readOnly value={`${window.location.origin}/lead-bot/${data.bot.id}`} onFocus={e => e.target.select()} /></label>
      <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/lead-bot/${data.bot!.id}`); setNotice(data.publicEnabled ? "Link copied." : "Inactive link copied for review. Public intake is still closed."); } catch { setNotice("Select the link above to copy it."); } }}>Copy link</Button>
      <a className="ml-4 text-sm text-emerald-300 underline" href="/leads">Open existing lead queue</a>
    </div>}
    {notice && <p role="status" className="rounded-lg bg-slate-800 p-3 text-sm">{notice}</p>}
  </section>;
}
