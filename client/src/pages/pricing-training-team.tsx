import { TrainingJobSnapshot } from '@/components/training-job-snapshot';
import { TrainingScoreboard } from '@/components/training-scoreboard';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { ScenarioTest } from './admin/pricing-training';
import { emptyTrainingAnswer, type TrainingAnswer, type SavedTrainingAnswer, type PricingTrainingScenario } from '@shared/pricingTraining';
import { answerDistribution, TRAINING_REWARDS, type TrainingGrade, type TrainingScore } from '@shared/pricingTrainingTeam';

const endpoint='/api/pricing-training-team';
type Contribution={id:string;userId:string;displayName:string;answer:TrainingAnswer;revision:number;grade:TrainingGrade|null;rewardAmount:number;reviewNote:string|null;thanksStatus?:string};
type Data={ownerId:string;userId:string;canReview:boolean;scenarios:PricingTrainingScenario[];completed:string[];myScore:TrainingScore;leaderboard:Omit<TrainingScore,'drafts'>[];counts:{scenario_id:string;responses:number;pending:number}[];answers:Record<string,SavedTrainingAnswer&{grade:TrainingGrade|null;rewardAmount:number;reviewNote:string|null}>};
type Detail={canCompare:boolean;responses:Contribution[];final:SavedTrainingAnswer|null};
const labels:Record<TrainingGrade,string>={contribution:'Contribution',mostly_correct:'Mostly correct',correct:'Correct',rejected:'No reward (spam / invalid)'};
async function get<T>(url:string):Promise<T>{return (await apiRequest('GET',url)).json();}

function Distribution({answers,field,label}:{answers:TrainingAnswer[];field:keyof TrainingAnswer;label:string}){
  const bins=answerDistribution(answers,field),max=Math.max(1,...bins.map(b=>b.count));
  return <figure className="min-w-0 rounded-xl border border-slate-700 p-3"><figcaption className="mb-3 font-semibold">{label}</figcaption>
    {bins.length? <ul className="max-h-64 space-y-2 overflow-y-auto" aria-label={`${label} distribution`}>{bins.map(b=><li key={b.label} className="text-sm">
      <div className="flex justify-between gap-3"><span>{field==='price'?'$':''}{b.label.replaceAll('_',' ')}</span><span>{b.count} {b.count===1?'response':'responses'}</span></div>
      <div className="mt-1 h-3 rounded bg-slate-800" aria-hidden="true"><div className="h-3 rounded bg-blue-500" style={{width:`${b.count/max*100}%`}}/></div>
    </li>)}</ul>:<p className="text-sm text-slate-400">No values supplied.</p>}
  </figure>;
}

function ReviewCard({response,canReview,userId,onAdopt,onReviewed}:{response:Contribution;canReview:boolean;userId:string;onAdopt:()=>void;onReviewed:()=>Promise<unknown>}){
  const [grade,setGrade]=useState<TrainingGrade>('contribution'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function review(){setBusy(true);setError('');try{await apiRequest('POST',`${endpoint}/review/${response.id}`,{revision:response.revision,grade,note});await onReviewed();}catch(e){setError(e instanceof Error?e.message:'Review failed. Please retry.');}finally{setBusy(false);}}
  const a=response.answer;
  return <article className="min-w-0 space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
    <h3 className="font-bold">{response.displayName}{response.userId===userId?' (you)':''}</h3>
    <p className="text-sm">{a.decision} · {a.difficulty} difficulty · {a.price==null?'No price':`$${a.price}`}</p>
    <p className="text-sm text-slate-300">Crew: minimum {a.minimumCrew??'—'}, recommended {a.recommendedCrew??'—'} · Hours: minimum {a.minimumScheduledHours??'—'}, billed {a.minimumBillableHours??'—'}, expected {a.expectedElapsedHours??'—'}</p>
    <p className="text-sm">{a.reasons.join(' · ')}</p><p className="whitespace-pre-wrap break-words text-sm">{a.notes}</p>
    {a.equipment&&<p className="text-sm">Equipment: {a.equipment}</p>}{a.followUp&&<p className="text-sm">Follow-up: {a.followUp}</p>}
    {response.grade?<p className="text-sm text-emerald-300">{labels[response.grade]} · {response.rewardAmount} JCMOVES credited<br/>{response.reviewNote}</p>:<p className="text-sm text-amber-300">Awaiting owner review · 100 JCMOVES base, up to 100 bonus</p>}
    {canReview&&<Button className="min-h-12 w-full" variant="outline" onClick={onAdopt}>Use as starting point for final answer</Button>}
    {canReview&&!response.grade&&response.userId!==userId&&<fieldset disabled={busy} className="space-y-3 border-t border-slate-700 pt-3">
      <label className="block text-sm">Owner rating<select value={grade} onChange={e=>setGrade(e.target.value as TrainingGrade)} className="mt-1 min-h-12 w-full rounded bg-slate-800 p-2">{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label} · {TRAINING_REWARDS[value as TrainingGrade]} JCMOVES total</option>)}</select></label>
      <label className="block text-sm">Review explanation<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} className="mt-1 min-h-24 w-full rounded bg-slate-800 p-3"/></label>
      <Button disabled={busy||!note.trim()} className="min-h-12 w-full" onClick={()=>void review()}>{busy?'Saving review…':`Approve review${TRAINING_REWARDS[grade]?` & credit ${TRAINING_REWARDS[grade]} JCMOVES`:' without reward'}`}</Button>
      <p className="text-xs text-slate-400">One payout per coworker per request. This rating does not finalize the team answer.</p>
    </fieldset>}
    {canReview&&response.thanksStatus&&<p className="text-xs text-slate-400">Discord thank-you: {response.thanksStatus==='sending'?'delivery pending / unconfirmed':response.thanksStatus}</p>}
    {canReview&&response.thanksStatus==='failed'&&<Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);void apiRequest('POST',`${endpoint}/thanks/${response.id}/retry`).then(onReviewed).catch(()=>setError('Could not retry Discord delivery.')).finally(()=>setBusy(false));}}>Retry failed Discord thank-you</Button>}
    {error&&<p role="alert" className="text-red-300">{error}</p>}
  </article>;
}

function TeamRequest({data,index,onNavigate}:{data:Data;index:number;onNavigate:(direction:number)=>void}){
  const {toast}=useToast();
  const queryClient=useQueryClient(),s=data.scenarios[index];
  const detail=useQuery<Detail>({queryKey:[endpoint,s.id,data.userId],queryFn:()=>get(`${endpoint}/scenario/${s.id}`),refetchOnWindowFocus:false});
  const [mode,setMode]=useState<'compare'|'contribute'|'final'>(data.canReview?'compare':'contribute');
  const [seed,setSeed]=useState<Contribution|null>(null);
  async function refresh(){await Promise.all([queryClient.invalidateQueries({queryKey:[endpoint],exact:true}),detail.refetch()]);}
  const mine=data.answers[s.id];
  const canCompare=data.canReview||(mine?.status==='reviewed'&&detail.data?.canCompare===true);
  const ownerAnswer=detail.data?.final??undefined;
  const initialFinal=seed?{answer:seed.answer,status:'draft' as const,revision:ownerAnswer?.revision??0,updatedAt:ownerAnswer?.updatedAt??''}:ownerAnswer;
  const go=(delta:number)=>{setSeed(null);onNavigate(delta);};
  return <section className="space-y-5">
    <TrainingJobSnapshot scenario={s} index={index} count={data.scenarios.length} finalized={data.completed.includes(s.id)}/>
    <div className="flex flex-wrap gap-2"><Button className="min-h-12" disabled={!canCompare} variant={mode==='compare'?'default':'outline'} onClick={()=>setMode('compare')}>{canCompare?`Compare responses (${detail.data?.responses.length??0})`:'Compare after submitting'}</Button>
      <Button className="min-h-12" variant={mode==='contribute'?'default':'outline'} onClick={()=>setMode('contribute')}>My contribution</Button>
      {data.canReview&&<Button className="min-h-12" variant={mode==='final'?'default':'outline'} onClick={()=>{setSeed(null);setMode('final');}}>Owner final answer</Button>}
    </div>
    {!data.canReview&&!canCompare&&<p className="rounded-xl border border-blue-500/40 p-3 text-sm">Submit your own answer to this request first. Coworker responses, charts, and the owner's final answer stay hidden until you submit. Saving a draft does not unlock them.</p>}
    {!data.canReview&&detail.isError&&<p role="alert">Could not check comparison access. <Button variant="outline" onClick={()=>void detail.refetch()}>Retry</Button></p>}
    {mine?.status==='reviewed'&&<div role="status" className={`rounded-2xl border p-5 ${mine.grade?'border-emerald-400 bg-emerald-950/60':'border-amber-400 bg-amber-950/40'}`}>
      <p className="text-sm font-semibold">{mine.grade?'Owner review complete':'✓ Answer submitted'}</p>
      <p className="mt-2 text-2xl font-black">{mine.grade?(mine.rewardAmount?`+${mine.rewardAmount} JCMOVES credited`:'No JCMOVES credited'):'100–200 JCMOVES pending approval'}</p>
      <p className="mt-2 text-sm">{mine.grade?`${labels[mine.grade]}${mine.rewardAmount?` · 100 contribution + ${Math.max(0,mine.rewardAmount-100)} bonus`:''}`:'Your contribution is saved. The owner reviews it before any reward is credited.'}</p>
      {mine.reviewNote&&<p className="mt-2 whitespace-pre-wrap text-sm">{mine.reviewNote}</p>}
    </div>}
    {mode==='contribute'&&(mine?.grade?<div className="rounded-xl bg-slate-900 p-4"><p className="mt-2 text-sm text-slate-400">Reviewed submissions are kept unchanged for the reward audit.</p></div>:<><p className="text-sm text-slate-300">Submit your own judgment and explanation. Saving an answer submits it for owner review; drafts do not earn rewards.</p>
      <ScenarioTest showSnapshot={false} scenario={s} saved={mine} ownerId={`team:${data.userId}`} index={index} count={500} saveEndpoint={endpoint} onSaved={value=>{queryClient.setQueryData<Data>([endpoint],old=>old?{...old,answers:{...old.answers,[s.id]:{...value,grade:null,rewardAmount:0,reviewNote:null}}}:old);if(value.status==='reviewed')toast({title:'✓ Answer submitted',description:'JCMOVES pending owner approval: 100 for contribution, 150 mostly correct, or 200 correct.'});void refresh();}} onNavigate={go}/></>)}
    {mode==='final'&&data.canReview&&(detail.isPending?<p>Loading final answer…</p>:detail.isError?<p role="alert">Cannot load the final answer. Return to comparisons and retry.</p>:<><p className="rounded-xl border border-blue-500 p-3 text-sm">{seed?`Starting from ${seed.displayName}'s response. `:''}Review or override every value, then save the final answer. Only this answer counts toward the shared 500 goal.</p>
      <ScenarioTest showSnapshot={false} key={`${s.id}:final:${seed?.id??'owner'}:${ownerAnswer?.revision??0}`} scenario={s} saved={initialFinal} ownerId={`final:${data.userId}:${seed?.id??'owner'}`} index={index} count={500} saveEndpoint={`${endpoint}/final`} onSaved={()=>{setSeed(null);void refresh();}} onNavigate={go}/></>)}
    {mode==='compare'&&canCompare&&<>
      {detail.isPending?<p>Loading responses…</p>:detail.isError?<div role="alert">Could not load responses. <Button onClick={()=>void detail.refetch()}>Retry</Button></div>:<>
        <p className="text-sm text-slate-400">Charts show submitted responses, not a vote on correctness. Missing values are excluded. The owner makes the final decision.</p>
        {!!detail.data?.responses.length&&<div className="grid min-w-0 gap-3 sm:grid-cols-2">{([['price','Price'],['minimumCrew','Minimum crew'],['recommendedCrew','Recommended crew'],['minimumScheduledHours','Minimum scheduled hours'],['minimumBillableHours','Minimum billed hours'],['expectedElapsedHours','Expected hours'],['difficulty','Difficulty'],['decision','Decision']] as [keyof TrainingAnswer,string][]).map(([field,label])=><Distribution key={field} field={field} label={label} answers={detail.data!.responses.map(r=>r.answer)}/>)}</div>}
        {ownerAnswer?.status==='reviewed'&&<div className="rounded-xl border border-emerald-500 p-4"><h3 className="font-bold">Owner’s final answer</h3><p className="text-sm">{ownerAnswer.answer.decision} · {ownerAnswer.answer.difficulty} · {ownerAnswer.answer.price==null?'No price':`$${ownerAnswer.answer.price}`} · Minimum crew {ownerAnswer.answer.minimumCrew??'—'} · Minimum hours {ownerAnswer.answer.minimumScheduledHours??'—'}</p><p className="whitespace-pre-wrap text-sm">{ownerAnswer.answer.notes}</p></div>}
        {!detail.data?.responses.length&&<p>No coworker responses yet. Be the first to contribute.</p>}
        {detail.data?.responses.map(r=><ReviewCard key={`${r.id}:${r.revision}:${r.grade}`} response={r} canReview={data.canReview} userId={data.userId} onReviewed={refresh} onAdopt={()=>{setSeed(r);setMode('final');}}/>)}
      </>}
    </>}
  </section>;
}

export default function PricingTrainingTeamPage(){
  const query=useQuery<Data>({queryKey:[endpoint],queryFn:()=>get(endpoint),refetchOnWindowFocus:true,refetchInterval:30000});
  const {toast}=useToast();
  const previousReviews=useRef<{userId:string;grades:Record<string,string|null>}|null>(null);
  useEffect(()=>{
    const d=query.data;if(!d)return;
    if(previousReviews.current?.userId===d.userId){for(const [id,a] of Object.entries(d.answers)){
      if(a.grade&&!previousReviews.current.grades[id])toast({title:a.rewardAmount?`+${a.rewardAmount} JCMOVES · Owner verified`:'Owner review complete',description:`${id}: ${a.reviewNote||labels[a.grade]}`});
    }}
    previousReviews.current={userId:d.userId,grades:Object.fromEntries(Object.entries(d.answers).map(([id,a])=>[id,a.grade]))};
  },[query.data,toast]);
  const [index,setIndex]=useState<number|null>(null),[copied,setCopied]=useState(false);
  const [awarding,setAwarding]=useState(false),[prizeResult,setPrizeResult]=useState('');
  async function awardDailyPrize(){
    setAwarding(true);setPrizeResult('');
    try{const result=await (await apiRequest('POST',`${endpoint}/daily-prize`)).json();
      setPrizeResult(`${result.day}: ${result.awards.length?`${result.alreadyAwarded?'Already credited':'Credited'} — ${result.awards.map((a:{displayName:string;amount:number})=>`${a.displayName}: ${a.amount} JCMOVES`).join('; ')}`:'No eligible verified points; no prize awarded.'}`);
    }catch{setPrizeResult('Could not confirm the daily prize. Retry safely; the same day cannot be paid twice.');}finally{setAwarding(false);}
  }
  if(query.isPending)return <p className="p-6">Loading team training…</p>;
  if(query.isError||!query.data)return <div className="p-6"><p role="alert">Team training is available to approved crew and owners. Could not load it.</p><Button onClick={()=>void query.refetch()}>Retry</Button></div>;
  const d=query.data,linked=d.scenarios.findIndex(s=>s.id===new URLSearchParams(window.location.search).get('scenario'));
  const active=Math.min(index??(linked>=0?linked:Math.max(0,d.scenarios.findIndex(s=>!d.completed.includes(s.id)))),499);
  return <main className="dark mx-auto min-h-screen w-full max-w-3xl space-y-6 bg-slate-950 px-4 py-6 text-white">
    <header className="space-y-3"><h1 className="text-2xl font-black">500 requests · one team goal</h1><p className="text-sm text-slate-300">Contribute your pricing judgment. The owner reviews, rewards, and finalizes each request.</p><p className="text-xl font-bold">{d.completed.length} / 500 finalized together</p><progress aria-label="Team completion" value={d.completed.length} max={500} className="h-3 w-full accent-blue-500"/>
      <p className="text-sm text-slate-300">100 for contribution · 150 mostly correct · 200 correct. All rewards require owner approval. One reward per coworker per request.</p>
      <Button className="min-h-12" variant="outline" onClick={()=>{void navigator.clipboard.writeText(`${window.location.origin}/crew/pricing-training`).then(()=>setCopied(true)).catch(()=>setCopied(false));}}>{copied?'Link copied':'Copy coworker link'}</Button>
      <p className="break-all text-xs text-blue-300">{window.location.origin}/crew/pricing-training</p>
      {d.canReview&&<a className="block py-3 text-sm text-blue-300 underline" href="/admin/pricing-training">Your original answers & export</a>}
      {d.completed.length===500&&<p role="status" className="rounded-xl bg-emerald-950 p-4">All 500 finalized together! Ready for owner review of pricing and safety rules. Live rules have not changed automatically.</p>}
    </header>
    <TrainingScoreboard mine={d.myScore} entries={d.leaderboard} total={d.scenarios.length}/>
    <section className="rounded-2xl border border-amber-400/40 bg-amber-950/30 p-4" aria-label="Daily leaderboard prize">
      <h2 className="font-bold text-amber-200">Daily leader prize · 1,000 JCMOVES</h2>
      <p className="mt-2 text-sm">Most scenario JCMOVES verified by the owner during a Chicago calendar day wins. Tied leaders split 1,000 equally (extra whole tokens follow a fixed order). No verified points means no prize. Prizes are credited separately to your wallet after the day ends.</p>
      {d.canReview&&<Button className="mt-3 min-h-12" disabled={awarding} onClick={()=>void awardDailyPrize()}>{awarding?'Checking daily prize…':"Award yesterday's leaders"}</Button>}
      {prizeResult&&<p role="status" className="mt-3 text-sm">{prizeResult}</p>}
    </section>
    <label className="block text-sm">Choose a request<select aria-label="Choose team request" value={active} onChange={e=>setIndex(Number(e.target.value))} className="mt-2 min-h-12 w-full min-w-0 rounded-xl bg-slate-900 p-3">{d.scenarios.map((s,i)=>{const count=d.counts.find(c=>c.scenario_id===s.id);return <option key={s.id} value={i}>{i+1}. {d.completed.includes(s.id)?'✓ ':''}{s.title} ({count?.responses??0} responses{d.canReview?`, ${count?.pending??0} pending`:''})</option>;})}</select></label>
    <TeamRequest key={d.scenarios[active].id} data={d} index={active} onNavigate={delta=>{setIndex(Math.max(0,Math.min(499,active+delta)));window.scrollTo({top:0});}}/>
    <div className="flex justify-between"><Button className="min-h-12" disabled={active===0} onClick={()=>setIndex(active-1)}>Previous request</Button><Button className="min-h-12" disabled={active===499} onClick={()=>setIndex(active+1)}>Next request</Button></div>
  </main>;
}
