import { ArrowRight, ArrowUpRight, Banknote, Boxes, Check, CircleHelp, ClipboardCheck, Clock, Footprints, House, MapPin, PackageOpen, Route, ShieldAlert, SignalHigh, SignalLow, SignalMedium, Truck, Users, Weight, Wrench, XCircle, type LucideIcon } from 'lucide-react';
import type { PricingTrainingScenario } from '@shared/pricingTraining';
import { TRAINING_REASONS } from '@shared/pricingTraining';

export const decisionIcons: Record<string, LucideIcon> = { quote: ClipboardCheck, information: CircleHelp, specialist: ShieldAlert, decline: XCircle };
export const difficultyIcons: Record<string, LucideIcon> = { low: SignalLow, moderate: SignalMedium, high: SignalHigh, unknown: CircleHelp };
export const sectionIcons: Record<string, LucideIcon> = { Decision: ClipboardCheck, Crew: Users, Hours: Clock, Price: Banknote, Reasons: CircleHelp };
export const reasonIcons: Record<typeof TRAINING_REASONS[number], LucideIcon> = {
  'Heavy or awkward items': Weight, 'Stairs or elevator': ArrowUpRight,
  'Long carry / difficult access': Footprints, 'Volume of work': Boxes,
  'Travel time': Route, 'Truck or equipment': Truck, 'Disposal or materials': PackageOpen,
  'Minimum charge': ClipboardCheck, 'Packing or disassembly': Wrench,
  'Customer is not ready': Clock, 'Missing information': CircleHelp,
  'Specialist or unsafe conditions': ShieldAlert,
};
export { Check };

function Fact({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note?: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-700/80 bg-slate-950/60 p-3 sm:p-4">
    <dt className="flex flex-col gap-2 text-sm text-slate-300"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-400/10"><Icon aria-hidden="true" className="h-8 w-8 text-blue-300" /></span>{label}</dt>
    <dd className="mt-2 break-words text-xl font-bold leading-snug text-white">{value}</dd>
    {note && <dd className="mt-1 text-sm leading-5 text-slate-400">{note}</dd>}
  </div>;
}

export function TrainingJobSnapshot({ scenario, index, count, finalized = false }: { scenario: PricingTrainingScenario; index: number; count: number; finalized?: boolean }) {
  const f = scenario.features;
  const text = (key: string) => f[key] == null || String(f[key]).trim() === '' ? 'Not specified' : String(f[key]);
  const quantity = (key: string, unit: string) => typeof f[key] === 'number' && Number.isFinite(f[key]) ? `${f[key]} ${f[key] === 1 && (unit === 'flights' || unit === 'workers') ? unit.slice(0, -1) : unit}` : 'Not specified';
  const noTransport = ['assembly', 'load_only', 'unload_only', 'packing'].includes(scenario.service) || /no (?:company )?transport|no moving between addresses/i.test(`${f.scope ?? ''} ${f.truck ?? ''}`);
  const uncertainty = text('uncertainty');
  const scene = scenario.service === 'assembly' ? [[Boxes, 'Boxed parts'], [Wrench, 'Assembly'], [House, 'In place']] as const
    : scenario.service === 'packing' ? [[House, 'At the job'], [PackageOpen, 'Packing'], [Boxes, 'Packed items']] as const
    : scenario.service === 'load_only' ? [[House, 'Pickup'], [Boxes, 'Loading'], [Truck, 'Customer truck']] as const
    : scenario.service === 'unload_only' ? [[Truck, 'Customer truck'], [Boxes, 'Unloading'], [House, 'Destination']] as const
    : scenario.service === 'junk_removal' ? [[House, 'Pickup'], [Boxes, 'Removal'], [Truck, 'Hauling']] as const
    : [[House, 'Pickup'], [Truck, 'Transport'], [House, 'Destination']] as const;
  return <section aria-label="Job snapshot" className="min-w-0 space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
    <header>
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Request {index + 1} of {count} · {scenario.id}{finalized ? ' · Owner finalized' : ''}</p>
      <h2 className="mt-2 break-words text-xl font-bold leading-snug sm:text-2xl">{scenario.title}</h2>
      <p className="mt-2 text-sm capitalize text-slate-300">{scenario.service.replaceAll('_', ' ')} · {text('scope')}</p>
    </header>
    <div aria-label="Work overview" className="flex items-center justify-between gap-1 rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-950 via-slate-950 to-slate-900 px-2 py-5 sm:px-6">
      {scene.map(([Icon, label], i) => <div key={label} className="contents">{i > 0 && <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-400"/>}<div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center"><div className="rounded-2xl border border-blue-300/20 bg-blue-400/10 p-3 shadow-lg shadow-blue-950/50"><Icon aria-hidden="true" strokeWidth={1.5} className="h-9 w-9 text-blue-200 sm:h-12 sm:w-12"/></div><span className="text-xs font-semibold text-blue-100 sm:text-sm">{label}</span></div></div>)}
    </div>
    <div className="flex gap-3 rounded-xl bg-blue-950/40 p-3">
      <Boxes aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
      <div className="min-w-0"><h3 className="text-sm font-semibold text-blue-200">Items & work</h3><p className="mt-1 break-words text-base leading-6">{text('inventory')}</p></div>
    </div>
    <dl className="grid grid-cols-2 gap-2 sm:gap-3">
      <Fact icon={Weight} label="Heaviest item" value={quantity('heaviestItemLb', 'lb')} note="Customer-estimated" />
      <Fact icon={Footprints} label="Carry distance" value={quantity('carryFeet', 'ft')} />
      <Fact icon={ArrowUpRight} label="Pickup / service stairs" value={quantity('originStairFlights', 'flights')} />
      <Fact icon={ArrowUpRight} label="Destination stairs" value={quantity('destinationStairFlights', 'flights')} />
      <Fact icon={MapPin} label="Depot to job" value={quantity('depotToJobRoadMiles', 'mi')} note="One-way road distance" />
      <Fact icon={Route} label="Loaded trip" value={f.loadedRoadMiles == null && noTransport ? 'No transport requested' : quantity('loadedRoadMiles', 'mi')} />
    </dl>
    <div className="rounded-xl border border-blue-400/30 bg-blue-950/30 p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-blue-200">Customer requests</h3>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-lg font-bold"><span className="flex items-center gap-2"><Users aria-hidden="true" className="h-5 w-5 text-blue-300" />{quantity('requestedCrew', 'workers')}</span><span className="flex items-center gap-2"><Clock aria-hidden="true" className="h-5 w-5 text-blue-300" />{quantity('requestedHours', 'hr')}</span></div>
      <p className="mt-2 text-sm text-slate-300">You decide the crew and time this job needs.</p>
    </div>
    <dl className="space-y-3 text-base leading-6">
      {([['access', 'Access & conditions', MapPin], ['truck', 'Transport & equipment', Truck], ['timing', 'Timing', Clock], ['readiness', 'Readiness', PackageOpen]] as const).map(([key, label, Icon]) => <div key={key} className="flex gap-3"><Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" /><div className="min-w-0"><dt className="text-sm font-semibold text-slate-300">{label}</dt><dd className="break-words">{text(key)}</dd></div></div>)}
    </dl>
    {uncertainty !== 'Not specified' && <div className="flex gap-3 rounded-xl border border-amber-400/40 bg-amber-950/30 p-3"><CircleHelp aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><h3 className="font-semibold text-amber-200">Things to confirm</h3><p className="mt-1 break-words text-base leading-6 text-amber-100">{uncertainty}</p></div></div>}
    <details className="border-t border-slate-700 pt-2"><summary className="min-h-12 cursor-pointer py-3 font-semibold text-blue-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">Full customer request</summary><p className="whitespace-pre-wrap break-words pb-2 text-base leading-7 text-slate-200">{scenario.request}</p></details>
  </section>;
}
