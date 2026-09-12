import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TRAINING_REASONS, emptyTrainingAnswer, trainingAnswerProblems, trainingAnswerSchema, type TrainingAnswer, type SavedTrainingAnswer, type PricingTrainingScenario } from "@shared/pricingTraining";

type TrainingData={ownerId:string;version:number;scenarios:PricingTrainingScenario[];answers:Record<string,SavedTrainingAnswer>};
const endpoint="/api/admin/pricing-training";

function Choice<T extends string|number>({label,value,options,onChange}:{label:string;value:T|null;options:{value:T;label:string}[];onChange:(value:T)=>void}){
  return <fieldset className="min-w-0 space-y-2"><legend className="mb-2 font-semibold">{label}</legend><div className="grid grid-cols-2 gap-2">
    {options.map(option=><button type="button" key={option.value} aria-pressed={value===option.value} onClick={()=>onChange(option.value)} className={`min-h-12 rounded-xl border px-3 py-3 text-left text-sm font-medium ${value===option.value?"border-blue-400 bg-blue-600 text-white":"border-slate-700 bg-slate-900 text-slate-200"}`}>{option.label}</button>)}
  </div></fieldset>;
}
function NumberChoice({label,value,options,onChange,unit=""}:{label:string;value:number|null;options:number[];onChange:(value:number|null)=>void;unit?:string}){
  const [custom,setCustom]=useState(false);
  const showCustom=custom||(value!=null&&!options.includes(value));
  return <div className="space-y-2"><Choice label={label} value={value} options={options.map(n=>({value:n,label:`${unit==="$"?"$":""}${n}${unit&&unit!=="$"?` ${unit}`:""}`}))} onChange={n=>{setCustom(false);onChange(n);}}/>
    <button type="button" onClick={()=>setCustom(true)} className="min-h-11 text-sm font-semibold text-blue-300 underline">None of these — enter my own</button>
    {showCustom&&<Input aria-label={`Custom ${label}`} type="number" inputMode={unit==="workers"?"numeric":"decimal"} min={unit==="workers"?1:0.25} step={unit==="workers"?1:"any"} value={value??""} onChange={event=>onChange(event.target.value===""?null:Number(event.target.value))} className="h-12 border-slate-600 bg-slate-900"/>}
  </div>;
}

export function ScenarioTest({scenario,saved,ownerId,onSaved,onNavigate,index,count,saveEndpoint=endpoint}:{scenario:PricingTrainingScenario;saved?:SavedTrainingAnswer;ownerId:string;onSaved:(answer:SavedTrainingAnswer)=>void;onNavigate:(direction:number)=>void;index:number;count:number;saveEndpoint?:string}){
  const storageKey=`jc-pricing-training:${ownerId}:${scenario.id}:${scenario.fingerprint}${saveEndpoint===endpoint?'':':'+saveEndpoint}`;
  const [olderDraft,setOlderDraft]=useState<TrainingAnswer|null>(()=>{
    try{const draft=JSON.parse(localStorage.getItem(storageKey)||"null");const parsed=trainingAnswerSchema.safeParse(draft?.answer);if(draft&&draft.revision!==(saved?.revision??0)&&parsed.success)return parsed.data;}catch{}
    return null;
  });
  const [answer,setAnswer]=useState<TrainingAnswer>(()=>{
    try{const draft=JSON.parse(localStorage.getItem(storageKey)||"null");const parsed=trainingAnswerSchema.safeParse(draft?.answer);if(draft?.revision===(saved?.revision??0)&&parsed.success)return parsed.data;}catch{}
    return saved?.answer??emptyTrainingAnswer();
  });
  const [step,setStep]=useState(0);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [storageError,setStorageError]=useState(false);
  const [message,setMessage]=useState("");
  const revision=useRef(saved?.revision??0);
  const lastSaved=useRef(JSON.stringify(saved?.answer??emptyTrainingAnswer()));
  const dirty=JSON.stringify(answer)!==lastSaved.current;
  useEffect(()=>{
    if(olderDraft)return;
    try{localStorage.setItem(storageKey,JSON.stringify({answer,revision:revision.current}));setStorageError(false);}catch{setStorageError(true);}
  },[answer,storageKey,olderDraft]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  const set=<K extends keyof TrainingAnswer>(key:K,value:TrainingAnswer[K])=>{setAnswer(a=>({...a,[key]:value}));setMessage("");};
  const stages=answer.decision==="quote"?["Decision","Crew","Hours","Price","Reasons"]:["Decision","Reasons"];
  const current=stages[Math.min(step,stages.length-1)];
  async function save(status:"draft"|"reviewed",direction?:number){
    if(olderDraft){setError("Choose which draft to review before saving.");return;}
    const problems=status==="reviewed"?trainingAnswerProblems(answer):[];
    if(problems.length){setError(problems.join(" "));return;}
    setSaving(true);setError("");
    try{
      const response=await apiRequest("PUT",`${saveEndpoint}/${scenario.id}`,{answer,status,revision:revision.current,fingerprint:scenario.fingerprint});
      const result=await response.json() as SavedTrainingAnswer;
      revision.current=result.revision;lastSaved.current=JSON.stringify(result.answer);onSaved(result);
      try{localStorage.removeItem(storageKey);}catch{}
      setMessage(status==="reviewed"?"Answer saved to your account.":"Draft saved to your account.");
      if(direction!==undefined)onNavigate(direction);
    }catch(error){setError(error instanceof Error?error.message:"Could not save. Please retry.");}finally{setSaving(false);}
  }
  async function move(direction:number){if(olderDraft)return;if(dirty)await save("draft",direction);else onNavigate(direction);}
  return <article className="min-w-0 space-y-5" aria-busy={saving}>
    {olderDraft&&<div role="alert" className="rounded-xl border border-amber-500 p-4 text-sm"><p>A newer answer is saved in your account. Your older phone draft is still available. Choose which to review before continuing.</p><div className="mt-3 flex flex-wrap gap-3"><Button onClick={()=>{setAnswer(olderDraft);setOlderDraft(null);}}>Review phone draft</Button><Button variant="outline" onClick={()=>setOlderDraft(null)}>Use account answer</Button></div></div>}
    <label className="block text-sm">Jump to a batch (20 requests each)<select aria-label="Jump to batch" disabled={saving||!!olderDraft} value={Math.floor(index/20)} onChange={e=>void move(Number(e.target.value)*20-index)} className="mt-2 h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3">{Array.from({length:Math.ceil(count/20)},(_,i)=><option key={i} value={i}>Batch {i+1}: requests {i*20+1}–{Math.min(count,(i+1)*20)}</option>)}</select></label>
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Request {index+1} of {count} · Batch {scenario.batch} · {scenario.id}</p>
      <h2 className="mt-2 text-xl font-bold">{scenario.title}</h2>
      <details className="mt-3" open={current==="Decision"}><summary className="min-h-10 cursor-pointer text-sm font-semibold text-blue-200">Customer request</summary><p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{scenario.request}</p></details>
      {saved?.status==="reviewed"&&<p className="mt-2 text-sm text-emerald-300">Previously answered. You can revise your choices.</p>}
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Question sections">{stages.map((label,i)=><button key={label} type="button" onClick={()=>setStep(i)} aria-current={current===label?"step":undefined} className={`min-h-11 rounded-lg px-3 py-2 text-xs ${current===label?"bg-blue-600":"bg-slate-800 text-slate-300"}`}>{i+1}. {label}</button>)}</div>
    <fieldset disabled={saving||!!olderDraft} className="min-w-0 space-y-6 disabled:opacity-60">
      {current==="Decision"&&<>
        <Choice label="How would you handle this request?" value={answer.decision} onChange={v=>set("decision",v)} options={[{value:"quote",label:"I can price this job"},{value:"information",label:"Need more information"},{value:"specialist",label:"Specialist / site review"},{value:"decline",label:"Decline this job"}]}/>
        <Choice label="How difficult is this job?" value={answer.difficulty} onChange={v=>set("difficulty",v)} options={[{value:"low",label:"Low"},{value:"moderate",label:"Moderate"},{value:"high",label:"High"},{value:"unknown",label:"Cannot tell yet"}]}/>
      </>}
      {current==="Crew"&&<>
        <p className="text-sm text-slate-300">Count trained JC workers. Extra hours do not make an unsafe crew size acceptable.</p>
        <NumberChoice label="Fewest workers you would allow" value={answer.minimumCrew} options={[1,2,3,4,5,6]} onChange={v=>set("minimumCrew",v)} unit="workers"/>
        <NumberChoice label="Crew you would normally send" value={answer.recommendedCrew} options={[1,2,3,4,5,6]} onChange={v=>set("recommendedCrew",v)} unit="workers"/>
      </>}
      {current==="Hours"&&<>
        <p className="text-sm text-slate-300">For your recommended crew of {answer.recommendedCrew??"?"}. Hours are elapsed crew time, not workers multiplied by time.</p>
        <NumberChoice label="Shortest safe work slot" value={answer.minimumScheduledHours} options={[0.5,1,2,3,4,6]} onChange={v=>set("minimumScheduledHours",v)} unit="hours"/>
        <NumberChoice label="Minimum hours you would bill" value={answer.minimumBillableHours} options={[1,2,3,4,6,8]} onChange={v=>set("minimumBillableHours",v)} unit="hours"/>
        <NumberChoice label="How long you expect it to take" value={answer.expectedElapsedHours} options={[1,2,3,4,6,8]} onChange={v=>set("expectedElapsedHours",v)} unit="hours"/>
      </>}
      {current==="Price"&&<>
        <p className="text-sm text-slate-300">Your total before tax, including the costs you would charge. These choices are not suggested or correct prices. Enter any other amount below.</p>
        <NumberChoice label="What would you charge?" value={answer.price} options={[150,250,350,500,750,1000,1500,2000]} onChange={v=>set("price",v)} unit="$"/>
      </>}
      {current==="Reasons"&&<>
        <fieldset><legend className="mb-2 font-semibold">Why? Tap all that apply.</legend><div className="grid grid-cols-2 gap-2">{TRAINING_REASONS.map(reason=><button key={reason} type="button" aria-pressed={answer.reasons.includes(reason)} onClick={()=>set("reasons",answer.reasons.includes(reason)?answer.reasons.filter(r=>r!==reason):[...answer.reasons,reason])} className={`min-h-12 rounded-xl border p-3 text-left text-sm ${answer.reasons.includes(reason)?"border-blue-400 bg-blue-600":"border-slate-700 bg-slate-900"}`}>{reason}</button>)}</div></fieldset>
        <label className="block space-y-2"><span className="font-semibold">Your explanation (optional)</span><Textarea value={answer.notes} onChange={e=>set("notes",e.target.value)} rows={4} maxLength={8000} placeholder="Example: I need 3 movers because of the stairs. The two-hour charge still applies even if it takes less time." className="border-slate-600 bg-slate-900"/></label>
        <label className="block space-y-2"><span>Equipment or skills needed (optional)</span><Textarea value={answer.equipment} onChange={e=>set("equipment",e.target.value)} maxLength={2000} rows={2} className="border-slate-600 bg-slate-900"/></label>
        <label className="block space-y-2"><span>What would you ask the customer? (optional)</span><Textarea value={answer.followUp} onChange={e=>set("followUp",e.target.value)} maxLength={2000} rows={2} className="border-slate-600 bg-slate-900"/></label>
        <div className="rounded-xl bg-slate-900 p-4 text-sm"><strong>Your answer</strong><p className="mt-2">{answer.decision??"No decision"} · {answer.difficulty??"No difficulty"}</p>{answer.decision==="quote"&&<p>Minimum {answer.minimumCrew??"?"} workers; recommend {answer.recommendedCrew??"?"}. Schedule at least {answer.minimumScheduledHours??"?"} hours; bill at least {answer.minimumBillableHours??"?"}. Expected {answer.expectedElapsedHours??"?"} hours. Price ${answer.price??"?"}.</p>}</div>
      </>}
    </fieldset>
    {error&&<p role="alert" className="rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
    <p aria-live="polite" className="text-sm text-slate-300">{saving?"Saving…":message|| (dirty?(storageError?"Not saved. Use Save draft before leaving.":"Draft kept on this phone. Save to sync with your account."):"Choose your answers. There is no prefilled answer key.")}</p>
    <div className={`sticky ${saveEndpoint===endpoint?'bottom-0':'bottom-16'} z-10 space-y-2 border-t border-slate-700 bg-slate-950 py-3 pb-[max(12px,env(safe-area-inset-bottom))]`}>
      <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={saving||step===0} onClick={()=>setStep(s=>Math.max(0,s-1))} className="min-h-12">Back</Button>{current===stages[stages.length-1]?<Button disabled={saving} onClick={()=>void save("reviewed",index<count-1?1:undefined)} className="min-h-12 bg-blue-600">{index<count-1?"Save answer & next":"Save final answer"}</Button>:<Button disabled={saving} onClick={()=>setStep(s=>Math.min(stages.length-1,s+1))} className="min-h-12 bg-blue-600">Next question</Button>}</div>
      <div className="flex flex-wrap justify-between gap-2"><button disabled={saving||index===0} onClick={()=>void move(-1)} className="min-h-11 text-sm text-slate-300 disabled:opacity-40">Previous request</button><button disabled={saving} onClick={()=>void save("draft")} className="min-h-11 text-sm text-blue-300">Save draft</button><button disabled={saving||index===count-1} onClick={()=>void move(1)} className="min-h-11 text-sm text-slate-300 disabled:opacity-40">Skip for now</button></div>
    </div>
  </article>;
}

export default function PricingTrainingPage(){
  const queryClient=useQueryClient();
  const query=useQuery<TrainingData>({queryKey:[endpoint],queryFn:async()=>{const response=await apiRequest("GET",endpoint);return response.json();},refetchOnWindowFocus:false});
  const [index,setIndex]=useState<number|null>(null);
  const [exportError,setExportError]=useState("");
  if(query.isPending)return <p className="p-6 text-white">Loading your training test…</p>;
  if(query.isError||!query.data)return <div className="p-6 text-white"><p role="alert">Could not load your saved test.</p><Button onClick={()=>void query.refetch()}>Retry</Button></div>;
  const data=query.data;
  const answered=Object.values(data.answers).filter(a=>a.status==="reviewed").length;
  const firstOpen=data.scenarios.findIndex(s=>data.answers[s.id]?.status!=="reviewed");
  const active=Math.min(index??Math.max(0,firstOpen),data.scenarios.length-1);
  const scenario=data.scenarios[active];
  async function download(){
    try{setExportError("");const response=await apiRequest("GET",`${endpoint}/export/answers`);const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="jc-pricing-training-answers.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setExportError("Could not export. Please retry.");}
  }
  return <main className="dark mx-auto min-h-screen w-full max-w-2xl space-y-5 bg-slate-950 px-4 py-5 text-white">
    <a href="/crew/pricing-training" className="block rounded-xl bg-blue-700 p-4 font-semibold">Team training · compare answers, review contributions & reward coworkers →</a>
    <header><h1 className="text-2xl font-black">Teach our job pricing</h1><p className="mt-2 text-sm text-slate-300">500 customer requests. Your choices teach us how you price and staff each job.</p><p className="mt-3 font-semibold">{answered} / 500 answered</p><progress aria-label="Training progress" value={answered} max={500} className="mt-2 h-2 w-full accent-blue-500"/><p className="mt-2 text-xs text-slate-400">Training only. Your answers are saved as examples for review before live pricing or crew rules change.</p></header>
    {answered===500&&<p role="status" className="rounded-xl bg-emerald-950 p-4">All 500 answered. Export your answers for pricing and safety-rule review.</p>}
    <ScenarioTest key={scenario.id} scenario={scenario} saved={data.answers[scenario.id]} ownerId={data.ownerId} index={active} count={data.scenarios.length}
      onSaved={saved=>{setIndex(active);queryClient.setQueryData<TrainingData>([endpoint],old=>old?{...old,answers:{...old.answers,[scenario.id]:saved}}:old);}}
      onNavigate={direction=>{setIndex(Math.max(0,Math.min(data.scenarios.length-1,active+direction)));window.scrollTo({top:0,behavior:"smooth"});}}/>
    <Button variant="outline" onClick={()=>void download()} className="min-h-11 w-full">Export my saved answers</Button>{exportError&&<p role="alert">{exportError}</p>}
  </main>;
}
