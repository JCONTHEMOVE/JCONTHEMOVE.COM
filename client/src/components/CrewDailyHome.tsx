import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewDailyHome as DailyHome } from '@shared/crewDailyHome';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

const endpoint = '/api/crew/marketing/daily-home';
const fieldClass = 'border-slate-600 bg-slate-950 min-h-11';
const copyClass = 'min-h-11 border-slate-600 bg-slate-950 text-white hover:bg-slate-800 hover:text-white';
function Mission({ title, status, children }: { title: string; status?: string; children: React.ReactNode }) {
  const finished = status === 'submitted' || status === 'completed';
  return <details open={finished ? false : undefined} className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-3">
    <summary className="min-h-11 cursor-pointer py-2 font-bold text-white">{title}{finished && <span className="mt-1 block text-xs font-normal text-emerald-300">{status === 'completed' ? 'Reviewed by owner' : 'Submitted for review'}</span>}</summary>
    <div className="mt-2 space-y-3 text-sm text-slate-300">{children}</div>
  </details>;
}

export function CrewDailyHome() {
  const home = useQuery<DailyHome>({ queryKey: [endpoint], refetchOnWindowFocus: true });
  const queryClient = useQueryClient(), { toast } = useToast();
  const [destination, setDestination] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofNotes, setProofNotes] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [outcome, setOutcome] = useState('');
  const [followDate, setFollowDate] = useState('');
  const save = useMutation({
    mutationFn: async ({ path, body }: { path: string; body: object }) => (await apiRequest('POST', `${endpoint}${path}`, body)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [endpoint] });
      setOutcome(''); setFollowDate('');
      toast({ title: 'Submitted for review', description: 'Your proof is saved. It does not award a referral or reward.' });
    },
    onError: (e: Error) => toast({ title: 'Not saved', description: e.message, variant: 'destructive' }),
  });
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast({ title: 'Copied', description: 'After sharing, submit your proof below.' }); }
    catch { toast({ title: 'Copy unavailable', description: 'Select and copy the text shown below.', variant: 'destructive' }); }
  }
  if (home.isLoading) return <p role="status" className="text-slate-300">Loading today’s missions…</p>;
  if (home.isError) return <div role="alert" className="text-slate-300">Could not load your missions. <Button variant="outline" onClick={() => home.refetch()}>Retry</Button></div>;
  const data = home.data;
  if (!data?.rep) return <p className="rounded-xl border border-amber-600 p-4 text-sm text-amber-100">Your owner needs to confirm one active pilot profile for this account before daily missions are available.</p>;
  const reach = data.outreach;
  const tomorrow = new Date(Date.parse(data.day) + 86_400_000).toISOString().slice(0, 10);
  const finished = Number(data.scenario?.submitted) + Number(!!reach && reach.status !== 'assigned') + Number(data.followupSubmitted);
  return <section aria-label="Daily campaign missions" className="space-y-3">
    <div className="rounded-xl border border-emerald-600/40 bg-emerald-950/30 p-4 text-white">
      <p className="text-xs text-emerald-300">September 14–October 31 campaign · {data.day} · Central time</p>
      <h2 className="mt-1 text-xl font-bold">Today’s three missions</h2>
      <p className="mt-1 text-sm text-slate-300">{data.rep.displayName} · {data.rep.territory}</p>
      <p className="mt-2 text-sm" role="status">{finished} of 3 submitted · Code: <strong>{data.rep.promoCode}</strong></p>
      {reach && <Button className={`mt-3 ${copyClass}`} variant="outline" onClick={() => copy(reach.destinationUrl)}>Copy my tracked booking link</Button>}
    </div>
    <Mission title="1. Learn · One relevant scenario" status={data.scenario?.submitted ? 'submitted' : undefined}>
      {data.scenario && <><p>{data.scenario.title}</p><p className="text-xs">Answer independently. Training submissions and owner review stay in the training tool.</p><a className="inline-flex min-h-11 items-center text-emerald-300 underline" href={`/crew/pricing-training?scenario=${encodeURIComponent(data.scenario.id)}`}>Open scenario</a></>}
    </Mission>
    <Mission title="2. Reach · Share approved copy" status={reach?.status}>
      {!reach ? <p>{data.active ? 'No owner-approved tracked copy is ready for your profile today. Check back after owner approval.' : 'The outreach campaign is outside its active dates.'}</p> : <>
        <p className="font-semibold text-white">{reach.headline}</p>
        <label className="block" htmlFor="daily-copy">Owner-approved outreach copy</label>
        <Textarea id="daily-copy" readOnly value={reach.caption} className={`${fieldClass} min-h-40`} />
        <Button variant="outline" className={copyClass} onClick={() => copy(reach.caption)}>Copy approved post</Button>
        <p className="text-xs">Share only where permitted or with contacts who agreed to hear from you. Copying does not submit proof.</p>
        {reach.status === 'assigned' && <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate({ path: '/reach', body: { variantId: reach.variantId, revision: reach.revision, destination, proofUrl, proofNotes, nextDate } }); }}>
          <label className="block" htmlFor="daily-destination">Where did you share?</label><Input id="daily-destination" required minLength={3} maxLength={200} value={destination} onChange={e => setDestination(e.target.value)} className={fieldClass} placeholder="Group or partner name" />
          <label className="block" htmlFor="daily-proof-url">Public post URL (or add an outreach note)</label><Input id="daily-proof-url" type="url" value={proofUrl} onChange={e => setProofUrl(e.target.value)} className={fieldClass} />
          <label className="block" htmlFor="daily-proof-note">Outreach note</label><Textarea id="daily-proof-note" required={!proofUrl} minLength={proofUrl ? undefined : 10} maxLength={2000} value={proofNotes} onChange={e => setProofNotes(e.target.value)} className={fieldClass} placeholder="What you shared and the next step. Avoid private customer details." />
          <label className="block" htmlFor="daily-next-date">Follow-up date</label><Input id="daily-next-date" type="date" required min={tomorrow} max="2026-11-30" value={nextDate} onChange={e => setNextDate(e.target.value)} className={fieldClass} />
          <Button className="min-h-11 w-full" disabled={save.isPending} type="submit">Submit proof</Button>
        </form>}
      </>}
    </Mission>
    <Mission title="3. Follow through · One due follow-up" status={!data.followup && data.followupSubmitted ? 'submitted' : undefined}>
      {data.followup ? <form key={data.followup.id} className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate({ path: `/followups/${data.followup!.id}`, body: { outcome, ...(followDate ? { nextDate: followDate } : {}) } }); }}>
        <p className="font-semibold text-white">{data.followup.title}</p><p>Due {data.followup.due_on}</p>
        <label className="block" htmlFor="daily-outcome">Follow-up outcome</label><Textarea id="daily-outcome" required minLength={10} maxLength={2000} value={outcome} onChange={e => setOutcome(e.target.value)} className={fieldClass} />
        <label className="block" htmlFor="daily-follow-date">Next date (leave blank if finished)</label><Input id="daily-follow-date" type="date" min={tomorrow} max="2026-11-30" value={followDate} onChange={e => setFollowDate(e.target.value)} className={fieldClass} />
        <Button className="min-h-11 w-full" type="submit" disabled={save.isPending}>Save follow-up</Button>
      </form> : <p>{data.followupSubmitted ? 'Your follow-up outcome is saved for owner review.' : 'No follow-up is due. Prepare tomorrow’s post in the ad builder below; new copy still needs owner approval.'}</p>}
    </Mission>
  </section>;
}
