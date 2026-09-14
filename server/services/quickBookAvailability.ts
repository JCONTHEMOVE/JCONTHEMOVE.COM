type ScheduledWork = { arrivalWindow?: string | null; hours?: number | string | null };

function interval(work: ScheduledWork): [number, number] | null {
  const match = String(work.arrivalWindow || "").match(/^(\d{1,2}):(\d{2})\s+(AM|PM)/i);
  const hours = Number(work.hours);
  if (!match || !Number.isFinite(hours) || hours <= 0) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const start = (hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + minute;
  const endMatch = String(work.arrivalWindow).match(/[–—-]\s*(\d{1,2}):(\d{2})\s+(AM|PM)\s*$/i);
  let latestStart = start;
  if (endMatch) {
    const endHour = Number(endMatch[1]);
    const endMinute = Number(endMatch[2]);
    if (endHour < 1 || endHour > 12 || endMinute > 59) return null;
    latestStart = (endHour % 12 + (endMatch[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + endMinute;
    if (latestStart < start) latestStart += 24 * 60;
  }
  // Reserve through completion when the crew arrives at the end of its window.
  return [start, latestStart + hours * 60];
}

// An unknown schedule cannot establish that an assigned mover is free.
export function quickBookWorkOverlaps(requested: ScheduledWork, assigned: ScheduledWork): boolean {
  const a = interval(requested);
  const b = interval(assigned);
  if (!a || !b) return true;
  return a[0] < b[1] && b[0] < a[1];
}
