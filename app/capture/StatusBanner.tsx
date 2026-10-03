import type { CaptureState } from "@/lib/capture/browser/engine";

/**
 * Big capture status (web spec §4.1): 🟢 Listening · 🟡 Offline (N waiting) ·
 * 🔴 Mic problem, plus the mic source. No transcript is ever shown. The banner is
 * an aria-live region so a screen reader announces state changes; the emoji is
 * decorative (aria-hidden) with the state conveyed as text too.
 */

const PRESENTATION: Record<
  CaptureState,
  { emoji: string; label: string; labelEn: string; color: string }
> = {
  listening: {
    emoji: "🟢",
    label: "Mendengarkan",
    labelEn: "Listening",
    color: "#1b5e20",
  },
  offline: {
    emoji: "🟡",
    label: "Terputus, menunggu sambungan",
    labelEn: "Offline, waiting to reconnect",
    color: "#8d6e00",
  },
  mic_error: {
    emoji: "🔴",
    label: "Mikrofon bermasalah",
    labelEn: "Microphone problem",
    color: "#b00020",
  },
};

export interface StatusBannerProps {
  state: CaptureState;
  queuedCount: number;
  micSource: string;
}

export function StatusBanner({ state, queuedCount, micSource }: StatusBannerProps) {
  const { emoji, label, labelEn, color } = PRESENTATION[state];
  const detail =
    state === "offline"
      ? `${queuedCount} segment${queuedCount === 1 ? "" : "s"} waiting`
      : state === "mic_error"
        ? "Check the microphone and connection"
        : "Audio is being captured";

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
        {label}
      </p>
      <p style={{ fontSize: 18, fontWeight: 600, margin: "4px 0 0", color }}>
        {labelEn}
      </p>
      <p style={{ fontSize: 16, margin: "8px 0 0" }}>{detail}</p>
      <p style={{ fontSize: 14, margin: "12px 0 0", color: "#444" }}>
        Microphone: <strong>{micSource}</strong>
      </p>
    </section>
  );
}
