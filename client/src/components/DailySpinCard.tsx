import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Gift, Clock3 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';

export function DailySpinCard({onOpen}:{onOpen?:()=>void}) {
  const {user}=useAuth();const client=useQueryClient();const [,navigate]=useLocation();
  const status=useQuery<{enabled:boolean;canClaim:boolean;available:boolean;nextResetAt:string}>({queryKey:['/api/reward-shop/daily-spin'],enabled:!!user,refetchInterval:60000});
  const open=()=>onOpen?onOpen():navigate('/marketplace?spin=1');
  const claim=useMutation({mutationFn:async()=>(await apiRequest('POST','/api/reward-shop/daily-spin/claim',{})).json(),onSuccess:async(data:{available:boolean})=>{
    await Promise.all([client.invalidateQueries({queryKey:['/api/reward-shop/daily-spin']}),client.invalidateQueries({queryKey:['/api/reward-shop/free-spins']})]);if(data.available)open();
  }});
  const ready=status.data?.enabled&&(status.data.canClaim||status.data.available);
  return <section className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/15 to-violet-500/10 p-4" aria-label="Free daily spin"><div className="flex items-center gap-3"><Gift className="h-8 w-8 shrink-0 text-amber-400"/><div><h2 className="font-bold">Your free daily spin</h2><p className="text-xs text-muted-foreground">One free spin each Chicago day · No wallet charge</p></div></div>
    <Button className="mt-3 min-h-11 w-full bg-amber-400 font-bold text-slate-950 hover:bg-amber-300" disabled={!!user&&(claim.isPending||status.isLoading||!ready)} onClick={()=>!user?navigate('/login'):status.data?.available?open():claim.mutate()}>{!user?'Sign in for your free spin':claim.isPending?'Unlocking…':ready?'Spin free now':status.isLoading?'Checking…':status.isError?'Unable to check spin':status.data?.enabled?'Come back tomorrow':'Spin temporarily unavailable'}</Button>
    {user&&status.data&&!ready&&status.data.enabled&&<p className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3"/>Next spin: {new Date(status.data.nextResetAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} Chicago</p>}
    {status.isError&&<Button variant="ghost" onClick={()=>status.refetch()}>Retry</Button>}{claim.error&&<p role="alert" className="mt-2 text-sm text-rose-400">{claim.error.message}</p>}
  </section>;
}
