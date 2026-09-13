import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TaskHeader({title,status,action}:{title:string;status?:ReactNode;action?:ReactNode}) {
  return <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="text-xl font-bold">{title}</h1>{status&&<div className="mt-1 text-sm text-muted-foreground">{status}</div>}</div>{action}</header>;
}

/** Mounted content retains its inputs. Invalid fields open their containing details. */
export function TaskDetails({title,children,defaultOpen=false}:{title:string;children:ReactNode;defaultOpen?:boolean}) {
  const ref=useRef<HTMLDetailsElement>(null);
  return <details ref={ref} open={defaultOpen||undefined} className="group rounded-xl border border-border" onInvalidCapture={()=>{if(ref.current)ref.current.open=true;}}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">{title}<ChevronDown aria-hidden className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"/></summary>
    <div className="space-y-3 border-t border-border p-3">{children}</div>
  </details>;
}

export function RewardsLink(){return <Link href="/marketplace?view=crew" className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-400 underline">Rewards</Link>;}

export function TaskStepNav({steps,value,onChange,disabled=false}:{steps:{id:string;label:string}[];value:string;onChange:(id:string)=>void;disabled?:boolean}) {
  return <nav aria-label="Form steps" className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{steps.map((step,index)=><Button key={step.id} type="button" variant={step.id===value?'default':'outline'} disabled={disabled} aria-current={step.id===value?'step':undefined} className="min-h-11 justify-start text-sm" onClick={()=>onChange(step.id)}>{index+1}. {step.label}</Button>)}</nav>;
}

export function TaskActionBar({children}:{children:ReactNode}) {
  return <div className="sticky bottom-20 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:bottom-3">{children}</div>;
}

export function useUnsavedTask(dirty:boolean) {
  useEffect(()=>{
    if(!dirty)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const navigation=(event:Event)=>{if(!window.confirm('Leave without saving your changes?'))event.preventDefault();};
    const click=(event:MouseEvent)=>{
      const link=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;
      if(!link||link.target==='_blank'||link.download||link.origin!==window.location.origin||link.href===window.location.href||link.getAttribute('href')?.startsWith('#'))return;
      if(!window.confirm('Leave without saving your changes?')){event.preventDefault();event.stopPropagation();}
    };
    window.addEventListener('beforeunload',unload);window.addEventListener('jc:before-navigate',navigation);document.addEventListener('click',click,true);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('jc:before-navigate',navigation);document.removeEventListener('click',click,true);};
  },[dirty]);
}

export function canLeaveTask(){return window.dispatchEvent(new Event('jc:before-navigate',{cancelable:true}));}
