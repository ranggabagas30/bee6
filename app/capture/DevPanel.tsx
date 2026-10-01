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

export function DevPanel() {
  return (
    <section data-testid="dev-panel" style={PANEL_STYLE} aria-label="Developer controls">
      <h2 style={{ fontSize: 14, margin: 0 }}>Developer controls</h2>
    </section>
  );
}
