import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import AddressField from "@/components/AddressField";
import { buildBookHref } from "@/lib/servicePagePrefill";
import {
  SNOW_DEPTHS, SNOW_PROPERTIES, SNOW_SERVICES, SNOW_INITIAL_SELECTION, SNOW_PRICING_DEFAULTS,
  buildSnowQuoteDetails, calculateSnowQuote, parseSnowQuoteInput, snowScenarioMatrix,
  type SnowQuoteInput, type SnowPlan, type SnowScenario, type SnowService,
} from "@shared/snowPricing";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const plans: { id: SnowPlan; label: string; unit: string; description: string }[] = [
  { id: "single", label: "Single visit", unit: "per visit", description: "One clearing at the selected snow depth" },
  { id: "monthly", label: "Monthly", unit: "per month", description: "A planned number of visits each month" },
  { id: "seasonal", label: "Full season", unit: "season total", description: "A visit allowance for the whole season" },
];
const panel = "rounded-3xl border border-slate-700/70 bg-slate-900/80 p-5 sm:p-6";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

function RangeControl({ id, label, value, min, max, step = 1, unit, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const isValid = (n: number) => Number.isFinite(n) && n >= min && n <= max && Math.abs(n / step - Math.round(n / step)) < 1e-7;
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium text-slate-200">{label}</label>
      <span className="flex items-center gap-1 text-sm text-cyan-200">
        <input type="number" aria-label={`${label}, exact value`} min={min} max={max} step={step} value={draft}
          onChange={event => { setDraft(event.currentTarget.value); const n = event.currentTarget.valueAsNumber; if (isValid(n)) onChange(n); }}
          onBlur={() => { const n = Number(draft); if (draft.trim() && Number.isFinite(n)) { const bounded = Math.max(min, Math.min(max, Math.round(n / step) * step)); onChange(bounded); setDraft(String(bounded)); } else setDraft(String(value)); }}
          className={`w-16 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-right ${focus}`} />
        <span>{unit}</span>
      </span>
    </div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.currentTarget.value))}
      aria-valuetext={`${value} ${unit}`} className={`h-6 w-full cursor-pointer accent-cyan-300 ${focus}`} />
  </div>;
}

export default function SnowRemovalPublicPage() {
  const [, setLocation] = useLocation();
  const [input, setInput] = useState<SnowQuoteInput>(() => {
    if (typeof window !== "undefined") {
      const saved = new URLSearchParams(window.location.search).get("snowQuote");
      if (saved && saved.length < 4000) {
        try { return parseSnowQuoteInput(JSON.parse(saved)); } catch { /* Invalid saved choices use the draft defaults. */ }
      }
    }
    return { ...SNOW_INITIAL_SELECTION };
  });
  const [serviceAddress, setServiceAddress] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("address") || "" : "");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const quote = useMemo(() => calculateSnowQuote(input), [input]);
  const scenarios = useMemo(() => snowScenarioMatrix(input), [input]);
  const planIndex = plans.findIndex(plan => plan.id === input.plan);
  const selectedProperty = SNOW_PROPERTIES.findIndex(property => property.widthFeet === input.widthFeet && property.lengthFeet === input.lengthFeet);
  const depthIndex = SNOW_DEPTHS.indexOf(input.depthInches);
  const endOnly = input.serviceType === "end_only";
  const deepSnow = input.depthInches >= 24;
  const update = (next: Partial<SnowQuoteInput>) => { setInput(current => ({ ...current, ...next })); setCopyStatus(""); };

  function chooseScenario(id: SnowScenario) {
    const scenario = SNOW_PRICING_DEFAULTS.cases.find(item => item.id === id)!;
    update({ scenario: id, backDragPercent: scenario.backDragPercent, visitsPerMonth: scenario.visitsPerMonth });
  }
  function handleBooking() {
    const destination = new URL(buildBookHref({ service: "snow_removal", address: serviceAddress, label: "Snow service estimate — review required", details: buildSnowQuoteDetails(input) }), window.location.origin);
    // Keep representative credit and campaign context through the existing booking entrypoint.
    new URLSearchParams(window.location.search).forEach((value, key) => {
      if ((/^(utm_|jc_)/.test(key) || ["promo", "promoCode", "rep", "ref", "fbclid"].includes(key)) && value.length <= 500) destination.searchParams.set(key, value);
    });
    setLocation(destination.pathname + destination.search);
  }
  async function copyEstimate() {
    const service = SNOW_SERVICES.find(item => item.id === input.serviceType)!;
    const description = [
      "JC ON THE MOVE LLC — Snow service planning estimate",
      `${service.label} | ${input.widthFeet} × ${input.lengthFeet} ft | ${input.depthInches} in snow`,
      endOnly ? "End-of-driveway-only service: manual apron quote required." : `${plans[planIndex].label}: ${money(quote.total)} (${input.scenario} case).`,
      input.plan !== "single" ? `${input.visitsPerMonth} visits/month${input.plan === "seasonal" ? ` × ${input.seasonMonths} months = ${quote.selected.seasonVisits} visits` : ""}; each modeled at ${input.depthInches} inches.` : "",
      input.plan === "seasonal" && input.seasonalPayment === "installment" ? `${input.installments} installments: first ${input.installments - 1} at ${money(quote.selected.installment)}, final ${money(quote.selected.finalInstallment)}.` : "",
      "Final scope, weather limits, price and payment terms require confirmation. Extra visits and deeper snow require a revised quote.",
      "JCOnTheMove.com | 906.285.9312",
    ].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(description); setCopyStatus("Estimate copied."); }
    catch { setCopyStatus("Copy is unavailable here. Use Request Snow Service to carry these choices into booking."); }
  }

  return <main className="min-h-screen bg-slate-950 pb-24 text-slate-100">
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <nav className="flex items-center justify-between gap-3" aria-label="Snow service navigation">
        <button type="button" onClick={() => setLocation("/")} className={`flex min-h-11 items-center gap-1 rounded-lg text-sm text-slate-300 ${focus}`}><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Home</button>
        <a href="tel:+19062859312" className={`rounded-lg text-sm text-cyan-200 ${focus}`}>906.285.9312</a>
      </nav>
      <header className="relative mb-7 mt-5 overflow-hidden rounded-[2rem] border border-cyan-700/50 bg-gradient-to-br from-cyan-950 via-slate-900 to-slate-950 px-6 py-8 sm:px-9 sm:py-10">
        <Snowflake className="pointer-events-none absolute -right-5 top-3 h-52 w-52 text-cyan-100/5 sm:right-10 sm:h-64 sm:w-64" aria-hidden="true" />
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">JC ON THE MOVE LLC · Northwoods snow care</p>
        <h1 className="relative mt-3 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">Your driveway.<br /><span className="text-cyan-200">Your winter plan.</span></h1>
        <p className="relative mt-4 max-w-xl text-base leading-relaxed text-slate-300">Slide to your property size, compare three payment options, and request a confirmed quote.</p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-cyan-100"><span className="rounded-full border border-cyan-600/40 px-3 py-1.5">12 size + snow scenarios</span><span className="rounded-full border border-cyan-600/40 px-3 py-1.5">Driveway to full service</span><span className="rounded-full border border-cyan-600/40 px-3 py-1.5">Draft pricing preview</span></div>
      </header>

      <section className="mb-6" aria-labelledby="snow-plans-heading">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 id="snow-plans-heading" className="text-lg font-bold">1. Choose your payment window</h2><span className="text-xs text-slate-400">{planIndex + 1} / 3</span></div>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((plan, index) => <button key={plan.id} type="button" aria-pressed={input.plan === plan.id} onClick={() => update({ plan: plan.id })}
            className={`rounded-2xl border p-4 text-left transition-colors ${focus} ${input.plan === plan.id ? "border-cyan-300 bg-cyan-950/70" : "border-slate-700 bg-slate-900 hover:border-slate-500"}`}>
            <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-slate-400">0{index + 1}</span>{input.plan === plan.id && <Check className="h-4 w-4 text-cyan-200" aria-hidden="true" />}</div>
            <p className="mt-2 text-base font-bold">{plan.label}</p>
            <p className="mt-1 text-2xl font-black text-cyan-100">{endOnly ? "Manual quote" : money(quote.selected[plan.id])}</p>
            <p className="mt-1 text-xs text-slate-400">{plan.description}</p>
          </button>)}
        </div>
        <div className="mx-auto mt-3 flex max-w-xs items-center gap-3">
          <button type="button" aria-label="Previous payment window" disabled={planIndex === 0} onClick={() => update({ plan: plans[planIndex - 1].id })} className={`rounded-lg p-2 disabled:opacity-25 ${focus}`}><ChevronLeft className="h-4 w-4" /></button>
          <label className="sr-only" htmlFor="snow-plan-slider">Payment window</label><input id="snow-plan-slider" type="range" min={0} max={2} value={planIndex} aria-valuetext={plans[planIndex].label} onChange={event => update({ plan: plans[Number(event.target.value)].id })} className={`w-full accent-cyan-300 ${focus}`} />
          <button type="button" aria-label="Next payment window" disabled={planIndex === 2} onClick={() => update({ plan: plans[planIndex + 1].id })} className={`rounded-lg p-2 disabled:opacity-25 ${focus}`}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <div className="space-y-5">
          <section className={panel} aria-labelledby="snow-property-heading">
            <h2 id="snow-property-heading" className="text-lg font-bold">2. Size it up</h2><p className="mt-1 text-sm text-slate-400">Choose a starting size, then slide to your measurements.</p>
            <div className="my-5 grid grid-cols-3 gap-2">{SNOW_PROPERTIES.map((property, index) => <button type="button" key={property.id} aria-pressed={selectedProperty === index} onClick={() => update({ widthFeet: property.widthFeet, lengthFeet: property.lengthFeet })} className={`rounded-xl border px-2 py-3 text-center text-xs sm:text-sm ${focus} ${selectedProperty === index ? "border-cyan-300 bg-cyan-900/40 text-cyan-100" : "border-slate-600 text-slate-300"}`}><span className="block font-semibold">{property.label}</span><span className="mt-1 block text-xs text-slate-400">{property.widthFeet} × {property.lengthFeet} ft</span></button>)}</div>
            <div className="space-y-5"><RangeControl id="snow-width" label="Driveway width" value={input.widthFeet} min={8} max={60} unit="ft" onChange={widthFeet => update({ widthFeet })} /><RangeControl id="snow-length" label="Driveway length" value={input.lengthFeet} min={10} max={250} unit="ft" onChange={lengthFeet => update({ lengthFeet })} /></div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-950 p-3"><span className="text-sm text-slate-400">Measured clearing area</span><strong className="text-cyan-100">{quote.areaSqFt.toLocaleString()} sq ft</strong></div>
            {endOnly && <p className="mt-3 text-sm text-amber-200">End-only service needs its own apron measurement. These driveway dimensions will be included as property context.</p>}
          </section>

          <section className={panel} aria-labelledby="snow-depth-heading">
            <h2 id="snow-depth-heading" className="text-lg font-bold">3. Set the snow + scope</h2>
            <div className="mt-5 flex items-center justify-between"><label htmlFor="snow-depth" className="text-sm font-medium">Snow depth per clearing</label><strong className="text-2xl text-cyan-200">{input.depthInches}″</strong></div>
            <input id="snow-depth" type="range" min={0} max={3} value={depthIndex} aria-valuetext={`${input.depthInches} inches`} onChange={event => update({ depthInches: SNOW_DEPTHS[Number(event.target.value)] })} className={`my-3 h-6 w-full accent-cyan-300 ${focus}`} />
            <div className="grid grid-cols-4 gap-2">{SNOW_DEPTHS.map(depth => <button key={depth} type="button" aria-pressed={input.depthInches === depth} onClick={() => update({ depthInches: depth })} className={`rounded-lg border py-2 text-sm ${focus} ${input.depthInches === depth ? "border-cyan-300 bg-cyan-950 text-cyan-100" : "border-slate-700 text-slate-400"}`}>{depth}″</button>)}</div>
            {deepSnow && <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-950/30 p-3 text-sm text-amber-200">Deep-snow review: 24–36″ needs an equipment and access check before pricing or scheduling is confirmed.</p>}
            <label htmlFor="snow-scope" className="mb-2 mt-6 block text-sm font-medium">Service coverage</label>
            <select id="snow-scope" value={input.serviceType} onChange={event => { const serviceType = event.target.value as SnowService; update({ serviceType, ...(serviceType === "end_only" ? { streetBank: true } : {}) }); }} className={`w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-sm ${focus}`}>{SNOW_SERVICES.map(service => <option key={service.id} value={service.id}>{service.label}</option>)}</select>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">The Works adds front and back steps plus salt. Hauling snow off-site, roof snow and ice removal need separate scope and pricing.</p>
            <label className={`mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 p-3 ${endOnly ? "opacity-50" : ""}`}><input type="checkbox" checked={input.backDrag && !endOnly} disabled={endOnly} onChange={event => update({ backDrag: event.target.checked })} className="mt-1 h-4 w-4 accent-cyan-300" /><span className="text-sm"><strong className="block">Back-drag to the front pile</strong><span className="text-xs text-slate-400">Extra handling for tight access or a long reverse pull</span></span></label>
            {input.backDrag && !endOnly && <div className="mt-4"><RangeControl id="snow-drag" label="Back-drag difficulty" value={input.backDragPercent} min={20} max={40} unit="%" onChange={backDragPercent => update({ backDragPercent })} /></div>}
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 p-3"><input type="checkbox" checked={input.streetBank} disabled={endOnly} onChange={event => update({ streetBank: event.target.checked })} className="mt-1 h-4 w-4 accent-cyan-300" /><span className="text-sm"><strong className="block">Clear the street bank</strong><span className="text-xs text-slate-400">Move the plow ridge at the driveway entrance</span></span></label>
            {input.streetBank && <div className="mt-4"><RangeControl id="snow-bank" label="Street-bank width" value={input.bankWidthFeet} min={5} max={60} unit="ft" onChange={bankWidthFeet => update({ bankWidthFeet })} /></div>}
          </section>

          {input.plan !== "single" && <section className={panel} aria-labelledby="snow-allowance-heading"><h2 id="snow-allowance-heading" className="text-lg font-bold">4. Plan your visit allowance</h2><p className="mb-5 mt-1 text-sm text-slate-400">Compare light, typical and busy-month assumptions.</p>
            <div className="mb-4 grid grid-cols-3 gap-2">{[8, 12, 15].map(visits => <button key={visits} type="button" aria-pressed={input.visitsPerMonth === visits} onClick={() => update({ visitsPerMonth: visits })} className={`rounded-xl border py-2 text-sm ${focus} ${input.visitsPerMonth === visits ? "border-cyan-300 text-cyan-100" : "border-slate-700 text-slate-400"}`}>{visits} visits</button>)}</div>
            <RangeControl id="snow-visits" label="Visits per month" value={input.visitsPerMonth} min={1} max={30} unit="visits" onChange={visitsPerMonth => update({ visitsPerMonth })} />
            {input.plan === "seasonal" && <div className="mt-5 space-y-5"><RangeControl id="snow-months" label="Season length" value={input.seasonMonths} min={1} max={12} unit="months" onChange={seasonMonths => update({ seasonMonths })} /><fieldset><legend className="mb-2 text-sm font-medium">Season payment preference</legend><div className="grid grid-cols-2 gap-2">{(["full", "installment"] as const).map(payment => <button type="button" key={payment} aria-pressed={input.seasonalPayment === payment} onClick={() => update({ seasonalPayment: payment })} className={`rounded-xl border py-3 text-sm ${focus} ${input.seasonalPayment === payment ? "border-cyan-300 bg-cyan-950 text-cyan-100" : "border-slate-700 text-slate-300"}`}>{payment === "full" ? "Full season" : "Split payments"}</button>)}</div></fieldset>{input.seasonalPayment === "installment" && <RangeControl id="snow-installments" label="Number of installments" value={input.installments} min={1} max={12} unit="payments" onChange={installments => update({ installments })} />}</div>}
            <p className="mt-4 rounded-xl bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">This budget assumes every visit has {input.depthInches}″ of snow. {input.plan === "seasonal" ? `${quote.selected.seasonVisits} planned visits for the season` : `${input.visitsPerMonth} planned visits per month`}. Extra visits, deeper snow and additional clearing passes need revised pricing. Season dates, trigger depth and carryover terms will be confirmed with your quote.</p>
          </section>}
        </div>

        <aside id="snow-estimate-review" className="scroll-mt-5 space-y-5 lg:sticky lg:top-5" aria-label="Your snow estimate">
          <section className="overflow-hidden rounded-3xl border border-cyan-600/60 bg-gradient-to-b from-cyan-950/80 to-slate-900 p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">Your estimate</p>
            <div className="my-4 grid grid-cols-3 gap-2" aria-label="Pricing scenarios">{SNOW_PRICING_DEFAULTS.cases.map(item => <button type="button" key={item.id} aria-pressed={input.scenario === item.id} onClick={() => chooseScenario(item.id)} className={`rounded-xl border py-2 text-sm font-semibold ${focus} ${input.scenario === item.id ? "border-cyan-200 bg-cyan-200 text-slate-950" : "border-cyan-800 text-cyan-100"}`}>{item.label}</button>)}</div>
            <div aria-live="polite" aria-atomic="true"><p className="text-sm text-slate-300">{endOnly ? "End of driveway only" : plans[planIndex].label}</p><p className="mt-1 break-words text-4xl font-black tracking-tight sm:text-5xl">{endOnly ? "Manual quote" : money(quote.amount)}</p><p className="mt-2 text-sm text-cyan-200">{!endOnly && (input.plan === "seasonal" && input.seasonalPayment === "installment" ? `per installment · ${money(quote.total)} season total` : plans[planIndex].unit)}</p></div>
            {input.plan === "seasonal" && input.seasonalPayment === "installment" && !endOnly && <p className="mt-3 text-xs leading-relaxed text-slate-300">{input.installments === 1 ? "1 payment" : `${input.installments - 1} payments at ${money(quote.selected.installment)}, then ${money(quote.selected.finalInstallment)}`}. Payment schedule is a request until confirmed.</p>}
            {!endOnly && <dl className="mt-5 space-y-2 border-t border-cyan-800/60 pt-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-400">Driveway base</dt><dd>{money(quote.selected.base)}</dd></div>{input.backDrag && <div className="flex justify-between gap-3"><dt className="text-slate-400">Back-drag · {input.backDragPercent}%</dt><dd>{money(quote.selected.drag)}</dd></div>}{input.streetBank && <div className="flex justify-between gap-3"><dt className="text-slate-400">Street bank</dt><dd>{money(quote.selected.bank)}</dd></div>}{quote.selected.serviceAddon > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-400">Steps / salt package</dt><dd>{money(quote.selected.serviceAddon)}</dd></div>}<div className="flex justify-between gap-3"><dt className="text-slate-400">Snow-depth multiplier</dt><dd>× {quote.depthFactor}</dd></div><div className="flex justify-between gap-3 border-t border-cyan-800/60 pt-2 font-bold"><dt>Estimated clearing</dt><dd>{money(quote.selected.single)}</dd></div></dl>}
            <p className="mt-4 text-xs leading-relaxed text-slate-300">Draft estimate. Property access, snow conditions and service scope are reviewed before a payable quote is issued. {endOnly ? "An apron-specific measurement is required." : "Visit prices round up to the nearest $5."}</p>
            <button type="button" onClick={copyEstimate} className={`mt-4 min-h-11 w-full rounded-xl border border-cyan-700 text-sm font-semibold text-cyan-100 hover:bg-cyan-900/50 ${focus}`}>Copy estimate summary</button><p role="status" className="mt-2 text-xs text-cyan-200">{copyStatus}</p>
          </section>

          <section className={panel} aria-labelledby="snow-request-heading"><h2 id="snow-request-heading" className="text-lg font-bold">Make it your quote</h2><p className="mb-4 mt-1 text-sm text-slate-400">Add the property address and continue with these choices.</p><label className="mb-2 block text-sm font-medium">Service address</label><AddressField value={serviceAddress} onChange={setServiceAddress} city={addressCity} state={addressState} zip={addressZip} onCityChange={setAddressCity} onStateChange={setAddressState} onZipChange={setAddressZip} onResolved={place => setServiceAddress(place.fullAddress)} placeholder="123 Main St, Ironwood, MI" theme="zinc" showManualFields={false} />
            <Button type="button" onClick={handleBooking} disabled={!serviceAddress.trim()} className="mt-4 h-12 w-full rounded-xl bg-cyan-300 font-bold text-slate-950 hover:bg-cyan-200">Request Snow Service <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">Your request continues through our booking system. Any payment link, status update or eligible reward follows the confirmed booking and payment process.</p>
          </section>
        </aside>
      </div>

      <details className={`${panel} mt-6`}><summary className={`cursor-pointer rounded-lg font-bold ${focus}`}>Compare all 12 scenarios <span className="ml-2 text-xs font-normal text-slate-400">3 property sizes × 4 snow depths</span></summary><p className="mb-4 mt-3 text-sm text-slate-400">{input.scenario[0].toUpperCase() + input.scenario.slice(1)} pricing case · current service and handling choices. Select a row to load it above.</p><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><caption className="sr-only">Twelve snow-removal planning scenarios</caption><thead className="border-b border-slate-600 text-xs text-slate-400"><tr><th scope="col" className="py-3">Property</th><th scope="col">Snow</th><th scope="col">Single</th><th scope="col">Monthly</th><th scope="col">Season</th><th scope="col"><span className="sr-only">Load scenario</span></th></tr></thead><tbody>{scenarios.map(row => <tr key={row.id} className="border-b border-slate-800"><th scope="row" className="py-3 pr-3 font-medium">{row.property}<span className="block text-xs font-normal text-slate-500">{row.widthFeet} × {row.lengthFeet} ft</span></th><td>{row.depthInches}″{row.depthInches >= 24 && <span className="block text-[10px] text-amber-300">Site review</span>}</td><td>{endOnly ? "Review" : money(row.selected.single)}</td><td>{endOnly ? "Review" : money(row.selected.monthly)}</td><td>{endOnly ? "Review" : money(row.selected.seasonal)}</td><td><button type="button" aria-label={`Use ${row.property}, ${row.depthInches} inches snow`} onClick={() => { update({ widthFeet: row.widthFeet, lengthFeet: row.lengthFeet, depthInches: row.depthInches }); document.getElementById("snow-property-heading")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }} className={`rounded-lg px-3 py-2 text-cyan-200 hover:bg-cyan-950 ${focus}`}>Use <ArrowRight className="inline h-3 w-3" aria-hidden="true" /></button></td></tr>)}</tbody></table></div></details>
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-cyan-800 bg-slate-950/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div><p className="text-[11px] text-slate-400">Draft {plans[planIndex].label.toLowerCase()} estimate</p><p className="text-xl font-black text-cyan-100">{endOnly ? "Manual quote" : money(quote.amount)}</p></div>
        <button type="button" onClick={() => document.getElementById("snow-estimate-review")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })} className={`rounded-xl bg-cyan-200 px-4 py-3 text-sm font-bold text-slate-950 ${focus}`}>Review quote <ArrowRight className="ml-1 inline h-4 w-4" aria-hidden="true" /></button>
      </div>
      <footer className="mt-6 text-center text-xs leading-relaxed text-slate-500">JC ON THE MOVE LLC · JCOnTheMove.com<br />We MOVE with PURPOSE GLORY to GOD</footer>
    </div>
  </main>;
}
