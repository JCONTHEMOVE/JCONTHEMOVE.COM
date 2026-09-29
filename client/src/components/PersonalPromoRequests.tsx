import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { personalPromoReviewSchema, type PersonalPromoReviewItem } from "@shared/personalPromo";
import { PERSONAL_PROMO_QUERY } from "./PersonalPromoPanel";

const endpoint = "/api/admin/promo-code-requests";
const emptyTerms = { description: "", discountPercent: "0", discountPercentJewelry: "0", rewardTokens: "0", referralRewardTokens: "0", maxUses: "", expiresAt: "" };

export function PersonalPromoRequests({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const requests = useQuery<PersonalPromoReviewItem[]>({ queryKey: [endpoint], enabled });
  const [review, setReview] = useState<PersonalPromoReviewItem | null>(null);
  const [filter, setFilter] = useState("pending");
  const [existingId, setExistingId] = useState("");
  const [code, setCode] = useState("");
  const [terms, setTerms] = useState(emptyTerms);
  const [feedback, setFeedback] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const existing = review?.candidates.find(promo => promo.id === existingId);
  const mutation = useMutation({
    mutationFn: async (action: "approve" | "reject") => {
      if (!review) throw new Error("Select a request.");
      if (action === "approve" && !confirmed) throw new Error("Confirm the code and offer terms first.");
      const payload = personalPromoReviewSchema.parse(action === "reject" ? { action, feedback } : {
        action, code: existing?.code || code, feedback,
        ...(existing ? { existingPromoId: existing.id } : { terms: {
          ...terms, maxUses: terms.maxUses ? Number(terms.maxUses) : null,
          expiresAt: terms.expiresAt ? new Date(terms.expiresAt).toISOString() : null,
        } }),
      });
      return apiRequest("POST", `${endpoint}/${review.id}/review`, payload);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [endpoint] });
      client.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
      client.invalidateQueries({ queryKey: ["/api/marketing-network/reps"] });
      client.invalidateQueries({ queryKey: [PERSONAL_PROMO_QUERY] });
      setReview(null); toast({ title: "Code request reviewed" });
    },
    onError: (error: Error) => toast({ title: "Review not saved", description: error.message, variant: "destructive" }),
  });
  function open(item: PersonalPromoReviewItem) {
    setReview(item); setCode(item.requestedCode); setFeedback(""); setConfirmed(false); setTerms(emptyTerms);
    setExistingId(item.candidates.find(promo => promo.code === item.requestedCode && !promo.unavailableReason)?.id || "");
  }
  return <section aria-labelledby="promo-requests-heading" className="my-6 border-y border-white/10 py-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="promo-requests-heading" className="flex items-center gap-2 text-lg font-semibold text-white"><ClipboardCheck className="h-5 w-5 text-emerald-400" />Personal code requests</h2>
      <div className="flex items-center gap-2">
        <select aria-label="Request status" value={filter} onChange={event => setFilter(event.target.value)} className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-white"><option value="pending">Pending</option><option value="reviewed">Reviewed</option></select>
        <Button variant="ghost" size="icon" aria-label="Refresh code requests" title="Refresh code requests" onClick={() => requests.refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {requests.isLoading ? <Loader2 aria-label="Loading code requests" className="mt-4 h-5 w-5 animate-spin" /> : requests.isError ? <p role="alert" className="mt-3 text-sm text-red-300">Could not load requests. Refresh to retry.</p> : <ul className="mt-3 divide-y divide-white/10">
      {(requests.data || []).filter(item => filter === "pending" ? item.status === "pending" : item.status !== "pending").map(item => <li key={item.id} className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0"><p className="break-words text-sm font-medium text-white">{item.workerName}</p><p className="break-all font-mono text-sm text-emerald-300">{item.approvedCode || item.requestedCode}</p><p className="mt-1 text-xs capitalize text-zinc-400">{item.status}</p>{item.feedback && <p className="mt-1 break-words text-xs text-zinc-300">{item.feedback}</p>}</div>
        {item.status === "pending" && <Button size="sm" variant="outline" onClick={() => open(item)}>Review</Button>}
      </li>)}
      {!(requests.data || []).some(item => filter === "pending" ? item.status === "pending" : item.status !== "pending") && <li className="py-3 text-sm text-zinc-400">No {filter} requests.</li>}
    </ul>}
    <Dialog open={Boolean(review)} onOpenChange={value => { if (!value && !mutation.isPending) setReview(null); }}>
      <DialogContent style={{ colorScheme: "dark" }} className="max-h-[90vh] overflow-y-auto border-zinc-700 bg-zinc-950 text-white sm:max-w-lg [&_input:not([type=checkbox])]:border-zinc-700 [&_input:not([type=checkbox])]:bg-zinc-900 [&_input]:text-white">
        <DialogHeader><DialogTitle>Review {review?.workerName}'s code</DialogTitle><DialogDescription>Requested: {review?.requestedCode}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label htmlFor="review-promo-record">Promo record</Label><select id="review-promo-record" value={existingId} onChange={event => { setExistingId(event.target.value); setConfirmed(false); }} className="h-10 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm"><option value="">Create a new personal code</option>{review?.candidates.map(promo => <option key={promo.id} value={promo.id} disabled={Boolean(promo.unavailableReason)}>{promo.code}{promo.unavailableReason ? " (unavailable)" : ""}</option>)}</select></div>
          {existing ? <div className="space-y-1 text-sm text-zinc-300"><p className="font-mono font-semibold text-emerald-300">{existing.code}</p><p>{existing.description || "Personal referral code"}</p><p>Services: {existing.discountPercent}% | Shop: {existing.discountPercentJewelry}%</p><p>Customer: {existing.rewardTokens} JCMOVES | Referrer: {existing.referralRewardTokens} JCMOVES</p><p>{existing.usesCount} uses{existing.maxUses !== null ? ` of ${existing.maxUses}` : " / unlimited"}</p>{existing.expiresAt && <p>Expires {new Date(existing.expiresAt).toLocaleDateString()}</p>}<p>Existing terms and usage history will be kept.</p></div> : <>
            <div className="space-y-1"><Label htmlFor="review-promo-code">Code</Label><Input id="review-promo-code" value={code} maxLength={20} onChange={event => { setCode(event.target.value.toUpperCase()); setConfirmed(false); }} className="font-mono" /></div>
            <div className="space-y-1"><Label htmlFor="review-promo-description">Description</Label><Input id="review-promo-description" value={terms.description} onChange={event => { setTerms({ ...terms, description: event.target.value }); setConfirmed(false); }} /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([['discountPercent', 'Service discount %'], ['discountPercentJewelry', 'Shop discount %'], ['rewardTokens', 'Customer JCMOVES'], ['referralRewardTokens', 'Referrer JCMOVES'], ['maxUses', 'Maximum uses']] as const).map(([key, label]) => <div key={key} className="space-y-1"><Label htmlFor={`review-${key}`}>{label}</Label><Input id={`review-${key}`} type="number" min={key === "maxUses" ? 1 : 0} max={key.includes("discount") ? 100 : 1_000_000} step={key === "maxUses" ? 1 : 0.01} placeholder={key === "maxUses" ? "Unlimited" : undefined} value={terms[key]} onChange={event => { setTerms({ ...terms, [key]: event.target.value }); setConfirmed(false); }} /></div>)}
              <div className="space-y-1"><Label htmlFor="review-expiresAt">Expiration</Label><Input id="review-expiresAt" type="datetime-local" value={terms.expiresAt} onChange={event => { setTerms({ ...terms, expiresAt: event.target.value }); setConfirmed(false); }} /></div>
            </div>
          </>}
          <div className="space-y-1"><Label htmlFor="review-promo-feedback">Feedback</Label><Input id="review-promo-feedback" value={feedback} maxLength={500} onChange={event => setFeedback(event.target.value)} /></div>
          {existing?.needsOwnershipApproval && <p className="text-sm text-amber-200">Assign {existing.code} to {review?.workerName}.</p>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I approve this personal code and its offer terms.</label>
          <div className="flex flex-wrap gap-2"><Button className="gap-2" disabled={mutation.isPending || !confirmed} onClick={() => mutation.mutate("approve")}>{mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve code</Button><Button variant="outline" className="gap-2 border-zinc-700 bg-zinc-900 text-white" disabled={mutation.isPending || !feedback.trim()} onClick={() => mutation.mutate("reject")}><X className="h-4 w-4" />Request changes</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
