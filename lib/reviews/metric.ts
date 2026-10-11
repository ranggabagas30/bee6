import { addDays } from "@/lib/capture/calendar";
import type { AttributionSession } from "@/lib/day/attribution";
import type { WorkCategory } from "@/lib/pipeline/categories";
import { selectCandidates, type ProposalThreadRow } from "@/lib/proposals/candidates";

/**
 * Windows and counting for the outcome review (R-11 §1). Pure: no I/O, no clock.
 * The count reuses R-08's own `selectCandidates` so "a fact" means the same
 * thing here as in the proposal that was approved.
 */

export interface DateWindow {
  from_date: string;
  to_date: string;
}

/**
 * before = the source proposal's evidence range, clipped to end the day before
 * the change took effect; after = effective_from_date .. review_date - 1
 * (exactly `review_after_days` days).
 */
export function reviewWindows(input: {
  range: DateWindow;
  effective_from_date: string;
  review_date: string;
}): { before: DateWindow; after: DateWindow } {
  const dayBefore = addDays(input.effective_from_date, -1);
  const to = input.range.to_date < dayBefore ? input.range.to_date : dayBefore;
  // A range wholly on/after the effective date is unreachable (a proposal range ends before it ships); guard anyway.
  const before: DateWindow =
    to < input.range.from_date ? { from_date: dayBefore, to_date: dayBefore } : { from_date: input.range.from_date, to_date: to };
  return { before, after: { from_date: input.effective_from_date, to_date: addDays(input.review_date, -1) } };
}

export function countWindow(input: {
  window: DateWindow;
  rows: readonly ProposalThreadRow[];
  sessions: readonly AttributionSession[];
  tz: string;
  category: WorkCategory;
}): { from_date: string; to_date: string; days_captured: number; count: number } {
  const { window, rows, sessions, tz, category } = input;
  const candidates = selectCandidates(rows, sessions, tz, window);
  const count = candidates.filter((c) => c.category === category).length;
  // A day nobody captured is not a "zero-problem" day: only captured days count.
  const captured = new Set<string>();
  for (const s of sessions) {
    if (s.end_reason === "discarded") continue;
    if (s.local_date >= window.from_date && s.local_date <= window.to_date) captured.add(s.local_date);
  }
  for (const c of candidates) captured.add(c.local_date);
  return { from_date: window.from_date, to_date: window.to_date, days_captured: captured.size, count };
}

/** count / days_captured, or null when no day was captured. */
export function rate(w: { days_captured: number; count: number }): number | null {
  return w.days_captured === 0 ? null : w.count / w.days_captured;
}
