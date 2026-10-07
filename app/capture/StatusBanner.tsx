import type { CaptureState } from "@/lib/capture/browser/engine";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";

/**
 * Big capture status (web spec §4.1): 🟢 Listening · 🟡 Offline (N waiting) ·
 * 🔴 Mic problem, plus the mic source. No transcript is ever shown. The banner is
 * an aria-live region so a screen reader announces state changes; the emoji is
 * decorative (aria-hidden) with the state conveyed as text too.
 *
 * Copy comes from the dictionary (UX-03 §5.12). An offline session still
 * captures, so its headline is "Listening" and the waiting count is the detail.
 */

/**
 * `"idle"` is the neutral "not started" state the page shows whenever no capture
 * session is actually running (before Start, outside hours, after Stop or Pause).
 * It never says "Listening": the label must match what the system is doing.
 */
export type StatusBannerState =
  | "listening"
  | "mic_error"
  | "idle"
  | "ended_auto"
  | "ended"
  | "discarded";

/**
 * The headline state for an engine state (UX-03 decision A). The headline takes
 * only listening, mic_error or idle. An upload failure leaves the engine at
 * "offline", but that is an upload result: the headline stays "Listening" and
 * the retry state lives in the upload block.
 */
export function headlineStateFor(engine: CaptureState): "listening" | "mic_error" {
  return engine === "mic_error" ? "mic_error" : "listening";
}

const PRESENTATION: Record<StatusBannerState, { emoji: string; label: DictKey; color: string }> = {
  listening: { emoji: "🟢", label: "C-h-listening", color: "#1b5e20" },
  mic_error: { emoji: "🔴", label: "C-h-mic", color: "#b00020" },
  idle: { emoji: "⚪", label: "C-h-idle", color: "#444" },
  ended_auto: { emoji: "■", label: "C-h-ended-auto", color: "#444" },
  ended: { emoji: "■", label: "C-h-ended", color: "#444" },
  discarded: { emoji: "⚪", label: "C-h-discarded", color: "#444" },
};

export interface StatusBannerProps {
  state: StatusBannerState;
  micSource: string;
  /** Outside hours only: the Mulai note under Not started (UX-03 5.2). */
  note?: string | null;
  /** ended_auto only: the auto-stop time, HH:MM in the shop's zone. */
  endedAt?: string;
}

export function StatusBanner({ state, micSource, note = null, endedAt = "" }: StatusBannerProps) {
  const { lang } = useLang();
  const { emoji, label, color } = PRESENTATION[state];
  const headline =
    state === "ended_auto" ? t(lang, label, { time: endedAt }) : t(lang, label);
  const detail =
    state === "idle" || state === "ended_auto" || state === "ended" || state === "discarded"
      ? note
      : state === "mic_error"
        ? t(lang, "C-h-mic-help")
        : t(lang, "C-cap-capturing");

  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        border: `3px solid ${color}`,
        borderRadius: 12,
        padding: 20,
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 56, margin: 0, lineHeight: 1 }} aria-hidden="true">
        {emoji}
      </p>
      <p style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 0", color }}>
        {headline}
      </p>
      <p style={{ fontSize: 16, margin: "8px 0 0" }}>{detail ?? ""}</p>
      <p style={{ fontSize: 14, margin: "12px 0 0", color: "#444" }}>
        {t(lang, "C-cap-mic", { source: micSource })}
      </p>
    </section>
  );
}
