import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { CheckCircle2, Clock3, ExternalLink, Loader2, ReceiptText, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type Closeout = {
  id: string;
  lead_id: string;
  status: string;
  canRetryInvoice?: boolean;
  first_name: string;
  last_name: string;
  service_type: string;
  actual_hours: string;
  quoted_total: string;
  calculated_final_total: string;
  deposit_applied: string;
  balance_due: string;
  proof_photos: Array<{ url: string; type: string; description?: string }>;
  change_orders: Array<{ id: string; description: string; quantity: string; unit_price: string; total: string }>;
};

function money(value: unknown) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function JobCloseoutPage() {
  const [, params] = useRoute("/job-closeout/:token");
  const token = params?.token || "";
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ status: string; invoiceUrl?: string | null } | null>(null);
  const query = useQuery<{ closeout: Closeout }>({
    queryKey: ["/api/job-closeouts", token],
    queryFn: async () => {
      const response = await fetch(`/api/job-closeouts/${encodeURIComponent(token)}`, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).error || "Closeout link is invalid or expired");
      return response.json();
    },
    enabled: !!token,
    retry: false,
  });
  const approve = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/job-closeouts/${encodeURIComponent(token)}/approve`, {});
      return response.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: data.invoiceUrl ? "Final amount approved" : "Job financially complete" });
    },
    onError: (error: Error) => {
      void query.refetch();
      toast({ title: "Could not finish the invoice request", description: error.message, variant: "destructive" });
    },
  });
  const reject = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/job-closeouts/${encodeURIComponent(token)}/reject`, { note });
      return response.json();
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Sent for owner review" });
    },
    onError: (error: Error) => toast({ title: "Could not request a correction", description: error.message, variant: "destructive" }),
  });

  if (query.isLoading) return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (query.isError || !query.data?.closeout) return <div className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><Card className="max-w-lg border-red-500/30 bg-slate-900"><CardContent className="p-7 text-center"><ShieldAlert className="mx-auto h-10 w-10 text-red-300" /><p className="mt-4">{query.error instanceof Error ? query.error.message : "Closeout not found"}</p></CardContent></Card></div>;

  const closeout = query.data.closeout;
  if (result) {
    return <div className="grid min-h-screen place-items-center bg-slate-950 p-5 text-white"><Card className="min-w-0 w-full max-w-lg border-emerald-500/30 bg-slate-900"><CardContent className="p-7 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" /><h1 className="mt-4 text-2xl font-black">Thank you</h1><p className="mt-2 text-slate-300">{result.status === "customer_rejected" ? "The owner will review your requested correction before billing." : "Your final job amount is approved."}</p>{result.invoiceUrl && <Button className="mt-5 min-h-11 h-auto w-full whitespace-normal bg-emerald-600 py-3" asChild><a href={result.invoiceUrl}>Pay final balance with Square <ExternalLink className="ml-2 h-4 w-4" /></a></Button>}</CardContent></Card></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <Card className="mx-auto max-w-2xl border-blue-500/30 bg-slate-900">
        <CardHeader><ReceiptText className="h-8 w-8 text-blue-300" /><CardTitle className="text-2xl">Review your completed job</CardTitle><p className="text-sm text-slate-400">{closeout.first_name} {closeout.last_name} · {closeout.service_type}</p></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 rounded-xl bg-slate-950/70 p-4 sm:grid-cols-2">
            <Summary label="Actual hours" value={`${Number(closeout.actual_hours).toFixed(2)} hours`} icon={Clock3} />
            <Summary label="Original approved quote" value={money(closeout.quoted_total)} />
            <Summary label="Final total" value={money(closeout.calculated_final_total)} />
            <Summary label="Deposit applied" value={`− ${money(closeout.deposit_applied)}`} />
            <div className="sm:col-span-2 flex items-center justify-between border-t border-slate-700 pt-3"><span className="font-bold">Balance after approval</span><span className="text-2xl font-black text-emerald-300">{money(closeout.balance_due)}</span></div>
          </div>
          {closeout.change_orders?.length > 0 && <div><h2 className="font-bold">Approved changes</h2><div className="mt-2 space-y-2">{closeout.change_orders.map((change) => <div key={change.id} className="flex justify-between rounded-lg border border-slate-700 p-3 text-sm"><span>{change.description} × {Number(change.quantity)}</span><strong>{money(change.total)}</strong></div>)}</div></div>}
          {closeout.proof_photos?.length > 0 && <div><h2 className="font-bold">Completion proof</h2><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{closeout.proof_photos.map((photo, index) => <a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.description || `${photo.type} proof`} className="h-28 w-full rounded-lg object-cover" /></a>)}</div></div>}
          {closeout.status === 'approved' && closeout.canRetryInvoice === true && <div className="space-y-3">
            <p className="text-sm text-slate-300">Your approval is saved. Retry to finish preparing your final invoice.</p>
            <Button className="min-h-11 h-auto w-full whitespace-normal bg-emerald-600 py-3" disabled={approve.isPending || query.isFetching} onClick={() => approve.mutate()}>{approve.isPending ? 'Preparing final invoice…' : 'Retry final invoice'}</Button>
          </div>}
          {closeout.status === "awaiting_customer" ? <><Button className="w-full bg-emerald-600 hover:bg-emerald-500" disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? "Creating final invoice…" : `Approve ${money(closeout.calculated_final_total)} final total`}</Button><div className="rounded-xl border border-slate-700 p-4"><p className="text-sm font-semibold">Something needs correction?</p><Textarea className="mt-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain the hours, item, damage, or charge that needs review" /><Button variant="outline" className="mt-3" disabled={!note.trim() || reject.isPending} onClick={() => reject.mutate()}>Send to owner review</Button></div></> : <p className="rounded-lg bg-amber-500/10 p-4 text-amber-100">This closeout is currently {closeout.status.replace(/_/g, " ")}.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Clock3 }) {
  return <div><p className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</p><p className="mt-1 font-bold">{value}</p></div>;
}
