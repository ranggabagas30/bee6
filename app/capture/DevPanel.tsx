import { useEffect, useState } from "react";
import type { CaptureEvent, LoggedCaptureEvent } from "@/lib/capture/browser/event-log";
import type { CaptureMode } from "@/lib/devices/capture-mode";

/**
 * DEV-01: `/capture` developer-mode panel. Only ever mounted when
 * `isDevControlsEnabled()` is true (see `app/capture/page.tsx`) — real builds
 * never include this in the render tree at all (see
 * `lib/capture/dev-mode.ts`). Manual Start/Pause/Stop plus a live,
 * newest-first log of capture pipeline events (never transcript/audio — see
 * `lib/capture/browser/event-log.ts`'s type).
 */

function formatRelativeTime(ts: number, now: number): string {
  const deltaMs = Math.max(0, now - ts);
  if (deltaMs < 1_000) return "just now";
  const seconds = Math.round(deltaMs / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** Compact, human-readable metadata for one event — no free-text fields exist to format. */
function formatMetadata(event: CaptureEvent): string {
  switch (event.type) {
    case "state_changed":
      return `state=${event.state} queued=${event.queuedCount}`;
    case "segment_opened":
      return `seg_id=${event.seg_id}`;
    case "segment_closed":
      return `seg_id=${event.seg_id} duration_ms=${event.duration_ms}`;
    case "segment_upload_started":
      return `seg_id=${event.seg_id} byte_count=${event.byte_count}`;
    case "segment_upload_result":
      return `seg_id=${event.seg_id} ok=${event.ok}`;
    case "segment_accepted":
      // R-19 PR-4a: a count only; the event type has no text field to format.
      return `lines=${event.lines}`;
    case "wake_lock_changed":
      return `held=${event.held}`;
    case "mic_restart":
      return `reason=${event.reason}`;
  }
}

function formatLine(logged: LoggedCaptureEvent, now: number): string {
  return `[${formatRelativeTime(logged.ts, now)}] ${logged.event.type}: ${formatMetadata(logged.event)}`;
}

const PANEL_STYLE: React.CSSProperties = {
  marginTop: 16,
  border: "2px dashed #7a4fff",
  borderRadius: 8,
  padding: 12,
  fontFamily: "monospace",
  fontSize: 13,
  // Keeps the panel (and its event log) inside the page's 360px budget
  // instead of the border/padding pushing it wider than the parent.
  boxSizing: "border-box",
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
  /** Last up-to-200 pipeline events (oldest-dropped ring buffer), oldest-first. */
  events: readonly LoggedCaptureEvent[];

  // R-07 Task 8 readouts — every one of these is a new OPTIONAL prop with a
  // safe "not shown" default, so a page that hasn't been updated to pass
  // them (the current pre-P1 page.tsx) renders exactly as it did before.
  // None of these ever exposes a reason string, a raw/full device id, or a
  // staff name (hard rules #2/#3/#7) — only a count, an age in minutes, a
  // fixed-enum mode label, and a short id the caller already truncated.
  /** `pendingSummary(readCache(localStorage)).count`. Omitted hides the whole readout block. */
  answerCacheCount?: number;
  /** Minutes since the oldest cached answer was written; `null` when nothing is cached. */
  oldestPendingAgeMinutes?: number | null;
  /** Wired by the caller to `purgeNow(localStorage, Date.now())` then a re-read. Omitted hides the button. */
  onPurgeNow?: () => void;
  /** `captureMode(pairedDeviceCount)` — display-only. */
  captureMode?: CaptureMode;
  /** This device's id, already truncated by the caller (first 6 chars) — DevPanel never sees the rest of it. */
  deviceIdShort?: string;
  /** R-19 PR-4a: the page's `linesThisSession` (sum of `segment_accepted` counts). A number only, never a line. */
  linesHeard?: number;
}

const READOUTS_STYLE: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 8,
  borderTop: "1px dashed #7a4fff",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

function hasAnyReadout(props: DevPanelProps): boolean {
  return (
    props.answerCacheCount !== undefined ||
    props.oldestPendingAgeMinutes !== undefined ||
    props.onPurgeNow !== undefined ||
    props.captureMode !== undefined ||
    props.deviceIdShort !== undefined ||
    props.linesHeard !== undefined
  );
}

const LOG_LIST_STYLE: React.CSSProperties = {
  marginTop: 8,
  maxHeight: 240,
  overflowY: "auto",
  padding: 0,
  listStyle: "none",
  fontSize: 12,
  // A long seg_id/reason string must wrap, never force horizontal overflow
  // on a 360px-wide phone screen (CLAUDE.md self-review checklist).
  overflowWrap: "anywhere",
};

export function DevPanel(props: DevPanelProps) {
  const {
    onStart,
    onPause,
    onStop,
    events,
    answerCacheCount,
    oldestPendingAgeMinutes,
    onPurgeNow,
    captureMode,
    deviceIdShort,
    linesHeard,
  } = props;
  // "Now" for the relative-time column, ticking once a second — read from
  // state (updated in an effect), never from Date.now() during render, so
  // the component body stays a pure function of its props/state.
  const [now, setNow] = useState(0);
  useEffect(() => {
    // Ticks asynchronously (never a synchronous setState call inside the
    // effect body); the brief 0 -> real-Date.now() gap before the first tick
    // only ever shows as "just now", clamped by formatRelativeTime below.
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Newest-first for display; the buffer itself stays oldest-first.
  const newestFirst = events.slice().reverse();

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
      <ul data-testid="dev-event-log" style={LOG_LIST_STYLE}>
        {newestFirst.map((logged, i) => (
          <li key={`${logged.ts}-${i}`}>{formatLine(logged, now)}</li>
        ))}
      </ul>
      {hasAnyReadout(props) && (
        <div data-testid="dev-readouts" style={READOUTS_STYLE}>
          {answerCacheCount !== undefined && (
            <span>
              Answer cache: {answerCacheCount} pending
              {oldestPendingAgeMinutes !== undefined && oldestPendingAgeMinutes !== null
                ? ` (oldest ${oldestPendingAgeMinutes} min)`
                : ""}
            </span>
          )}
          {onPurgeNow && (
            <button type="button" style={BUTTON_STYLE} onClick={onPurgeNow}>
              Purge now
            </button>
          )}
          {captureMode !== undefined && <span>Mode: {captureMode}</span>}
          {deviceIdShort !== undefined && <span>Device: {deviceIdShort}</span>}
          {linesHeard !== undefined && <span>Lines heard: {linesHeard}</span>}
        </div>
      )}
    </section>
  );
}
