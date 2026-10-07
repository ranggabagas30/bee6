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
export type StatusBannerState = CaptureState | "idle";

const PRESENTATION: Record<
  StatusBannerState,
  { emoji: string; label: DictKey; color: string; detail: DictKey | null }
> = {
  listening: { emoji: "🟢", label: "C-h-listening", color: "#1b5e20", detail: null },
  offline: { emoji: "🟡", label: "C-h-listening", color: "#8d6e00", detail: null },
  mic_error: { emoji: "🔴", label: "C-h-mic", color: "#b00020", detail: null },
  idle: { emoji: "⚪", label: "C-h-idle", color: "#444", detail: "C-h-idle-help" },
};

export interface StatusBannerProps {
  state: StatusBannerState;
  queuedCount: number;
  micSource: string;
}

export function StatusBanner({ state, queuedCount, micSource }: StatusBannerProps) {
  const { lang } = useLang();
  const { emoji, label, color, detail: detailKey } = PRESENTATION[state];
  const detail = detailKey
    ? t(lang, detailKey)
    : state === "offline"
      ? t(lang, "C-cap-waiting", { N: queuedCount })
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
        {t(lang, label)}
      </p>
      <p style={{ fontSize: 16, margin: "8px 0 0" }}>{detail}</p>
      <p style={{ fontSize: 14, margin: "12px 0 0", color: "#444" }}>
        {t(lang, "C-cap-mic", { source: micSource })}
      </p>
    </section>
  );
}
