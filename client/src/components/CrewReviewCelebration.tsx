import { useQuery } from '@tanstack/react-query';
import { Heart, Star } from 'lucide-react';
import { reviewTipLine, type ReviewTipSummary } from '@shared/reviewCelebration';

export function CrewReviewCelebration({reviewId}:{reviewId:string}) {
  const review=useQuery<{id:string;rating:number;crew:Array<{id:string;name:string}>;tips:ReviewTipSummary[];thanks:string[]}>({queryKey:[`/api/crew/review-celebrations/${encodeURIComponent(reviewId)}`]});
  if(review.isLoading)return <p role="status">Loading crew celebration…</p>;
  if(review.isError)return <p role="alert" className="mb-4 text-sm text-amber-300">This review celebration could not load.</p>;
  if(!review.data)return null;
  const data=review.data;
  return <section className="mb-5 rounded-2xl border border-rose-400/30 bg-slate-950 p-4 text-slate-100" aria-label="Crew review and tip breakdown"><h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Star className="h-5 w-5 text-amber-300"/>{data.rating}/5 · Thanks, crew!</h2><div className="grid grid-cols-2 gap-3">{data.crew.map(worker=><article key={worker.id} className="min-w-0 rounded-xl border border-slate-700 p-3"><img src={`/api/public/worker-avatar/${encodeURIComponent(worker.id)}.png`} alt={`${worker.name} avatar`} className="mx-auto h-16 w-16 rounded-full"/><p className="mt-2 break-words text-center text-sm font-bold">{worker.name}</p>{data.thanks.includes(worker.id)&&<p className="my-2 flex justify-center gap-1 text-xs text-rose-300"><Heart className="h-4 w-4 fill-rose-300"/>Customer thanks</p>}<div className="mt-2 space-y-2 text-xs text-slate-300">{data.tips.filter(tip=>tip.worker_id===worker.id).map((tip,index)=><p key={index}>{reviewTipLine(tip)}</p>)}{!data.tips.some(tip=>tip.worker_id===worker.id)&&<p>No tip allocated</p>}</div></article>)}</div></section>;
}

