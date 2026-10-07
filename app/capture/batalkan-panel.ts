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
