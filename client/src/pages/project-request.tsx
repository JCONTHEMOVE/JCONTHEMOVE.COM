import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, CheckCircle2, Hammer, Leaf, Package, Paintbrush, Snowflake, Sparkles, Truck, Upload, Users } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public-site-shell";
import { ProjectAddressField, type ProjectAddress } from "@/components/project-address-field";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { PROJECT_SERVICES, EXTRA_SERVICE_CODES, centralDateTime, projectEntry, projectScheduleError, projectScheduleLabel, projectServiceLabel } from "@shared/projectRequest";
import { JOB_SCHEDULE_OPTIONS } from "@shared/jcOperations";
import { phoneError } from "@shared/phone";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

type Photo = { name: string; type: string; mimeType: string; size: number; url: string };
type SavedRequest = { id: string; displayOrderNumber: string; serviceLabel: string };
const icons: Record<string, typeof Truck> = { moving: Truck, delivery: Package, junk_removal: Package, labor: Users, painting: Paintbrush, lawn_care: Leaf, snow_removal: Snowflake, cleaning: Sparkles };
const primaryCodes = ["moving", "delivery", "junk_removal", "labor", "handyman", "lawn_care"];

export default function ProjectRequestPage() {
  const { user } = useAuth();
  const [entry] = useState(() => projectEntry(window.location.search, document.referrer));
  const [step, setStep] = useState(0);
  const [serviceCode, setService] = useState(entry.serviceCode);
  const [additionalServices, setAdditional] = useState<string[]>(entry.additionalServices);
  const [showAll, setShowAll] = useState(!primaryCodes.includes(entry.serviceCode));
  const [address, setAddress] = useState<ProjectAddress>({ street: entry.address, city: "", state: "", zip: "" });
  const [destination, setDestination] = useState("");
  const [callback, setCallback] = useState(false);
  const [date, setDate] = useState(entry.date);
  const [time, setTime] = useState("");
  const [contact, setContact] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [readingPhotos, setReadingPhotos] = useState(false);
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<SavedRequest | null>(null);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const canHaveDestination = serviceCode === "moving" || serviceCode === "delivery";
  const preference = callback ? "callback" : "preferred_time";
  const schedule = { schedulingPreference: preference as "callback" | "preferred_time", preferredDate: callback ? undefined : date, preferredStartTime: callback ? undefined : time };
  const fullAddress = [address.street.trim(), address.city.trim(), address.state.trim(), address.zip.trim()].filter(Boolean).join(", ");
  const extras = additionalServices.filter(code => code !== serviceCode);
  const visibleServices = PROJECT_SERVICES.filter(service => showAll || primaryCodes.includes(service.code));
  const detailedParams = new URLSearchParams(window.location.search);
  detailedParams.set("mode", "builder");
  useEffect(() => {
    if (user) setContact(current => ({ firstName: current.firstName || user.firstName || "", lastName: current.lastName || user.lastName || "", phone: current.phone || user.phoneNumber || "", email: current.email || (user.email?.endsWith(".local") ? "" : user.email) || "" }));
  }, [user?.id]);
  function goTo(next: number) { setError(""); setStep(next); window.scrollTo({ top: 0, behavior: "smooth" }); requestAnimationFrame(() => heading.current?.focus()); }
  function validateLocation() {
    if (address.street.trim().length < 3 || !address.city.trim() || !/^[A-Za-z]{2}$/.test(address.state) || !/^\d{5}(?:-\d{4})?$/.test(address.zip)) return "Enter the street address, city, two-letter state and ZIP code.";
    return projectScheduleError(preference, date, time);
  }
  async function readPhotos(files: FileList | null) {
    if (!files?.length) return;
    setPhotoError("");
    const selected = Array.from(files);
    if (photos.length + selected.length > 5 || [...photos, ...selected].reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024 || selected.some(file => file.size > 3 * 1024 * 1024 || !/^image\/(jpeg|png|webp|gif)$/.test(file.type))) {
      setPhotoError("Choose up to 5 JPG, PNG, WebP or GIF photos: 3 MB each, 10 MB total.");
      return;
    }
    setReadingPhotos(true);
    try {
      const added = await Promise.all(selected.map(file => new Promise<Photo>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, size: file.size, type: file.type, mimeType: file.type, url: String(reader.result) });
        reader.onerror = () => reject(new Error("A photo could not be read. Try adding it again."));
        reader.readAsDataURL(file);
      })));
      setPhotos(current => [...current, ...added]);
    } catch { setPhotoError("A photo could not be read. Try adding it again, or continue without it."); }
    finally { setReadingPhotos(false); }
  }
  async function submit() {
    if (submitting.current) return;
    const locationError = validateLocation();
    if (locationError) { setStep(1); setError(locationError); return; }
    if (!contact.firstName.trim() || !contact.lastName.trim()) { setError("Enter your first and last name."); return; }
    const invalidPhone = phoneError(contact.phone);
    if (invalidPhone) { setError(invalidPhone); return; }
    if (contact.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) { setError("Enter a valid email address, or leave it blank."); return; }
    submitting.current = true;
    setPending(true); setError("");
    try {
      const response = await apiRequest("POST", "/api/leads/quick-request", {
        requestType: "project", ...contact, email: contact.email.trim() || undefined, serviceCode, additionalServices: extras,
        serviceAddress: fullAddress, city: address.city.trim(), state: address.state.trim(), zip: address.zip.trim(),
        destinationAddress: canHaveDestination ? destination.trim() : "", ...schedule, notes, photos, ...entry.attribution,
      });
      const data = await response.json();
      if (!data.success || !data.lead?.displayOrderNumber) throw new Error("The request could not be confirmed.");
      setSaved(data.lead); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (failure) {
      let message = "We couldn't confirm your request. Your details are still here. Please try again or call (906) 285-9312.";
      const raw = failure instanceof Error ? failure.message : "";
      try { const result = JSON.parse(raw.slice(raw.indexOf("{"))); if (result.errorCode === "RATE_LIMITED" || raw.startsWith("429")) message = "Please wait a few minutes before trying again, or call (906) 285-9312."; } catch {}
      setError(message);
    } finally { setPending(false); submitting.current = false; }
  }
  return <div className="jc-public"><PublicHeader booking /><main className="jc-container jc-request">
    {saved ? <section className="jc-request-card jc-success" aria-live="polite"><CheckCircle2 size={48} /><p className="jc-eyebrow" style={{ justifyContent: "center" }}>REQUEST {saved.displayOrderNumber}</p><h1>You're on our list.</h1><p>Thanks, {contact.firstName}. Your request is saved.<br />Our team will call to confirm your project, price and schedule.</p><div className="jc-form-summary"><strong>{projectServiceLabel(serviceCode)}</strong><p>{fullAddress}</p>{canHaveDestination && destination && <p>To: {destination}</p>}<p>{projectScheduleLabel(schedule)}</p>{extras.length > 0 && <p>Also interested in: {extras.map(projectServiceLabel).join(", ")}</p>}<p><strong>Staff confirmation pending.</strong> Your time is not reserved yet.</p></div><Link className="jc-button" href="/home">Back to home <ArrowRight size={17} /></Link><p className="jc-request-note"><Link href="/handmade-jewels-by-ashley">Visit Ashley's jewelry shop</Link> · <Link href="/rewards">Explore rewards</Link></p></section> : <>
      <div className="jc-request-title"><p className="jc-eyebrow">A LITTLE HELP STARTS HERE</p><h1>What can we help you with?</h1><p>A simple request. A real person to take it from here.</p></div>
      <ol className="jc-progress" aria-label="Request progress">{["Your project", "Where & when", "Contact & send"].map((name, index) => <li key={name} className={index <= step ? "is-active" : ""} aria-current={step === index ? "step" : undefined}><span>0{index + 1}</span>{name}</li>)}</ol>
      <form className="jc-request-card" noValidate onSubmit={event => { event.preventDefault(); if (step === 2) void submit(); else { const problem = step === 1 ? validateLocation() : null; if (problem) setError(problem); else goTo(step + 1); } }}>
        {step === 0 && <><h2 ref={heading} tabIndex={-1}>Start with the main thing.</h2><p className="jc-form-help">Choose the help you came for. We'll work out the details together.</p>
          <div className="jc-project-grid" role="group" aria-label="Main service">{visibleServices.map(service => { const Icon = icons[service.code] || Hammer; return <button type="button" key={service.code} className={`jc-project-option ${serviceCode === service.code ? "is-selected" : ""}`} aria-pressed={serviceCode === service.code} onClick={() => setService(service.code)}><Icon size={22} /><strong>{service.label}</strong><small>{service.hint}</small></button>; })}</div>
          <button type="button" className="jc-address-manual" style={{ marginTop: 12 }} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer services" : "More services & something else"}</button>
          <fieldset className="jc-extra-services"><legend>Anything else while we're there? <span>Optional</span></legend><div className="jc-chip-row">{[...new Set([...EXTRA_SERVICE_CODES, ...extras])].filter(code => code !== serviceCode).map(code => <label key={code} className="jc-chip"><input type="checkbox" checked={extras.includes(code)} onChange={event => setAdditional(current => event.target.checked ? [...current, code] : current.filter(item => item !== code))} />{projectServiceLabel(code)}</label>)}</div></fieldset>
          <details className="jc-optional"><summary>Add a note or photos <span className="jc-form-help">(optional)</span></summary><label className="jc-field" style={{ marginTop: 16 }}>Anything you'd like us to know?<textarea value={notes} maxLength={2500} onChange={event => setNotes(event.target.value)} placeholder="A few items to move, a room to paint…" /></label><label className="jc-field"><span><Upload size={14} style={{ display: "inline" }} /> Project photos · up to 5, 3 MB each</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={readingPhotos} onChange={event => { void readPhotos(event.target.files); event.target.value = ""; }} /></label>{readingPhotos && <p role="status">Adding photos…</p>}{photoError && <p className="jc-error" role="alert">{photoError}</p>}<ul className="jc-file-list">{photos.map((photo, index) => <li key={index}>{photo.name}<button type="button" aria-label={`Remove ${photo.name}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>Remove</button></li>)}</ul></details>
        </>}
        {step === 1 && <><h2 ref={heading} tabIndex={-1}>Where do you need us?</h2><p className="jc-form-help">Add your exact project address. An apartment or unit number helps.</p><ProjectAddressField value={address} onChange={setAddress} />{canHaveDestination && <label className="jc-field">Destination address (optional)<PlacesAutocomplete value={destination} maxLength={500} onChange={setDestination} placeholder="If you know where it's going" /></label>}
          <h2 style={{ marginTop: 26 }}>When works for you?</h2><p className="jc-form-help">Choose a preferred arrival window. We'll confirm availability with you.</p><label className="jc-callback"><input type="checkbox" checked={callback} onChange={event => { setCallback(event.target.checked); setError(""); }} />Have a representative call me to schedule.</label>
          {!callback && <div className="jc-field-row"><label className="jc-field">Preferred date<input type="date" min={centralDateTime().date} value={date} onChange={event => { setDate(event.target.value); setTime(""); }} /></label><label className="jc-field">Arrival window · Central<select value={time} onChange={event => setTime(event.target.value)}><option value="">Choose a time</option>{JOB_SCHEDULE_OPTIONS.filter(option => option.start).map(option => <option key={option.start} value={option.start!} disabled={!!date && !!projectScheduleError("preferred_time", date, option.start!)}>{option.label}</option>)}</select></label></div>}
        </>}
        {step === 2 && <><h2 ref={heading} tabIndex={-1}>Let's make it happen.</h2><p className="jc-form-help">Who should we call about this project?</p><div className="jc-field-row"><label className="jc-field">First name<input autoComplete="given-name" maxLength={80} value={contact.firstName} onChange={event => setContact({ ...contact, firstName: event.target.value })} /></label><label className="jc-field">Last name<input autoComplete="family-name" maxLength={80} value={contact.lastName} onChange={event => setContact({ ...contact, lastName: event.target.value })} /></label></div><label className="jc-field">Phone number<input type="tel" autoComplete="tel" value={contact.phone} onChange={event => setContact({ ...contact, phone: event.target.value })} placeholder="(906) 555-0123" /></label><label className="jc-field">Email (optional)<input type="email" autoComplete="email" maxLength={255} value={contact.email} onChange={event => setContact({ ...contact, email: event.target.value })} /></label>
          <div className="jc-form-summary"><div><div><strong>{projectServiceLabel(serviceCode)}</strong>{extras.length > 0 && <p>Also: {extras.map(projectServiceLabel).join(", ")}</p>}{notes && <p>{notes}</p>}{photos.length > 0 && <p>{photos.length} photo{photos.length === 1 ? "" : "s"} attached</p>}</div><button type="button" onClick={() => goTo(0)} aria-label="Edit project">Edit</button></div><div><div><strong>{fullAddress}</strong>{canHaveDestination && destination && <p>To: {destination}</p>}<p>{projectScheduleLabel(schedule)}</p></div><button type="button" onClick={() => goTo(1)} aria-label="Edit address and time">Edit</button></div></div>
          <p className="jc-form-help">We'll call about this request. Your project, price and schedule are confirmed with our team before work begins.</p>
        </>}
        {error && <p className="jc-error" role="alert">{error}</p>}
        <div className="jc-request-actions">{step > 0 ? <button type="button" className="jc-back" onClick={() => goTo(step - 1)} disabled={pending}><ArrowLeft size={16} /> Back</button> : <span className="jc-form-help" style={{ margin: 0, fontSize: 11 }}>No account needed.</span>}<button type="submit" className="jc-button" disabled={pending || readingPhotos}>{pending ? "Sending request…" : step === 2 ? "Send my request" : "Continue"}<ArrowRight size={17} /></button></div>
      </form><p className="jc-request-note">Prefer to talk? <a href="tel:+19062859312">(906) 285-9312</a> · <Link href={`/book?${detailedParams.toString()}`}>Build a detailed quote</Link></p>
    </>}
  </main><PublicFooter /></div>;
}
