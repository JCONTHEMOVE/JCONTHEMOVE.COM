export type ReviewTipSummary={worker_id:string;amount_usd:string;token_amount:string;tip_method:string;status:string;payroll_paid_at:unknown};
export function reviewTipLine(tip:ReviewTipSummary) {
  const amount=tip.tip_method==='jcmoves'?`${Number(tip.token_amount).toLocaleString('en-US',{maximumFractionDigits:8})} JCMOVES`:`$${Number(tip.amount_usd).toFixed(2)}`;
  const status=tip.status==='failed'?'Failed':tip.status!=='confirmed'?'Awaiting payment':tip.payroll_paid_at?'Paid out':['jcmoves','jcmoves_usd'].includes(tip.tip_method)?'Wallet credited':'Received · awaiting payroll';
  return `${amount} — ${status}`;
}

export function reviewCelebrationBody(input:{reviewId:string;rating:number;origin:string;crew:Array<{id:string;name:string;avatarUrl:string}>;tips:ReviewTipSummary[];thanks?:string[];tipUpdate?:boolean}) {
  return {
    allowed_mentions:{parse:[]},
    content:input.tipUpdate?'Crew tip payment update':`A customer sent feedback to the crew · ${Math.max(1,Math.min(5,input.rating))}/5 stars`,
    embeds:[{title:'Crew review & tip breakdown',url:`${input.origin}/crew/reviews?review=${encodeURIComponent(input.reviewId)}`,
      description:input.tips.length?'Amounts below use the recorded tip allocations. Payment and payout status are shown separately.':'No tip recorded with this review.',color:0x22d3ee},
      ...input.crew.slice(0,9).map(worker=>({title:worker.name.slice(0,80),thumbnail:{url:worker.avatarUrl},description:(input.thanks?.includes(worker.id)?'❤️ Customer sent thanks\n':'')+(input.tips.filter(tip=>tip.worker_id===worker.id).map(reviewTipLine).join('\n')||'Thanks for helping on this job · No tip allocated'),color:0x34d399}))],
  };
}
