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

type AvailableHours = { start_hour: number | null; end_hour: number | null; is_available?: boolean };

export function quickBookHoursCoverWork(work: ScheduledWork, weekly: AvailableHours[], overrides: AvailableHours[], blocked: boolean): boolean {
  const requested = interval(work);
  if (blocked || !requested || requested[1] > 24 * 60) return false;
  // Date overrides replace weekly hours; a whole-day block always wins.
  const hours = overrides.length ? overrides : weekly;
  if (!hours.length) return true;
  const ranges = hours.filter(row => row.is_available !== false && row.start_hour !== null && row.end_hour !== null)
    .map(row => [Number(row.start_hour) * 60, Number(row.end_hour) * 60])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1440 && end > start)
    .sort((a, b) => a[0] - b[0]);
  let coveredThrough = requested[0];
  for (const [start, end] of ranges) {
    if (start > coveredThrough) break;
    coveredThrough = Math.max(coveredThrough, end);
    if (coveredThrough >= requested[1]) return true;
  }
  return false;
}
