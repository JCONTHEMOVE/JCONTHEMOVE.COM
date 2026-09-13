import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, MapPin, Target, MessageSquare, Lightbulb, Check, ChevronDown, RotateCcw, Rocket, Trophy, Users, BookOpen, Megaphone, CalendarCheck, ShieldCheck } from 'lucide-react';
import { MARKETING_BOT_TERRITORIES, MARKETING_TERRITORY_LABELS } from '@shared/marketingBot';
import { DEFAULT_GROWTH_GOALS, GROWTH_GOALS } from '@shared/crewGrowth';

import { WorkerPhotoAvatar } from './WorkerPhotoAvatar';
import { DailySpinCard } from './DailySpinCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

type Goals = typeof DEFAULT_GROWTH_GOALS;
type Setup = {
  enrolled:boolean;reason?:string;ready?:boolean;goals?:Goals;
  rep?:{promo_code:string;promo_verified:boolean;territories:string[];message:string;ideas:string};
  partner?:{lane:string;backup:string};
  steps?:Array<{key:string;label:string;done:boolean}>;
  campaigns?:Array<{id:string;headline:string;destination_url:string}>;
};
const goalIcons={outreach:Megaphone,qualifiedInquiries:Users,bookings:Trophy,scenarios:BookOpen,activeDays:CalendarCheck};
const stepIcons={promo:ShieldCheck,areas:MapPin,message:MessageSquare,campaign:Rocket};

export function MarketingBotSetupCard() {
  const queryClient=useQueryClient();
  const {toast}=useToast();
  const setup=useQuery<Setup>({queryKey:['/api/marketing-execution/bot-setup']});
  const [territories,setTerritories]=useState<string[]>([]);
  const [message,setMessage]=useState('');
  const [ideas,setIdeas]=useState('');
  const [goals,setGoals]=useState<Goals>(DEFAULT_GROWTH_GOALS);

  const [editing,setEditing]=useState(false);
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{
    if(setup.data?.rep && !editing){
      setTerritories(setup.data.rep.territories);setMessage(setup.data.rep.message);setIdeas(setup.data.rep.ideas);
      setGoals(setup.data.goals||DEFAULT_GROWTH_GOALS);

    }
  },[setup.data,editing]);
  const save=useMutation({
    mutationFn:async()=> (await apiRequest('PUT','/api/marketing-execution/bot-setup',{territories,message,ideas,goals})).json(),
    onSuccess:(data:Setup)=>{queryClient.setQueryData(['/api/marketing-execution/bot-setup'],data);setEditing(false);toast({title:'Mission controls saved',description:data.ready?'Your approved campaign is ready to share.':'Saved. Your checklist shows what is next.'});},
    onError:(error:Error)=>toast({title:'Setup was not saved',description:error.message,variant:'destructive'}),
  });
  if(setup.isLoading)return <p role="status">Loading your arcade…</p>;
  if(setup.isError)return <div role="alert">Arcade could not load. <Button onClick={()=>setup.refetch()}>Retry</Button></div>;
  const data=setup.data;
  if(!data?.enrolled)return <p className="rounded-xl border p-4 text-sm">{data?.reason}</p>;
  const completed=data.steps?.filter(step=>step.done).length||0;
  const visibleAreas=expanded?MARKETING_BOT_TERRITORIES:MARKETING_BOT_TERRITORIES.filter(area=>territories.includes(area));
  const dirtyMessage=message.trim().length<30;
  return <section aria-labelledby="bot-setup-title" className="min-w-0 overflow-hidden rounded-3xl border border-cyan-400/30 bg-slate-950 text-slate-100 shadow-xl">
    <div className="space-y-4 bg-gradient-to-br from-indigo-950 via-slate-950 to-cyan-950 p-4 sm:p-5">
      <div className="flex items-center gap-3"><div className="rounded-2xl bg-cyan-300/15 p-3"><Bot className="h-7 w-7 text-cyan-300" aria-hidden="true"/></div><div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Crew growth arcade</p><h2 id="bot-setup-title" className="text-xl font-black">Power up your bot</h2></div><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-cyan-400 bg-slate-900 text-lg font-black" aria-label={`${completed} of 4 setup steps complete`}>{completed}<span className="text-xs text-slate-400">/4</span></div></div>
      <div className="grid grid-cols-4 gap-2" aria-label="Setup checkpoints">{data.steps?.map(step=>{const Icon=stepIcons[step.key as keyof typeof stepIcons]||Check;return <div key={step.key} title={step.label} className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center ${step.done?'border-emerald-400/40 bg-emerald-400/10 text-emerald-200':'border-slate-700 text-slate-400'}`}><Icon className="h-5 w-5" aria-hidden="true"/><span className="text-[10px] font-semibold">{({promo:'Code',areas:'Areas',message:'Message',campaign:'Campaign'} as Record<string,string>)[step.key]}</span><span className="text-[10px]">{step.done?'✓ Ready':'To do'}</span></div>;})}</div>
      <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-indigo-400/15 px-3 py-2">{data.partner?.lane}</span><span className="rounded-full bg-slate-800 px-3 py-2">Backup · {data.partner?.backup}</span><span className="break-all rounded-full bg-slate-800 px-3 py-2">{data.rep?.promo_verified?'✓':'!'} {data.rep?.promo_code}</span></div>
    </div>
    <div className="space-y-4 p-4 sm:p-5">
      <DailySpinCard />
      <WorkerPhotoAvatar />

      <div className="rounded-2xl border border-slate-800 p-3">
        <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-bold"><MapPin className="h-4 w-4 text-cyan-300"/>My areas <span className="text-cyan-300">{territories.length}</span></h3><button type="button" className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-cyan-200 focus-visible:outline focus-visible:outline-2" aria-expanded={expanded} aria-controls="worker-bot-areas" onClick={()=>setExpanded(!expanded)}>{expanded?'Simplify':'Expand'}<ChevronDown className={`h-4 w-4 ${expanded?'rotate-180':''}`}/></button></div>
        <div id="worker-bot-areas" className="grid grid-cols-2 gap-2">{visibleAreas.map(area=><label key={area} className={`relative flex min-h-16 cursor-pointer items-center gap-2 rounded-xl border p-2 text-xs font-semibold ${territories.includes(area)?'border-cyan-300/60 bg-cyan-300/10':'border-slate-700 bg-slate-900'}`}><input className="h-5 w-5 shrink-0 accent-cyan-400" type="checkbox" disabled={save.isPending} checked={territories.includes(area)} onChange={event=>{setEditing(true);setTerritories(current=>event.target.checked?[...current,area]:current.filter(value=>value!==area));}}/>{MARKETING_TERRITORY_LABELS[area]}</label>)}</div>
        {!visibleAreas.length&&<Button variant="outline" className="w-full min-h-11" onClick={()=>setExpanded(true)}>Choose areas</Button>}
        {expanded&&<div className="mt-2 flex gap-2"><Button variant="ghost" disabled={save.isPending} className="min-h-11 text-xs" onClick={()=>{setEditing(true);setTerritories([...MARKETING_BOT_TERRITORIES]);}}>Check all</Button><Button variant="ghost" disabled={save.isPending} className="min-h-11 text-xs" onClick={()=>{setEditing(true);setTerritories([]);}}>Clear all</Button></div>}
      </div>
      <details className="rounded-2xl border border-slate-800 p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-bold"><Target className="mr-2 inline h-4 w-4 text-violet-300"/>Tune weekly goals <span className="ml-1 text-xs font-normal text-slate-400">{Object.values(goals).filter(value=>value>0).length} on</span></summary>
        <div className="space-y-5 py-3">{GROWTH_GOALS.map(goal=>{const Icon=goalIcons[goal.key];const value=goals[goal.key];return <div key={goal.key}><div className="mb-2 flex items-center gap-2"><input type="checkbox" id={`goal-enabled-${goal.key}`} className="h-5 w-5 accent-violet-400" disabled={save.isPending} checked={value>0} onChange={event=>{setEditing(true);setGoals(current=>({...current,[goal.key]:event.target.checked?goal.initial:0}));}}/><label htmlFor={`goal-enabled-${goal.key}`} className="flex min-h-11 flex-1 items-center gap-2 text-sm"><Icon className="h-4 w-4 text-violet-300"/>{goal.label}</label><output htmlFor={`goal-slider-${goal.key}`} className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-violet-400/50 bg-violet-400/10 text-sm font-bold">{value||'Off'}</output></div><input id={`goal-slider-${goal.key}`} aria-label={`${goal.label} weekly target`} type="range" min={1} max={goal.max} step={1} value={value||1} disabled={!value||save.isPending} className="h-8 w-full cursor-pointer accent-violet-400 disabled:opacity-30" onChange={event=>{setEditing(true);setGoals(current=>({...current,[goal.key]:Number(event.target.value)}));}}/></div>;})}</div>
        <Button variant="ghost" className="min-h-11 text-xs" disabled={save.isPending} onClick={()=>{setEditing(true);setGoals({...DEFAULT_GROWTH_GOALS});}}><RotateCcw className="mr-2 h-4 w-4"/>Starter goals</Button><p className="mt-2 text-xs text-slate-400">Personal targets only. Reward rules and earned progress stay unchanged.</p>
      </details>
      <details className="rounded-2xl border border-slate-800 p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-bold"><MessageSquare className="mr-2 inline h-4 w-4 text-amber-300"/>My message <span className="text-xs font-normal text-slate-400">{dirtyMessage?'· needs setup':'· drafted'}</span></summary><label htmlFor="worker-bot-message" className="my-2 block text-xs text-slate-400">Personalize your introduction (30–1,500 characters)</label><Textarea id="worker-bot-message" value={message} maxLength={1500} disabled={save.isPending} onChange={event=>{setEditing(true);setMessage(event.target.value);}} placeholder="How can you help your neighbors?"/><Button variant="ghost" className="mt-2 min-h-11 text-xs" disabled={save.isPending} onClick={()=>{setEditing(true);setMessage(`I help local families with ${data.partner?.lane.toLowerCase()}. Tell JC ON THE MOVE what you need and ask for a quote. Let's plan your next project together.`);}}>Use starter message</Button></details>
      <details className="rounded-2xl border border-slate-800 p-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-bold"><Lightbulb className="mr-2 inline h-4 w-4 text-amber-300"/>Feed the bot an idea</summary><label htmlFor="worker-bot-ideas" className="my-2 block text-xs text-slate-400">Topics or community needs. No customer contact details.</label><Textarea id="worker-bot-ideas" value={ideas} maxLength={1500} disabled={save.isPending} onChange={event=>{setEditing(true);setIdeas(event.target.value);}} placeholder="What could help your community this week?"/></details>
      <div className="space-y-2"><Button className="min-h-12 w-full rounded-xl bg-cyan-300 font-bold text-slate-950 hover:bg-cyan-200" disabled={save.isPending||!territories.length||dirtyMessage} onClick={()=>save.mutate()}><Rocket className="mr-2 h-5 w-5"/>{save.isPending?'Saving…':editing?'Save mission controls':'Save setup'}</Button><p className="text-center text-xs text-slate-400" role="status">{editing?'Unsaved changes':data.ready?'Ready to share an approved campaign':'Next: '+(data.steps?.find(step=>!step.done)?.label||'review your setup')}</p></div>
      {data.campaigns?.map(campaign=><a className="flex min-h-12 items-center gap-2 break-words rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200" key={campaign.id} href={campaign.destination_url} target="_blank" rel="noreferrer"><Rocket className="h-5 w-5 shrink-0"/>Play: {campaign.headline}</a>)}
      <details className="text-xs text-slate-400"><summary className="min-h-11 cursor-pointer content-center">How this works</summary><p className="pb-3">Areas are shared. Your saved ideas guide bot drafts; an owner approves campaigns. Setup clicks earn no financial reward. Copying content is not proof of publication. Readiness requires a verified code and approved campaign.</p></details>
    </div>
  </section>;
}


