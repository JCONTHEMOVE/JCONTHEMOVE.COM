import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarClock, PhoneCall, ArrowRight, ArrowLeft } from "lucide-react";
import { bookingTimeLabel, recommendMove, validBookingDate, type BookingTimeZone, type MovePlan, type PublicBookingStatus } from "@shared/homepageBooking";
import { projectEntry } from "@shared/projectRequest";
import "./homepage-booking-chat.css";

type Path = "callback" | "book";
type Answer = {
  path: Path | null; address: string; size: string; when: string; date: string;
  timeZone: BookingTimeZone; scope: MovePlan["scope"]; inventory: string; access: MovePlan["access"];
  truckSource: "customer" | "rental" | "jc_on_the_move" | "none";
  destination: string; name: string; phone: string; email: string;
  custom: boolean; crew: 2 | 3 | 4; hours: string; overrideReason: string;
};
type Saved = { version: 1; key: string; step: number; answers: Answer; updatedAt: number; submitted: boolean; attribution: ReturnType<typeof projectEntry>["attribution"] };
type Quote = { minEstimate: number; maxEstimate: number; estimateLabel: string; crewSize: number; requestedHours: number; autoBookEligible: boolean; reviewRequired: boolean; fingerprint: string };
type Slot = { time: string; startAt: string; centralLabel: string; easternLabel: string };
const STORAGE_KEY = "jc-homepage-request-v1";
const steps = ["location", "size", "when", "scope", "inventory", "access", "truck", "destination", "name", "phone", "email", "review"] as const;
const initial: Answer = { path: null, address: "", size: "", when: "", date: "", timeZone: "America/Chicago", scope: "load_unload", inventory: "", access: "unknown", truckSource: "customer", destination: "", name: "", phone: "", email: "", custom: false, crew: 2, hours: "", overrideReason: "" };
function fresh(): Saved {
  return { version: 1, key: crypto.randomUUID(), step: 0, answers: { ...initial }, updatedAt: Date.now(), submitted: false, attribution: projectEntry(window.location.search).attribution };
}
function recover(): Saved {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.version === 1 && typeof saved.key === "string" && /^[a-f0-9-]{36}$/.test(saved.key)
      && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < steps.length
      && Date.now() - saved.updatedAt < 24 * 60 * 60_000 && saved.answers && typeof saved.answers.address === "string") {
      return { ...saved, answers: { ...initial, ...saved.answers } };
    }
  } catch { /* Storage can be unavailable; the in-memory draft still works. */ }
  return fresh();
}
function planning(a: Answer): MovePlan | null {
  const squareFootage = Number(a.size);
  const truck = ["pickup_van_10", "15_ft", "20_ft", "26_ft"].includes(a.size);
  if (!truck && !(squareFootage > 0)) return null;
  return {
    sizingBasis: truck ? "truck" : "square_footage",
    ...(truck ? { truckSize: a.size as MovePlan["truckSize"] } : { squareFootage }),
    inventory: a.inventory, scope: a.scope, access: a.access,
    ...(a.custom ? { selectedCrewSize: a.crew, selectedHours: Number(a.hours) || undefined } : {}),
    overrideReason: a.overrideReason,
  };
}
async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || "We couldn't save your request. Your answers are still here.");
  return data;
}

/** A short front door to the existing quick-request and instant-booking v3 APIs.
 * Nothing is persisted as a lead until the customer reviews and submits. */
export function HomepageBookingChat() {
  const [draft, setDraft] = useState<Saved>(recover);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [terms, setTerms] = useState(false);
  const [result, setResult] = useState<PublicBookingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const submitting = useRef(false);
  const a = draft.answers;
  const step = steps[draft.step];
  const plan = planning(a);
  const recommendation = plan ? recommendMove(plan) : null;

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() })); }
    catch { setStorageWarning(true); }
  }, [draft]);
  useEffect(() => {
    if (a.path) heading.current?.focus();
  }, [draft.step, a.path]);
  useEffect(() => {
    const back = (event: PopStateEvent) => {
      const next = event.state?.jcHomepageStep;
      if (Number.isInteger(next) && next >= 0 && next < steps.length) {
        setDraft(d => ({ ...d, step: next })); setError("");
      }
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    // Recover server state even after a response was lost. Stored UI data and
    // Square redirect parameters can never mark a booking confirmed or paid.
    let active = true;
    fetch("/api/instant-booking/status", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: draft.key }) })
      .then(async response => {
        if (response.status === 404) return null;
        if (!response.ok) throw Error("Could not recover request status. Retry before submitting.");
        return response.json();
      }).then(status => { if (active) { setResult(status); setStatusChecked(true); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [draft.key]);

  function update<K extends keyof Answer>(key: K, value: Answer[K]) {
    generation.current++;
    setDraft(d => ({ ...d, answers: { ...d.answers, [key]: value } }));
    setQuote(null); setSlots([]); setSlot(null); setTerms(false); setError("");
  }
  function go(index: number) {
    setDraft(d => ({ ...d, step: index })); setError("");
    history.pushState({ ...history.state, jcHomepageStep: index }, "", window.location.href);
  }
  function choose(path: Path) {
    if (busy || result) return;
    update("path", path);
    if (path === "book" && draft.step > 2 && !validBookingDate(a.date)) go(2);
    history.replaceState({ ...history.state, jcHomepageStep: draft.step }, "", window.location.href);
  }
  function next(event: FormEvent) {
    event.preventDefault();
    if (step === "location" && (a.address.trim().length < 8 || !/\b\d{5}\b/.test(a.address))) return setError("Enter the service address with its 5-digit ZIP code.");
    if (step === "size" && !plan) return setError("Choose a truck size or enter the approximate square footage.");
    if (step === "when" && a.path === "book" && !validBookingDate(a.date)) return setError("Choose a date. We will check actual crew availability before reserving.");
    if (step === "inventory" && a.inventory.trim().length < 3) return setError("Tell us the main items, stairs and any heavy items so the team can review the plan.");
    if (step === "destination" && a.scope === "move" && a.destination.trim().length < 5) return setError("Enter the destination address.");
    if (step === "name" && a.name.trim().length < 2) return setError("Enter your name.");
    if (step === "phone" && !/^[2-9]\d{2}[2-9]\d{6}$/.test(a.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))) return setError("Enter a complete 10-digit phone number.");
    if (step === "email" && a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return setError("Enter a valid email or leave it blank.");
    go(Math.min(steps.length - 1, draft.step + (step === "truck" && a.scope !== "move" ? 2 : 1)));
  }
  function payload() {
    if (!plan || !recommendation) throw Error("Review your move size first.");
    if (recommendation.overridden && !a.overrideReason.trim()) throw Error("Tell the team why you changed the recommendation.");
    if (recommendation.selectedHours > 12) throw Error("This move needs a callback to plan the duration.");
    return {
      requestKey: draft.key, service: a.scope === "move" ? "moving" : "labor",
      customerName: a.name, customerPhone: a.phone, customerEmail: a.email,
      serviceAddress: a.address, destinationAddress: a.destination,
      zip: a.address.match(/\b\d{5}\b/)?.[0] || "", requestedDate: a.date,
      requestedHours: recommendation.selectedHours, movePlan: plan,
      truckSource: a.truckSource, truckSize: plan.truckSize === "pickup_van_10" ? "cargo_van" : plan.truckSize || "other",
      notes: a.inventory, timeZone: a.timeZone, ...draft.attribution,
    };
  }
  async function check() {
    const revision = generation.current;
    setBusy(true); setError("");
    try {
      const data = await post("/api/instant-booking/availability", payload());
      if (revision !== generation.current) return;
      setQuote(data.quote); setSlots(data.slots); setSlot(null); setTerms(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function refreshStatus() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/instant-booking/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: draft.key }) });
      if (response.status === 404) { setResult(null); setStatusChecked(true); return; }
      if (!response.ok) throw Error("Could not check request status. Please retry.");
      setResult(await response.json()); setStatusChecked(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (submitting.current || !statusChecked) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      if (a.path === "callback") {
        const names = a.name.trim().split(/\s+/);
        await post("/api/leads/quick-request", {
          requestKey: draft.key, requestType: "callback", firstName: names[0], lastName: names.slice(1).join(" ") || "Customer",
          phone: a.phone, email: a.email, serviceCode: "moving", serviceAddress: a.address,
          destinationAddress: a.destination, notes: a.inventory, movePlan: plan,
          timeZone: a.timeZone, callbackWhen: a.when || "Please discuss timing by phone", ...draft.attribution,
        });
      } else {
        if (!quote || !slot || !terms) throw Error("Review the quote, choose an available time and accept the service terms.");
        await post("/api/instant-booking/hold", { ...payload(), startTime: slot.time, termsAccepted: terms, reviewedQuoteFingerprint: quote.fingerprint });
      }
      setDraft(d => ({ ...d, submitted: true }));
      setResult(await post("/api/instant-booking/status", { requestKey: draft.key }));
    } catch (e) {
      setError(`${(e as Error).message} Your answers are still here. Retry uses the same request.`);
      if (a.path === "book") { setQuote(null); setSlot(null); setSlots([]); setTerms(false); }
    } finally { submitting.current = false; setBusy(false); }
  }
  const titles: Record<typeof step, string> = {
    location: "Where do you need help?", size: "How big is the move?", when: "When do you need help?",
    scope: "What will the movers do?", inventory: "What are we moving?", access: "Any stairs or specialty items?", truck: "Who is providing the truck?",
    destination: "Where are we taking it?", name: "What is your name?", phone: "What number should we call?",
    email: "Would you like to add an email?", review: "Does this plan look right?",
  };
  return <section className="jc-booking-chat" aria-label="Moving request" id="moving-request">
    <div className="jc-chat-paths" aria-label="Choose how to get moving help">
      <button type="button" aria-pressed={a.path === "callback"} onClick={() => choose("callback")} disabled={busy || !!result}><PhoneCall size={21} /><strong>Request a callback</strong><span>Talk through your project.</span></button>
      <button type="button" aria-pressed={a.path === "book"} onClick={() => choose("book")} disabled={busy || !!result}><CalendarClock size={21} /><strong>Pick an available date and time to book movers</strong><span>Check the crew's schedule.</span></button>
    </div>
    {storageWarning && <p role="status">Your browser cannot save this draft. Keep this tab open until you finish.</p>}
    {error && <p className="jc-chat-error" role="alert">{error}</p>}
    {!statusChecked && <button className="jc-chat-secondary" type="button" disabled={busy} onClick={refreshStatus}>Check request status</button>}
    {result ? <div className="jc-chat-result" role="status">
      <h2>{result.kind === "callback" ? "Your callback is requested." : result.status === "confirmed" ? "Your time is confirmed." : "Your booking status"}</h2>
      <p>{result.message}</p>
      {result.startAt && <p>{new Intl.DateTimeFormat("en-US", { timeZone: a.timeZone, dateStyle: "long" }).format(new Date(result.startAt))} · {bookingTimeLabel(result.startAt, "America/Chicago")} / {bookingTimeLabel(result.startAt, "America/Detroit")}</p>}
      {result.expiresAt && ["pending_review", "awaiting_deposit"].includes(result.status) && <p>Hold expires {new Intl.DateTimeFormat("en-US", { timeZone: a.timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(result.expiresAt))} ({a.timeZone === "America/Chicago" ? "Central" : "Eastern"}).</p>}
      {result.kind === "hold" && <p>Payment: {result.paymentState === "paid" ? "Full payment verified" : result.paymentState === "deposit_paid" ? "Deposit received; remaining balance separate" : "No payment verified"}.</p>}
      {result.quoteRevision && <p>Quote revision {result.quoteRevision}{result.customerTotal != null ? ` · $${result.customerTotal.toFixed(2)}` : ""}</p>}
      {result.paymentUrl && <a className="jc-chat-primary" href={result.paymentUrl}>View existing Square deposit request{result.depositAmount != null ? ` · $${result.depositAmount.toFixed(2)}` : ""}</a>}
      <button className="jc-chat-secondary" type="button" disabled={busy} onClick={refreshStatus}>Refresh status</button>
    </div> : a.path && <form onSubmit={next} className="jc-chat-body">
      <p className="jc-chat-caption">{a.path === "callback" ? "Callback request · no deposit" : "Moving request · availability checked before holding"}</p>
      <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2>
      <fieldset disabled={busy}>
        {step === "location" && <label>Service address, including ZIP<input autoComplete="street-address" value={a.address} onChange={e => update("address", e.target.value)} placeholder="Street, city, state, ZIP" /></label>}
        {step === "size" && <><label>Truck size or approximate home size<select value={["pickup_van_10", "15_ft", "20_ft", "26_ft"].includes(a.size) ? a.size : a.size ? "home" : ""} onChange={e => update("size", e.target.value)}><option value="">Choose a size</option><option value="pickup_van_10">Pickup, van or 10-foot truck</option><option value="15_ft">15-foot truck</option><option value="20_ft">20-foot truck</option><option value="26_ft">26-foot truck</option><option value="home">Use home square footage</option></select></label>{(a.size === "home" || Number(a.size) > 0) && <label>Approximate square feet<input type="number" min="1" max="100000" value={a.size === "home" ? "" : a.size} onChange={e => update("size", e.target.value)} /></label>}</>}
        {step === "when" && <>{a.path === "book" ? <label>Service date<input type="date" value={a.date} onChange={e => update("date", e.target.value)} /></label> : <label>Timing preference (optional)<input value={a.when} onChange={e => update("when", e.target.value)} placeholder="This week, next month, or let's discuss" /></label>}<label>Show times in<select value={a.timeZone} onChange={e => update("timeZone", e.target.value as BookingTimeZone)}><option value="America/Chicago">Central · Ironwood / Hurley</option><option value="America/Detroit">Eastern · eastern Upper Peninsula</option></select></label><p>Available slots show both Central and Eastern. The service date follows the crew's Central calendar.</p></>}
        {step === "scope" && <label>Service scope<select value={a.scope} onChange={e => update("scope", e.target.value as Answer["scope"])}><option value="load">Loading only</option><option value="unload">Unloading only</option><option value="load_unload">Loading and unloading</option><option value="move">Moving between addresses</option></select></label>}
        {step === "inventory" && <label>Main items, stairs and heavy items<textarea rows={3} value={a.inventory} onChange={e => update("inventory", e.target.value)} placeholder="For example: boxes, sofa, bed, one flight of stairs. Include any piano, safe or other heavy item." /></label>}
        {step === "access" && <label>Access and heavy items<select value={a.access} onChange={e => update("access", e.target.value as Answer["access"])}><option value="unknown">Not sure — please review</option><option value="standard">Ground floor, standard furniture and boxes</option><option value="stairs">Stairs or difficult access</option><option value="special">Piano, safe, hot tub or other specialty item</option></select></label>}
        {step === "truck" && <label>Truck provider<select value={a.truckSource} onChange={e => update("truckSource", e.target.value as Answer["truckSource"])}><option value="customer">My truck</option><option value="rental">A rental truck</option><option value="jc_on_the_move">JC ON THE MOVE</option><option value="none">No truck / let's discuss</option></select></label>}
        {step === "destination" && <label>Destination address<input value={a.destination} onChange={e => update("destination", e.target.value)} /></label>}
        {step === "name" && <label>Your name<input autoComplete="name" value={a.name} onChange={e => update("name", e.target.value)} /></label>}
        {step === "phone" && <label>Phone number<input type="tel" autoComplete="tel" value={a.phone} onChange={e => update("phone", e.target.value)} /></label>}
        {step === "email" && <label>Email (optional)<input type="email" autoComplete="email" value={a.email} onChange={e => update("email", e.target.value)} /></label>}
        {step === "review" && recommendation && <>
          <dl className="jc-chat-summary"><dt>Location</dt><dd>{a.address}{a.scope === "move" && ` → ${a.destination}`}</dd><dt>Move size</dt><dd>{recommendation.basis}</dd><dt>Scope & inventory</dt><dd>{a.scope.replaceAll("_", " ")} · {a.inventory} · Access: {a.access}</dd><dt>Truck</dt><dd>{a.truckSource.replaceAll("_", " ")}</dd><dt>Timing</dt><dd>{a.path === "book" ? `${a.date} · ${a.timeZone === "America/Chicago" ? "Central" : "Eastern"} display` : a.when || "Discuss by phone"}</dd><dt>Contact</dt><dd>{a.name} · {a.phone}{a.email && ` · ${a.email}`}</dd></dl>
          <div className="jc-chat-recommendation"><strong>Suggested: {recommendation.crewSize} movers · {recommendation.minimumHours}–{recommendation.maximumHours} hours</strong><p>{recommendation.explanation}</p></div>
          <label className="jc-chat-checkbox"><input type="checkbox" checked={a.custom} onChange={e => { const checked = e.target.checked; generation.current++; setDraft(d => ({ ...d, answers: { ...d.answers, custom: checked, crew: recommendation.crewSize, hours: String(recommendation.maximumHours) } })); setQuote(null); setSlot(null); setSlots([]); setTerms(false); }} />Choose a different crew or duration for review</label>
          {a.custom && <><label>Selected movers<select value={a.crew} onChange={e => update("crew", Number(e.target.value) as 2 | 3 | 4)}>{[2, 3, 4].map(n => <option key={n} value={n}>{n} movers</option>)}</select></label><label>Selected hours<input type="number" min="1" max="12" step="0.5" value={a.hours} onChange={e => update("hours", e.target.value)} /></label><label>Reason for the change<input value={a.overrideReason} onChange={e => update("overrideReason", e.target.value)} /></label></>}
          <p>Selected plan: {recommendation.selectedCrewSize} movers · {recommendation.selectedHours} hours. {recommendation.overridden && "The team must review your change."}</p>
          {a.path === "callback" ? <button type="button" className="jc-chat-primary" disabled={!statusChecked} onClick={submit}>Request my callback <ArrowRight size={18} /></button> : <>
            <button type="button" className="jc-chat-primary" onClick={check}>Check estimate & real availability</button>
            {quote && <div className="jc-chat-availability"><h3>{quote.estimateLabel}</h3><p>{quote.crewSize} movers · {quote.requestedHours} hours. {quote.autoBookEligible ? "Existing 30% scheduling deposit applies after approval." : "Team review required before any deposit request."}</p>
              {slots.length ? <><p>Choose a start time. Checking availability does not reserve it.</p><div className="jc-chat-slots">{slots.map(s => <button type="button" aria-pressed={slot?.time === s.time} key={s.time} onClick={() => { setSlot(s); setTerms(false); }}><strong>{a.timeZone === "America/Chicago" ? s.centralLabel : s.easternLabel}</strong><span>{a.timeZone === "America/Chicago" ? s.easternLabel : s.centralLabel}</span></button>)}</div>{slot && <p>Review: {a.date} at {slot.centralLabel} / {slot.easternLabel}, {quote.crewSize} movers, {quote.requestedHours} hours.</p>}<label className="jc-chat-checkbox"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} /><span>I reviewed this plan and accept the <a href="/terms" target="_blank" rel="noreferrer">service terms and cancellation policy</a>.</span></label><button type="button" className="jc-chat-primary" disabled={!slot || !terms || !statusChecked} onClick={submit}>{quote.autoBookEligible ? "Hold this time & request deposit link" : "Hold this time for team review"}</button><p>No payment is taken by this button. A hold is not a confirmed booking.</p></> : <><p>No online crew capacity is available for this date and duration.</p><button type="button" className="jc-chat-secondary" onClick={() => choose("callback")}>Use my answers to request a callback</button></>}
            </div>}
          </>}
        </>}
        <div className="jc-chat-navigation"><button type="button" className="jc-chat-secondary" disabled={draft.step === 0} onClick={() => go(draft.step - (step === "name" && a.scope !== "move" ? 2 : 1))}><ArrowLeft size={16} /> Back</button>{step !== "review" && <button type="submit" className="jc-chat-primary">Continue <ArrowRight size={16} /></button>}{step === "review" && <button type="button" className="jc-chat-secondary" onClick={() => go(0)}>Edit answers</button>}</div>
      </fieldset>
      {busy && <p role="status">Checking and saving your request…</p>}
    </form>}
  </section>;
}
