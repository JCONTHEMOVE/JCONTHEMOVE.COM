import { useState } from 'react';
import { Trophy, Target, CheckCircle2, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TrainingScore } from '@shared/pricingTrainingTeam';

type PublicScore = Omit<TrainingScore, 'drafts'>;
export function TrainingScoreboard({mine,entries,total}:{mine:TrainingScore;entries:PublicScore[];total:number}) {
  const [metric,setMetric]=useState<'rewards'|'submitted'|'todayPoints'>('rewards');
  const [expanded,setExpanded]=useState(false);
  const sorted=[...entries].sort((a,b)=>b[metric]-a[metric]||a.displayName.localeCompare(b.displayName)||a.userId.localeCompare(b.userId));
  const rank=(score:PublicScore)=>score[metric]>0?sorted.filter(r=>r[metric]>score[metric]).length+1:null;
  const myRank=rank(mine);
  const next=[25,100,250,total].find(n=>n>mine.submitted);
  return <section aria-label="Scenario scores and leaderboard" className="space-y-4">
    <div className="rounded-2xl border border-blue-400/40 bg-gradient-to-br from-blue-950 to-slate-900 p-4">
      <div className="flex items-center gap-2"><Target className="h-5 w-5 text-blue-300" aria-hidden="true"/><h2 className="font-bold">Your 500-scenario journey</h2></div>
      <div className="my-3 flex items-baseline justify-between gap-2"><span className="text-3xl font-black">{mine.submitted}<span className="text-base font-normal text-slate-300"> / {total} submitted</span></span><span className="text-sm text-blue-200">{Math.round(mine.submitted/total*100)}%</span></div>
      <progress aria-label="Your submitted scenarios" value={mine.submitted} max={total} className="h-3 w-full accent-blue-400"/>
      <p className="mt-2 text-xs text-slate-300">{next?`${next-mine.submitted} more submissions to your ${next}-scenario milestone.`:'All scenarios submitted! Thank you for sharing your experience.'}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-950/50 p-3"><dt className="flex items-center gap-1 text-emerald-300"><Coins className="h-4 w-4" aria-hidden="true"/> Scenario JCMOVES</dt><dd className="mt-1 text-xl font-bold">{mine.rewards.toLocaleString()}</dd><dd className="text-xs text-slate-300">{(mine.rewards-mine.bonus).toLocaleString()} base + {mine.bonus.toLocaleString()} bonus</dd></div>
        <div className="rounded-xl bg-slate-950/50 p-3"><dt className="flex items-center gap-1 text-blue-200"><CheckCircle2 className="h-4 w-4" aria-hidden="true"/> Owner reviewed</dt><dd className="mt-1 text-xl font-bold">{mine.reviewed}</dd><dd className="text-xs text-slate-300">{mine.pending} pending · {mine.drafts} drafts</dd></div>
      </dl>
      <p className="mt-3 text-sm text-slate-200">{mine.correct} correct · {mine.mostlyCorrect} mostly correct</p>
    </div>
    <details className="rounded-2xl border border-amber-400/30 bg-slate-900" open>
      <summary className="cursor-pointer p-4 font-bold"><Trophy className="mr-2 inline h-5 w-5 text-amber-300" aria-hidden="true"/>Crew leaderboard</summary>
      <div className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap gap-2" aria-label="Leaderboard ranking">
          <Button aria-pressed={metric==='rewards'} variant={metric==='rewards'?'default':'outline'} onClick={()=>setMetric('rewards')}>Verified JCMOVES</Button>
          <Button aria-pressed={metric==='submitted'} variant={metric==='submitted'?'default':'outline'} onClick={()=>setMetric('submitted')}>Submissions</Button>
          <Button aria-pressed={metric==='todayPoints'} variant={metric==='todayPoints'?'default':'outline'} onClick={()=>setMetric('todayPoints')}>Today's prize race</Button>
        </div>
        <p className="text-xs text-slate-300">{metric==='submitted'?'Ranked by scenarios submitted, regardless of review outcome.':metric==='todayPoints'?'Ranked by scenario JCMOVES verified today, midnight to midnight in Chicago. Daily prizes do not count toward points.':'Ranked by scenario JCMOVES credited after owner review. Pending answers earn no points yet.'} Equal totals share a rank. Answers stay private until you submit.</p>
        <p className="text-sm font-semibold">{myRank?`Your rank: #${myRank}`:metric==='submitted'?'Submit your first scenario to join.':'No verified points for this ranking yet.'}</p>
        {sorted.length?<ol className="space-y-2" aria-label="Crew rankings">{(expanded?sorted:sorted.slice(0,5)).map(row=><li key={row.userId} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 ${row.userId===mine.userId?'border-blue-400 bg-blue-950/50':'border-slate-700'}`}>
          <span className="w-8 shrink-0 text-center font-black text-amber-300">{rank(row)?`#${rank(row)}`:'—'}</span>
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-bold">{row.displayName}{row.userId===mine.userId?' (you)':''}</p><p className="text-xs text-slate-400">{row.submitted}/{total} submitted · {row.reviewed} reviewed</p></div>
          <div className="shrink-0 text-right"><p className="font-black">{row[metric].toLocaleString()}</p><p className="text-xs text-slate-300">{metric==='submitted'?'submitted':'JCMOVES'}</p></div>
        </li>)}</ol>:<p className="rounded-xl bg-slate-950 p-4 text-sm">The board is ready. Submit the first scenario to get started.</p>}
        {sorted.length>5&&<Button variant="ghost" onClick={()=>setExpanded(v=>!v)}>{expanded?'Show top 5':`Show all ${sorted.length} participants`}</Button>}
        <p className="text-xs text-slate-400">Current scenario set only. Refreshes every 30 seconds.</p>
      </div>
    </details>
  </section>;
}
