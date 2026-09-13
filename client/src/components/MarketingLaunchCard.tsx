import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Megaphone, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MarketingBotSetupCard } from './MarketingBotSetupCard';

type LaunchAction = {
  id: string;
  title: string;
  description: string;
  status: string;
  proof_url: string | null;
  proof_notes: string | null;
};

type MyLaunch = {
  rep: null | {
    id: string;
    slug: string;
    display_name: string;
    brand_name: string;
    promo_code: string;
    service_focus: string[];
    territory: string;
    audience: string;
    profileUrl: string;
  };
  actions: LaunchAction[];
  tutorialStepsDone: number;
  discordInviteUrl: string;
};

export function MarketingLaunchCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const launch = useQuery<MyLaunch>({ queryKey: ["/api/marketing-execution/my-launch"] });

  const complete = useMutation({
    mutationFn: async (action: LaunchAction) => {
      const response = await apiRequest("POST", `/api/marketing-execution/my-actions/${action.id}/complete`, {
        proofNotes: proofNotes[action.id] || action.proof_notes || "",
        proofUrl: proofUrls[action.id] || action.proof_url || "",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-execution/my-launch"] });
      toast({ title: "Marketing action logged", description: "Your launch board is updated." });
    },
    onError: (error: Error) => toast({ title: "Could not log action", description: error.message, variant: "destructive" }),
  });

  if (launch.isLoading) return <p className="text-sm text-slate-500">Loading your marketing launch…</p>;
  const data = launch.data;
  if (!data?.rep) {
    return (
      <Card className="border-amber-500/25 bg-amber-500/10">
        <CardContent className="p-4">
          <div className="flex items-start gap-3"><Target className="mt-0.5 h-5 w-5 text-amber-300" /><div><p className="font-black text-white">Marketing profile still needs linking</p><p className="mt-1 text-sm text-slate-300">Your admin will connect your crew account to Matt, Bill, Evan, Troy, or Darrell’s promo profile. You can still use the ad builder while that is being finished.</p></div></div>
        </CardContent>
      </Card>
    );
  }

  const completed = data.actions.filter((action) => action.status === "completed").length;
  return (
    <div className="space-y-4"><MarketingBotSetupCard /><details><summary className="min-h-11 cursor-pointer rounded-xl border border-slate-700 p-3 text-sm font-semibold">Launch actions · {completed}/{data.actions.length} completed</summary><Card className="mt-3 border-emerald-400/25 bg-emerald-500/10">
      <CardHeader className="pb-2"><CardTitle className="flex items-start justify-between gap-3 text-white"><span><span className="block text-xs uppercase tracking-[0.18em] text-emerald-200">Marketing launch</span><span className="mt-1 block text-lg">{data.rep.brand_name}</span></span><Megaphone className="h-5 w-5 text-emerald-300" /></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-200">Use <strong>{data.rep.promo_code}</strong> and your verified rep page whenever you share JC ON THE MOVE.</p>
        <div className="flex flex-wrap gap-2"><a href={data.rep.profileUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="border-emerald-300/35"><ExternalLink className="mr-2 h-3.5 w-3.5" />Open rep page</Button></a><a href={data.discordInviteUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="border-indigo-300/35">Crew Discord</Button></a><span className="rounded-full border border-emerald-300/30 px-2 py-1 text-xs text-emerald-100">{completed}/{data.actions.length} actions</span></div>
        <div className="space-y-3">
          {data.actions.map((action) => (
            <div key={action.id} className="rounded-xl border border-emerald-200/15 bg-slate-950/40 p-3">
              <div className="flex gap-3"><CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${action.status === "completed" ? "text-emerald-300" : "text-slate-600"}`} /><div><p className="text-sm font-black text-white">{action.title}</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{action.description}</p></div></div>
              {action.status === "completed" ? <p className="mt-3 text-xs font-semibold text-emerald-200">Completed {action.proof_notes ? `· ${action.proof_notes}` : ""}</p> : <div className="mt-3 grid gap-2"><Input value={proofUrls[action.id] || ""} onChange={(event) => setProofUrls((current) => ({ ...current, [action.id]: event.target.value }))} placeholder="Optional post or proof URL" className="h-8 border-slate-700 bg-slate-950 text-xs" /><Textarea value={proofNotes[action.id] || ""} onChange={(event) => setProofNotes((current) => ({ ...current, [action.id]: event.target.value }))} placeholder="What did you post, share, or follow up on?" className="min-h-16 border-slate-700 bg-slate-950 text-xs" /><Button size="sm" disabled={complete.isPending} onClick={() => complete.mutate(action)} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">Log completed action</Button></div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card></details></div>
  );
}
