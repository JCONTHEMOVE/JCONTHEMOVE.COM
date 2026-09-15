import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';

type Alert={event_key:string;review_id:string;status:string;error:string|null};
function DeliveryRow({alert}:{alert:Alert}) {
  const client=useQueryClient();
  const [reason,setReason]=useState('');const [messageId,setMessageId]=useState('');
  const action=useMutation({mutationFn:async(kind:'retry'|'delivered'|'not_delivered')=>apiRequest('POST',`/api/admin/marketing-execution/review-alerts/${kind==='retry'?'retry':'reconcile'}`,{eventKey:alert.event_key,...(kind!=='retry'?{action:kind,reason,...(messageId?{messageId}:{})}:{})}),onSuccess:()=>client.invalidateQueries({queryKey:['/api/admin/marketing-execution/review-alerts']})});
  return <div className="min-w-0 space-y-2 rounded-xl border border-slate-700 p-3 text-sm"><p className="break-all font-semibold">{alert.review_id}</p><p className="text-xs">{alert.status} · {alert.error||'Delivery recorded'}</p>
    {alert.status==='failed'&&<Button disabled={action.isPending} onClick={()=>action.mutate('retry')}>Retry confirmed failure</Button>}
    {alert.status==='uncertain'&&<><label className="block text-xs">Reconciliation evidence<Input value={reason} onChange={event=>setReason(event.target.value)} placeholder="What did you verify in Discord?"/></label><label className="block text-xs">Discord message ID (if delivered)<Input value={messageId} onChange={event=>setMessageId(event.target.value)}/></label><div className="flex flex-wrap gap-2"><Button disabled={action.isPending||reason.trim().length<10||!/^\d+$/.test(messageId)} onClick={()=>action.mutate('delivered')}>Confirm delivered</Button><Button variant="outline" disabled={action.isPending||reason.trim().length<10} onClick={()=>action.mutate('not_delivered')}>Confirmed absent: retry</Button></div></>}
    {action.error&&<p role="alert">{action.error.message}</p>}
  </div>;
}
export function MarketingGrowthReview() {
  const readiness=useQuery<Array<{slug:string;lane:string;setup:{ready?:boolean;reason?:string;steps?:Array<{key:string;label:string;done:boolean}>}}>>({queryKey:['/api/admin/marketing-execution/bot-readiness']});
  const deliveries=useQuery<Alert[]>({queryKey:['/api/admin/marketing-execution/review-alerts'],refetchInterval:60000});
  return <section className="mb-5 space-y-4 rounded-2xl border border-cyan-400/25 bg-slate-950 p-4 text-slate-100"><h2 className="flex items-center gap-2 font-bold"><Bot className="h-5 w-5 text-cyan-300"/>Worker bot launch</h2>
    <div className="grid gap-3 sm:grid-cols-2">{readiness.data?.map(worker=><article key={worker.slug} className="rounded-xl border border-slate-700 p-3"><h3 className="font-bold capitalize">{worker.slug} {worker.setup.ready&&<Check className="inline h-4 w-4 text-emerald-300"/>}</h3><p className="text-xs text-slate-400">{worker.lane}</p><ul className="mt-2 space-y-1 text-xs">{worker.setup.steps?.map(step=><li key={step.key}>{step.done?'✓':'○'} {step.label}</li>)}</ul>{worker.setup.reason&&<p className="mt-2 text-xs text-amber-300">{worker.setup.reason}</p>}</article>)}</div>
    {readiness.isLoading&&<p role="status">Loading worker readiness…</p>}{readiness.isError&&<p role="alert">Worker readiness could not load.</p>}
    <details><summary className="min-h-11 cursor-pointer content-center text-sm font-semibold"><AlertTriangle className="mr-2 inline h-4 w-4 text-amber-300"/>Review & tip Discord deliveries</summary><div className="space-y-2">{deliveries.data?.map(alert=><DeliveryRow key={alert.event_key} alert={alert}/>)}{deliveries.data?.length===0&&<p className="text-sm text-slate-400">No review alerts queued yet.</p>}{deliveries.isError&&<p role="alert">Delivery queue could not load.</p>}</div></details>
  </section>;
}
