import { addDays, zonedTimeToEpochMs } from "@/lib/capture/calendar";

/**
 * Batalkan (cancel) panel timing (UX-03 §5.6, technical spec §8.1). Pure
 * predicates over `openedAtMs`/`nowMs`, so the 1s arm delay and the 15s
 * self-close are unit-tested without real timers; the page drives a `setInterval`
 * that calls these.
 */

/** The red "Ya, hapus sesi" button is disabled for the first second after open. */
export const DISCARD_ARM_MS = 1_000;

/** The panel closes itself after 15s with no tap; nothing changes. */
export const DISCARD_PANEL_TIMEOUT_MS = 15_000;

export function isDiscardArmed(openedAtMs: number, nowMs: number): boolean {
  return nowMs - openedAtMs >= DISCARD_ARM_MS;
}

export function shouldAutoClosePanel(openedAtMs: number, nowMs: number): boolean {
  return nowMs - openedAtMs >= DISCARD_PANEL_TIMEOUT_MS;
}

/**
 * Whether the cancel panel should say Mulai is available "straight away"
 * (C-c-cancel-b-now) instead of "{date} at 01:00" (C-c-cancel-b). True once
 * the next business day's Mulai window has already opened — the closing-hour
 * cancel case (worked example, technical spec §8.3): a cancel at Thu 01:30
 * offers Thursday's Mulai at once, because Thu's window is already open.
 */
export function nextMulaiIsNow(sessionLocalDate: string, nowMs: number, tz: string): boolean {
  const nextWindowStart = zonedTimeToEpochMs(addDays(sessionLocalDate, 1), "01:00", tz);
  return nowMs >= nextWindowStart;
}
