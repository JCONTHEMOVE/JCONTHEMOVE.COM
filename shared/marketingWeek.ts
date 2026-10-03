// Marketing themes are separate from service-date availability and pricing rules.
export const MARKETING_WEEKLY_THEMES = [
  "Minocqua Mondays",
  "Iron River Tuesdays",
  "Eagle River Wednesdays",
] as const;

export const MARKETING_WEEKLY_SUMMARY = MARKETING_WEEKLY_THEMES.join(", ");

export const MARKETING_WEEKLY_NOTE =
  `Weekly marketing focus: ${MARKETING_WEEKLY_SUMMARY}. Request a quote; service dates and crew availability are confirmed for each job.`;
