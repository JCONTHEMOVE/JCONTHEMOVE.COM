import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { LEAD_BOT_QUESTIONS, LEAD_BOT_SERVICES, leadBotAnswersSchema, inquiryQualification, type LeadBotPublic } from "@shared/leadBotPilot";
import "./lead-bot.css";

async function request(path: string, body?: unknown) {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}
const empty = { serviceAddress: "", city: "", state: "MI", zip: "", scope: "", timing: "", timeZone: "America/Chicago", firstName: "", lastName: "", email: "", phone: "", answers: {} as Record<string, string>, consent: false };
type Draft = typeof empty;
function readDraft(key: string): { draft: Draft; submissionKey: string; visitorId: string } {
  try { const saved = JSON.parse(sessionStorage.getItem(key) || "null"); if (saved?.draft && saved.submissionKey && saved.visitorId) return saved; } catch { /* storage unavailable */ }
  return { draft: { ...empty, answers: {} }, submissionKey: crypto.randomUUID(), visitorId: crypto.randomUUID() };
}
export default function LeadBotPage() {
  const [, params] = useRoute("/lead-bot/:id");
  const [bot, setBot] = useState<LeadBotPublic | null>(null);
  const [error, setError] = useState("");
  const preview = new URLSearchParams(window.location.search).get("preview") === "1";
  useEffect(() => {
    let current = true;
    setBot(null); setError("");
    request(preview ? `/api/admin/marketing-bot/lead-bot-pilot/${params?.id}/preview` : `/api/lead-bots/${params?.id}`)
      .then(value => { if (current) setBot(value); }).catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [params?.id, preview]);
  return <main className="lead-bot"><div className="lead-bot-wrap">
    <a className="lead-bot-brand" href="/">JC <span>ON THE MOVE</span> <small>LLC</small></a>
    {bot ? <LeadBotConversation key={`${bot.id}:${bot.revision}:${preview}`} bot={bot} /> : <section className="lead-bot-card"><h1>Let’s talk about your project.</h1><p role={error ? "alert" : "status"}>{error || "Opening your request…"}</p>{error && <a href="/">Visit JC ON THE MOVE</a>}</section>}
    <footer>JC ON THE MOVE LLC · Northwoods moving &amp; project help</footer>
  </div></main>;
}

export function LeadBotConversation({ bot }: { bot: LeadBotPublic }) {
  const storageKey = `jc-lead-bot:${bot.id}:${bot.revision}:${bot.preview ? "preview" : "public"}`;
  const [saved] = useState(() => readDraft(storageKey));
  const [draft, setDraft] = useState<Draft>(saved.draft);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = ["location", "scope", "timing", ...bot.questions, "contact", "review"];
  const current = steps[step];
  const titles: Record<string, string> = { location: "Where can we help?", scope: "What would you like done?", timing: "When are you hoping for help?", ...LEAD_BOT_QUESTIONS, contact: "How can our team reach you?", review: "Does everything look right?" };
  useEffect(() => { heading.current?.focus(); setError(""); }, [step]);
  useEffect(() => {
    if (done) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, draft })); } catch { /* in-memory answers still work */ }
  }, [draft, storageKey, saved, done]);
  useEffect(() => {
    if (!bot.preview) void request(`/api/lead-bots/${bot.id}/visit`, { visitorId: saved.visitorId }).catch(() => {});
  }, [bot.id, bot.preview, saved.visitorId]);
  const change = (key: keyof Draft, value: any) => setDraft(valueBefore => ({ ...valueBefore, [key]: value }));
  const input = (label: string, key: keyof Omit<Draft, "answers" | "consent">, type = "text", maxLength = 300, autoComplete?: string) => <label>{label}<input type={type} value={String(draft[key])} onChange={e => change(key, e.target.value)} required maxLength={maxLength} autoComplete={autoComplete} /></label>;
  async function next() {
    setError("");
    const validation = leadBotAnswersSchema.safeParse(draft);
    const fields = current === "location" ? ["serviceAddress", "city", "state", "zip"] : current === "scope" ? ["scope"] : current === "timing" ? ["timing", "timeZone"] : current === "contact" ? ["firstName", "lastName", "email", "phone"] : [];
    if (!validation.success) {
      const issue = validation.error.issues.find(i => current === "review" || fields.includes(String(i.path[0])));
      if (issue) { setError(issue.message); return; }
    }
    if (bot.questions.includes(current as keyof typeof LEAD_BOT_QUESTIONS) && !draft.answers[current]?.trim()) { setError("Please answer this question. You can say ‘not sure’."); return; }
    if (current === "location" && !bot.towns.some(t => t.city.toLowerCase() === draft.city.trim().toLowerCase() && t.state === draft.state)) { setError("Choose one of the towns covered by this campaign, or contact the main office for another location."); return; }
    if (current !== "review") { setStep(step + 1); return; }
    if (!validation.success) return;
    const issue = inquiryQualification({ ...bot, representativeId: "", campaignId: "", variantId: "", promotionId: null }, validation.data);
    if (issue) { setError(issue); return; }
    setBusy(true);
    try {
      if (!bot.preview) await request("/api/leads/quick-request", { leadBotId: bot.id, revision: bot.revision, submissionKey: saved.submissionKey, visitorId: saved.visitorId, inquiry: validation.data });
      setDone(true);
      try { sessionStorage.removeItem(storageKey); } catch { /* optional storage */ }
    } catch (err) { setError(err instanceof Error ? err.message : "We could not save this request. Please retry."); }
    finally { setBusy(false); }
  }
  if (done) return <section className="lead-bot-card" role="status"><p className="lead-bot-kicker">{bot.preview ? "OWNER PREVIEW" : "REQUEST RECEIVED"}</p><h1>{bot.preview ? "Preview complete." : "Thanks. Your inquiry is with our team."}</h1><p>{bot.preview ? "Nothing was submitted and no lead was created." : "Your project details and representative credit were saved for owner review. Your date and price still need confirmation."}</p><a href="/">Back to JC ON THE MOVE</a></section>;
  return <>
    <div className="lead-bot-intro"><p className="lead-bot-kicker">{LEAD_BOT_SERVICES[bot.service].label} · {bot.representative}</p><h1>A little detail.<br /><span>A good start.</span></h1><p>Tell us about your project. We’ll review the scope, location and timing before confirming a quote.</p></div>
    {bot.preview && <p className="lead-bot-preview" role="status">Owner preview · Your answers stay in this preview. Nothing is sent.</p>}
    <section className="lead-bot-card">
      <div className="lead-bot-progress"><span>Step {step + 1} of {steps.length}</span><span>{Math.round((step + 1) / steps.length * 100)}%</span></div>
      <progress aria-label="Conversation progress" value={step + 1} max={steps.length} />
      <h2 ref={heading} tabIndex={-1}>{titles[current]}</h2>
      <form onSubmit={event => { event.preventDefault(); if (!busy) void next(); }}>
        {current === "location" && <><p className="lead-bot-hint">For projects in {bot.towns.map(t => `${t.city}, ${t.state}`).join(" · ")}</p>{input("Street address", "serviceAddress", "text", 300, "street-address")}
          <label>Town<select value={`${draft.city}|${draft.state}`} required onChange={e => { const [city, state] = e.target.value.split("|"); setDraft(d => ({ ...d, city, state })); }}><option value={`|${draft.state}`}>Choose your town</option>{bot.towns.map(t => <option key={`${t.city}|${t.state}`} value={`${t.city}|${t.state}`}>{t.city}, {t.state}</option>)}</select></label>{input("ZIP code", "zip", "text", 10, "postal-code")}</>}
        {current === "scope" && <label>Describe the project<textarea value={draft.scope} onChange={e => change("scope", e.target.value)} required minLength={10} maxLength={1000} placeholder="What needs moving, removing or working on?" /></label>}
        {current === "timing" && <>{input("Preferred day, time or flexibility", "timing", "text", 200)}<label>Your time zone<select value={draft.timeZone} onChange={e => change("timeZone", e.target.value)}><option value="America/Chicago">Central time</option><option value="America/Detroit">Eastern time</option></select></label><p className="lead-bot-hint">This is a preference. The team will confirm availability with you.</p></>}
        {bot.questions.includes(current as keyof typeof LEAD_BOT_QUESTIONS) && <label>Your answer<textarea value={draft.answers[current] || ""} onChange={e => change("answers", { ...draft.answers, [current]: e.target.value })} required maxLength={200} placeholder="A short answer is fine. “Not sure” is okay." /></label>}
        {current === "contact" && <>{input("First name", "firstName", "text", 80, "given-name")}{input("Last name", "lastName", "text", 80, "family-name")}{input("Phone number", "phone", "tel", 40, "tel")}{input("Email", "email", "email", 255, "email")}<p className="lead-bot-hint">For this inquiry only. This does not sign you up for marketing texts.</p></>}
        {current === "review" && <><dl className="lead-bot-review"><dt>Service</dt><dd>{LEAD_BOT_SERVICES[bot.service].label}</dd><dt>Location</dt><dd>{draft.serviceAddress}, {draft.city}, {draft.state} {draft.zip}</dd><dt>Project</dt><dd>{draft.scope}</dd><dt>Preferred timing</dt><dd>{draft.timing} · {draft.timeZone === "America/Chicago" ? "Central" : "Eastern"}</dd>{bot.questions.map(q => <div key={q}><dt>{LEAD_BOT_QUESTIONS[q]}</dt><dd>{draft.answers[q]}</dd></div>)}<dt>Contact</dt><dd>{draft.firstName} {draft.lastName}<br />{draft.phone}<br />{draft.email}</dd><dt>Representative</dt><dd>{bot.representative}</dd></dl>
          {bot.promotion && <p className="lead-bot-offer">Code {bot.promotion.code}: {bot.promotion.description}<small>Eligibility and final pricing are confirmed by the team. No discount is applied by this form.</small></p>}
          <label className="lead-bot-check"><input type="checkbox" checked={draft.consent} onChange={e => change("consent", e.target.checked)} required /><span>I’m requesting a review of this project. I understand this does not reserve a time or confirm a price.</span></label></>}
        {error && <p className="lead-bot-error" role="alert">{error}</p>}
        <div className="lead-bot-actions">{step > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}<button type="submit" disabled={busy}>{busy ? "Saving…" : current === "review" ? bot.preview ? "Finish preview" : "Send inquiry" : "Continue"}</button></div>
      </form>
    </section>
  </>;
}
