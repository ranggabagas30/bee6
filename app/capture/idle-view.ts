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
 * The Mulai button's headline and note (UX-03 §5.4, technical spec §8.5) for
 * the no-session state. Pure: every input is passed in, so the table is
 * unit-tested without a clock. `offered` drives whether the Mulai button is
 * enabled; `headline` drives StatusBanner's state; `note` is the already-
 * translated line shown under it (or under the headline when Mulai isn't
 * rendered at all — §5.4: "Mulai not rendered" only for `session_open", which
 * this function never sees — the page only calls it when no session is open).
 */

export type IdleHeadline = "idle" | "ended" | "ended_auto" | "discarded";

export interface IdleView {
  headline: IdleHeadline;
  offered: boolean;
  note: string | null;
  /** ended_auto only: the auto-stop time, HH:MM in the shop's zone. */
  endedAt: string | null;
}

export interface IdleViewInput {
  config: CaptureConfigResponse;
  nowMs: number;
  lang: Lang;
}

/** The day-ended headline for a last_ended.end_reason (§5.4 table). */
function endedHeadlineFor(endReason: "selesai" | "auto_stop" | "lost" | "discarded"): IdleHeadline {
  if (endReason === "auto_stop") return "ended_auto";
  if (endReason === "discarded") return "discarded";
  return "ended";
}

export function idleViewFor(input: IdleViewInput): IdleView {
  const { config, nowMs, lang } = input;
  const tz = config.timezone;
  const weekly = config.weekly_hours;
  const last = config.last_ended;

  const availability = mulaiAvailability({
    now_ms: nowMs,
    weekly,
    tz,
    session_open: false,
    last_ended: last
      ? { business_date: last.business_date, debrief_ends_at_ms: last.debrief_ends_at_ms }
      : null,
  });

  const nextOfferNote = (): { date: string; time: string } | null => {
    const nextMs = availability.next_offer_ms;
    return nextMs === null
      ? null
      : { date: dayLabel(localDateOf(nextMs, tz), lang), time: clockLabel(nextMs, tz) };
  };

  if (availability.reason === "offered") {
    return { headline: "idle", offered: true, note: null, endedAt: null };
  }

  if (availability.reason === "closed_day") {
    const nextMs = availability.next_offer_ms;
    const note = nextMs === null ? null : t(lang, "C-m-closed", { date: dayLabel(localDateOf(nextMs, tz), lang) });
    return { headline: "idle", offered: false, note, endedAt: null };
  }

  if (availability.reason === "window_passed") {
    const nextMs = availability.next_offer_ms;
    const today = businessDateOf(nowMs, tz);
    const window = mulaiWindowFor(today, weekly, tz);
    const note =
      nextMs === null || window === null
        ? null
        : t(lang, "C-m-window-passed", {
            time: clockLabel(window.end_ms, tz),
            date: dayLabel(localDateOf(nextMs, tz), lang),
          });
    return { headline: "idle", offered: false, note, endedAt: null };
  }

  // `day_ended` and `debrief_running` only ever reach here with `last` set
  // (mulaiAvailability only returns them when `last` is non-null); the guard
  // is defensive only.
  if (!last) return { headline: "idle", offered: false, note: null, endedAt: null };

  const headline = endedHeadlineFor(last.end_reason);
  const endedAt = headline === "ended_auto" ? clockLabel(autoStopAtMs(last.business_date, weekly, tz) ?? nowMs, tz) : null;
  const next = nextOfferNote();

  if (availability.reason === "day_ended") {
    const note =
      next === null
        ? null
        : t(lang, "C-m-day-ended", { endedDate: dayLabel(last.business_date, lang), ...next });
    return { headline, offered: false, note, endedAt };
  }

  // debrief_running
  const note =
    next === null || last.debrief_ends_at_ms === null
      ? null
      : t(lang, "C-m-debrief", { debriefUntil: clockLabel(last.debrief_ends_at_ms, tz), ...next });
  return { headline, offered: false, note, endedAt };
}
