import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, PhoneCall, ShieldCheck, Truck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/hooks/useCart";
import { DateFirstBooking } from "@/components/date-first-booking";

type BookingService = "moving" | "labor" | "junk";
type BookingForm = {
  service: BookingService;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  serviceAddress: string;
  destinationAddress: string;
  zip: string;
  requestedDate: string;
  requestedHours: string;
  truckSource: "jc_on_the_move" | "customer" | "rental" | "none";
  truckSize: "none" | "cargo_van" | "15_ft" | "20_ft" | "26_ft" | "other";
  difficulty: "standard" | "moderate" | "difficult";
  stairsFlights: string;
  junkVolume: "quarter" | "half" | "three_quarter" | "full";
  notes: string;
  smsConsent: boolean;
  termsAccepted: boolean;
  termsVersion: string;
};

type Quote = {
  minEstimate: number;
  maxEstimate: number;
  estimateLabel: string;
  crewSize: number;
  requestedHours: number;
  travelFallback: boolean;
  conditionalHold: boolean;
  reviewRequired: boolean;
  travelEstimate: number;
  autoBookEligible?: boolean;
  operatingEligibility?: {
    decision: "eligible" | "manual_review" | "blocked";
    areaCode: string | null;
    reasons: Array<{ code: string; message: string }>;
  };
};

type Slot = { time: string; label: string; availableCrew: number };

const initialForm: BookingForm = {
  service: "moving",
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  serviceAddress: "",
  destinationAddress: "",
  zip: "",
  requestedDate: "",
  requestedHours: "2",
  truckSource: "jc_on_the_move",
  truckSize: "15_ft",
  difficulty: "standard",
  stairsFlights: "0",
  junkVolume: "half",
  notes: "",
  smsConsent: false,
  termsAccepted: false,
  termsVersion: "2026-08-regional-v1",
};

function phoneIsComplete(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits);
}

function errorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : "";
  try {
    const json = JSON.parse(raw.replace(/^\d+:\s*/, ""));
    return json.error || json.message || fallback;
  } catch {
    return raw.replace(/^\d+:\s*/, "") || fallback;
  }
}

export default function InstantBookingPage() {
  const { toast } = useToast();
  const { addItem } = useCart();
  const [mode, setMode] = useState<"schedule" | "choose" | "callback" | "reserve">("schedule");
  const [form, setForm] = useState<BookingForm>(initialForm);
  const [heavyItems, setHeavyItems] = useState([
    { name: "", pounds: "" },
    { name: "", pounds: "" },
    { name: "", pounds: "" },
  ]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [checking, setChecking] = useState(false);
  const [holding, setHolding] = useState(false);
  const [callbackSending, setCallbackSending] = useState(false);
  const [complete, setComplete] = useState<{
    kind: "callback" | "hold";
    message: string;
    paymentUrl?: string | null;
    depositAmount?: number | null;
    status?: string;
    bookingId?: string;
  } | null>(null);

  const normalizedHeavyItems = useMemo(() => (
    heavyItems
      .filter((item) => item.name.trim() || item.pounds.trim())
      .map((item) => ({ name: item.name.trim() || "Heavy item", pounds: Number(item.pounds) }))
      .filter((item) => Number.isFinite(item.pounds) && item.pounds > 0)
  ), [heavyItems]);

  function update<K extends keyof BookingForm>(key: K, value: BookingForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (!(["notes", "smsConsent", "termsAccepted", "termsVersion"] as Array<keyof BookingForm>).includes(key)) {
      setQuote(null);
      setSlots([]);
      setSelectedSlot("");
    }
  }

  function instantPayload(startTime?: string) {
    return {
      ...form,
      requestedHours: Number(form.requestedHours),
      stairsFlights: Number(form.stairsFlights || 0),
      heavyItems: normalizedHeavyItems,
      ...(startTime ? { startTime } : {}),
    };
  }

  async function checkAvailability(event: FormEvent) {
    event.preventDefault();
    if (!phoneIsComplete(form.customerPhone)) {
      toast({ title: "Use a complete 10-digit callback number", variant: "destructive" });
      return;
    }
    setChecking(true);
    try {
      const response = await apiRequest("POST", "/api/instant-booking/availability", instantPayload());
      const data = await response.json() as { quote: Quote; slots: Slot[]; message: string };
      setQuote(data.quote);
      setSlots(data.slots);
      setSelectedSlot("");
      if (!data.slots.length) toast({ title: "No online slots for that day", description: data.message });
    } catch (error) {
      toast({ title: "Could not check availability", description: errorMessage(error, "Please try again or request a callback."), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }

  async function placeHold() {
    if (!selectedSlot) return;
    setHolding(true);
    try {
      const response = await apiRequest("POST", "/api/instant-booking/hold", instantPayload(selectedSlot));
      const data = await response.json() as { bookingId: string; message: string; paymentUrl?: string | null; depositAmount?: number | null; status?: string };
      addItem({
        id: `booking-${data.bookingId}`,
        referenceId: data.bookingId,
        bookingId: data.bookingId,
        name: `${form.service === "moving" ? "Moving" : form.service === "labor" ? "Labor" : "Junk removal"} booking`,
        price: quote?.minEstimate || 0,
        image: "",
        type: "service",
        settlementMode: "linked_booking",
        metadata: { customerEmail: form.customerEmail, status: data.status },
      });
      setComplete({ kind: "hold", bookingId: data.bookingId, message: data.message, paymentUrl: data.paymentUrl, depositAmount: data.depositAmount, status: data.status });
    } catch (error) {
      toast({ title: "Could not place the hold", description: errorMessage(error, "Please choose another time or request a callback."), variant: "destructive" });
      setSlots([]);
      setSelectedSlot("");
    } finally {
      setHolding(false);
    }
  }

  async function submitCallback(event: FormEvent) {
    event.preventDefault();
    const parts = form.customerName.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !phoneIsComplete(form.customerPhone)) {
      toast({ title: "Add your name and complete 10-digit phone number", variant: "destructive" });
      return;
    }
    setCallbackSending(true);
    try {
      const response = await apiRequest("POST", "/api/leads/quick-request", {
        firstName: parts[0],
        lastName: parts.slice(1).join(" ") || "Customer",
        phone: form.customerPhone,
        serviceCode: form.service === "junk" ? "junk_removal" : form.service,
        notes: form.notes,
        photos: [],
      });
      const data = await response.json() as { duplicate?: boolean };
      setComplete({
        kind: "callback",
        message: data.duplicate
          ? "We already have your callback request and will follow up."
          : "Your callback request is in. A JC ON THE MOVE team member will reach out.",
      });
    } catch (error) {
      toast({ title: "Could not send callback request", description: errorMessage(error, "Please check the number and try again."), variant: "destructive" });
    } finally {
      setCallbackSending(false);
    }
  }

  if (complete) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-7 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h1 className="mt-4 text-2xl font-black">You’re all set</h1>
            <p className="mt-3 text-muted-foreground">{complete.message}</p>
            {complete.kind === "hold" && (
              <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm">
                {complete.status === "awaiting_deposit"
                  ? `Your time is held for 24 hours. The ${complete.depositAmount ? `$${complete.depositAmount.toFixed(2)} ` : ""}deposit confirms the booking and starts individual crew assignment.`
                  : "No payment was taken. The team will review this nonstandard request before sending a deposit request."}
              </p>
            )}
            {complete.paymentUrl && (
              <Button className="mt-4 w-full bg-emerald-600 hover:bg-emerald-500" asChild>
                <a href={complete.paymentUrl}>Pay the 30% deposit securely with Square</a>
              </Button>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {complete.kind === "hold" && (
                <Button variant="outline" onClick={() => window.location.assign("/handmade-jewels-by-ashley")}>
                  Add handmade jewelry
                </Button>
              )}
              {complete.kind === "hold" && (
                <Button variant="outline" onClick={() => window.location.assign("/cart")}>
                  Review combined cart
                </Button>
              )}
              <Button onClick={() => window.location.assign("/")}>Back to home</Button>
              <Button variant="outline" asChild><a href="tel:9062859312">Call 906-285-9312</a></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-300">JC ON THE MOVE LLC</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Request service</h1>

        </div>

        {mode === "schedule" && <DateFirstBooking onChooseCallback={() => setMode("callback")} onDetailedBooking={() => setMode("reserve")} />}

        {mode === "choose" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-blue-500/40 bg-slate-900/90">
              <CardHeader>
                <PhoneCall className="h-8 w-8 text-blue-300" />
                <CardTitle className="text-xl">Request a callback</CardTitle>
                <CardDescription>Best for a fast answer, a custom job, or when you are not ready to choose a time.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-slate-300">About 60 seconds. We create a real lead with a verified callback number.</p>
                <Button className="w-full" onClick={() => setMode("callback")}>Request callback</Button>
              </CardContent>
            </Card>
            <Card className="border-emerald-500/40 bg-slate-900/90">
              <CardHeader>
                <CalendarClock className="h-8 w-8 text-emerald-300" />
                <CardTitle className="text-xl">Estimate & request a time</CardTitle>
                <CardDescription>For moving, labor, or junk removal with a clear job scope and a preferred start time.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-slate-300">We only show two-hour start times with enough active crew capacity.</p>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-500" onClick={() => setMode("reserve")}>Build my estimate</Button>
              </CardContent>
            </Card>
          </div>
        )}

        {mode === "callback" && (
          <Card className="border-slate-700 bg-slate-900/95">
            <CardHeader>
              <div className="flex items-center gap-2"><PhoneCall className="h-5 w-5 text-blue-300" /><CardTitle>60-second callback request</CardTitle></div>
              <CardDescription>No pricing or reservation is created here — this becomes a call-back lead for the team.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={submitCallback}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your name"><Input value={form.customerName} onChange={(e) => update("customerName", e.target.value)} required /></Field>
                  <Field label="Phone number"><Input type="tel" autoComplete="tel" placeholder="(906) 285-9312" value={form.customerPhone} onChange={(e) => update("customerPhone", e.target.value)} required /></Field>
                </div>
                <Field label="Service">
                  <select className="field-select" value={form.service} onChange={(e) => update("service", e.target.value as BookingService)}>
                    <option value="moving">Moving</option><option value="labor">Labor only</option><option value="junk">Junk removal</option>
                  </select>
                </Field>
                <Field label="Anything we should know? (optional)"><Textarea rows={4} value={form.notes} onChange={(e) => update("notes", e.target.value)} /></Field>
                <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setMode("choose")}>Back</Button><Button type="submit" disabled={callbackSending}>{callbackSending ? "Sending…" : "Request callback"}</Button></div>
              </form>
            </CardContent>
          </Card>
        )}

        {mode === "reserve" && (
          <form className="space-y-5" onSubmit={checkAvailability}>
            <Card className="border-slate-700 bg-slate-900/95">
              <CardHeader>
                <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-emerald-300" /><CardTitle>Job details</CardTitle></div>
                <CardDescription>Every estimate is clear about crew size, difficulty, travel, and what still needs review.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Service"><select className="field-select" value={form.service} onChange={(e) => update("service", e.target.value as BookingService)}><option value="moving">Moving</option><option value="labor">Labor only</option><option value="junk">Junk removal</option></select></Field>
                  <Field label="Date"><Input type="date" min={new Date().toISOString().slice(0, 10)} value={form.requestedDate} onChange={(e) => update("requestedDate", e.target.value)} required /></Field>
                  <Field label={form.service === "junk" ? "Expected job time" : "Requested hours"}><Input type="number" min="1" max="12" step="0.5" value={form.requestedHours} onChange={(e) => update("requestedHours", e.target.value)} disabled={form.service === "junk"} required /></Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={form.service === "moving" ? "Pickup address" : "Service address"}><Input autoComplete="street-address" value={form.serviceAddress} onChange={(e) => update("serviceAddress", e.target.value)} required /></Field>
                  <Field label="ZIP code"><Input inputMode="numeric" maxLength={10} value={form.zip} onChange={(e) => update("zip", e.target.value)} required /></Field>
                </div>
                {form.service === "moving" && (
                  <Field label="Destination address"><Input autoComplete="street-address" value={form.destinationAddress} onChange={(e) => update("destinationAddress", e.target.value)} required /></Field>
                )}
                {form.service === "junk" ? (
                  <Field label="How much truck space?"><select className="field-select" value={form.junkVolume} onChange={(e) => update("junkVolume", e.target.value as BookingForm["junkVolume"])}><option value="quarter">¼ truckload</option><option value="half">½ truckload</option><option value="three_quarter">¾ truckload</option><option value="full">Full truckload</option></select></Field>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Truck source"><select className="field-select" value={form.truckSource} onChange={(e) => update("truckSource", e.target.value as BookingForm["truckSource"])}><option value="jc_on_the_move">JC ON THE MOVE truck</option><option value="customer">Customer truck</option><option value="rental">Rental truck</option><option value="none">No truck needed</option></select></Field>
                    <Field label="Truck size"><select className="field-select" value={form.truckSize} onChange={(e) => update("truckSize", e.target.value as BookingForm["truckSize"])}><option value="none">No truck</option><option value="cargo_van">Cargo van</option><option value="15_ft">15 ft</option><option value="20_ft">20 ft</option><option value="26_ft">26 ft</option><option value="other">Other / not sure</option></select></Field>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Difficulty"><select className="field-select" value={form.difficulty} onChange={(e) => update("difficulty", e.target.value as BookingForm["difficulty"])}><option value="standard">Standard</option><option value="moderate">Moderate (tight access, some disassembly)</option><option value="difficult">Difficult (needs team review)</option></select></Field>
                  <Field label="Flights of stairs"><Input type="number" min="0" max="20" value={form.stairsFlights} onChange={(e) => update("stairsFlights", e.target.value)} /></Field>
                </div>
                <div className="rounded-lg border border-slate-700 p-3">
                  <p className="text-sm font-bold">Up to three heaviest items (optional)</p>
                  <p className="mb-3 text-xs text-slate-400">200–299 lb requires 2 movers; 300–399 lb requires 3; 400+ lb requires 4.</p>
                  <div className="grid gap-2">{heavyItems.map((item, index) => <div className="grid gap-2 sm:grid-cols-[1fr_150px]" key={index}><Input placeholder={"Item " + (index + 1)} value={item.name} onChange={(e) => setHeavyItems((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} /><Input type="number" min="1" placeholder="Estimated pounds" value={item.pounds} onChange={(e) => setHeavyItems((rows) => rows.map((row, i) => i === index ? { ...row, pounds: e.target.value } : row))} /></div>)}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-700 bg-slate-900/95">
              <CardHeader><div className="flex items-center gap-2"><Users className="h-5 w-5 text-blue-300" /><CardTitle>Contact & availability</CardTitle></div><CardDescription>We use your number only to follow up on this request. A complete 10-digit number is required.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Your name"><Input autoComplete="name" value={form.customerName} onChange={(e) => update("customerName", e.target.value)} required /></Field><Field label="Phone number"><Input type="tel" autoComplete="tel" placeholder="(906) 285-9312" value={form.customerPhone} onChange={(e) => update("customerPhone", e.target.value)} required /></Field></div>
                <Field label="Email (used for the deposit link and combined cart)"><Input type="email" autoComplete="email" value={form.customerEmail} onChange={(e) => update("customerEmail", e.target.value)} required /></Field>
                <Field label="Notes or access details (optional)"><Textarea rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} /></Field>
                <label className="flex items-start gap-2 rounded-lg border border-slate-700 p-3 text-sm text-slate-300">
                  <input type="checkbox" className="mt-1" checked={form.smsConsent} onChange={(e) => update("smsConsent", e.target.checked)} />
                  Send transactional booking and crew-status updates by text. Email and the customer portal remain available without SMS consent.
                </label>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setMode("choose")}>Back</Button><Button type="submit" disabled={checking}>{checking ? "Checking live crew capacity…" : "See estimate & available times"}</Button></div>
              </CardContent>
            </Card>

            {quote && <Card className="border-blue-500/40 bg-blue-500/5"><CardContent className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-blue-200">Your instant estimate</p><p className="mt-1 text-3xl font-black">{quote.estimateLabel}</p><p className="mt-2 text-sm text-slate-300">{quote.crewSize} crew member{quote.crewSize === 1 ? "" : "s"} · about {quote.requestedHours} hour{quote.requestedHours === 1 ? "" : "s"}</p></div><ShieldCheck className="h-8 w-8 text-blue-300" /></div>{quote.autoBookEligible ? <p className="mt-4 rounded-md border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">This standard same-state job is eligible for automatic approval and a 30% scheduling deposit.</p> : <p className="mt-4 rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">{quote.operatingEligibility?.reasons?.[0]?.message || "This request needs team review before a deposit is requested."}</p>}</CardContent></Card>}

            {quote && <Card className="border-emerald-500/40 bg-slate-900/95"><CardHeader><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-emerald-300" /><CardTitle>Available start times</CardTitle></div><CardDescription>Two-hour increments in Central Time. The selected time is held for 24 hours while the deposit or staff review is completed.</CardDescription></CardHeader><CardContent>{slots.length ? <><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((slot) => <Button type="button" key={slot.time} variant={selectedSlot === slot.time ? "default" : "outline"} className={selectedSlot === slot.time ? "bg-emerald-600 hover:bg-emerald-500" : ""} onClick={() => setSelectedSlot(slot.time)}>{slot.label}</Button>)}</div><label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-700 p-3 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={form.termsAccepted} onChange={(e) => update("termsAccepted", e.target.checked)} /><span>I accept the <a href="/terms" target="_blank" rel="noreferrer" className="text-blue-300 underline">service terms and cancellation policy</a> for this quote.</span></label><Button type="button" className="mt-4 w-full bg-emerald-600 hover:bg-emerald-500" disabled={!selectedSlot || !form.termsAccepted || holding} onClick={placeHold}>{holding ? "Placing 24-hour hold…" : quote.autoBookEligible ? "Reserve time & continue to 30% deposit" : "Request this time for review"}</Button></> : <div className="rounded-lg bg-slate-950/70 p-4 text-sm text-slate-300">No online capacity is configured for this day. Use the callback option and we will check another date or crew plan.</div>}</CardContent></Card>}
          </form>
        )}
      </div>
      <style>{".field-select{display:flex;min-height:2.75rem;width:100%;border-radius:.375rem;border:1px solid hsl(var(--input));background:hsl(var(--background));padding:.5rem .75rem;font-size:1rem;color:hsl(var(--foreground))}.field-select:focus{outline:2px solid hsl(var(--ring));outline-offset:2px}"}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>;
}
