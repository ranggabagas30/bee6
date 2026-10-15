import type { CaptureSession } from "@/lib/firestore/schema";
import type { DemoOpenSession } from "@/lib/demo/contract";

/**
 * R-19 PR-4b (plan 5.7a): the sandbox device's still-open session, for `demo_session.open_session`. Pure: it is
 * handed the device's session docs (the ONE sessions query the next-day guard state already reads, so the capture
 * config adds no second query) and picks the newest one that has not ended, newest by `started_at_ms` in code.
 * The result carries ids and times only: no outlet, no device id, no actor (hard rule #7).
 */
export function pickOpenSession(sessions: readonly CaptureSession[]): DemoOpenSession | null {
  let newest: CaptureSession | null = null;
  for (const s of sessions) {
    if (s.ended_at_ms !== null) continue;
    if (newest === null || s.started_at_ms > newest.started_at_ms) newest = s;
  }
  if (newest === null) return null;
  return {
    session_id: newest.session_id,
    started_at_ms: newest.started_at_ms,
    closing_reached: newest.demo_closing_at_ms !== undefined,
    auto_stop_at_ms: newest.auto_stop_at_ms,
  };
}
