import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Loader2, Printer } from "lucide-react";
import type { JobWorkflow, RepairTarget, WorkflowBlocker, WorkflowQuote } from "@shared/job-workflow";
import { customerNotesFromDetails } from "@shared/leadDetails";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Review = { version: string; reviewHash: string; quote: WorkflowQuote; blockers: WorkflowBlocker[]; recipient: { name: string; email: string; phone: string }; smsConsent: boolean; invoiceAvailable: boolean; schedule: { date: string; window: string }; fromAddress: string; toAddress?: string; service: string; ownerReasons: string[] };
type Props = { lead: any; employees: Array<{ id: string; firstName?: string; lastName?: string }>; dirty: boolean; onEdit: (section: "customer" | "details" | "schedule" | "quote", field?: string) => void; onPayment: () => void; onCloseout: () => void; onStart: () => void; onComplete: () => void; onVersion: (version: string) => void };
const money = (n: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
const stages = ["Details", "Quote", "Confirmation", "Crew & dispatch", "Closeout"];

function errorDetail(error: unknown): { message: string; blockers: WorkflowBlocker[] } {
  const message = error instanceof Error ? error.message : "Could not finish this action.";
  try { const data = JSON.parse(message.slice(message.indexOf("{"))); return { message: data.error || message, blockers: data.blockers || [] }; } catch { return { message, blockers: [] }; }
}

export function JobWorkflowReport({ lead, employees, dirty, onEdit, onPayment, onCloseout, onStart, onComplete, onVersion }: Props) {
  const queryKey = ["/api/leads", lead.id, "workflow"];
  const { data: flow, isError, refetch, isFetching } = useQuery<JobWorkflow>({ queryKey, retry: false });
  const [panel, setPanel] = useState<"" | "quote" | "confirmation" | "crew" | "payment">("");
  const [method, setMethod] = useState<"email" | "sms" | "both" | "copy">(/@/.test(lead.email || "") && !/\.local$|\.internal$/.test(lead.email || "") ? "email" : "copy");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [agreementMethod, setAgreementMethod] = useState("phone");
  const [agreementNote, setAgreementNote] = useState("");
  const [attested, setAttested] = useState(false);
  const [paymentAttested, setPaymentAttested] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [error, setError] = useState<{ message: string; blockers: WorkflowBlocker[] } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [delivery, setDelivery] = useState<JobWorkflow["delivery"]>();
  const [notice, setNotice] = useState("");
  const [crewResults, setCrewResults] = useState<Array<{recipient: string; outcome: {status: string; message?: string}}>>([]);
  const panelVersion = useRef("");
  const resume = useRef<"" | "quote" | "confirmation" | "crew" | "payment">("");
  const operation = useRef(crypto.randomUUID());
  const crewOperation = useRef(crypto.randomUUID());
  const invalidate = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey }), queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id] }), queryClient.invalidateQueries({ queryKey: ["/api/leads"] }), queryClient.invalidateQueries({ queryKey: ["/api/jobs/planner"] })]);
  };
  useEffect(() => { if (flow?.version) onVersion(flow.version); }, [flow?.version, onVersion]);
  useEffect(() => {
    if (panel) { panelVersion.current = flow?.version || ""; setAttested(false); setPaymentAttested(false); setCrewResults([]); }
  }, [panel]);
  useEffect(() => {
    const opened: HTMLDetailsElement[] = [];
    const before = () => { document.querySelectorAll<HTMLDetailsElement>("#job-operation-report details:not([open])").forEach(el => { opened.push(el); el.open = true; }); };
    const after = () => { opened.splice(0).forEach(el => { el.open = false; }); };
    window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  const preview = useMutation({ mutationFn: async (chosen: typeof method) => (await apiRequest("POST", `/api/leads/${lead.id}/quote-review`, { deliveryMethod: chosen })).json() as Promise<Review>, onSuccess: data => { setReview(data); setError(null); }, onError: e => setError(errorDetail(e)) });
  const openQuote = () => { if (dirty) { onEdit("quote"); return; } setPanel("quote"); setDelivery(undefined); setReview(null); setError(null); operation.current = crypto.randomUUID(); preview.mutate(method); };
  useEffect(() => {
    const saved = async () => { await invalidate(); if (resume.current) { const target = resume.current; resume.current = ""; setPanel(target); if (target === "quote") { setReview(null); operation.current = crypto.randomUUID(); preview.mutate(method); } } };
    const requestReview = () => openQuote();
    const requestPayment = () => { setPanel("payment"); setPaymentAttested(false); setError(null); };
    window.addEventListener("jc:job-setup-saved", saved); window.addEventListener("jc:review-quote", requestReview); window.addEventListener("jc:record-job-payment", requestPayment);
    return () => { window.removeEventListener("jc:job-setup-saved", saved); window.removeEventListener("jc:review-quote", requestReview); window.removeEventListener("jc:record-job-payment", requestPayment); };
  }, [lead.id, dirty, method]);
  const repair = (target: RepairTarget, field?: string) => {
    setError(null);
    if (target === "confirmation") { setPanel("confirmation"); return; }
    if (target === "payment") { setPanel("payment"); return; }
    resume.current = panel || (target === "quote" ? "quote" : "");
    setPanel("");
    onEdit(target === "crew" ? "schedule" : target, field);
  };
  const approve = useMutation({ mutationFn: async () => {
    if (!review || dirty) throw Error("Save and review the current job before sending.");
    return (await apiRequest("POST", `/api/leads/${lead.id}/approve-and-send`, { version: review.version, reviewHash: review.reviewHash, idempotencyKey: operation.current, deliveryMethod: method, message: note, recordSmsConsent: consent, overrideReason })).json();
  }, onSuccess: async data => { setDelivery(data.delivery); setError(data.warning ? { message: data.warning, blockers: [] } : null); await invalidate(); }, onError: async e => { setError(errorDetail(e)); await invalidate(); } });
  const confirm = useMutation({ mutationFn: async () => (await apiRequest("POST", `/api/leads/${lead.id}/customer-confirmation`, { version: panelVersion.current, method: agreementMethod, attested, note: agreementNote })).json(), onSuccess: async () => { setPanel(""); setError(null); setAttested(false); setNotice("Customer agreement recorded."); await invalidate(); }, onError: e => setError(errorDetail(e)) });
  const payment = useMutation({ mutationFn: async () => (await apiRequest("POST", `/api/leads/${lead.id}/mark-paid`, { dispatch: false, paymentConfirmed: paymentAttested, method: paymentMethod, expectedVersion: panelVersion.current })).json(), onSuccess: async data => { setPanel(""); setPaymentAttested(false); setNotice(data.accountingPending ? "Payment recorded. Accounting needs review; crew has not been dispatched." : "Payment recorded. Crew has not been dispatched."); await invalidate(); }, onError: e => setError(errorDetail(e)) });
  const crew = useMutation({ mutationFn: async (action: "notify" | "dispatch") => (await apiRequest("POST", `/api/leads/${lead.id}/crew-action`, { version: panelVersion.current, action, idempotencyKey: crewOperation.current })).json(), onSuccess: async data => { setCrewResults(data.notifications || []); setError(null); setNotice(data.alreadyPerformed ? "This crew action was already recorded." : "Crew action saved. Payment was unchanged."); await invalidate(); }, onError: e => setError(errorDetail(e)) });
  const busy = preview.isPending || approve.isPending || confirm.isPending || crew.isPending || payment.isPending;
  const primary = () => {
    setError(null);
    if (dirty) { resume.current = flow?.nextAction.key === "review" ? "quote" : ""; onEdit("quote"); return; }
    switch (flow?.nextAction.key) {
      case "review": openQuote(); break;
      case "confirm": setPanel("confirmation"); break;
      case "dispatch": crewOperation.current = crypto.randomUUID(); setPanel("crew"); break;
      case "fix": if (flow.blockers[0]) repair(flow.blockers[0].target, flow.blockers[0].field); break;
      case "closeout": onCloseout(); break;
      case "start": onStart(); break;
      case "complete": onComplete(); break;
      case "edit": repair(flow.nextAction.target || "customer"); break;
    }
  };
  const blockers = (items: WorkflowBlocker[]) => <ul className="space-y-2">{items.map(item => <li key={item.code} className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"><span className="text-sm">{item.message}</span><Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => repair(item.target, item.field)}>Fix it</Button></li>)}</ul>;
  const quoteLines = (quote: WorkflowQuote) => <dl className="space-y-2 text-sm">{quote.lines.map((line, i) => <div className="flex justify-between gap-4" key={i}><dt>{line.name}</dt><dd className="shrink-0">{money(line.total)}</dd></div>)}{quote.discount > 0 && <div className="flex justify-between gap-4 text-emerald-500"><dt>Discount</dt><dd>−{money(quote.discount)}</dd></div>}<div className="flex justify-between border-t pt-3 text-lg font-bold"><dt>Quote total</dt><dd>{money(quote.total)}</dd></div></dl>;
  const stageIndex = flow?.stage === "details" ? 0 : flow?.stage === "quote" ? 1 : flow?.stage === "confirmation" ? 2 : ["dispatch", "work"].includes(flow?.stage || "") ? 3 : 4;
  const address = lead.confirmedFromAddress || lead.fromAddress;
  const destination = lead.confirmedToAddress || lead.toAddress;
  const names = (lead.crewMembers || []).map((id: string) => { const person = employees.find(e => e.id === id); const name = person ? [person.firstName, person.lastName].filter(Boolean).join(" ") : "Assigned crew member"; return `${name} (${lead.acceptedByEmployees?.includes(id) ? "accepted" : "pending"})`; });
  return <>
    <style>{`@media print { body *:not(:has(#job-operation-report)):not(#job-operation-report):not(#job-operation-report *) {display:none!important;} body *:has(#job-operation-report) {display:block!important;margin:0!important;padding:0!important;} #job-operation-report {position:static;width:100%;color:#111;background:white;border:0;} #job-operation-report .no-print {display:none!important;} #job-operation-report details {display:block;} }`}</style>
    <article id="job-operation-report" className="mb-4 overflow-hidden rounded-2xl border bg-card" data-testid="job-operation-report">
      <header className="border-b px-4 py-4 sm:px-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-muted-foreground">JC-{lead.orderNumber} · {String(lead.serviceType || "Service").replace(/_/g, " ")}</p><h1 className="mt-1 text-xl font-bold">{lead.firstName} {lead.lastName}</h1></div><div className="text-right"><span className="text-sm font-semibold text-blue-500">{flow?.label || "Checking job status…"}</span><p className="mt-1 text-xl font-bold">{money(flow?.quote.total ?? lead.totalPrice ?? lead.basePrice)}</p></div></div>
        <ol aria-label="Job progress" className="no-print mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs">{stages.map((stage, i) => <li key={stage} aria-current={i === stageIndex ? "step" : undefined} className={`flex items-center gap-1 ${i === stageIndex ? "font-bold text-blue-500" : "text-muted-foreground"}`}>{i < stageIndex ? <CheckCircle2 className="h-3 w-3"/> : <span>{i + 1}.</span>}{stage}{i < 4 && <ChevronRight className="ml-1 h-3 w-3"/>}</li>)}</ol>
      </header>
      <div className="grid gap-x-8 gap-y-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
        <ReportItem title="Customer" onEdit={() => onEdit("customer")}><div className="flex flex-wrap gap-x-4 gap-y-1">{lead.phone && <a className="underline" href={`tel:${lead.phone}`}>{lead.phone}</a>}{lead.email && !/\.local$|\.internal$/.test(lead.email) && <a className="break-all underline" href={`mailto:${lead.email}`}>{lead.email}</a>}</div></ReportItem>
        <ReportItem title={flow?.confirmation.current ? "Agreed schedule" : "Schedule to confirm"} onEdit={flow?.capabilities.manage ? () => onEdit("schedule") : undefined}><p>{lead.confirmedDate || lead.moveDate || "Date to arrange"}{lead.arrivalWindow ? ` · ${lead.arrivalWindow} Central` : " · Time to arrange"}</p></ReportItem>
        <ReportItem title="Project / pickup" onEdit={() => onEdit("details")}><p>{address || "Address needed"}</p>{destination && <p className="mt-1"><span className="text-muted-foreground">To: </span>{destination}</p>}</ReportItem>
        <ReportItem title="Crew" onEdit={flow?.capabilities.manage ? () => onEdit("schedule", "setup-named-crew") : undefined}><p>{flow?.crew.selected ?? names.length} of {flow?.crew.needed ?? lead.crewSize ?? 0} selected · {flow?.crew.accepted || 0} accepted</p>{names.length > 0 && <p className="mt-1 text-muted-foreground">{names.join(", ")}</p>}{lead.confirmedHours && <p className="mt-1 text-muted-foreground">{lead.confirmedHours} estimated hours</p>}</ReportItem>
        <ReportItem title="Customer agreement"><p>{flow?.confirmation.current ? `Recorded by ${flow.confirmation.method}` : flow?.confirmation.recordedAt ? "Details changed — reconfirm" : "Not yet recorded"}</p></ReportItem>
        <ReportItem title="Payment"><p>{flow?.payment.label || "Checking payment"}</p></ReportItem>
      </div>
      {customerNotesFromDetails(lead.details) && <p className="mx-4 mb-4 whitespace-pre-wrap text-sm sm:mx-5"><span className="font-medium">Scope: </span>{customerNotesFromDetails(lead.details)}</p>}
      {flow && <details className="border-t px-4 py-2 sm:px-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Quote breakdown · {flow.quote.matches ? flow.quote.status : "review needed"}</summary><div className="pb-4">{quoteLines(flow.quote)}</div></details>}
      {flow?.delivery && <details className="border-t px-4 py-2 sm:px-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Quote delivery{[flow.delivery.email, flow.delivery.sms, flow.delivery.invoice].some(item => item && ["failed", "unknown", "unavailable"].includes(item.status)) ? " · needs attention" : ""}</summary><div className="space-y-2 pb-3 text-sm">{(["invoice", "email", "sms"] as const).map(channel => { const item = flow.delivery?.[channel]; return item && item.status !== "not_requested" ? <p key={channel}><span className="capitalize">{channel === "sms" ? "Text" : channel}</span>: {item.status === "sent" ? channel === "invoice" ? "Created" : "Accepted by provider" : item.status}{item.message ? ` · ${item.message}` : ""}</p> : null; })}<Button className="no-print min-h-11" variant="outline" onClick={openQuote} disabled={dirty || busy}>Review delivery</Button></div></details>}
      <footer className="no-print border-t bg-muted/20 p-4 sm:px-5">
        {isError && <div role="alert" className="mb-3 text-sm">Job readiness could not load. <Button variant="link" onClick={() => refetch()}>Retry status</Button></div>}
        {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
        {error && !panel && <div role="alert" className="mb-3"><p className="mb-2 text-sm text-red-500">{error.message}</p>{blockers(error.blockers)}</div>}
        {flow?.capabilities.manage && !["work", "closeout", "closed"].includes(flow.stage) && flow.blockers.length > 0 && <details className="mb-3"><summary className="cursor-pointer py-2 text-sm">{flow.blockers.length} item{flow.blockers.length === 1 ? "" : "s"} to finish before dispatch</summary>{blockers(flow.blockers)}</details>}
        <div className="flex flex-wrap items-center gap-2"><Button className="min-h-11 w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto" onClick={primary} disabled={!flow || busy || flow.nextAction.key === "done"} data-testid="workflow-primary-action">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}{dirty ? "Review unsaved changes" : flow?.nextAction.label || "Checking…"}</Button>
          <Button variant="ghost" className="min-h-11" onClick={() => onEdit("customer")}>Edit details</Button>
          <details className="relative"><summary className="min-h-11 cursor-pointer px-3 py-3 text-sm">More actions</summary><div className="absolute right-0 z-30 mt-1 grid min-w-48 gap-1 rounded-lg border bg-background p-2 shadow-lg"><Button variant="ghost" disabled={dirty || busy} onClick={openQuote}>Review / share quote</Button>{flow?.capabilities.manage && <><Button variant="ghost" disabled={dirty || !names.length || busy} onClick={() => { crewOperation.current = crypto.randomUUID(); setPanel("crew"); }}>Notify crew</Button><Button variant="ghost" onClick={onPayment}>Payment & closeout</Button></>}<Button variant="ghost" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4"/>Print report</Button></div></details>
          {isFetching && !busy && <span className="text-xs text-muted-foreground">Updating…</span>}
        </div>
      </footer>
    </article>
    <Dialog open={Boolean(panel)} onOpenChange={open => { if (!open && !busy) setPanel(""); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{panel === "quote" ? "Review and share quote" : panel === "confirmation" ? "Record customer confirmation" : panel === "payment" ? "Record payment received" : "Crew plan"}</DialogTitle><DialogDescription>{panel === "quote" ? "Approve the exact quote below, then share it with the customer." : panel === "confirmation" ? "Record the customer's agreement to this quote, scope, and schedule." : panel === "payment" ? "Record a verified full cash or check payment. This does not dispatch the crew." : "Review the saved crew and schedule before notifying or dispatching."}</DialogDescription></DialogHeader>
      {error && <div role="alert"><p className="mb-2 text-sm text-red-500">{error.message}</p>{blockers(error.blockers)}{!error.blockers.length && panel !== "quote" && <Button variant="outline" onClick={async () => { const latest = await refetch(); panelVersion.current = latest.data?.version || ""; setAttested(false); setPaymentAttested(false); setError(null); }}>Review current details</Button>}{!error.blockers.length && panel === "quote" && <Button variant="outline" onClick={() => { operation.current = crypto.randomUUID(); preview.mutate(method); }}>Refresh review</Button>}</div>}
      {panel === "quote" && <>
        {!delivery && <><Label htmlFor="workflow-delivery">Share by</Label><select id="workflow-delivery" className="min-h-11 w-full rounded-md border bg-background px-3" value={method} disabled={busy} onChange={e => { const chosen = e.target.value as typeof method; setMethod(chosen); setReview(null); operation.current = crypto.randomUUID(); preview.mutate(chosen); }}><option value="email">Email</option>{flow?.capabilities.sms && <><option value="sms">Text message</option><option value="both">Email and text message</option></>}<option value="copy">Copy quote link</option></select></>}
        {preview.isPending && <p role="status">Checking the saved quote…</p>}
        {review && <><div className="rounded-lg border p-3 text-sm"><p className="font-semibold">{review.recipient.name}</p><p className="mt-1">{review.schedule.date || "Date to confirm"}{review.schedule.window ? ` · ${review.schedule.window}` : ""}</p><p className="mt-1">{review.fromAddress}{review.toAddress ? ` → ${review.toAddress}` : ""}</p><p className="mt-1 break-all text-muted-foreground">{method === "email" ? review.recipient.email : method === "sms" ? review.recipient.phone : method === "both" ? `${review.recipient.email} · ${review.recipient.phone}` : "Link for you to share"}</p></div>{quoteLines(review.quote)}
          {!delivery && <>{blockers(review.blockers)}{!review.invoiceAvailable && <p className="text-sm text-muted-foreground">Online payment setup is pending. You can still share this quote.</p>}{["sms", "both"].includes(method) && !review.smsConsent && <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox checked={consent} onCheckedChange={v => setConsent(v === true)}/>The customer agreed to receive this quote by text.</label>}{review.quote.requiresOwner && <div><Label htmlFor="workflow-owner-reason">Owner exception reason</Label><p className="my-2 text-sm">{review.ownerReasons.join(" ")}</p><Input id="workflow-owner-reason" value={overrideReason} onChange={e => setOverrideReason(e.target.value)}/></div>}<details><summary className="cursor-pointer py-2 text-sm">Add a personal note</summary><Textarea aria-label="Personal note" value={note} onChange={e => setNote(e.target.value)}/></details><Button className="min-h-11 bg-blue-600 text-white" onClick={() => approve.mutate()} disabled={busy || dirty || Boolean(review.blockers.length) || !flow?.capabilities.approve || (["sms", "both"].includes(method) && !review.smsConsent && !consent) || (review.quote.requiresOwner && !overrideReason.trim())}>{approve.isPending ? "Saving and sharing…" : method === "copy" ? "Approve and prepare link" : ["approved", "sent"].includes(review.quote.status) ? "Send approved quote" : "Approve and send"}</Button></>}
        </>}
        {delivery && <div role="status" className="space-y-3 rounded-lg border p-4"><p className="font-semibold text-emerald-500">Quote saved and approved</p>{(["invoice", "email", "sms"] as const).map(channel => delivery[channel]?.status !== "not_requested" && <p key={channel} className="text-sm"><span className="capitalize">{channel === "sms" ? "Text" : channel}</span>: {delivery[channel]?.status === "sent" ? channel === "invoice" ? "Created" : "Sent to provider" : delivery[channel]?.status || "Not requested"}{delivery[channel]?.message ? ` · ${delivery[channel]?.message}` : ""}</p>)}{delivery.quoteAccessUrl && <><Label htmlFor="workflow-share-link">Quote link</Label><Input id="workflow-share-link" readOnly value={delivery.quoteAccessUrl} onFocus={e => e.target.select()}/><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(delivery.quoteAccessUrl!); setNotice("Quote link copied. Delivery is not recorded automatically."); } catch { setNotice("Select the quote link above and copy it."); } }}>Copy link</Button></>}{[delivery.email, delivery.sms].some(d => d?.status === "failed") && <Button variant="outline" disabled={busy} onClick={() => approve.mutate()}>Retry failed delivery</Button>}<Button className="w-full" onClick={() => setPanel("")}>Return to job</Button></div>}
      </>}
      {panel === "confirmation" && <><div className="rounded-lg border p-3 text-sm"><p>{lead.firstName} {lead.lastName} · {money(flow?.quote.total)}</p><p className="mt-1">{lead.confirmedDate || "Date needed"} · {lead.arrivalWindow || "Time needed"}</p><p className="mt-1">{address}{destination ? ` → ${destination}` : ""}</p></div><Label htmlFor="agreement-method">Customer agreed by</Label><select id="agreement-method" className="min-h-11 rounded-md border bg-background px-3" value={agreementMethod} onChange={e => setAgreementMethod(e.target.value)}><option value="phone">Phone</option><option value="text">Text message</option><option value="email">Email</option></select><label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox checked={attested} onCheckedChange={v => setAttested(v === true)}/>I verified that the customer agrees to this quote, work, address, and schedule.</label><Label htmlFor="agreement-note">Note (optional)</Label><Textarea id="agreement-note" value={agreementNote} onChange={e => setAgreementNote(e.target.value)}/><Button className="min-h-11" disabled={!attested || dirty || busy} onClick={() => confirm.mutate()}>{confirm.isPending ? "Recording…" : "Record confirmation"}</Button></>}
      {panel === "crew" && <>{crewResults.length > 0 && <div role="status" className="rounded-lg border p-3"><p className="font-semibold">Crew action saved</p>{crewResults.map((r,i) => <p key={i} className="mt-2 text-sm">{r.recipient}: {r.outcome.status === "sent" ? "Email accepted by provider" : r.outcome.status}{r.outcome.message ? ` · ${r.outcome.message}` : ""}</p>)}</div>}<p className="text-sm">{lead.confirmedDate || "Date to confirm"} · {lead.arrivalWindow || "Time to confirm"}</p><p className="text-sm">{names.join(", ") || "No crew selected"}</p><p className="text-sm">Payment: {flow?.payment.label}</p>{flow && blockers(flow.blockers)}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || dirty || !names.length} onClick={() => crew.mutate("notify")}>Notify crew of plan</Button><Button disabled={busy || dirty || Boolean(flow?.blockers.length)} onClick={() => crew.mutate("dispatch")}>Dispatch crew</Button></div><p className="text-xs text-muted-foreground">These actions do not record a payment.</p></>}
      {panel === "payment" && <><p className="text-lg font-bold">Full payment: {money(flow?.quote.total)}</p><Label htmlFor="workflow-payment-method">Received by</Label><select id="workflow-payment-method" className="min-h-11 rounded-md border bg-background px-3" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="cash">Cash</option><option value="check">Check</option></select><label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox checked={paymentAttested} onCheckedChange={v => setPaymentAttested(v === true)}/>I verified that this full payment was received.</label><Button disabled={!paymentAttested || busy || dirty || Boolean(lead.paymentPaidAt)} onClick={() => payment.mutate()}>{payment.isPending ? "Recording…" : "Record payment"}</Button><Button variant="outline" onClick={() => { setPanel(""); onCloseout(); }}>Past-job closeout / rewards</Button></>}
    </DialogContent></Dialog>
  </>;
}

function ReportItem({ title, children, onEdit }: { title: string; children: React.ReactNode; onEdit?: () => void }) {
  return <section><div className="mb-1 flex items-center justify-between gap-2"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>{onEdit && <button className="no-print min-h-11 px-2 text-xs font-medium text-blue-500 underline" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>Edit</button>}</div>{children}</section>;
}
