/**
 * Opening-hours check (web spec §4.1: capture starts at opening, pauses at
 * closing). Pure given an instant + the outlet's local times and IANA timezone.
 * Supports windows that wrap past midnight (closing <= opening). The window is
 * half-open: active for [opening, closing).
 */

/** Parses "HH:MM" into minutes-of-day (0–1439). */
function parseHm(hm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!match) throw new Error(`Invalid time "${hm}", expected HH:MM`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Time out of range: "${hm}"`);
  return hours * 60 + minutes;
}

/** Minutes-of-day at `now` in the given IANA timezone (0–1439). */
export function minutesOfDayInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

export interface OpeningHours {
  opening_time: string; // "07:00"
  closing_time: string; // "21:45"
  timezone: string; // "Asia/Jakarta"
}

/** True when capture should be active at `now` for these hours. */
export function isWithinOpeningHours(now: Date, hours: OpeningHours): boolean {
  const open = parseHm(hours.opening_time);
  const close = parseHm(hours.closing_time);
  const t = minutesOfDayInZone(now, hours.timezone);
  // Non-wrapping window (e.g. 07:00–21:45).
  if (open < close) return t >= open && t < close;
  // Wrapping window past midnight (e.g. 20:00–02:00).
  if (open > close) return t >= open || t < close;
  // Equal times → zero-length window: never active.
  return false;
}
