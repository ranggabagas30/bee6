"use client";

import { useSyncExternalStore } from "react";
import { demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-state";

/**
 * When this browser's demo session ends, read by the staff and web top bars (R-25 R6). Deliberately light: it
 * imports only React and the pure demo state (demo-state.ts), never the demo client, so a top bar that renders on
 * the pilot's `/pair` and `/capture` does not pull Firebase Auth into its bundle (pinned in import-boundaries.test.ts).
 * The contract name stays `useDemoExpiryHHMM` exported from app/demo/DemoBar.tsx, which re-exports it from here.
 */

/** Device-local HH:MM; an em-dash, never the text "NaN", when the instant is not a valid date. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The live session's expiry as device-local "HH:MM" (e.g. "11:20"), for the outlet line of the top bars. `null` when
 * there is nothing to show: no demo state (every pilot browser), a malformed record, an instant that is not a valid
 * date, or a session that has already ended. Re-renders when the stored state changes (another tab, a new visit)
 * and, while the headless DemoBar is mounted, at the expiry instant. Pure client state: the server snapshot is
 * `null`, so it cannot disagree with the server render.
 */
export function useDemoExpiryHHMM(): string | null {
  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const view = viewFromSnapshot(snapshot);
  if (view === null || view.expired) return null;
  const text = hhmm(view.state.expires_at_ms);
  return text === "—" ? null : text;
}
