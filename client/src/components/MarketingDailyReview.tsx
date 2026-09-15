import React from 'react';
import { Button } from '@/components/ui/button';
import { reviewProofUrl, type MarketingReviewAction } from '@shared/marketingActionReview';

function submittedTime(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' Central';
}

export function MarketingDailyReview({ actions, pending, onApprove }: {
  actions: MarketingReviewAction[]; pending: boolean; onApprove: (id: string) => void;
}) {
  if (!actions.length) return null;
  return <section aria-label="Daily campaign review" className="space-y-3 border-t border-white/10 pt-4">
    <h3 className="text-sm font-bold text-white">Daily campaign review · {actions.filter(a => a.status === 'submitted').length} awaiting review</h3>
    {actions.map(action => {
      const proofUrl = reviewProofUrl(action.proof_url);
      return <article key={action.id} aria-label={action.title} className="min-w-0 space-y-2 rounded-lg border border-white/10 bg-zinc-950/55 p-3 text-xs text-zinc-300">
        <h4 className="text-sm font-semibold text-white">{action.title}</h4>
        <p className="font-semibold text-amber-200">{action.status === 'submitted' ? 'Submitted for review' : action.status === 'completed' ? 'Reviewed by owner' : 'Awaiting crew submission'}</p>
        {action.due_on && <p>Follow-up due: {String(action.due_on).slice(0, 10)}</p>}
        <p>Submitted: {submittedTime(action.submitted_at)}</p>
        <div><p className="font-semibold">Campaign / follow-up context</p><p className="whitespace-pre-wrap break-words">{action.description || 'No context recorded.'}</p></div>
        {action.campaign_variant_id && <p className="break-all">Variant: {action.campaign_variant_id} · Revision {action.campaign_revision ?? 'not recorded'}</p>}
        <div><p className="font-semibold">Submitted proof URL</p>{proofUrl ? <a className="inline-flex min-h-11 items-center break-all text-sky-300 underline" href={proofUrl} target="_blank" rel="noopener noreferrer">{proofUrl}</a> : <p className="break-all">{action.proof_url ? `Unsupported proof URL: ${action.proof_url}` : 'No public URL submitted.'}</p>}</div>
        <div><p className="font-semibold">Outreach note / follow-up outcome</p><p className="whitespace-pre-wrap break-words">{action.proof_notes || 'No note submitted.'}</p></div>
        {action.status === 'submitted' && <Button className="min-h-11" size="sm" disabled={pending} onClick={() => onApprove(action.id)}>Approve proof</Button>}
      </article>;
    })}
  </section>;
}
