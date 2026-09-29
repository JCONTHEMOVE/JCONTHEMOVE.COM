import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Copy, Loader2, Pencil, RefreshCw, Send, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { personalPromoNameSchema, type PersonalPromoState } from "@shared/personalPromo";

export const PERSONAL_PROMO_QUERY = "/api/crew/marketing/promo-code";

export function PersonalPromoPanel({ state, loading, failed, retry }: {
  state?: PersonalPromoState; loading: boolean; failed: boolean; retry: () => void;
}) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const valid = personalPromoNameSchema.parse(code);
      return (await apiRequest("POST", `${PERSONAL_PROMO_QUERY}/requests`, { code: valid })).json() as Promise<PersonalPromoState>;
    },
    onSuccess: next => {
      client.setQueryData([PERSONAL_PROMO_QUERY], next);
      setEditing(false); setCode("");
      toast({ title: "Code submitted for owner approval" });
    },
    onError: (error: Error) => toast({ title: "Request not saved", description: error.message, variant: "destructive" }),
  });
  const pending = state?.request?.status === "pending";
  const options = [...new Set([...(state?.candidates || []).map(promo => promo.code), ...(state?.suggestions || [])])];
  return <section aria-labelledby="personal-promo-heading" className="border-y border-white/10 py-5">
    <div className="flex items-center justify-between gap-3">
      <h2 id="personal-promo-heading" className="flex items-center gap-2 text-lg font-semibold text-white"><Tag className="h-5 w-5 text-emerald-400" />Your personal code</h2>
      <Button type="button" variant="ghost" size="icon" aria-label="Refresh personal code" title="Refresh personal code" onClick={retry}><RefreshCw className="h-4 w-4" /></Button>
    </div>
    {loading ? <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />Loading your code...</p>
      : failed ? <p role="alert" className="mt-3 text-sm text-amber-300">Your code could not be verified. Refresh before generating an ad.</p>
      : state && <>
        {state.promo && <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="break-all font-mono text-xl font-bold text-emerald-300">{state.promo.code}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-300"><Check className="h-3 w-3" />Approved</p>
            <p className="mt-2 text-sm text-zinc-300">{state.offer?.caption}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Copy personal code" title="Copy personal code" onClick={() => navigator.clipboard.writeText(state.promo!.code).then(() => toast({ title: "Code copied" })).catch(() => toast({ title: "Copy failed", variant: "destructive" }))}><Copy className="h-4 w-4" /></Button>
        </div>}
        {state.reason && <p className="mt-3 text-sm text-amber-300">{state.reason}</p>}
        {pending && <div className="mt-4 border-l-2 border-amber-400 pl-3" role="status">
          <p className="flex items-center gap-2 text-sm text-amber-200"><Clock className="h-4 w-4" />Awaiting owner approval</p>
          <p className="mt-1 break-all font-mono text-sm text-white">{state.request!.requestedCode}</p>
        </div>}
        {state.request?.status === "rejected" && <div className="mt-4 border-l-2 border-red-400 pl-3">
          <p className="text-sm text-red-200">Changes requested for {state.request.requestedCode}</p>
          <p className="mt-1 break-words text-sm text-zinc-300">{state.request.feedback}</p>
        </div>}
        {!pending && (editing || !state.promo) && <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
          {options.length > 0 && <div className="space-y-1">
            <Label htmlFor="personal-promo-suggestion">Available names and your existing codes</Label>
            <select id="personal-promo-suggestion" value={options.includes(code) ? code : ""} onChange={event => setCode(event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-white">
              <option value="">Choose a name</option>{options.map(option => <option key={option}>{option}</option>)}
            </select>
          </div>}
          <div className="space-y-1"><Label htmlFor="personal-promo-name">Requested code</Label><Input id="personal-promo-name" value={code} onChange={event => setCode(event.target.value.toUpperCase())} minLength={3} maxLength={20} pattern="[A-Za-z0-9]{3,20}" placeholder="TIMMOVES" required className="bg-zinc-950 font-mono text-white" /></div>
          <Button type="submit" disabled={mutation.isPending || !personalPromoNameSchema.safeParse(code).success} className="gap-2">{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Request approval</Button>
        </form>}
        {!pending && !editing && state.promo && <Button type="button" variant="ghost" className="mt-3 gap-2" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Request a different code</Button>}
      </>}
  </section>;
}
