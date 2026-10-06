import type { CaptureState } from "@/lib/capture/browser/engine";

/**
 * Big capture status (web spec §4.1, UX-03 §0 and §5): 🟢 Listening, plus the mic
 * source. 🔴 Mic problem when the mic fails. No transcript is ever shown.
 * The banner is an aria-live region so a screen reader announces state changes;
 * the emoji is decorative (aria-hidden) with the state conveyed as text too.
 *
 * `"idle"` is the neutral "not started" state the page shows whenever no capture
 * session is actually running (before Start, outside hours, after Stop/Pause).
 * It never says "Listening": the label must match what the system is doing.
 *
 * Upload results (retrying, no internet, uploads waiting) never change this
 * headline. They are shown only on the upload line (UploadStatusLine), so
 * while a session runs the headline stays green for every upload result.
 */

interface BilingualLine {
  id: string;
  en: string;
}

export type StatusBannerState = CaptureState | "idle";

const LISTENING: BilingualLine = { id: "Mendengarkan", en: "Listening" };

/**
 * "offline" means the engine's uploads are failing while the session is still
 * running. Capture continues and segments queue up, so it presents exactly like
 * "listening". The failure is reported on the upload line instead.
 */
const PRESENTATION: Record<
  CaptureState,
  {
    emoji: string;
    color: string;
    headline: BilingualLine;
    detail: BilingualLine | null;
  }
> = {
  listening: {
    emoji: "🟢",
    color: "#1b5e20",
    headline: LISTENING,
    detail: null,
  },
  offline: {
    emoji: "🟢",
    color: "#1b5e20",
    headline: LISTENING,
    detail: null,
  },
  mic_error: {
    emoji: "🔴",
    color: "#b00020",
    headline: { id: "Mikrofon bermasalah", en: "Microphone problem" },
    detail: {
      id: "Periksa mikrofon dan koneksi",
      en: "Check the microphone and connection",
    },
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
  micSource: string;
}

export function StatusBanner({ state, micSource }: StatusBannerProps) {
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

  return (
    <StatusFrame emoji={emoji} label={headline.id} labelEn={headline.en} color={color}>
      {detail ? (
        <>
          <p style={{ fontSize: 16, margin: "8px 0 0" }}>{detail.id}</p>
          <p style={{ fontSize: 14, margin: "2px 0 0" }}>{detail.en}</p>
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
