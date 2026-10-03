import type { CaptureState } from "@/lib/capture/browser/engine";

/**
 * Big capture status (web spec §4.1): 🟢 Listening · 🟡 Listening with uploads
 * waiting (N) · 🔴 Mic problem, plus the mic source. No transcript is ever shown.
 * The banner is an aria-live region so a screen reader announces state changes;
 * the emoji is decorative (aria-hidden) with the state conveyed as text too.
 *
 * `"idle"` is the neutral "not started" state the page shows whenever no capture
 * session is actually running (before Start, outside hours, after Stop/Pause).
 * It never says "Listening": the label must match what the system is doing.
 */

interface BilingualLine {
  id: string;
  en: string;
}

export type StatusBannerState = CaptureState | "idle";

/**
 * "offline" means the engine's uploads are failing while the session is still
 * running: capture continues and segments queue up. So its headline says
 * listening is happening, plus the waiting count. It never says "Terputus" or
 * "Offline", because that would hide that listening is still going on.
 */
const PRESENTATION: Record<
  CaptureState,
  {
    emoji: string;
    color: string;
    headline: (queuedCount: number) => BilingualLine;
    detail: ((online: boolean) => BilingualLine) | null;
  }
> = {
  listening: {
    emoji: "🟢",
    color: "#1b5e20",
    headline: () => ({ id: "Mendengarkan", en: "Listening" }),
    detail: null,
  },
  offline: {
    emoji: "🟡",
    color: "#8d6e00",
    headline: (queuedCount) => ({
      id: `Mendengarkan · pengiriman tertunda (${queuedCount} menunggu)`,
      en: `Listening · uploads waiting (${queuedCount})`,
    }),
    // navigator.onLine is only a hint. "Tidak ada internet" is shown only when
    // the browser itself reports no connection; otherwise the server is the
    // likely cause, so say that instead.
    detail: (online) =>
      online
        ? { id: "Server sibuk, mencoba lagi", en: "Server busy, retrying" }
        : { id: "Tidak ada internet", en: "No internet" },
  },
  mic_error: {
    emoji: "🔴",
    color: "#b00020",
    headline: () => ({ id: "Mikrofon bermasalah", en: "Microphone problem" }),
    detail: () => ({
      id: "Periksa mikrofon dan koneksi",
      en: "Check the microphone and connection",
    }),
  },
};

const IDLE_PRESENTATION = {
  emoji: "⚪",
  label: "Belum mulai",
  labelEn: "Not started",
  color: "#444",
  detail: {
    id: "Pengambilan audio belum berjalan",
    en: "Audio capture is not running",
  },
} as const;

export interface StatusBannerProps {
  state: StatusBannerState;
  queuedCount: number;
  micSource: string;
  /** navigator.onLine as a hint only; defaults to true (never claims "no internet"). */
  online?: boolean;
}

export function StatusBanner({
  state,
  queuedCount,
  micSource,
  online = true,
}: StatusBannerProps) {
  if (state === "idle") {
    return (
      <StatusFrame
        emoji={IDLE_PRESENTATION.emoji}
        label={IDLE_PRESENTATION.label}
        labelEn={IDLE_PRESENTATION.labelEn}
        color={IDLE_PRESENTATION.color}
      >
        <p style={{ fontSize: 16, margin: "8px 0 0" }}>{IDLE_PRESENTATION.detail.id}</p>
        <p style={{ fontSize: 14, margin: "2px 0 0" }}>{IDLE_PRESENTATION.detail.en}</p>
      </StatusFrame>
    );
  }

  const { emoji, color, headline, detail } = PRESENTATION[state];
  const { id: label, en: labelEn } = headline(queuedCount);
  const detailLine = detail ? detail(online) : null;

  return (
    <StatusFrame emoji={emoji} label={label} labelEn={labelEn} color={color}>
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
    </StatusFrame>
  );
}

function StatusFrame({
  emoji,
  label,
  labelEn,
  color,
  children,
}: {
  emoji: string;
  label: string;
  labelEn: string;
  color: string;
  children: React.ReactNode;
}) {
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
      {children}
    </section>
  );
}
