import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import type { getFinancialNoticeReview, FinancialNoticeReviewRow, FinancialNoticeResolution } from '../../../server/services/jobFinancialNoticeReview';

type Report = Awaited<ReturnType<typeof getFinancialNoticeReview>>;
const statusLabels: Record<string,string> = { review:'Needs review',pending:'Queued',processing:'In progress',retry:'Waiting to retry',sent:'Complete',suppressed:'Closed' };
function NoticeReview({ notice, leadId, refresh }: { notice: FinancialNoticeReviewRow; leadId: string; refresh(): Promise<unknown> }) {
  const id = useId();
  const [evidence,setEvidence] = useState('');
  const [receipt,setReceipt] = useState('');
  const [channel,setChannel] = useState('');
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  const request = useRef<{ signature: string; id: string }>();
  const selected = notice.deliveries.find(item => item.channel === channel);
  async function resolve(action: 'confirm_sent' | 'suppress') {
    setSaving(true); setMessage('');
    const fields = { eventKey:notice.event_key,action,evidence:evidence.trim(),
      ...(action === 'confirm_sent' ? { channel:selected?.channel,attemptToken:selected?.attempt_token,providerReference:receipt.trim() } : {}) };
    const signature = JSON.stringify(fields);
    const requestId = request.current?.signature === signature ? request.current.id : crypto.randomUUID();
    request.current = { signature,id:requestId };
    try {
      await apiRequest('POST',`/api/admin/payments/notices/${encodeURIComponent(leadId)}/review`,
        { ...fields,requestId } as FinancialNoticeResolution);
      setMessage('Review recorded.');
      await refresh();
    } catch {
      setMessage('Review could not be confirmed. Refresh to check its status; retrying the same details preserves your review request.');
    } finally { setSaving(false); }
  }
  return <article className="min-w-0 space-y-3 rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap justify-between gap-2">
      <h4 className="font-semibold">{notice.kind === 'final_invoice_sent' ? 'Final invoice notice' : 'Payment notice'}</h4>
      <span>{statusLabels[notice.status] || 'Status unavailable'}</span>
    </div>
    <p className="text-xs text-muted-foreground">Created {new Date(notice.created_at).toLocaleString()}</p>
    {notice.deliveries.map(item => <p key={item.channel} className="break-words">
      {item.channel === 'email' ? 'Email' : 'SMS'}: {item.status === 'review' ? 'Outcome unknown' : item.status === 'sent' ? 'Provider accepted' : 'Send in progress'}
      {item.provider_reference ? <span className="block text-xs">Receipt: {item.provider_reference}</span> : null}
    </p>)}
    {notice.status === 'review' ? <div className="space-y-3">
      <p>Check the provider’s delivery history before recording a receipt. Confirming a receipt allows remaining channels to continue when delivery is enabled.</p>
      <label className="block" htmlFor={`${id}-evidence`}>Review evidence</label>
      <textarea id={`${id}-evidence`} className="min-h-24 w-full rounded-md border bg-background p-2" maxLength={2000}
        value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="Record what you checked and what you found (at least 10 characters)." />
      {notice.deliveries.length ? <>
        <label className="block" htmlFor={`${id}-channel`}>Delivery with a confirmed receipt</label>
        <select id={`${id}-channel`} className="min-h-11 w-full rounded-md border bg-background px-2" value={channel}
          onChange={event=>{setChannel(event.target.value);setReceipt('');}}>
          <option value="">Choose email or SMS</option>
          {notice.deliveries.filter(item=>item.status !== 'sending').map(item=><option key={item.channel} value={item.channel}>{item.channel === 'email' ? 'Email' : 'SMS'}</option>)}
        </select>
        <label className="block" htmlFor={`${id}-receipt`}>Provider receipt ID</label>
        <input id={`${id}-receipt`} className="min-h-11 w-full rounded-md border bg-background px-2" maxLength={255}
          value={receipt} onChange={event=>setReceipt(event.target.value)} />
        <Button className="min-h-11 h-auto w-full whitespace-normal" disabled={saving || !selected || receipt.trim().length<3 || evidence.trim().length<10}
          onClick={()=>void resolve('confirm_sent')}>Record receipt and continue remaining delivery</Button>
      </> : <p>No delivery attempt can be confirmed here. Check the legacy provider history before closing this notice.</p>}
      <Button variant="outline" className="min-h-11 h-auto w-full whitespace-normal" disabled={saving || evidence.trim().length<10}
        onClick={()=>void resolve('suppress')}>Close notice without sending more messages</Button>
      <p className="text-xs text-muted-foreground">Closing preserves the history. A provider request already in progress could still arrive.</p>
    </div> : null}
    {notice.reviews.length ? <details><summary className="cursor-pointer py-2">Review history ({notice.reviews.length})</summary>
      {notice.reviews.map(review=><p key={review.request_payload.requestId} className="mt-2 break-words text-xs">
        {new Date(review.created_at).toLocaleString()} · {review.actor_id} · {review.request_payload.action === 'suppress' ? 'Closed notice' : 'Confirmed receipt'}: {review.request_payload.evidence}
      </p>)}
    </details> : null}
    {message ? <p role="status">{message}</p> : null}
  </article>;
}

export function FinancialNoticeReviewPanel({ leadId }: { leadId: string }) {
  const query = useQuery<Report>({ queryKey:['financial-notices',leadId],
    queryFn:async()=>(await apiRequest('GET',`/api/admin/payments/notices/${encodeURIComponent(leadId)}`)).json() });
  if (query.isPending) return <p role="status">Loading customer notices…</p>;
  if (query.isError) return <div><p role="alert">Customer notices could not be loaded.</p>
    <Button variant="outline" className="min-h-11" onClick={()=>void query.refetch()}>Refresh notices</Button></div>;
  if (!query.data?.enabled) return null;
  return <section className="min-w-0 space-y-3" aria-label="Customer notice review">
    <h3 className="font-semibold">Customer notices</h3>
    <p className="text-sm">{query.data.deliveryEnabled ? 'Automatic delivery enabled.' : 'Automatic delivery paused.'} Unknown outcomes stay held for review.</p>
    <Button variant="outline" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh notices</Button>
    {query.data.notices.length ? query.data.notices.map(notice=><NoticeReview key={notice.event_key} notice={notice} leadId={leadId} refresh={query.refetch} />)
      : <p className="text-sm text-muted-foreground">No canonical financial notices recorded.</p>}
    {query.data.truncated ? <p className="text-sm">Showing the latest 50 notices for this job.</p> : null}
  </section>;
}
