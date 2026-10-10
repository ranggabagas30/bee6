import { addDays } from "@/lib/capture/calendar";
import { MAX_RANGE_DAYS } from "@/lib/proposals/constants";

/**
 * suff-v1 `range_valid` (technical spec §8.15), literally. Checks, in this
 * exact order, the first failing one wins:
 *   1. from <= to                                           -> range_order
 *   2. to <= today                                           -> range_future
 *   3. (to - from + 1 days) <= MAX_RANGE_DAYS                 -> range_too_long
 *   4. from >= addDays(today, -(retentionDays - 1))           -> range_too_old
 * "YYYY-MM-DD" strings sort lexicographically exactly like dates, so string
 * comparison is enough — no Date parsing needed for order checks.
 */
export type RangeError = "range_order" | "range_future" | "range_too_long" | "range_too_old";

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromMs = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const toMs = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((toMs - fromMs) / 86_400_000);
}

export function validateRange(
  r: { from_date: string; to_date: string },
  today: string,
  retentionDays: number,
): { ok: true } | { ok: false; code: RangeError } {
  if (r.from_date > r.to_date) return { ok: false, code: "range_order" };
  if (r.to_date > today) return { ok: false, code: "range_future" };
  if (daysBetween(r.from_date, r.to_date) + 1 > MAX_RANGE_DAYS) {
    return { ok: false, code: "range_too_long" };
  }
  const oldestAllowed = addDays(today, -(retentionDays - 1));
  if (r.from_date < oldestAllowed) return { ok: false, code: "range_too_old" };
  return { ok: true };
}
