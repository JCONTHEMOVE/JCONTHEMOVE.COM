import { TaskStepNav, TaskActionBar, TaskDetails, useUnsavedTask, canLeaveTask } from "@/components/task-ui";
import { useMemo, useState, useRef, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, Clock3, Home, MapPin, ShieldCheck, Truck, Users } from "lucide-react";
import { estimateJobDuration, JOB_SCHEDULE_OPTIONS, type SizingBasis, type TruckSize } from "@shared/jcOperations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Service = "moving" | "labor" | "junk_removal";
type Capacity = { status: "open" | "limited" | "ask_jc"; availableCrew: number; message: string };

function phoneIsComplete(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits);
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Please try again.";
  try {
    const parsed = JSON.parse(raw.replace(/^\d+:\s*/, ""));
    return parsed.error || parsed.message || raw;
  } catch {
    return raw.replace(/^\d+:\s*/, "");
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-slate-200"><span>{label}</span>{children}</label>;
}

export function DateFirstBooking({ onChooseCallback, onDetailedBooking }: { onChooseCallback: () => void; onDetailedBooking: () => void }) {
  const { toast } = useToast();
  const [step,setStep]=useState('customer');
  const formRef=useRef<HTMLFormElement>(null);
  const steps=[{id:'customer',label:'Customer'},{id:'service',label:'Service / location'},{id:'schedule',label:'Schedule / crew'},{id:'review',label:'Review'}];
  const [service, setService] = useState<Service>("moving");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [workScope, setWorkScope] = useState("");
  const [sizingBasis, setSizingBasis] = useState<SizingBasis>("square_footage");
  const [squareFootage, setSquareFootage] = useState("1500");
  const [truckSize, setTruckSize] = useState<TruckSize>("15_ft");
  const [crewSize, setCrewSize] = useState<2 | 3 | 4 | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState<{ manageUrl: string; capacityStatus: string; duplicate?: boolean } | null>(null);

  const estimate = useMemo(() => estimateJobDuration({
    sizingBasis,
    squareFootage: sizingBasis === "square_footage" ? Number(squareFootage) : null,
    truckSize: sizingBasis === "truck" ? truckSize : null,
    selectedCrewSize: crewSize,
  }), [sizingBasis, squareFootage, truckSize, crewSize]);

  const selectedCrew = crewSize || estimate.recommendedCrewSize;

  async function checkCapacity() {
    if (!date || !time) {
      toast({ title: "Choose a date and time first", variant: "destructive" });
      return null;
    }
    setChecking(true);
    try {
      const response = await apiRequest("POST", "/api/scheduling/preference-capacity", {
        date,
        time,
        crewSize: selectedCrew,
        planningMinutes: Math.round(estimate.planningHours * 60),
      });
      const result = await response.json() as Capacity;
      setCapacity(result);
      return result;
    } catch (error) {
      toast({ title: "Could not check that time", description: errorMessage(error), variant: "destructive" });
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !phoneIsComplete(phone)) {
      toast({ title: "Add your name and complete 10-digit phone number", variant: "destructive" });
      return;
    }
    if (!email.trim() || !address.trim() || !zip.trim() || !workScope.trim() || !date) {
      setStep(!email.trim() ? 'customer' : !address.trim() || !zip.trim() || !workScope.trim() ? 'service' : 'schedule');
      toast({ title: 'Complete the required fields before submitting', variant: 'destructive' });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const response = await apiRequest("POST", "/api/leads/quick-request", {
        requestType: "scheduled",
        firstName: parts[0],
        lastName: parts.slice(1).join(" ") || "Customer",
        email,
        phone,
        serviceCode: service,
        serviceAddress: address,
        zip,
        workScope,
        sizingBasis,
        squareFootage: sizingBasis === "square_footage" ? Number(squareFootage) : undefined,
        truckSize: sizingBasis === "truck" ? truckSize : undefined,
        selectedCrewSize: selectedCrew,
        preferredDate: date,
        preferredStartTime: time,
        notes,
        photos: [],
      });
      const result = await response.json() as { duplicate?: boolean; scheduleRequest?: { manageUrl?: string; capacityStatus?: string } };
      if (!result.scheduleRequest?.manageUrl) throw new Error("Your request was saved, but the management link could not be created. Please call JC ON THE MOVE.");
      setComplete({ manageUrl: result.scheduleRequest.manageUrl, capacityStatus: result.scheduleRequest.capacityStatus || capacity?.status || "ask_jc", duplicate: result.duplicate });
    } catch (error) {
      toast({ title: "Could not save your requested date", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  useUnsavedTask(Boolean(name||email||phone||address||workScope)&&!complete&&!submitting);
  function goStep(next:string){
    const target=steps.findIndex(item=>item.id===next);
    if(target>steps.findIndex(item=>item.id===step)){
      for(const item of steps.slice(0,target)){
        const fields=Array.from(formRef.current?.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`[data-step="${item.id}"] input,[data-step="${item.id}"] textarea,[data-step="${item.id}"] select`)||[]);
        const invalid=fields.find(field=>!field.checkValidity());
        if(invalid){setStep(item.id);window.setTimeout(()=>{invalid.focus();invalid.reportValidity();},0);return;}
        if(item.id==='schedule'&&!date){setStep('schedule');window.setTimeout(()=>formRef.current?.querySelector<HTMLInputElement>('input[type="date"]')?.focus(),0);return;}
        if(item.id==='customer'&&!phoneIsComplete(phone)){setStep('customer');toast({title:'Enter a complete phone number',variant:'destructive'});window.setTimeout(()=>formRef.current?.querySelector<HTMLInputElement>('input[type="tel"]')?.focus(),0);return;}
      }
    }
    setStep(next);
  }
  if (complete) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5 text-slate-100">
        <CardContent className="p-7 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
          <h2 className="mt-4 text-2xl font-black">Your preferred date is saved</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">{complete.duplicate ? "We found your recent request and refreshed its secure management link." : "This is a tentative request, not a dispatch or confirmed booking. JC will call to confirm the details and time."}</p>
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm">
            Current capacity: <strong className="capitalize text-emerald-300">{complete.capacityStatus.replace("_", " ")}</strong>
          </div>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild className="bg-emerald-600 hover:bg-emerald-500"><a href={complete.manageUrl}>Review or change my request</a></Button>
            <Button variant="outline" asChild><a href="tel:9062859312">Call 906-285-9312</a></Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <form ref={formRef} noValidate className="space-y-4" onSubmit={event=>{if(step!=='review'){event.preventDefault();goStep(steps[steps.findIndex(item=>item.id===step)+1].id);}else void submit(event);}}>
    <TaskStepNav steps={steps} value={step} onChange={goStep} disabled={submitting}/>
    <fieldset disabled={submitting} className="min-w-0 space-y-4">
      <section hidden={step!=='customer'} data-step="customer" className="space-y-3" aria-label="Customer">
        <Field label="Your name"><Input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required/></Field>
        <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></Field>
        <Field label="Phone"><Input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} required/></Field>
      </section>
      <section hidden={step!=='service'} data-step="service" className="space-y-3" aria-label="Service and location">
        <Field label="Service"><select className="field-select min-h-11" value={service} onChange={e=>setService(e.target.value as Service)}><option value="moving">Moving</option><option value="labor">Loading / unloading</option><option value="junk_removal">Junk removal</option></select></Field>
        <Field label="Service address"><Input autoComplete="street-address" value={address} onChange={e=>setAddress(e.target.value)} required/></Field>
        <Field label="ZIP code"><Input inputMode="numeric" maxLength={10} value={zip} onChange={e=>setZip(e.target.value)} required/></Field>
        <Field label="Work needed"><Textarea rows={3} value={workScope} onChange={e=>setWorkScope(e.target.value)} placeholder="Items, pickup/drop-off, stairs, access" required/></Field>
      </section>
      <section hidden={step!=='schedule'} data-step="schedule" className="space-y-3" aria-label="Schedule and crew">
        <Field label="Preferred date"><Input type="date" min={new Date().toISOString().slice(0,10)} value={date} onInput={e=>{setDate(e.currentTarget.value);setCapacity(null);}} onChange={e=>{setDate(e.target.value);setCapacity(null);}} required/></Field>
        <Field label="Preferred start"><select className="field-select min-h-11" value={time} onChange={e=>{setTime(e.target.value);setCapacity(null);}}>{JOB_SCHEDULE_OPTIONS.filter(o=>o.start).map(o=><option key={o.start!} value={o.start!}>{o.label} Central</option>)}</select></Field>
        <Field label="Estimate from"><select className="field-select min-h-11" value={sizingBasis} onChange={e=>{setSizingBasis(e.target.value as SizingBasis);setCrewSize(null);setCapacity(null);}}><option value="square_footage">Home size</option><option value="truck">Truck size</option></select></Field>
        {sizingBasis==='square_footage'?<Field label="Approx. square feet"><Input type="number" min="1" max="100000" value={squareFootage} onChange={e=>{setSquareFootage(e.target.value);setCrewSize(null);setCapacity(null);}} required/></Field>:<Field label="Truck"><select className="field-select min-h-11" value={truckSize} onChange={e=>{setTruckSize(e.target.value as TruckSize);setCrewSize(null);setCapacity(null);}}><option value="pickup_van_10">Pickup / van / 10 ft</option><option value="15_ft">15 ft</option><option value="20_ft">20 ft</option><option value="26_ft">26 ft</option></select></Field>}
        <Field label="Crew"><select className="field-select min-h-11" value={selectedCrew} onChange={e=>{setCrewSize(Number(e.target.value) as 2|3|4);setCapacity(null);}}><option value="2">2 movers</option><option value="3">3 movers</option><option value="4">4 movers</option></select></Field>
        <p className="text-sm">Estimated time: {estimate.minimumHours}–{estimate.maximumHours} hours · Planning: {estimate.planningHours} hours</p>
        {estimate.manualReview&&<p role="status" className="text-amber-300">Crew and size need staff review.</p>}
        <TaskDetails title="Additional notes"><Field label="Notes"><Textarea value={notes} onChange={e=>setNotes(e.target.value)}/></Field></TaskDetails>
      </section>
      <section hidden={step!=='review'} className="space-y-3" aria-label="Review request">
        <dl className="grid gap-3 rounded-xl border p-3 text-sm [overflow-wrap:anywhere]"><div><dt>Customer</dt><dd>{name} · {email} · {phone}</dd></div><div><dt>Service / location</dt><dd>{service.replace('_',' ')} · {address} · {zip}</dd><dd>{workScope}</dd></div><div><dt>Schedule / crew</dt><dd>{date} · {time} Central · {selectedCrew} movers · {estimate.planningHours} hours</dd></div></dl>
              <Card className="border-emerald-500/30 bg-emerald-500/[0.06] text-slate-100">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-300" /><p className="font-black">Clear minimums and local package options</p></div>
            <p className="mt-1 text-sm text-slate-300">Moving and junk-removal labor/service has a $400 floor. Eligible local jobs can use 2 movers / 3 hours or 3 movers / 2 hours for $555. Truck, equipment, disposal, hazmat, specialty items, and pass-through costs stay separate.</p>
          </div>
          <div className="flex flex-col gap-2 sm:min-w-56">
            <Button type="button" variant="outline" onClick={checkCapacity} disabled={checking || !date}>{checking ? "Checking…" : "Check this time"}</Button>
            {capacity && <div className={`rounded-lg border px-3 py-2 text-center text-sm ${capacity.status === "open" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : capacity.status === "limited" ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-red-400/40 bg-red-400/10 text-red-100"}`}><strong className="capitalize">{capacity.status.replace("_", " ")}</strong><br /><span className="text-xs">{capacity.message}</span></div>}
          </div>
        </CardContent>
      </Card>


        <p className="text-sm">Staff must confirm the date, crew, and price before dispatch.</p>
      </section>
    </fieldset>
    <TaskActionBar>{step!=='customer'&&<Button type="button" variant="outline" disabled={submitting} onClick={()=>goStep(steps[steps.findIndex(item=>item.id===step)-1].id)}>Back</Button>}<Button type="submit" disabled={submitting}>{submitting?'Saving request…':step==='review'?'Request this date':'Next'}</Button></TaskActionBar>
    <TaskDetails title="Other booking options"><Button type="button" variant="outline" onClick={()=>{if(canLeaveTask())onChooseCallback();}}>Request a callback</Button><Button type="button" variant="outline" onClick={()=>{if(canLeaveTask())onDetailedBooking();}}>Deposit-ready booking</Button></TaskDetails>
  </form>;
}
