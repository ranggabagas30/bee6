import {
  autoStopAtMs,
  businessDateOf,
  localDateOf,
  mulaiAvailability,
  mulaiWindowFor,
} from "@/lib/capture/calendar";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import { t } from "@/lib/i18n/dict";
import { clockLabel, dayLabel } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n/lang";

/**
 * The status banner outside opening hours (UX-03 decision 7 Oct, sections 5.2 and 5.4).
 * The banner stays on the page after the planned close. It says:
 *  - "Ended automatically at HH:MM" when a session ran today and auto-stopped, either
 *    seen by this page (`autoStoppedOn`) or recorded by the server (`last_ended`);
 *  - otherwise "Not started", with the Mulai note for a closed day or a passed cut-off.
 * Pure: every input is passed in, so the rule is unit-tested without a clock.
 */
export type OffHoursBanner =
  | { state: "idle"; note: string | null }
  | { state: "ended_auto"; endedAt: string };

export interface OffHoursBannerInput {
  config: CaptureConfigResponse;
  nowMs: number;
  /** Business date on which this page itself saw a live session stop, else null. */
  autoStoppedOn: string | null;
  lang: Lang;
}

export function offHoursBanner(input: OffHoursBannerInput): OffHoursBanner {
  const { config, nowMs, autoStoppedOn, lang } = input;
  const tz = config.timezone;
  const weekly = config.weekly_hours;
  const today = businessDateOf(nowMs, tz);
  const last = config.last_ended;

  const autoStoppedToday =
    autoStoppedOn === today || (last?.business_date === today && last.end_reason === "auto_stop");
  if (autoStoppedToday) {
    const stopAt = autoStopAtMs(today, weekly, tz) ?? nowMs;
    return { state: "ended_auto", endedAt: clockLabel(stopAt, tz) };
  }

  const availability = mulaiAvailability({
    now_ms: nowMs,
    weekly,
    tz,
    session_open: false,
    last_ended: last ? { business_date: last.business_date, debrief_ends_at_ms: last.debrief_ends_at_ms } : null,
  });
  return { state: "idle", note: idleNote(availability, nowMs, today, weekly, tz, lang) };
}

/** The Mulai note for a not-started day (copy C-m-closed or C-m-window-passed); null otherwise. */
function idleNote(
  availability: ReturnType<typeof mulaiAvailability>,
  nowMs: number,
  today: string,
  weekly: CaptureConfigResponse["weekly_hours"],
  tz: string,
  lang: Lang,
): string | null {
  if (availability.next_offer_ms === null) return null;
  const nextDate = dayLabel(localDateOf(availability.next_offer_ms, tz), lang);
  if (availability.reason === "closed_day") {
    return t(lang, "C-m-closed", { date: nextDate });
  }
  if (availability.reason === "window_passed") {
    const window = mulaiWindowFor(today, weekly, tz);
    if (!window || nowMs <= window.end_ms) return null;
    return t(lang, "C-m-window-passed", { time: clockLabel(window.end_ms, tz), date: nextDate });
  }
  return null;
}
