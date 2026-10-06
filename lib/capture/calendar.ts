/**
 * Pure calendar and Mulai-session rules (PROD-01 §4.0, §4.1, §4.8, §4.10, §4.13).
 * Used by the phone (page, reducer) and the server (session routes). No I/O,
 * no clock reads: every function takes `now` or a timestamp explicitly.
 *
 * Times are shop-local wall clock (`tz`). A business date `D` is "YYYY-MM-DD".
 */
import {
  AUTO_STOP_AFTER_CLOSE_MIN,
  MULAI_CUTOFF_BEFORE_CLOSE_MIN,
  parseHmToMinutes,
  type Weekday,
  type WeeklyHours,
} from "@/lib/firestore/schema";

export const AUTO_STOP_AFTER_CLOSE_MS = AUTO_STOP_AFTER_CLOSE_MIN * 60_000;
export const MULAI_CUTOFF_BEFORE_CLOSE_MS = MULAI_CUTOFF_BEFORE_CLOSE_MIN * 60_000;
/** D1: Selesai is shown from start + 4 h. Equal to the Mulai cut-off on purpose (§4.0). */
export const SELESAI_AFTER_START_MS = MULAI_CUTOFF_BEFORE_CLOSE_MIN * 60_000;
export const DEBRIEF_DURATION_MS = 60 * 60_000;
/** Checkpoints fire exactly at open/close (Q4 may change this). */
export const CHECKPOINT_GRACE_MS = 0;

const WEEKDAY_BY_INDEX: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ── date and zone helpers ─────────────────────────────────────────────────────

/** One Intl formatter per zone: constructing it is far costlier than formatting. */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zoneFormatters.set(tz, fmt);
  }
  return fmt;
}

/** Calendar parts of `ms` in `tz`, via Intl (no library). */
function zonedParts(ms: number, tz: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const fmt = formatterFor(tz);
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's offset in ms at instant `ms` (zone wall clock minus UTC). */
function zoneOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** "YYYY-MM-DD" of `ms` in `tz` (calendar date, no business-day shift). */
export function localDateOf(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Weekday of a "YYYY-MM-DD" date (UTC noon avoids any zone shift). */
export function weekdayOf(localDate: string): Weekday {
  const [y, m, d] = localDate.split("-").map(Number);
  const idx = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
  return WEEKDAY_BY_INDEX[idx] ?? "sun";
}

/** "YYYY-MM-DD" plus `n` calendar days (UTC-noon arithmetic). */
export function addDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n, 12);
  return new Date(t).toISOString().slice(0, 10);
}

/** Epoch ms of wall-clock `hm` on `localDate` in `tz` (DST-safe, two-pass). */
export function zonedTimeToEpochMs(localDate: string, hm: string, tz: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  const minutes = parseHmToMinutes(hm);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, Math.floor(minutes / 60), minutes % 60);
  const first = guess - zoneOffsetMs(guess, tz);
  return guess - zoneOffsetMs(first, tz);
}

// ── day hours ────────────────────────────────────────────────────────────────

interface Hours {
  open: string;
  close: string;
}

export function hoursOn(localDate: string, weekly: WeeklyHours): Hours | null {
  return weekly[weekdayOf(localDate)];
}

/**
 * The first open day on or after `localDate`, searching 7 days (phone copy on a
 * closed day, D1 of R-P1). null when no weekday is open.
 */
export function nextOpenDay(
  localDate: string,
  weekly: WeeklyHours,
): { local_date: string; hours: Hours } | null {
  for (let i = 0; i < 7; i++) {
    const d = addDays(localDate, i);
    const hours = hoursOn(d, weekly);
    if (hours) return { local_date: d, hours };
  }
  return null;
}

/** Planned close instant of D (next local day when close <= open). null = closed. */
export function closeMs(localDate: string, weekly: WeeklyHours, tz: string): number | null {
  const h = hoursOn(localDate, weekly);
  if (!h) return null;
  const closeDate = h.close <= h.open ? addDays(localDate, 1) : localDate;
  return zonedTimeToEpochMs(closeDate, h.close, tz);
}

/** Auto-stop = close + 1 h (§4.8). null on a closed weekday. */
export function autoStopAtMs(localDate: string, weekly: WeeklyHours, tz: string): number | null {
  const c = closeMs(localDate, weekly, tz);
  return c === null ? null : c + AUTO_STOP_AFTER_CLOSE_MS;
}

export interface PlannedInterval {
  local_date: string;
  start_ms: number;
  end_ms: number;
}

/** Opening to close of D (for checkpoints). null = closed weekday. */
export function plannedIntervalFor(
  localDate: string,
  weekly: WeeklyHours,
  tz: string,
): PlannedInterval | null {
  const h = hoursOn(localDate, weekly);
  const end = closeMs(localDate, weekly, tz);
  if (!h || end === null) return null;
  return {
    local_date: localDate,
    start_ms: zonedTimeToEpochMs(localDate, h.open, tz),
    end_ms: end,
  };
}

// ── Mulai window (§4.0 rules 1, 2, 11) ───────────────────────────────────────

export interface MulaiWindow {
  business_date: string;
  start_ms: number;
  end_ms: number; // inclusive
}

/** W(D) = [01:00 on D, close(D) - 4 h]. null on a closed weekday. */
export function mulaiWindowFor(
  localDate: string,
  weekly: WeeklyHours,
  tz: string,
): MulaiWindow | null {
  const c = closeMs(localDate, weekly, tz);
  if (c === null) return null;
  return {
    business_date: localDate,
    start_ms: zonedTimeToEpochMs(localDate, "01:00", tz),
    end_ms: c - MULAI_CUTOFF_BEFORE_CLOSE_MS,
  };
}

/** The D whose window contains `ms`, else null (§4.0 rule 1; windows lie inside D). */
export function mulaiWindowDateOf(ms: number, weekly: WeeklyHours, tz: string): string | null {
  const candidate = localDateOf(ms, tz);
  const w = mulaiWindowFor(candidate, weekly, tz);
  return w && ms >= w.start_ms && ms <= w.end_ms ? candidate : null;
}

/** §4.0 rule 4 (D1): min(start + 4 h, close(D)). */
export function selesaiFromMs(
  startedAtMs: number,
  localDate: string,
  weekly: WeeklyHours,
  tz: string,
): number {
  const c = closeMs(localDate, weekly, tz) ?? Number.POSITIVE_INFINITY;
  return Math.min(startedAtMs + SELESAI_AFTER_START_MS, c);
}

/** §4.10 clock rule: calendar date of `ms`, minus one day before 01:00. */
export function businessDateOf(ms: number, tz: string): string {
  const c = localDateOf(ms, tz);
  return ms < zonedTimeToEpochMs(c, "01:00", tz) ? addDays(c, -1) : c;
}

// ── Mulai availability (§4.0 rule 6, §4.13) ──────────────────────────────────

export type MulaiReason =
  | "offered"
  | "session_open"
  | "closed_day"
  | "day_ended"
  | "debrief_running"
  | "window_passed";

export interface MulaiAvailability {
  offered: boolean;
  reason: MulaiReason;
  business_date: string | null;
  next_offer_ms: number | null;
}

export interface LastEndedInput {
  business_date: string;
  debrief_ends_at_ms: number | null;
}

/** First instant >= now at which Mulai is offered, searching up to 8 days ahead. */
function nextOfferMs(
  now: number,
  weekly: WeeklyHours,
  tz: string,
  from: string,
  last: LastEndedInput | null,
): number | null {
  for (let i = 0; i <= 8; i++) {
    const d = addDays(from, i);
    const w = mulaiWindowFor(d, weekly, tz);
    if (!w) continue;
    if (last && d <= last.business_date) continue;
    const t = Math.max(w.start_ms, last?.debrief_ends_at_ms ?? Number.NEGATIVE_INFINITY, now);
    if (t <= w.end_ms) return t;
  }
  return null;
}

export function mulaiAvailability(input: {
  now_ms: number;
  weekly: WeeklyHours;
  tz: string;
  session_open: boolean;
  last_ended: LastEndedInput | null;
}): MulaiAvailability {
  const { now_ms: now, weekly, tz, session_open: open, last_ended: last } = input;
  if (open) {
    return { offered: false, reason: "session_open", business_date: null, next_offer_ms: null };
  }
  const d = businessDateOf(now, tz);
  const w = mulaiWindowFor(d, weekly, tz);
  const blocked = (reason: MulaiReason): MulaiAvailability => ({
    offered: false,
    reason,
    business_date: null,
    next_offer_ms: nextOfferMs(now, weekly, tz, d, last),
  });
  if (!w) return blocked("closed_day");
  if (last && d <= last.business_date) return blocked("day_ended");
  if (last?.debrief_ends_at_ms != null && now < last.debrief_ends_at_ms) {
    return blocked("debrief_running");
  }
  if (now > w.end_ms) return blocked("window_passed");
  return { offered: true, reason: "offered", business_date: d, next_offer_ms: null };
}

// ── checkpoints (§4.1) ───────────────────────────────────────────────────────

export type Checkpoint = "none" | "opening_no_session" | "closing_session_running";

export function evaluateCheckpoint(input: {
  now_ms: number;
  weekly: WeeklyHours;
  tz: string;
  running_session_local_date: string | null;
  mulai: MulaiAvailability;
}): Checkpoint {
  const { now_ms: now, weekly, tz, running_session_local_date: running, mulai } = input;
  if (running !== null) {
    const c = closeMs(running, weekly, tz);
    return c !== null && now >= c + CHECKPOINT_GRACE_MS ? "closing_session_running" : "none";
  }
  if (!mulai.offered || mulai.business_date === null) return "none";
  const p = plannedIntervalFor(mulai.business_date, weekly, tz);
  const w = mulaiWindowFor(mulai.business_date, weekly, tz);
  if (!p || !w) return "none";
  return p.start_ms <= now && now <= w.end_ms ? "opening_no_session" : "none";
}
