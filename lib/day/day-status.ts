import { hoursOn, mulaiWindowFor } from "@/lib/capture/calendar";
import type { WeeklyHours } from "@/lib/firestore/schema";
import type { AttributionSession } from "@/lib/day/attribution";

/** Technical spec §8.15 "Day status". */
export type DayStatus = "closed" | "on" | "off" | "pending";

/**
 * Technical spec §8.15, in this order (first match wins):
 *  1. `hoursOn(d, weekly) === null` -> "closed" (even if a stale start was
 *     dated to d — a closed weekday is never "on");
 *  2. a session with `local_date === d` and `end_reason !== "discarded"`
 *     (including a still-open session, `end_reason: null`) -> "on";
 *  3. `now_ms > mulaiWindowFor(d).end_ms`, or a discarded session with
 *     `local_date === d` -> "off";
 *  4. otherwise -> "pending".
 */
export function dayStatus(
  d: string,
  weekly: WeeklyHours,
  tz: string,
  sessions: readonly AttributionSession[],
  now_ms: number,
): DayStatus {
  if (hoursOn(d, weekly) === null) return "closed";

  const onThisDay = sessions.filter((s) => s.local_date === d);
  if (onThisDay.some((s) => s.end_reason !== "discarded")) return "on";

  const w = mulaiWindowFor(d, weekly, tz);
  const windowPassed = w !== null && now_ms > w.end_ms;
  const hasDiscarded = onThisDay.some((s) => s.end_reason === "discarded");
  if (windowPassed || hasDiscarded) return "off";

  return "pending";
}
