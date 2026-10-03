export type JobCloseoutRepair = "date" | "crew" | "total";

export const closeoutRepairs = {
  date: {
    label: "Fix job date",
    section: "schedule",
    fieldId: "setup-closeout-date",
    help: "Enter the date the work actually took place. Past-job closeout requires a date before today in Central time. If the work is scheduled for today or later, leave its date unchanged and close it out after it is eligible.",
  },
  crew: {
    label: "Fix crew assignments",
    section: "schedule",
    fieldId: "setup-named-crew",
    help: "Select the crew accounts that actually worked this job and remove any unavailable accounts before returning to closeout.",
  },
  total: {
    label: "Fix job total",
    section: "quote",
    fieldId: "setup-quote-review",
    help: "Review the crew, hours and pricing, then save the final job total before recording full payment.",
  },
} as const;

export function centralBusinessDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isPastJobDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value && value < centralBusinessDate();
}
