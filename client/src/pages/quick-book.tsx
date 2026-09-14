import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  DollarSign,
  Loader2,
  MapPin,
  MessageSquareText,
  Plus,
  RefreshCw,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import { JOB_SCHEDULE_OPTIONS } from "@shared/jcOperations";
import { EMPTY_QUICK_BOOK_DRAFT, type QuickBookDraft, type QuickBookSessionResponse } from "@shared/quickBook";

type Session = QuickBookSessionResponse & { canComplete: boolean };
type ChatEntry = { id: string; role: "user" | "assistant"; text: string };
type Delivery = {
  recipientUserId: string;
  recipientName?: string;
  channel: string;
  status: "sent" | "failed" | "skipped";
  error?: string | null;
  attempts?: number;
};
type BookedResult = {
  bookingId: string;
  leadId: string;
  orderNumber?: number | null;
  total?: number;
  rewardBasis?: number;
  deliveries: Delivery[];
  customerMessageSent: false;
  squareInvoiceCreated: false;
};

const SESSION_KEY = "jc.quickBookSessionId.v1";

function buildVisualFixtureSession(): Session {
  const now = new Date().toISOString();
  return {
    id: "visual-fixture",
    status: "ready",
    revision: 1,
    draft: {
      ...EMPTY_QUICK_BOOK_DRAFT,
      customerName: "Fixture Customer",
      customerPhone: "(906) 555-0100",
      smsConsent: true,
      confirmedDate: "2026-09-04",
      arrivalWindow: "10:00 AM – 11:00 AM",
      pickupAddress: "100 Example St, Bessemer, MI 49911",
      pickupInstructions: "Customer will meet the crew at the rental truck.",
      workScope: "load_only",
      truckConfig: "customer_truck",
      truckSize: "26_ft",
      estimatedHours: 2,
      crewSize: 3,
      crewMemberIds: ["fixture-darrell", "fixture-troy", "fixture-evan"],
      crewLeadUserId: "fixture-darrell",
      crewConfirmed: true,
      stairsFlights: 0,
      hasElevator: false,
      specialItemsConfirmed: true,
      specialItems: {
        piano: false,
        safe: false,
        hotTub: false,
        poolTable: false,
        otherLargeItem: false,
        notes: "",
      },
      promoCode: "LOCAL3X2",
    },
    fieldMeta: {},
    missingFields: [],
    reviewReasons: [],
    readiness: { ready: true, missingFields: [], reviewReasons: [] },
    quote: {
      total: 450,
      rewardEligibleTotal: 525,
      location: { label: "Ironwood/Bessemer local zone" },
    },
    crewSuggestions: [
      { id: "fixture-darrell", name: "Darrell Jackson", score: 98, available: true, reason: "Available lead mover", recommended: true },
      { id: "fixture-troy", name: "Troy Tom", score: 94, available: true, reason: "Available mover", recommended: true },
      { id: "fixture-evan", name: "Evan", score: 92, available: true, reason: "Available mover", recommended: true },
      { id: "fixture-matthew", name: "Matthew Pease", score: 80, available: true, reason: "Available alternate", recommended: false },
    ],
    assistantMessage: "The routine Bessemer labor-only job is complete.",
    nextQuestion: "Review the exact quote and confirmed crew.",
    suggestions: ["Change the time", "Add a stop", "Review crew"],
    agent: { provider: "deterministic", model: "visual-fixture", fallbackUsed: false },
    startedAt: now,
    updatedAt: now,
    canComplete: false,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || "Quick Book request failed");
  return data as T;
}

function FieldShell({ label, missing, children }: { label: string; missing?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1.5 rounded-xl border p-3 ${missing ? "border-amber-400/70 bg-amber-400/5" : "border-slate-700/80 bg-slate-950/35"}`}>
      <Label className="flex items-center justify-between text-xs font-semibold text-slate-300">
        {label}
        {missing && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Needed</span>}
      </Label>
      {children}
    </div>
  );
}

function ChoiceButton({ active, disabled, onClick, children }: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${active ? "border-cyan-300 bg-cyan-400/20 text-cyan-100" : "border-slate-700 bg-slate-950/70 text-slate-200 hover:border-slate-500"}`}
    >
      {children}
    </button>
  );
}

function quoteAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export default function QuickBookPage({ visualFixture = false }: { visualFixture?: boolean }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState<QuickBookDraft | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [booked, setBooked] = useState<BookedResult | null>(null);
  const [newStop, setNewStop] = useState("");
  const startedRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const idempotencyRef = useRef(crypto.randomUUID());

  const applySession = useCallback((next: Session) => {
    sessionRef.current = next;
    setSession(next);
    setDraft(next.draft);
    if (!visualFixture) localStorage.setItem(SESSION_KEY, next.id);
  }, [visualFixture]);

  const createSession = useCallback(async () => {
    if (visualFixture) {
      const next = buildVisualFixtureSession();
      applySession(next);
      setMessages([{ id: crypto.randomUUID(), role: "assistant", text: `${next.assistantMessage}\n\n${next.nextQuestion}` }]);
      setBooked(null);
      return;
    }
    const active = sessionRef.current;
    const abandonSessionId = active && (active.status === "draft" || active.status === "ready") ? active.id : undefined;
    const next = await requestJson<Session>("/api/quick-book/sessions", { method: "POST", body: JSON.stringify({ abandonSessionId }) });
    applySession(next);
    setMessages([{ id: crypto.randomUUID(), role: "assistant", text: `${next.assistantMessage}\n\n${next.nextQuestion}` }]);
    setBooked(null);
    idempotencyRef.current = crypto.randomUUID();
  }, [applySession, visualFixture]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        if (visualFixture) {
          await createSession();
          return;
        }
        const savedId = localStorage.getItem(SESSION_KEY);
        if (savedId) {
          const existing = await requestJson<Session>(`/api/quick-book/sessions/${encodeURIComponent(savedId)}`);
          if (existing.status === "draft" || existing.status === "ready") {
            applySession(existing);
            setMessages([{ id: crypto.randomUUID(), role: "assistant", text: `Draft resumed.\n\n${existing.nextQuestion}` }]);
            return;
          }
        }
        await createSession();
      } catch (error) {
        try {
          localStorage.removeItem(SESSION_KEY);
          await createSession();
        } catch (retryError) {
          toast({ title: "Quick Book could not start", description: retryError instanceof Error ? retryError.message : "Try again.", variant: "destructive" });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [applySession, createSession, toast, visualFixture]);

  const postUpdate = useCallback(async (payload: { message?: string; source?: "typed" | "voice" | "tap"; patch?: Record<string, unknown> }) => {
    const current = sessionRef.current;
    if (!current || busy) return null;
    if (visualFixture) {
      const next: Session = {
        ...current,
        revision: current.revision + 1,
        draft: { ...current.draft, ...(payload.patch || {}) },
        updatedAt: new Date().toISOString(),
      };
      applySession(next);
      return next;
    }
    setBusy(true);
    try {
      const next = await requestJson<Session>(`/api/quick-book/sessions/${current.id}/message`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: current.revision, source: payload.source || "tap", message: payload.message, patch: payload.patch }),
      });
      applySession(next);
      return next;
    } catch (error) {
      toast({ title: "Update not saved", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
      return null;
    } finally {
      setBusy(false);
    }
  }, [applySession, busy, toast, visualFixture]);

  const sendMessage = useCallback(async (text: string, source: "typed" | "voice" = "typed") => {
    const message = text.trim();
    if (!message || busy) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    const next = await postUpdate({ message, source });
    if (next) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: `${next.assistantMessage}\n\n${next.nextQuestion}`,
      }]);
    }
  }, [busy, postUpdate]);

  const applyPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!draft || busy) return;
    const optimistic = { ...draft, ...patch } as QuickBookDraft;
    setDraft(optimistic);
    const saved = await postUpdate({ patch, source: "tap" });
    if (!saved) setDraft(sessionRef.current?.draft || draft);
  }, [busy, draft, postUpdate]);

  const handleSuggestion = useCallback((suggestion: string) => {
    const missing = sessionRef.current?.missingFields[0];
    if (missing === "text-message consent") return void applyPatch({ smsConsent: /^yes/i.test(suggestion) });
    if (missing === "one-hour arrival window") return void applyPatch({ arrivalWindow: suggestion });
    if (missing === "work scope") {
      const value = /unload only/i.test(suggestion) ? "unload_only" : /load and unload/i.test(suggestion) ? "load_unload" : "load_only";
      return void applyPatch({ workScope: value });
    }
    if (missing === "truck or equipment choice") {
      const value = /customer/i.test(suggestion) ? "customer_truck" : /rental|u-?haul/i.test(suggestion) ? "rental_truck" : /jc|company/i.test(suggestion) ? "company_truck" : "no_truck";
      return void applyPatch({ truckConfig: value });
    }
    if (missing === "special-item check" && /^no/i.test(suggestion)) {
      return void applyPatch({ specialItemsConfirmed: true, specialItems: { piano: false, safe: false, hotTub: false, poolTable: false, otherLargeItem: false, notes: "" } });
    }
    void sendMessage(suggestion, "typed");
  }, [applyPatch, sendMessage]);

  const transcribeAudio = useCallback(async (audio: Blob) => {
    if (visualFixture) throw new Error("Voice transcription is disabled in the visual fixture.");
    const form = new FormData();
    form.append("audio", audio, "quick-book.webm");
    const result = await requestJson<{ text: string }>("/api/quick-book/transcribe", { method: "POST", body: form });
    return result.text;
  }, [visualFixture]);

  const missing = useCallback((label: string) => session?.missingFields.includes(label) || false, [session]);
  const quote = session?.quote || null;
  const quoteTotal = quoteAmount(quote?.total);
  const rewardBasis = quoteAmount(quote?.rewardEligibleTotal);
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(session?.startedAt || Date.now()).getTime()) / 1000));

  const recommendedCrew = useMemo(() => session?.crewSuggestions.filter((worker) => worker.recommended && worker.available).slice(0, draft?.crewSize || 0) || [], [draft?.crewSize, session?.crewSuggestions]);

  const toggleCrew = useCallback((workerId: string) => {
    if (!draft || busy) return;
    const selected = draft.crewMemberIds.includes(workerId)
      ? draft.crewMemberIds.filter((id) => id !== workerId)
      : draft.crewMemberIds.length < (draft.crewSize || 0) ? [...draft.crewMemberIds, workerId] : draft.crewMemberIds;
    const lead = draft.crewLeadUserId && selected.includes(draft.crewLeadUserId) ? draft.crewLeadUserId : null;
    void applyPatch({ crewMemberIds: selected, crewLeadUserId: lead, crewConfirmed: false });
  }, [applyPatch, busy, draft]);

  const useRecommendedCrew = useCallback(() => {
    const ids = recommendedCrew.map((worker) => worker.id);
    if (!ids.length) return;
    void applyPatch({ crewMemberIds: ids, crewLeadUserId: ids[0], crewConfirmed: false });
  }, [applyPatch, recommendedCrew]);

  const confirmCrew = useCallback(() => {
    if (!draft || draft.crewMemberIds.length !== draft.crewSize || !draft.crewLeadUserId) return;
    void applyPatch({ crewMemberIds: draft.crewMemberIds, crewLeadUserId: draft.crewLeadUserId, crewConfirmed: true });
  }, [applyPatch, draft]);

  const bookJob = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !current.readiness.ready || busy) return;
    setBusy(true);
    try {
      const result = await requestJson<BookedResult>(`/api/quick-book/sessions/${current.id}/book`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: current.revision, idempotencyKey: idempotencyRef.current }),
      });
      setBooked(result);
      localStorage.removeItem(SESSION_KEY);
      toast({ title: "Job booked", description: "The tentative crew plan was saved and delivery results are ready." });
    } catch (error) {
      toast({ title: "Job was not booked", description: error instanceof Error ? error.message : "The draft is still safe.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [busy, toast]);

  if (loading || !session || !draft) {
    return <div className="flex min-h-[70vh] items-center justify-center bg-slate-950 text-white"><Loader2 className="h-8 w-8 animate-spin text-cyan-300" /></div>;
  }

  if (booked) {
    const grouped = booked.deliveries.reduce<Record<string, Delivery[]>>((result, delivery) => {
      (result[delivery.recipientName || delivery.recipientUserId] ||= []).push(delivery);
      return result;
    }, {});
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <Card className="mx-auto max-w-2xl border-emerald-400/40 bg-slate-900 text-white">
          <CardContent className="space-y-6 p-6">
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
              <h1 className="mt-3 text-2xl font-black">Job booked and crew alerts attempted</h1>
              <p className="mt-1 text-sm text-slate-300">Job {booked.orderNumber ? `JC-${booked.orderNumber}` : booked.leadId} · ${booked.total ? `$${booked.total.toFixed(2)}` : "Exact quote saved"}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm">
              <p className="font-bold text-slate-200">Delivery record</p>
              <div className="mt-3 space-y-3">
                {Object.entries(grouped).map(([name, deliveries]) => (
                  <div key={name} className="rounded-lg bg-slate-900 p-3">
                    <p className="font-semibold">{name}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {deliveries.map((delivery) => <Badge key={`${delivery.recipientUserId}-${delivery.channel}`} variant="outline" className={delivery.status === "sent" ? "border-emerald-500/50 text-emerald-200" : delivery.status === "failed" ? "border-red-500/50 text-red-200" : "border-amber-500/50 text-amber-200"}>{delivery.channel}: {delivery.status}</Badge>)}
                    </div>
                  </div>
                ))}
                {!booked.deliveries.length && <p className="text-amber-200">No delivery record was returned. Open the job before assuming anyone received an alert.</p>}
              </div>
            </div>
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
              No customer message was sent and no Square invoice was created. Customer acceptance and payment remain separate actions.
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button variant="outline" className="h-12 border-slate-600" onClick={() => navigate(`/lead/${booked.leadId}`)}>Open job</Button>
              <Button className="h-12 bg-cyan-400 font-black text-slate-950 hover:bg-cyan-300" onClick={() => void createSession()}><Plus className="mr-2 h-4 w-4" />Quick Book another</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 pb-40 text-white lg:pb-8">
      <header className="sticky top-0 z-30 border-b border-cyan-400/20 bg-slate-950/95 px-3 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => navigate("/crew")} aria-label="Back to crew dashboard"><ArrowLeft className="h-5 w-5" /></Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-cyan-300" /><h1 className="truncate text-lg font-black">60-Second Quick Book</h1></div>
            <p className="truncate text-xs text-slate-400">Talk or type · exact server quote · one final tap</p>
          </div>
          <Badge variant="outline" className="border-cyan-400/40 text-cyan-200"><Clock3 className="mr-1 h-3 w-3" />{elapsedSeconds}s</Badge>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={busy} onClick={() => void createSession()} aria-label="Start a new Quick Book"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </header>

      {visualFixture && (
        <div className="mx-auto mt-3 max-w-7xl px-3">
          <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm font-semibold text-amber-100" role="status">
            Development visual fixture — controls update only this screen. Booking, crew alerts, customer messages, and invoices are disabled.
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-7xl gap-4 px-3 py-4 lg:grid-cols-[minmax(320px,0.85fr)_minmax(540px,1.15fr)]">
        <section className="flex min-h-[440px] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/80 lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)]">
          <div className="border-b border-slate-700/70 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold"><MessageSquareText className="h-4 w-4 text-cyan-300" />Tell me the job</p>
            <p className="mt-1 text-xs text-slate-400">Example: “Beth, 920-555-0123, loading a 26-foot U-Haul in Bessemer Friday at 10, three movers for two hours, no stairs or special items.”</p>
          </div>
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="gap-4 p-4">
              {messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent className={message.role === "user" ? "bg-cyan-500/20 text-cyan-50" : "rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-slate-100"}>
                    <MessageResponse>{message.text}</MessageResponse>
                  </MessageContent>
                </Message>
              ))}
              {busy && (
                <Message from="assistant">
                  <MessageContent className="flex rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                    <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                  </MessageContent>
                </Message>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <div className="border-t border-slate-700 bg-slate-950/90 p-3">
            {session.suggestions.length > 0 && (
              <Suggestions className="pb-2">
                {session.suggestions.map((suggestion) => <Suggestion key={suggestion} suggestion={suggestion} disabled={busy} onClick={handleSuggestion} className="min-h-11 border-slate-600 bg-slate-900 text-slate-100" />)}
              </Suggestions>
            )}
            <PromptInput onSubmit={({ text }) => sendMessage(text, "typed")}>
              <PromptInputBody><PromptInputTextarea disabled={busy} placeholder="Talk or type the job details…" className="min-h-14 text-base" /></PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  <SpeechInput
                    aria-label="Speak job details"
                    disabled={busy}
                    maxDurationMs={60_000}
                    onAudioRecorded={transcribeAudio}
                    onTranscriptionChange={(text) => void sendMessage(text, "voice")}
                    onSpeechError={(message) => toast({ title: "Voice unavailable", description: message, variant: "destructive" })}
                    className="h-11 w-11 bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                  />
                  <span className="text-xs text-slate-400">Tap mic, then speak</span>
                </PromptInputTools>
                <PromptInputSubmit disabled={busy} status={busy ? "submitted" : "ready"} className="h-11 w-11 bg-cyan-500 text-slate-950 hover:bg-cyan-400" />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </section>

        <section className="space-y-4">
          <Card className="border-slate-700 bg-slate-900/85 text-white">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-5 w-5 text-cyan-300" />Customer</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <FieldShell label="Customer name" missing={missing("customer name")}><Input value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} onBlur={() => void applyPatch({ customerName: draft.customerName })} className="h-11 border-slate-700 bg-black" placeholder="Full name" /></FieldShell>
              <FieldShell label="Phone" missing={missing("10-digit phone")}><Input inputMode="tel" value={draft.customerPhone} onChange={(event) => setDraft({ ...draft, customerPhone: event.target.value })} onBlur={() => void applyPatch({ customerPhone: draft.customerPhone })} className="h-11 border-slate-700 bg-black" placeholder="(906) 555-0123" /></FieldShell>
              <FieldShell label="Email (optional)"><Input inputMode="email" value={draft.customerEmail} onChange={(event) => setDraft({ ...draft, customerEmail: event.target.value })} onBlur={() => void applyPatch({ customerEmail: draft.customerEmail })} className="h-11 border-slate-700 bg-black" placeholder="Optional receipt email" /></FieldShell>
              <FieldShell label="Customer explicitly agreed to texts" missing={missing("text-message consent")}>
                <div className="grid grid-cols-2 gap-2"><ChoiceButton active={draft.smsConsent === true} disabled={busy} onClick={() => void applyPatch({ smsConsent: true })}>Yes</ChoiceButton><ChoiceButton active={draft.smsConsent === false} disabled={busy} onClick={() => void applyPatch({ smsConsent: false })}>No</ChoiceButton></div>
              </FieldShell>
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-900/85 text-white">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-5 w-5 text-cyan-300" />Locations & schedule</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <FieldShell label="Pickup / service address" missing={missing("complete pickup address")}><Input value={draft.pickupAddress} onChange={(event) => setDraft({ ...draft, pickupAddress: event.target.value })} onBlur={() => void applyPatch({ pickupAddress: draft.pickupAddress })} className="h-11 border-slate-700 bg-black" placeholder="Street, city, state or ZIP" /></FieldShell>
              <FieldShell label="Destination" missing={missing("complete destination address")}><Input value={draft.destinationAddress} onChange={(event) => setDraft({ ...draft, destinationAddress: event.target.value })} onBlur={() => void applyPatch({ destinationAddress: draft.destinationAddress })} className="h-11 border-slate-700 bg-black" placeholder="Required for load + unload" /></FieldShell>
              <FieldShell label="Confirmed job date" missing={missing("confirmed date")}><Input type="date" value={draft.confirmedDate} onChange={(event) => void applyPatch({ confirmedDate: event.target.value })} className="h-11 border-slate-700 bg-black" /></FieldShell>
              <FieldShell label="One-hour arrival window" missing={missing("one-hour arrival window")}>
                <Select value={draft.arrivalWindow || undefined} onValueChange={(value) => void applyPatch({ arrivalWindow: value })}><SelectTrigger className="h-11 border-slate-700 bg-black"><SelectValue placeholder="Choose a window" /></SelectTrigger><SelectContent>{JOB_SCHEDULE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
              </FieldShell>
              <FieldShell label="Pickup access code"><Input value={draft.pickupAccessCode} onChange={(event) => setDraft({ ...draft, pickupAccessCode: event.target.value })} onBlur={() => void applyPatch({ pickupAccessCode: draft.pickupAccessCode })} className="h-11 border-slate-700 bg-black" placeholder="Encrypted when saved" /></FieldShell>
              <FieldShell label="Entry instructions"><Input value={draft.pickupInstructions} onChange={(event) => setDraft({ ...draft, pickupInstructions: event.target.value })} onBlur={() => void applyPatch({ pickupInstructions: draft.pickupInstructions })} className="h-11 border-slate-700 bg-black" placeholder="Gate, parking, contact" /></FieldShell>
              <FieldShell label="Destination access code"><Input value={draft.destinationAccessCode} onChange={(event) => setDraft({ ...draft, destinationAccessCode: event.target.value })} onBlur={() => void applyPatch({ destinationAccessCode: draft.destinationAccessCode })} className="h-11 border-slate-700 bg-black" placeholder="Encrypted when saved" /></FieldShell>
              <FieldShell label="Destination instructions"><Input value={draft.destinationInstructions} onChange={(event) => setDraft({ ...draft, destinationInstructions: event.target.value })} onBlur={() => void applyPatch({ destinationInstructions: draft.destinationInstructions })} className="h-11 border-slate-700 bg-black" placeholder="Elevator, dock, parking" /></FieldShell>
              <div className="space-y-2 rounded-xl border border-slate-700/80 bg-slate-950/35 p-3 sm:col-span-2">
                <Label className="text-xs font-semibold text-slate-300">Additional stops</Label>
                {draft.additionalStops.map((stop, index) => (
                  <div key={`${stop.address}-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-black px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{stop.address}</span>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void applyPatch({ additionalStops: draft.additionalStops.filter((_, stopIndex) => stopIndex !== index) })}>Remove</Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={newStop} onChange={(event) => setNewStop(event.target.value)} className="h-11 border-slate-700 bg-black" placeholder="Stop address" />
                  <Button type="button" variant="outline" className="h-11" disabled={busy || !newStop.trim()} onClick={() => { void applyPatch({ additionalStops: [...draft.additionalStops, { address: newStop.trim(), note: "" }] }); setNewStop(""); }}><Plus className="h-4 w-4" /><span className="sr-only">Add stop</span></Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-900/85 text-white">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-5 w-5 text-cyan-300" />Job plan</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FieldShell label="Work scope" missing={missing("work scope")}><div className="grid grid-cols-3 gap-2"><ChoiceButton active={draft.workScope === "load_only"} disabled={busy} onClick={() => void applyPatch({ workScope: "load_only" })}>Load only</ChoiceButton><ChoiceButton active={draft.workScope === "unload_only"} disabled={busy} onClick={() => void applyPatch({ workScope: "unload_only" })}>Unload only</ChoiceButton><ChoiceButton active={draft.workScope === "load_unload"} disabled={busy} onClick={() => void applyPatch({ workScope: "load_unload" })}>Both</ChoiceButton></div></FieldShell>
              <FieldShell label="Truck / equipment" missing={missing("truck or equipment choice")}><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><ChoiceButton active={draft.truckConfig === "customer_truck"} disabled={busy} onClick={() => void applyPatch({ truckConfig: "customer_truck" })}>Customer</ChoiceButton><ChoiceButton active={draft.truckConfig === "rental_truck"} disabled={busy} onClick={() => void applyPatch({ truckConfig: "rental_truck" })}>Rental</ChoiceButton><ChoiceButton active={draft.truckConfig === "company_truck"} disabled={busy} onClick={() => void applyPatch({ truckConfig: "company_truck" })}>JC truck</ChoiceButton><ChoiceButton active={draft.truckConfig === "no_truck"} disabled={busy} onClick={() => void applyPatch({ truckConfig: "no_truck" })}>No truck</ChoiceButton></div></FieldShell>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldShell label="Truck size"><Select value={draft.truckSize} onValueChange={(value) => void applyPatch({ truckSize: value })}><SelectTrigger className="h-11 border-slate-700 bg-black"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not specified</SelectItem><SelectItem value="cargo_van">Cargo van</SelectItem><SelectItem value="15_ft">15-foot</SelectItem><SelectItem value="20_ft">20-foot</SelectItem><SelectItem value="26_ft">26-foot</SelectItem><SelectItem value="custom">Other</SelectItem></SelectContent></Select></FieldShell>
                <FieldShell label="Property size"><Input value={draft.propertySize} onChange={(event) => setDraft({ ...draft, propertySize: event.target.value })} onBlur={() => void applyPatch({ propertySize: draft.propertySize })} className="h-11 border-slate-700 bg-black" placeholder="Apartment, 2-bedroom house…" /></FieldShell>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FieldShell label="Movers" missing={missing("crew size")}><Select value={draft.crewSize?.toString()} onValueChange={(value) => void applyPatch({ crewSize: Number(value), crewMemberIds: [], crewLeadUserId: null, crewConfirmed: false })}><SelectTrigger className="h-11 border-slate-700 bg-black"><SelectValue placeholder="Crew" /></SelectTrigger><SelectContent>{[1,2,3,4,5,6].map((count) => <SelectItem key={count} value={String(count)}>{count}</SelectItem>)}</SelectContent></Select></FieldShell>
                <FieldShell label="Estimated hours" missing={missing("estimated hours")}><Select value={draft.estimatedHours?.toString()} onValueChange={(value) => void applyPatch({ estimatedHours: Number(value), crewConfirmed: false })}><SelectTrigger className="h-11 border-slate-700 bg-black"><SelectValue placeholder="Hours" /></SelectTrigger><SelectContent>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <SelectItem key={count} value={String(count)}>{count} hours</SelectItem>)}</SelectContent></Select></FieldShell>
                <FieldShell label="Stairs" missing={missing("stairs")}><Select value={draft.stairsFlights?.toString()} onValueChange={(value) => void applyPatch({ stairsFlights: Number(value) })}><SelectTrigger className="h-11 border-slate-700 bg-black"><SelectValue placeholder="Flights" /></SelectTrigger><SelectContent>{Array.from({ length: 11 }, (_, index) => index).map((count) => <SelectItem key={count} value={String(count)}>{count === 0 ? "No stairs" : `${count} flights`}</SelectItem>)}</SelectContent></Select></FieldShell>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldShell label="Elevator" missing={missing("elevator")}><div className="grid grid-cols-2 gap-2"><ChoiceButton active={draft.hasElevator === false} disabled={busy} onClick={() => void applyPatch({ hasElevator: false })}>No</ChoiceButton><ChoiceButton active={draft.hasElevator === true} disabled={busy} onClick={() => void applyPatch({ hasElevator: true })}>Yes</ChoiceButton></div></FieldShell>
                <FieldShell label="Special items" missing={missing("special-item check")}><div className="grid grid-cols-2 gap-2"><ChoiceButton active={draft.specialItemsConfirmed && !Object.entries(draft.specialItems).some(([key,value]) => key !== "notes" && value === true)} disabled={busy} onClick={() => void applyPatch({ specialItemsConfirmed: true, specialItems: { piano: false, safe: false, hotTub: false, poolTable: false, otherLargeItem: false, notes: "" } })}>None</ChoiceButton><ChoiceButton active={Object.entries(draft.specialItems).some(([key,value]) => key !== "notes" && value === true)} disabled={busy} onClick={() => void applyPatch({ specialItemsConfirmed: true, specialItems: { ...draft.specialItems, otherLargeItem: true } })}>Needs review</ChoiceButton></div></FieldShell>
              </div>
              <details className="rounded-xl border border-slate-700 bg-slate-950/35 p-3">
                <summary className="cursor-pointer text-sm font-bold text-slate-200">Inventory, appliances, and specialty details</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {([['washerDryer', 'Washer / dryer'], ['refrigerator', 'Refrigerator'], ['patioFurniture', 'Patio furniture']] as const).map(([key, label]) => <ChoiceButton key={key} active={draft.inventory[key] === true} disabled={busy} onClick={() => void applyPatch({ inventory: { ...draft.inventory, [key]: draft.inventory[key] === true ? false : true } })}>{label}</ChoiceButton>)}
                  {([['piano', 'Piano'], ['safe', 'Safe'], ['hotTub', 'Hot tub'], ['poolTable', 'Pool table'], ['otherLargeItem', 'Other large item']] as const).map(([key, label]) => <ChoiceButton key={key} active={draft.specialItems[key] === true} disabled={busy} onClick={() => void applyPatch({ specialItemsConfirmed: true, specialItems: { ...draft.specialItems, [key]: draft.specialItems[key] === true ? false : true } })}>{label}</ChoiceButton>)}
                </div>
                <Textarea value={draft.specialItems.notes} onChange={(event) => setDraft({ ...draft, specialItems: { ...draft.specialItems, notes: event.target.value } })} onBlur={() => void applyPatch({ specialItems: draft.specialItems })} className="mt-3 min-h-16 border-slate-700 bg-black" placeholder="Specialty item size, weight, handling notes" />
              </details>
              <div className="grid gap-3 sm:grid-cols-3">
                <FieldShell label="Bedrooms"><Input type="number" min={0} max={20} value={draft.bedrooms ?? ""} onChange={(event) => setDraft({ ...draft, bedrooms: event.target.value === "" ? null : Number(event.target.value) })} onBlur={() => void applyPatch({ bedrooms: draft.bedrooms })} className="h-11 border-slate-700 bg-black" /></FieldShell>
                <FieldShell label="Boxes"><Input type="number" min={0} max={10000} value={draft.inventory.boxes ?? ""} onChange={(event) => setDraft({ ...draft, inventory: { ...draft.inventory, boxes: event.target.value === "" ? null : Number(event.target.value) } })} onBlur={() => void applyPatch({ inventory: draft.inventory })} className="h-11 border-slate-700 bg-black" /></FieldShell>
                <FieldShell label="Promo code"><Input value={draft.promoCode} onChange={(event) => setDraft({ ...draft, promoCode: event.target.value.toUpperCase() })} onBlur={() => void applyPatch({ promoCode: draft.promoCode })} className="h-11 border-slate-700 bg-black font-mono" placeholder="Optional" /></FieldShell>
              </div>
              <FieldShell label="Notes"><Textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} onBlur={() => void applyPatch({ notes: draft.notes })} className="min-h-20 border-slate-700 bg-black" placeholder="Inventory, parking, additional stops, or customer requests" /></FieldShell>
            </CardContent>
          </Card>

          <Card className={`border text-white ${missing("confirmed named crew") || missing("confirmed crew lead") ? "border-amber-400/60 bg-amber-400/5" : "border-slate-700 bg-slate-900/85"}`}>
            <CardHeader className="pb-3"><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="h-5 w-5 text-cyan-300" />Crew confirmation</CardTitle>{recommendedCrew.length > 0 && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={useRecommendedCrew}>Use suggested</Button>}</div></CardHeader>
            <CardContent className="space-y-3">
              {!draft.confirmedDate && <p className="text-sm text-amber-200">Choose the job date to check crew availability.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {session.crewSuggestions.map((worker) => {
                  const selected = draft.crewMemberIds.includes(worker.id);
                  return (
                    <button key={worker.id} type="button" disabled={busy || !worker.available} onClick={() => toggleCrew(worker.id)} className={`min-h-16 rounded-xl border p-3 text-left ${selected ? "border-cyan-300 bg-cyan-400/15" : "border-slate-700 bg-slate-950/60"} disabled:opacity-45`}>
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-slate-600"}`}>{selected && <Check className="h-3.5 w-3.5" />}</span>
                        <span className="min-w-0 flex-1"><span className="block font-bold">{worker.name}</span><span className="block text-xs text-slate-400">{worker.reason}</span></span>
                        {worker.recommended && <Badge className="bg-cyan-500/20 text-cyan-100">Suggested</Badge>}
                      </div>
                    </button>
                  );
                })}
              </div>
              {draft.crewMemberIds.length > 0 && (
                <FieldShell label="Crew lead" missing={missing("confirmed crew lead")}><Select value={draft.crewLeadUserId || undefined} onValueChange={(value) => void applyPatch({ crewLeadUserId: value, crewConfirmed: false })}><SelectTrigger className="h-11 border-slate-700 bg-black"><SelectValue placeholder="Choose lead mover" /></SelectTrigger><SelectContent>{draft.crewMemberIds.map((id) => { const worker = session.crewSuggestions.find((item) => item.id === id); return <SelectItem key={id} value={id}>{worker?.name || "Selected mover"}</SelectItem>; })}</SelectContent></Select></FieldShell>
              )}
              <Button type="button" variant="outline" className="h-12 w-full border-cyan-500/40" disabled={busy || draft.crewMemberIds.length !== draft.crewSize || !draft.crewLeadUserId} onClick={confirmCrew}>{draft.crewConfirmed ? <><CheckCircle2 className="mr-2 h-4 w-4 text-emerald-300" />Crew confirmed</> : "Confirm named crew"}</Button>
            </CardContent>
          </Card>

          <Card className={`border-2 text-white ${session.readiness.ready ? "border-emerald-400/70 bg-emerald-500/10" : "border-slate-700 bg-slate-900/90"}`}>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div><p className="flex items-center gap-2 text-sm font-bold text-slate-300"><DollarSign className="h-4 w-4" />Exact server quote</p><p className="mt-1 text-4xl font-black">{quoteTotal > 0 ? `$${quoteTotal.toFixed(2)}` : "Not ready"}</p>{quote && <p className="mt-1 text-xs text-slate-400">{String((quote.location as any)?.label || "Server-calculated rate")} · JCMOVES basis ${rewardBasis.toFixed(2)}</p>}</div>
                <Badge variant="outline" className={session.readiness.ready ? "border-emerald-400 text-emerald-200" : "border-amber-400/60 text-amber-200"}>{session.readiness.ready ? "Ready" : `${session.missingFields.length + session.reviewReasons.length} checks`}</Badge>
              </div>
              {(session.missingFields.length > 0 || session.reviewReasons.length > 0) && <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100"><p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />Saved as draft — no alerts</p><ul className="mt-2 space-y-1 text-xs"><li>{session.missingFields.join(" · ")}</li>{session.reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
              {!session.canComplete && <p className="rounded-xl border border-blue-400/30 bg-blue-400/10 p-3 text-sm text-blue-100">Your staff account can collect and save this draft. An owner or administrator must perform the final booking.</p>}
              <Button type="button" className="h-14 w-full bg-emerald-400 text-base font-black text-slate-950 hover:bg-emerald-300" disabled={busy || !session.readiness.ready || !session.canComplete} onClick={() => void bookJob()}>{busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}Book & Alert Crew</Button>
              <p className="text-center text-xs text-slate-400">One tap saves the booking and tentative crew plan. It does not message the customer or create a Square invoice.</p>
            </CardContent>
          </Card>
        </section>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 space-y-2 border-t border-slate-700 bg-slate-950/95 p-3 backdrop-blur lg:hidden">
        <PromptInput onSubmit={({ text }) => sendMessage(text, "typed")} className="bg-slate-900">
          <PromptInputBody><PromptInputTextarea disabled={busy} placeholder="Add or correct a detail…" className="min-h-10 text-base" /></PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools><SpeechInput disabled={busy} maxDurationMs={60_000} onAudioRecorded={transcribeAudio} onTranscriptionChange={(text) => void sendMessage(text, "voice")} onSpeechError={(message) => toast({ title: "Voice unavailable", description: message, variant: "destructive" })} className="h-11 w-11 bg-cyan-500 text-slate-950" /></PromptInputTools>
            <PromptInputSubmit disabled={busy} status={busy ? "submitted" : "ready"} className="h-11 w-11 bg-cyan-500 text-slate-950" />
          </PromptInputFooter>
        </PromptInput>
        <Button type="button" className="h-14 w-full bg-emerald-400 text-base font-black text-slate-950 hover:bg-emerald-300" disabled={busy || !session.readiness.ready || !session.canComplete} onClick={() => void bookJob()}>
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
          {session.readiness.ready ? `Book & Alert Crew · $${quoteTotal.toFixed(2)}` : `Draft · ${session.missingFields.length + session.reviewReasons.length} checks left`}
        </Button>
      </div>
    </main>
  );
}
