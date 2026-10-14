import { useSyncExternalStore } from "react";
import type { DemoSessionProfile } from "@/lib/capture/contract";
import { DEBRIEF_DONE_FLAG_KEY } from "@/lib/debrief/constants";
import type { CapturePhase } from "@/lib/demo/guide";
import type { DictKey } from "@/lib/i18n/dict";

/**
 * R-19 PR-5: the seam between /capture and the judge guide. The page owns the session, the config and the
 * actions (Jump to closing time, refetch config); the guide lives in the root layout. The page publishes ONE
 * snapshot here (through `CaptureGuideBridge`, a render-less component) and the guide subscribes. Nothing in a
 * snapshot is a transcript, audio or a name: a profile, a phase, counts and two callbacks.
 *
 * Only a sandbox judge device ever publishes (the page does so only when the capture config carries
 * `demo_session`), so the guide's /capture card exists only there; the pilot never mounts the guide at all.
 */

/** PR-3 (plan 6.3) writes `localStorage[DEBRIEF_DONE_FLAG_KEY] = String(endsAtMs)` on entering the terminal done screen. */
export { DEBRIEF_DONE_FLAG_KEY };

export interface CaptureBridgeState {
  profile: DemoSessionProfile;
  phase: CapturePhase;
  /** The local session id (the spoken-cards progress is keyed by it); null when no session is open. */
  sessionId: string | null;
  /** Sum of `segment_accepted` line COUNTS since Start. */
  linesThisSession: number;
  closingBusy: boolean;
  closingError: { key: DictKey; vars?: Record<string, string | number> } | null;
  /** The engine reports a microphone or upload problem (drives "Not picking up your voice?"). */
  micTrouble: boolean;
}

export interface CaptureBridgeActions {
  /** The page's existing "Jump to closing time" (POST /api/v1/demo/closing). */
  jumpToClosing: () => void;
  /** Re-reads GET /api/v1/capture/config into the page (after End, a jump, or while `busy`/`preparing`). */
  refetchConfig: () => Promise<void>;
}

export interface CaptureBridge {
  state: CaptureBridgeState;
  actions: CaptureBridgeActions;
}

export interface CapturePhaseInput {
  profile: DemoSessionProfile;
  session: { closingReached: boolean } | null;
  lastEnded: { end_reason: string; debrief_ends_at_ms: number | null } | null;
  nowMs: number;
  /** `localStorage[DEBRIEF_DONE_FLAG_KEY]` (null when unset). */
  debriefDoneFlag: string | null;
  /** The page's own idle verdict (`idle.offered`): Start is on screen. */
  startOffered: boolean;
}

/** The plan 7.1 phase of the staff phone, from what the page knows. Pure. */
export function capturePhaseFor(input: CapturePhaseInput): CapturePhase {
  if (input.session) return input.session.closingReached ? "closing" : "listening";
  if (input.profile.open_session !== null) return "open_session";
  const last = input.lastEnded;
  const debriefEndsAt = last && last.end_reason !== "discarded" ? last.debrief_ends_at_ms : null;
  if (debriefEndsAt === null) return "ready";
  if (input.debriefDoneFlag !== null && input.debriefDoneFlag === String(debriefEndsAt)) return "debrief_done";
  if (input.nowMs >= debriefEndsAt) return input.startOffered ? "ready" : "debrief_done";
  return input.profile.next_day.reason === "preparing" ? "debrief_preparing" : "debrief_question";
}

// ── the store ────────────────────────────────────────────────────────────────────────────────────────────────

let current: CaptureBridge | null = null;
const listeners = new Set<() => void>();

export function publishCaptureBridge(bridge: CaptureBridge | null): void {
  current = bridge;
  for (const l of [...listeners]) l();
}

export function readCaptureBridge(): CaptureBridge | null {
  return current;
}

export function subscribeCaptureBridge(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

export function useCaptureBridge(): CaptureBridge | null {
  return useSyncExternalStore(subscribeCaptureBridge, readCaptureBridge, () => null);
}
