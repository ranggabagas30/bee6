/**
 * DEV-01: `/capture` developer-mode panel. Only ever mounted when
 * `isDevControlsEnabled()` is true (see `app/capture/page.tsx`) — real builds
 * never include this in the render tree at all (see
 * `lib/capture/dev-mode.ts`). Manual start/pause/stop controls and the capture
 * event log land here in later tasks; this task is the shell only.
 */

const PANEL_STYLE: React.CSSProperties = {
  marginTop: 16,
  border: "2px dashed #7a4fff",
  borderRadius: 8,
  padding: 12,
  fontFamily: "monospace",
  fontSize: 13,
};

const BUTTON_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 8,
  flexWrap: "wrap",
};

const BUTTON_STYLE: React.CSSProperties = {
  flex: "1 1 auto",
  padding: "8px 12px",
  fontSize: 13,
};

export interface DevPanelProps {
  /** Same `startCaptureSession()` call the real auto-gate effect uses. */
  onStart: () => void;
  /** Same `session.stop()` the real auto-gate effect uses on a phase change. */
  onPause: () => void;
  /** Same `session.stop()`, offered as a separate, explicitly-labelled action. */
  onStop: () => void;
}

export function DevPanel({ onStart, onPause, onStop }: DevPanelProps) {
  return (
    <section data-testid="dev-panel" style={PANEL_STYLE} aria-label="Developer controls">
      <h2 style={{ fontSize: 14, margin: 0 }}>Developer controls</h2>
      <div style={BUTTON_ROW_STYLE}>
        <button type="button" style={BUTTON_STYLE} onClick={onStart}>
          Start
        </button>
        <button type="button" style={BUTTON_STYLE} onClick={onPause}>
          Pause
        </button>
        <button type="button" style={BUTTON_STYLE} onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}
