import { DAILY_ACTION_PREFIX } from './crewDailyHome';

export type MarketingReviewAction = {
  id: string; rep_id: string; action_key: string; title: string; description: string; status: string;
  proof_url: string | null; proof_notes: string | null;
  submitted_at?: string | null; due_on?: string | null;
  campaign_variant_id?: string | null; campaign_revision?: number | null;
};

export function splitMarketingActions<T extends { action_key: string }>(actions: T[]) {
  return {
    launch: actions.filter(action => !action.action_key.startsWith(DAILY_ACTION_PREFIX)),
    daily: actions.filter(action => action.action_key.startsWith(DAILY_ACTION_PREFIX)),
  };
}

export function marketingLaunchProgress(actions: MarketingReviewAction[], reps: { id: string; attributionLinked: boolean }[]) {
  const launch = splitMarketingActions(actions).launch;
  const linked = new Set(reps.filter(rep => rep.attributionLinked).map(rep => rep.id));
  return {
    total: launch.length,
    completed: launch.filter(action => action.status === 'completed' && linked.has(action.rep_id)).length,
    pendingAttribution: launch.filter(action => action.status === 'completed' && !linked.has(action.rep_id)).length,
  };
}

export function reviewProofUrl(value: string | null) {
  try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
