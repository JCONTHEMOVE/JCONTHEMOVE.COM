import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, DollarSign, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type Action = "payment" | "payout";
type Receipt = { method: "cash" | "check" | ""; paidDate: string; reference: string; note: string };
type Snapshot = {
  lead: {
    id: string; orderNumber?: number | null; firstName: string; lastName: string; email?: string;
    status: string; source?: string | null; fromAddress: string; confirmedFromAddress?: string;
    moveDate?: string; confirmedDate?: string; totalPrice?: string; basePrice?: string;
    paymentPaidAt?: string | null; crewMembers?: string[]; assignedToUserId?: string | null;
    crewLeadUserId?: string | null;
  };
  employees: Array<{ id: string; firstName: string; lastName: string }>;
  rewards: {
    state: string; paidInFull: boolean; completed: boolean; customerPool: number; crewPool: number;
    records: Array<{ recipient_label: string | null; token_amount: string; reward_kind: string }>;
  };
  reconciliation: { enabled: boolean; automaticRewardsEnabled?: boolean; reviewReasons: string[] };
};
type Review = { action: Action; receipt: Receipt; snapshot: Snapshot; fingerprint: string };
const pastStatuses = new Set(["confirmed", "available", "assigned", "accepted", "dispatched", "in_progress", "completed"]);
const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const tokens = (value: number) => Number.isFinite(value) ? value.toLocaleString("en-US") : "Unavailable";

function businessDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function jobDate(snapshot: Snapshot) {
  const value = snapshot.lead.confirmedDate || snapshot.lead.moveDate || "";
  const iso = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const legacy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return iso || (legacy ? `${legacy[3]}-${legacy[1].padStart(2, "0")}-${legacy[2].padStart(2, "0")}` : "");
}

function crew(snapshot: Snapshot) {
  return [...new Set([...(snapshot.lead.crewMembers || []), snapshot.lead.assignedToUserId].filter((id): id is string => !!id))]
    .sort().map(id => {
      const employee = snapshot.employees.find(person => person.id === id);
      return { id, verified: !!employee, name: employee ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() : "Unverified crew account" };
    });
}

function fingerprint(snapshot: Snapshot) {
  // Ignore query timestamps/order, but require a new review after any material change.
  const { lead, rewards, reconciliation } = snapshot;
  return JSON.stringify({
    lead: [lead.id, lead.orderNumber, lead.firstName, lead.lastName, lead.email, lead.status, lead.source,
      lead.confirmedFromAddress || lead.fromAddress, jobDate(snapshot), lead.totalPrice || lead.basePrice,
      lead.paymentPaidAt, lead.crewLeadUserId],
    crew: crew(snapshot),
    rewards: [rewards.state, rewards.paidInFull, rewards.completed, rewards.customerPool, rewards.crewPool,
      rewards.records.map(record => JSON.stringify([record.recipient_label, record.token_amount, record.reward_kind])).sort()],
    reconciliation: [reconciliation.enabled, reconciliation.automaticRewardsEnabled, [...(reconciliation.reviewReasons || [])].sort()],
  });
}

function unavailable(snapshot: Snapshot, action: Action) {
  const { lead, rewards, reconciliation } = snapshot;
  if (lead.source === "moving_help_uhaul") return "Moving Help reservations are not eligible for this JCMOVES closeout.";
  if (action === "payout") {
    if (lead.status.toLowerCase() !== "completed" || !rewards.completed) return "Complete the job before issuing JCMOVES.";
    if (!lead.paymentPaidAt || !rewards.paidInFull) return "Full payment must be recorded before issuing JCMOVES.";
    if (reconciliation.enabled && !reconciliation.automaticRewardsEnabled) return "JCMOVES processing is paused for this release.";
    if (reconciliation.enabled && reconciliation.reviewReasons.some(reason => reason !== "reward_retry_pending")) return "Resolve the payment reconciliation items before issuing JCMOVES.";
    if (rewards.state === "issued") return "JCMOVES is already issued. No new payout is needed.";
    if (rewards.state === "pending_customer_claim") return "The customer portion is held for account claim; a new payout is not needed.";
    if (rewards.state !== "ready_to_issue") return "This job is not ready for JCMOVES payout.";
  } else {
    if (lead.paymentPaidAt || rewards.paidInFull) return "Payment is already recorded. Use the JCMOVES payout option if awards are still missing.";
    // The legacy cash/check endpoint is not a canonical-ledger payment adapter.
    if (reconciliation.enabled) return "This job uses verified payment reconciliation. Record its payment through that workflow before requesting JCMOVES.";
    if (!pastStatuses.has(lead.status.toLowerCase())) return "Confirm the job before using past-job payment closeout.";
    if (!jobDate(snapshot) || jobDate(snapshot) >= businessDate()) return "Past-job closeout requires the correct job date, before today.";
    if (!Number.isFinite(Number(lead.totalPrice || lead.basePrice)) || Number(lead.totalPrice || lead.basePrice) <= 0) return "Save the final job total before recording full payment.";
  }
  const members = crew(snapshot);
  if (!members.length || members.some(person => !person.verified)) return "Assign and verify the crew accounts that actually worked this job.";
  return null;
}

function receiptProblem(receipt: Receipt) {
  if (!receipt.method) return "Choose how the full payment was received.";
  const parsed = new Date(`${receipt.paidDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt.paidDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== receipt.paidDate || receipt.paidDate > businessDate()) return "Choose a valid payment date, today or earlier.";
  return null;
}

function JobSummary({ snapshot }: { snapshot: Snapshot }) {
  const { lead, rewards } = snapshot;
  return <div className="space-y-3 rounded-lg border p-3 text-sm" data-testid="admin-payment-job-summary">
    <p className="font-semibold">{lead.orderNumber ? `JC-${lead.orderNumber}` : "Job"} · {lead.firstName} {lead.lastName}</p>
    <p className="break-words text-muted-foreground">{lead.confirmedFromAddress || lead.fromAddress || "Address not set"}</p>
    <dl className="grid grid-cols-2 gap-2">
      <div><dt className="text-muted-foreground">Job date</dt><dd>{jobDate(snapshot) || "Not set"}</dd></div>
      <div><dt className="text-muted-foreground">Saved total</dt><dd className="font-semibold">{money(lead.totalPrice || lead.basePrice)}</dd></div>
      <div><dt className="text-muted-foreground">Work status</dt><dd>{lead.status.replace(/_/g, " ")}</dd></div>
      <div><dt className="text-muted-foreground">Full payment</dt><dd>{rewards.paidInFull ? "Recorded" : "Not recorded"}</dd></div>
    </dl>
    <div><p className="font-medium">JCMOVES recipients</p>
      <p className="break-words">Customer: {lead.firstName} {lead.lastName}{lead.email ? ` (${lead.email})` : " — account matching required"}</p>
      <p>Crew: {crew(snapshot).map(person => person.name).join(", ") || "No crew assigned"}</p>
      <p className="mt-1 text-xs text-muted-foreground">Current pool estimates: {tokens(rewards.customerPool)} customer / {tokens(rewards.crewPool)} crew JCMOVES. Final eligibility and missing awards are checked by the server; an unmatched customer portion may be held for account claim.</p>
    </div>
  </div>;
}

export function AdminJobPaymentShortcut({ leadId }: { leadId: string }) {
  const { hasAdminAccess } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [receipt, setReceipt] = useState<Receipt>({ method: "", paidDate: "", reference: "", note: "" });
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const query = useQuery<Snapshot>({
    queryKey: ["admin-payment-shortcut", leadId], enabled: open && hasAdminAccess, retry: false, staleTime: 0,
    queryFn: async () => {
      const read = async (url: string) => (await apiRequest("GET", url)).json();
      const [lead, employees, rewards, reconciliation] = await Promise.all([
        read(`/api/leads/${encodeURIComponent(leadId)}`), read("/api/employees"),
        read(`/api/leads/${encodeURIComponent(leadId)}/jcmoves-status`),
        read(`/api/admin/payments/reconciliation/${encodeURIComponent(leadId)}`),
      ]);
      if (lead?.id !== leadId) throw new Error("The requested job could not be verified.");
      return { lead, employees, rewards, reconciliation };
    },
  });

  useEffect(() => {
    clearTimeout(clickTimer.current);
    clickCount.current = 0;
    setClicks(0);
    setOpen(false);
    setReview(null);
    setConfirmed(false);
    return () => clearTimeout(clickTimer.current);
  }, [leadId, hasAdminAccess]);

  const reset = () => {
    setAction(null); setReview(null); setConfirmed(false); setError(""); setResult("");
    setReceipt({ method: "", paidDate: businessDate(), reference: "", note: "" });
  };
  const onShortcutClick = () => {
    if (!hasAdminAccess || submitting.current) return;
    if (clickCount.current === 0) clickTimer.current = setTimeout(() => { clickCount.current = 0; setClicks(0); }, 10_000);
    clickCount.current += 1;
    if (clickCount.current === 5) {
      clearTimeout(clickTimer.current); clickCount.current = 0; setClicks(0);
      reset(); setOpen(true);
    } else setClicks(clickCount.current);
  };

  const submit = async () => {
    if (!hasAdminAccess || !confirmed || !review || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      // Re-read before every submission. A changed job/payment/recipient needs another review.
      const fresh = await query.refetch();
      if (fresh.error || !fresh.data) throw new Error("Could not verify current payment details. Refresh and review again.");
      if (fingerprint(fresh.data) !== review.fingerprint) {
        setReview(null); setConfirmed(false);
        throw new Error("The job, payment, or recipients changed. Review the updated details before confirming.");
      }
      const blocked = unavailable(fresh.data, review.action) || (review.action === "payment" ? receiptProblem(review.receipt) : null);
      if (blocked) throw new Error(blocked);
      if (review.action === "payment") {
        const response = await apiRequest("POST", `/api/leads/${encodeURIComponent(leadId)}/record-offline-payment`, {
          method: review.receipt.method, paidDate: review.receipt.paidDate,
          reference: review.receipt.reference.trim() || null, note: review.receipt.note.trim() || null, completeJob: true,
        });
        const data = await response.json();
        setResult(data.completion?.ok
          ? `Payment and completion recorded. ${data.jcmoves?.creditedAccountCount ?? 0} linked accounts have recorded JCMOVES credits.${data.jcmoves?.pendingCustomerClaim ? " The customer portion is held for account claim." : ""}`
          : "Payment and completion recorded. JCMOVES still needs review; check the job before retrying.");
      } else {
        const response = await apiRequest("POST", `/api/leads/${encodeURIComponent(leadId)}/retry-disbursement`, {});
        const data = await response.json();
        setResult(data.note || "JCMOVES payout check completed. Review the refreshed job rewards for the recorded credits.");
      }
      setReview(null); setConfirmed(false);
      for (const key of [["/api/leads"], ["/api/jobs/planner"], ["/api/rewards"], ["/api/rewards/lead", leadId], ["/api/admin/payments/reconciliation", leadId], ["admin-payment-shortcut", leadId]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    } catch (cause) {
      setConfirmed(false);
      setError(cause instanceof Error ? cause.message : "The action could not be confirmed. Refresh the job before retrying.");
    } finally {
      submitting.current = false; setBusy(false);
    }
  };

  if (!hasAdminAccess) return null;
  const snapshot = query.data;
  const loading = query.isPending || query.isFetching;
  const ready = !!snapshot && !loading && !query.isError;
  const blocked = snapshot && action ? unavailable(snapshot, action) : null;
  const receiptError = action === "payment" ? receiptProblem(receipt) : null;
  const reviewChanged = !!review && !!snapshot && review.fingerprint !== fingerprint(snapshot);
  return <>
    <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0 touch-manipulation text-emerald-400"
      aria-label="Admin payment options — click five times" title="Click $ five times within 10 seconds" onClick={onShortcutClick}
      data-testid="button-admin-payment-shortcut">
      <DollarSign className="h-5 w-5" aria-hidden="true" />
    </Button>
    <span className="sr-only" aria-live="polite">{clicks > 0 ? `${clicks} of 5 clicks to open admin payment options` : ""}</span>
    <Dialog open={open} onOpenChange={value => { if (!submitting.current) { setOpen(value); if (!value) reset(); } }}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" data-testid="admin-payment-dialog">
        <DialogHeader>
          <DialogTitle>{result ? "Payment & JCMOVES result" : review ? "Final admin confirmation" : "Payment received & JCMOVES"}</DialogTitle>
          <DialogDescription>{review ? "Check this job and its recipients, then confirm the selected action." : "Review the saved job, record an eligible cash/check receipt, or request its missing JCMOVES awards."}</DialogDescription>
        </DialogHeader>
        {result ? <p role="status" className="rounded-lg border border-emerald-500/30 p-3">{result}</p> : <>
          {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Checking current job and payments…</p> : null}
          {query.isError ? <div role="alert" className="text-sm text-destructive">Could not load current payment details. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div> : null}
          {snapshot ? <JobSummary snapshot={review?.snapshot || snapshot} /> : null}
          {review ? <div className="space-y-3">
            <p className="font-semibold">{review.action === "payment" ? "Record full payment, complete job & process eligible JCMOVES" : "Request missing eligible JCMOVES awards"}</p>
            {review.action === "payment" ? <dl className="space-y-1 break-words text-sm">
              <div><dt className="inline font-medium">Payment: </dt><dd className="inline">{money(review.snapshot.lead.totalPrice || review.snapshot.lead.basePrice)} · {review.receipt.method} · {review.receipt.paidDate}</dd></div>
              <div><dt className="inline font-medium">Reference: </dt><dd className="inline">{review.receipt.reference || "None"}</dd></div>
              <div><dt className="inline font-medium">Note: </dt><dd className="inline whitespace-pre-wrap">{review.receipt.note || "None"}</dd></div>
            </dl> : null}
            <p className="text-xs text-muted-foreground">{review.action === "payment" ? "This records payment and job completion. Existing completion notifications and review requests may run. It does not create a new quote, invoice, or dispatch." : "The server checks eligibility and existing awards before issuing missing JCMOVES. This does not record another payment."}</p>
            {reviewChanged ? <p role="alert" className="text-sm text-amber-400">Details changed. Go back and review the current job.</p> : null}
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={busy || reviewChanged} />
              <span>{review.action === "payment" ? "I confirm the work is finished, this full cash/check payment was received, and the customer and crew recipients are correct." : "I confirm this completed job is fully paid and the JCMOVES recipients are correct."}</span>
            </label>
          </div> : <div className="space-y-3">
            <fieldset className="space-y-2" disabled={!ready || busy}>
              <legend className="mb-2 text-sm font-medium">Choose an action</legend>
              {([ ["payment", "Payment received & complete job"], ["payout", "Pay out eligible JCMOVES"] ] as const).map(([value, label]) =>
                <label key={value} className="flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm">
                  <input type="radio" name={`admin-payment-action-${leadId}`} value={value} checked={action === value} onChange={() => { setAction(value); setConfirmed(false); setError(""); }} />{label}
                </label>)}
            </fieldset>
            {blocked ? <p role="status" className="text-sm text-amber-400">{blocked}</p> : null}
            {action === "payment" && !blocked ? <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Use this only for a full cash/check payment already received. Card, U-Haul, and other payments must use their verified payment records.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="mb-2 text-sm font-medium" id="shortcut-payment-method-label">Payment method</p>
                  <RadioGroup aria-labelledby="shortcut-payment-method-label" value={receipt.method} onValueChange={value => setReceipt({ ...receipt, method: value as "cash" | "check" })} className="grid grid-cols-2 gap-2">
                    {(["cash", "check"] as const).map(method => <div key={method} className="flex min-h-11 items-center gap-2 rounded-md border px-3">
                      <RadioGroupItem value={method} id={`shortcut-payment-${method}`} /><Label htmlFor={`shortcut-payment-${method}`}>{method === "cash" ? "Cash" : "Check"}</Label>
                    </div>)}
                  </RadioGroup>
                </div>
                <div><Label htmlFor="shortcut-payment-date">Payment date</Label><Input id="shortcut-payment-date" type="date" max={businessDate()} value={receipt.paidDate} onChange={event => setReceipt({ ...receipt, paidDate: event.target.value })} /></div>
              </div>
              <div><Label htmlFor="shortcut-payment-reference">Receipt / check reference (optional)</Label><Input id="shortcut-payment-reference" maxLength={200} value={receipt.reference} onChange={event => setReceipt({ ...receipt, reference: event.target.value })} /></div>
              <div><Label htmlFor="shortcut-payment-note">Closeout note (optional)</Label><Textarea id="shortcut-payment-note" maxLength={1000} value={receipt.note} onChange={event => setReceipt({ ...receipt, note: event.target.value })} /></div>
              {receiptError ? <p className="text-xs text-muted-foreground">{receiptError}</p> : null}
            </div> : null}
          </div>}
        </>}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
            if (review) { setReview(null); setConfirmed(false); setError(""); } else { setOpen(false); reset(); }
          }}>{result ? "Done" : review ? "Back" : "Cancel"}</Button>
          {!result && (review ? <Button type="button" className="min-h-11 whitespace-normal bg-emerald-700 text-white hover:bg-emerald-800" disabled={!ready || busy || !confirmed || reviewChanged || !!blocked} onClick={() => void submit()} data-testid="button-final-confirm-admin-payment">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4 shrink-0" />}
            {busy ? "Confirming…" : review.action === "payment" ? "Confirm payment & JCMOVES" : "Confirm JCMOVES payout"}
          </Button> : <Button type="button" className="min-h-11" disabled={!ready || !action || !!blocked || !!receiptError} onClick={() => {
            if (!snapshot || !action || blocked || receiptError) return;
            setReview({ action, receipt: { ...receipt }, snapshot, fingerprint: fingerprint(snapshot) }); setConfirmed(false); setError("");
          }} data-testid="button-review-admin-payment">Review for final confirmation</Button>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
