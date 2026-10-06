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

const PRESENTATION: Record<
  CaptureState,
  { emoji: string; label: DictKey; color: string }
> = {
  listening: { emoji: "🟢", label: "C-h-listening", color: "#1b5e20" },
  offline: { emoji: "🟡", label: "C-h-listening", color: "#8d6e00" },
  mic_error: { emoji: "🔴", label: "C-h-mic", color: "#b00020" },
};

export interface StatusBannerProps {
  state: CaptureState;
  queuedCount: number;
  micSource: string;
}

export function StatusBanner({ state, queuedCount, micSource }: StatusBannerProps) {
  const { lang } = useLang();
  const { emoji, label, color } = PRESENTATION[state];
  const detail =
    state === "offline"
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
