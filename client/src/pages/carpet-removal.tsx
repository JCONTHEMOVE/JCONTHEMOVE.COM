import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Loader2, Phone, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HOME_PROJECT_CAMPAIGN, HOME_PROJECT_SERVICES, captureHomeProjectReferral, homeProjectRequestSchema, type HomeProjectRequest } from "@shared/homeProjectCampaign";

const media = "/campaigns/carpet-removal";
type SavedRequest = { displayOrderNumber: string; repName: string | null; photoCount: number };
async function preparePhoto(file: File): Promise<HomeProjectRequest["photos"][number]> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error("Choose JPG, PNG or WebP photos under 20 MB each.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not read " + file.name)); image.src = url; });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Photo upload is unavailable in this browser. You can still request a quote without photos.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.82);
    const size = Math.ceil((data.split(",")[1]?.length || 0) * 3 / 4);
    if (size > 3 * 1024 * 1024) throw new Error("That photo is too large. Please choose a smaller photo.");
    return { name: file.name.slice(0, 250), mimeType: "image/jpeg", size, url: data };
  } finally { URL.revokeObjectURL(url); }
}
export default function CarpetRemovalPage() {
  const [referral] = useState(() => {
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(HOME_PROJECT_CAMPAIGN.storageKey) || "null"); } catch { /* Storage can be disabled. */ }
    return captureHomeProjectReferral(window.location.search, stored);
  });
  useEffect(() => {
    try { localStorage.setItem(HOME_PROJECT_CAMPAIGN.storageKey, JSON.stringify(referral)); } catch { /* URL attribution still works. */ }
    const oldTitle = document.title;
    document.title = "Carpet Removal & Light Demolition | JC ON THE MOVE LLC";
    return () => { document.title = oldTitle; };
  }, [referral]);
  const rep = useQuery<{ displayName: string; brandName: string }>({
    queryKey: ["/api/marketing-network/reps/" + encodeURIComponent(referral.repSlug || "")], enabled: !!referral.repSlug, retry: 1,
  });
  const [requestId] = useState(() => crypto.randomUUID());
  const [projectType, setProjectType] = useState<HomeProjectRequest["projectType"]>("carpet_removal");
  const [haulAway, setHaulAway] = useState(true);
  const [furnitureHelp, setFurnitureHelp] = useState(false);
  const [photos, setPhotos] = useState<HomeProjectRequest["photos"]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedRequest | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || uploading) return;
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) || "").trim();
    const parsed = homeProjectRequestSchema.safeParse({
      requestId, firstName: value("firstName"), lastName: value("lastName"), email: value("email"), phone: value("phone"),
      projectType, address: value("address"), zip: value("zip"), scope: value("scope"),
      squareFootage: value("squareFootage") ? Number(value("squareFootage")) : undefined,
      preferredDeadline: value("preferredDeadline") || undefined, accessNotes: value("accessNotes"),
      haulAway, furnitureHelp, photos, repSlug: referral.repSlug, tracking: referral.tracking,
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the form."); return; }
    setSending(true); setError("");
    try {
      const response = await fetch("/api/home-projects", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok || !result.success || !result.lead?.displayOrderNumber) throw new Error(result.error || "We could not save your project. Please try again.");
      setSaved(result.lead);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Connection lost. Your details are still here. Please retry."); }
    finally { setSending(false); }
  }
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length + files.length > 5) { setError("You can add up to five photos."); return; }
    setUploading(true); setError("");
    try {
      const prepared: HomeProjectRequest["photos"] = [];
      for (const file of Array.from(files)) prepared.push(await preparePhoto(file));
      setPhotos(current => [...current, ...prepared]);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "We could not prepare the photos."); }
    finally { setUploading(false); }
  }
  return <main className="min-h-screen bg-[#102d25] text-white">
    <header className="border-b border-white/15">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
        <Link href="/" className="text-lg font-black tracking-tight text-[#f0cf83]">JC ON THE MOVE LLC</Link>
        <a className="inline-flex items-center gap-2 text-sm font-bold" href="tel:+19062859312"><Phone className="h-4 w-4" />(906) 285-9312</a>
      </div>
    </header>
    <section className="mx-auto grid max-w-6xl items-center gap-9 px-5 py-10 md:grid-cols-[1fr_0.85fr] md:py-16">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-[#f0cf83]">Helping Hands for your home</p>
        <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">Carpet removal &amp; light demolition</h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">Old carpet, flooring prep, or a small tear-out project? Show us the work and tell us your deadline. We’ll review the scope and get you a project quote.</p>
        <p className="mt-4 text-base text-white/80">Planning for Thanksgiving or the holidays? Include your preferred completion date so we can check the schedule.</p>
        <Button asChild className="mt-7 h-auto min-h-12 whitespace-normal bg-[#f0cf83] px-6 py-3 text-base font-bold text-[#102d25] hover:bg-[#ffe1a0]"><a href="#project-quote">Request my project quote <ArrowRight className="ml-2 h-5 w-5 shrink-0" /></a></Button>
        {rep.data && <p className="mt-5 text-base text-[#f0cf83]">Referred by {rep.data.displayName} with JC ON THE MOVE LLC</p>}
        <p className="mt-8 text-sm leading-relaxed text-white/65">Serving Ironwood and the surrounding Northwoods. Scope, travel, pricing and availability are confirmed after review. Nonstructural work only; hazardous-material removal is outside this service.</p>
      </div>
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl">
        <video className="aspect-[4/5] w-full" controls playsInline muted preload="metadata" poster={media + "/crew.jpg"} aria-label="JC ON THE MOVE LLC carpet removal slideshow">
          <source src={media + "/slideshow.mp4"} type="video/mp4" />Your browser does not support video. <a href={media + "/slideshow.mp4"}>Watch the carpet removal slideshow.</a>
        </video>
      </div>
    </section>
    <section id="project-quote" className="scroll-mt-6 bg-slate-50 px-5 py-12 text-slate-950">
      <div className="mx-auto max-w-3xl">
        {saved ? <div role="status" className="rounded-xl border border-emerald-200 bg-white p-7 shadow-sm">
          <CheckCircle2 className="h-10 w-10 text-emerald-700" />
          <h2 className="mt-4 text-3xl font-black">Your project request is saved</h2>
          <p className="mt-4 text-lg">Request <strong>{saved.displayOrderNumber}</strong> is in our quote queue. We’ll review the details and contact you about the next step.</p>
          <p className="mt-3">{saved.photoCount} photo{saved.photoCount === 1 ? "" : "s"} attached.{saved.repName ? " Referral credit recorded for " + saved.repName + "." : ""}</p>
          <p className="mt-4 text-sm text-slate-600">This is a quote request. Your price and completion date still need confirmation.</p>
          <Link href="/" className="mt-6 inline-block font-bold text-emerald-800 underline">Back to JC ON THE MOVE</Link>
        </div> : <>
          <h2 className="text-3xl font-black">Tell us about your project</h2>
          <p className="mt-3 text-base text-slate-600">Photos help us understand the work. No payment is required to request a quote.</p>
          {referral.repSlug && rep.isError && <div role="alert" className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">We couldn’t verify your referral link. Please retry or call us so the right person gets credit. <button type="button" className="font-bold underline" onClick={() => rep.refetch()}>Retry</button></div>}
          <form className="mt-7 space-y-6" onSubmit={submit}>
            <div><Label htmlFor="projectType">What do you need?</Label><select id="projectType" value={projectType} onChange={event => setProjectType(event.target.value as HomeProjectRequest["projectType"])} className="mt-2 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950">{Object.entries(HOME_PROJECT_SERVICES).map(([value, service]) => <option key={value} value={value}>{service.label}</option>)}</select></div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div><Label htmlFor="firstName">First name</Label><Input id="firstName" name="firstName" autoComplete="given-name" required maxLength={80} className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="lastName">Last name</Label><Input id="lastName" name="lastName" autoComplete="family-name" required maxLength={80} className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="email">Email (optional)</Label><Input id="email" name="email" type="email" autoComplete="email" maxLength={255} className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="address">Project address or city</Label><Input id="address" name="address" autoComplete="street-address" required maxLength={500} className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="zip">Project ZIP code</Label><Input id="zip" name="zip" autoComplete="postal-code" inputMode="numeric" required pattern="[0-9]{5}(-[0-9]{4})?" className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="squareFootage">Approximate square footage (optional)</Label><Input id="squareFootage" name="squareFootage" type="number" min="1" max="100000" className="mt-2 bg-white text-slate-950" /></div>
              <div><Label htmlFor="preferredDeadline">Preferred completion date (optional)</Label><Input id="preferredDeadline" name="preferredDeadline" type="date" className="mt-2 bg-white text-slate-950" /></div>
            </div>
            <div><Label htmlFor="scope">What would you like removed or worked on?</Label><Textarea id="scope" name="scope" required minLength={10} maxLength={1500} rows={4} placeholder="For example: remove carpet and padding in two rooms, about 350 sq. ft., with wood flooring underneath." className="mt-2 bg-white text-slate-950" /></div>
            <div className="flex flex-wrap gap-5">
              <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-emerald-800" checked={haulAway} onChange={event => setHaulAway(event.target.checked)} />Haul away removed material</label>
              <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-emerald-800" checked={furnitureHelp} onChange={event => setFurnitureHelp(event.target.checked)} />Help moving furniture</label>
            </div>
            <div><Label htmlFor="accessNotes">Stairs, parking or other project notes (optional)</Label><Textarea id="accessNotes" name="accessNotes" maxLength={1000} rows={2} className="mt-2 bg-white text-slate-950" /></div>
            <div><Label htmlFor="photos" className="flex items-center gap-2"><Upload className="h-4 w-4" />Project photos (up to five)</Label>
              <Input id="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading || sending || photos.length >= 5} className="mt-2 h-auto bg-white py-3 text-slate-950" onChange={event => { void addPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} />
              {uploading && <p className="mt-2 text-sm" role="status">Preparing photos…</p>}
              <div className="mt-3 flex flex-wrap gap-3">{photos.map((photo, index) => <div className="relative" key={photo.name + "-" + index}><img className="h-24 w-24 rounded-md object-cover" src={photo.url} alt={"Project photo " + (index + 1)} /><button type="button" aria-label={"Remove photo " + (index + 1)} className="absolute right-0 top-0 rounded-full bg-slate-900 p-1 text-white" disabled={sending} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}><X className="h-4 w-4" /></button></div>)}</div>
            </div>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
            <Button type="submit" disabled={sending || uploading || (!!referral.repSlug && (rep.isPending || rep.isError))} className="h-auto min-h-12 w-full whitespace-normal bg-[#102d25] px-6 py-3 text-base font-bold text-white hover:bg-emerald-900">{sending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Saving your request…</> : "Send my project for a quote"}</Button>
            <p className="text-sm text-slate-600">We’ll use your contact information to respond to this project request. <Link className="underline" href="/privacy">Privacy policy</Link></p>
          </form>
        </>}
      </div>
    </section>
    <footer className="px-5 py-8 text-center text-sm text-[#f0cf83]">JC ON THE MOVE LLC<br />We MOVE with PURPOSE. GLORY to GOD.</footer>
  </main>;
}

