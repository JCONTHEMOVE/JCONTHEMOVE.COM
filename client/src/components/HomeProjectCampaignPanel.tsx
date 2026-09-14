import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { HOME_PROJECT_CAMPAIGN, homeProjectLink } from "@shared/homeProjectCampaign";
import { formatOrderNumber } from "@shared/schema";
type Counts = { requests: number; needs_review: number; quoted: number; booked: number; completed: number };
type CampaignStats = {
  totals: Counts; reps: Array<Counts & { slug: string; name: string }>;
  recent: Array<{ id: string; order_number: number; first_name: string; status: string; deadline: string | null; rep_name: string | null }>;
};
export function HomeProjectCampaignPanel({ reps }: { reps: Array<{ slug: string; displayName: string; isActive: boolean }> }) {
  const { toast } = useToast();
  const query = useQuery<CampaignStats>({ queryKey: ["/api/admin/marketing-network/home-projects"] });
  async function copy(slug: string, name: string) {
    try { await navigator.clipboard.writeText(homeProjectLink(slug)); toast({ title: name + "'s project link copied" }); }
    catch { toast({ title: "Select and copy the link below", variant: "destructive" }); }
  }
  return <Card className="border-emerald-500/30 bg-emerald-950/30 text-white">
    <CardHeader><CardTitle>Carpet removal &amp; holiday home projects</CardTitle><p className="text-sm text-slate-300">Goal: {HOME_PROJECT_CAMPAIGN.goal} booked projects by December 14, 2026. About eight bookings per week.</p></CardHeader>
    <CardContent className="space-y-6">
      {query.isPending ? <p role="status">Loading campaign results…</p> : query.isError ? <div role="alert"><p>Campaign results are unavailable. Existing leads remain in the quote queue.</p><Button onClick={() => query.refetch()} variant="outline" className="mt-3">Retry results</Button></div> : query.data && <>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">{([["Requests", "requests"], ["Needs review", "needs_review"], ["Quotes sent", "quoted"], ["Booked", "booked"], ["Completed", "completed"]] as const).map(([label, key]) => <div key={key}><p className="text-sm text-slate-300">{label}</p><p className="mt-1 text-3xl font-black">{query.data.totals[key]}</p></div>)}</div>
        <div><label htmlFor="home-project-goal" className="text-sm">{query.data.totals.booked} of {HOME_PROJECT_CAMPAIGN.goal} booked projects</label><progress id="home-project-goal" max={HOME_PROJECT_CAMPAIGN.goal} value={Math.min(HOME_PROJECT_CAMPAIGN.goal, query.data.totals.booked)} className="mt-2 h-3 w-full accent-emerald-400" /></div>
        {query.data.reps.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-bold">Credit by original referral</caption><thead><tr className="border-b border-white/20"><th className="py-2 pr-4">Source</th><th className="pr-4">Requests</th><th className="pr-4">Booked</th><th>Completed</th></tr></thead><tbody>{query.data.reps.map(row => <tr key={row.slug} className="border-b border-white/10"><th className="py-2 pr-4 font-medium">{row.name}</th><td>{row.requests}</td><td>{row.booked}</td><td>{row.completed}</td></tr>)}</tbody></table></div>}
        {query.data.recent.length > 0 && <div><h3 className="font-bold">Recent project requests</h3><ul className="mt-2 space-y-2">{query.data.recent.map(lead => <li key={lead.id}><Link href={"/lead/" + lead.id} className="block rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5"><span className="font-bold">{formatOrderNumber(lead.order_number)} · {lead.first_name}</span><span className="ml-3">{lead.status.replace(/_/g, " ")}</span><span className="block text-slate-300">{lead.rep_name || "Direct"}{lead.deadline ? " · Requested by " + lead.deadline : ""}</span></Link></li>)}</ul></div>}
      </>}
      <div><h3 className="font-bold">Share each person’s project link</h3><p className="mt-1 text-sm text-slate-300">These links work in posts, texts and links from your other websites. Credit follows the original referral into the saved request.</p>
        <div className="mt-4 space-y-3">{reps.filter(rep => rep.isActive).map(rep => <div key={rep.slug} className="flex flex-col gap-2 sm:flex-row sm:items-center"><label htmlFor={"project-link-" + rep.slug} className="w-20 shrink-0 text-sm font-bold">{rep.displayName}</label><Input id={"project-link-" + rep.slug} readOnly value={homeProjectLink(rep.slug)} className="min-w-0 bg-black/20 text-sm text-white" onFocus={event => event.currentTarget.select()} /><Button variant="outline" onClick={() => copy(rep.slug, rep.displayName)}>Copy link</Button></div>)}</div>
      </div>
      <p className="text-sm text-slate-300">Requests require an owner-reviewed quote. Referral credit here records the source; existing payout rules still apply.</p>
    </CardContent>
  </Card>;
}

