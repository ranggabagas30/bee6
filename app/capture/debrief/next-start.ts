import { addDays, businessDateOf } from "@/lib/capture/calendar";
import { dayLabel } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n/lang";

/**
 * The business day rolls over at 01:00 (technical specification §4.10), and a sandbox's Start unlocks then: the
 * same "01:00" the `C-sess-start-locked` button text carries. Display only.
 */
const BUSINESS_DAY_START_HM = "01:00";

/**
 * The "Next Start · Tue 13 Oct from 01:00" line of the sandbox done and closed screens. The page passes
 * `nextMulaiText` only on the pilot (a sandbox has no opening-hours calendar of its own), so on a sandbox the
 * line is the next business date after `nowMs`. Null when neither is known.
 */
export function nextStartParts(
  nextMulaiText: { day: string; hm: string } | null,
  nowMs: number | undefined,
  tz: string,
  lang: Lang,
): { day: string; hm: string } | null {
  if (nextMulaiText) return nextMulaiText;
  if (nowMs === undefined) return null;
  return { day: dayLabel(addDays(businessDateOf(nowMs, tz), 1), lang), hm: BUSINESS_DAY_START_HM };
}
