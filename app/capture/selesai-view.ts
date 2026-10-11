import { selesaiFromMs } from "@/lib/capture/calendar";
import type { WeeklyHours } from "@/lib/firestore/schema";
import { t } from "@/lib/i18n/dict";
import { clockLabel } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n/lang";

/**
 * When the Selesai button appears (technical spec §8.3 rule 4, UX-03 §5.5):
 * `selesai_from_ms = min(started_at_ms + 4h, close(D))`. Before it, the
 * primary slot shows the "You can tap End from HH:MM" note instead of a
 * button. Pure: every input is passed in, so it is unit-tested without a
 * clock.
 */

export interface SelesaiViewInput {
  nowMs: number;
  session: { started_at_ms: number; local_date: string };
  weekly: WeeklyHours;
  tz: string;
  lang: Lang;
  /** R-18: the sandbox demo profile is present, so Selesai is ready at once. */
  demo?: boolean;
}

export interface SelesaiView {
  /** True once Selesai is on screen (as a button, with its confirm). */
  ready: boolean;
  /** The "from HH:MM" note, shown only while not ready. */
  note: string | null;
}

export function selesaiViewFor(input: SelesaiViewInput): SelesaiView {
  const { nowMs, session, weekly, tz, lang } = input;
  if (input.demo === true) return { ready: true, note: null };
  const from = selesaiFromMs(session.started_at_ms, session.local_date, weekly, tz);
  if (nowMs >= from) return { ready: true, note: null };
  return { ready: false, note: t(lang, "C-n-selesai-from", { time: clockLabel(from, tz) }) };
}
