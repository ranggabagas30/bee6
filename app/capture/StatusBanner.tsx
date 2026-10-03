import type { CaptureState } from "@/lib/capture/browser/engine";

/**
 * Big capture status (web spec §4.1): 🟢 Listening · 🟡 Offline (N waiting) ·
 * 🔴 Mic problem, plus the mic source. No transcript is ever shown. The banner is
 * an aria-live region so a screen reader announces state changes; the emoji is
 * decorative (aria-hidden) with the state conveyed as text too.
 */

interface BilingualLine {
  id: string;
  en: string;
}

const PRESENTATION: Record<
  CaptureState,
  {
    emoji: string;
    label: string;
    labelEn: string;
    color: string;
    detail: ((queuedCount: number) => BilingualLine) | null;
  }
> = {
  listening: {
    emoji: "🟢",
    label: "Mendengarkan",
    labelEn: "Listening",
    color: "#1b5e20",
    detail: null,
  },
  offline: {
    emoji: "🟡",
    label: "Terputus, menunggu sambungan",
    labelEn: "Offline, waiting to reconnect",
    color: "#8d6e00",
    detail: (queuedCount) => ({
      id: `${queuedCount} rekaman menunggu dikirim`,
      en: `${queuedCount} segment${queuedCount === 1 ? "" : "s"} waiting`,
    }),
  },
  mic_error: {
    emoji: "🔴",
    label: "Mikrofon bermasalah",
    labelEn: "Microphone problem",
    color: "#b00020",
    detail: () => ({
      id: "Periksa mikrofon dan koneksi",
      en: "Check the microphone and connection",
    }),
  },
};

export interface StatusBannerProps {
  state: CaptureState;
  queuedCount: number;
  micSource: string;
}

export function StatusBanner({ state, queuedCount, micSource }: StatusBannerProps) {
  const { emoji, label, labelEn, color, detail } = PRESENTATION[state];
  const detailLine = detail ? detail(queuedCount) : null;

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
      {detailLine ? (
        <>
          <p style={{ fontSize: 16, margin: "8px 0 0" }}>{detailLine.id}</p>
          <p style={{ fontSize: 14, margin: "2px 0 0" }}>{detailLine.en}</p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 16, margin: "8px 0 0" }}>Audio sedang diambil</p>
          <p style={{ fontSize: 14, margin: "2px 0 0" }}>Audio is being captured</p>
        </>
      )}
      <p style={{ fontSize: 14, margin: "12px 0 0", color: "#444" }}>
        Mikrofon / Microphone: <strong>{micSource}</strong>
      </p>
    </section>
  );
}
