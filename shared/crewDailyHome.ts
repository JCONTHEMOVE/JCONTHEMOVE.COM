export const CREW_CAMPAIGN_START = '2026-09-14';
export const CREW_CAMPAIGN_END = '2026-10-31';
export const DAILY_ACTION_PREFIX = 'crew-fall-2026:';

export type DailyAction = { id: string; title: string; status: string; due_on: string | null; proof_notes: string | null };
export type CrewDailyHome = {
  day: string;
  active: boolean;
  rep: { displayName: string; territory: string; promoCode: string } | null;
  scenario: { id: string; title: string; submitted: boolean } | null;
  outreach: { variantId: string; revision: number; headline: string; caption: string; destinationUrl: string; promoCode: string; status: string } | null;
  followup: DailyAction | null;
  followupSubmitted: boolean;
};
