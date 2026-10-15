import { useSyncExternalStore } from "react";
import type { DemoSessionProfile } from "@/lib/capture/contract";
import { DEBRIEF_DONE_EVENT, DEBRIEF_DONE_FLAG_KEY, DEBRIEF_VIEW_EVENT } from "@/lib/debrief/constants";
import { readDebriefView, type DebriefViewKind } from "@/lib/debrief/view-signal";
import type { CapturePhase, ProposalsGuideScreen } from "@/lib/demo/guide";
import { PROPOSALS_PROGRESS_EVENT, PROPOSALS_SCREEN_EVENT, readProposalsProgressVersion, readProposalsScreen } from "@/lib/demo/proposals-signal";
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

function readDebriefDoneFlag(): string | null {
  try {
    return window.localStorage.getItem(DEBRIEF_DONE_FLAG_KEY);
  } catch {
    return null; // storage blocked: the phase falls back to the window rule
  }
}

function subscribeDebriefDoneFlag(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === DEBRIEF_DONE_FLAG_KEY) onChange();
  };
  window.addEventListener(DEBRIEF_DONE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DEBRIEF_DONE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The PR-3 done flag as the page sees it: re-read the moment `writeDoneFlag` runs in this document (its
 * DEBRIEF_DONE_EVENT) or another tab writes it (the browser's `storage` event), so the published phase turns
 * `debrief_done` with the done screen, not on the page's next 30 s clock tick. Null on the server and when
 * storage is blocked.
 */
export function useDebriefDoneFlag(): string | null {
  return useSyncExternalStore(subscribeDebriefDoneFlag, readDebriefDoneFlag, () => null);
}

function subscribeDebriefViewEvent(onChange: () => void): () => void {
  window.addEventListener(DEBRIEF_VIEW_EVENT, onChange);
  return () => window.removeEventListener(DEBRIEF_VIEW_EVENT, onChange);
}

/**
 * The screen the debrief shows right now (round-4 D2): re-read the moment DebriefFlow publishes a change (its
 * DEBRIEF_VIEW_EVENT), so the phase turns `debrief_question` in the same render as the page's question screen,
 * not on the guide's next config re-poll. Null on the server and while no sandbox debrief is mounted.
 */
export function useDebriefView(): DebriefViewKind | null {
  return useSyncExternalStore(subscribeDebriefViewEvent, readDebriefView, () => null);
}

export interface ProposalsSignal {
  /** The proposals page's own screen (lib/demo/proposals-signal); null while no sandbox proposals page is mounted. */
  screen: ProposalsGuideScreen | null;
  /** Bumped by the page after every write that moves the journey counters; the guide re-reads the progress on each bump. */
  progressVersion: number;
}

const NO_PROPOSALS_SIGNAL: ProposalsSignal = { screen: null, progressVersion: 0 };
// useSyncExternalStore needs a stable snapshot: one object per distinct (screen, version) pair.
let proposalsSnapshot: ProposalsSignal = NO_PROPOSALS_SIGNAL;
function readProposalsSignal(): ProposalsSignal {
  const screen = readProposalsScreen();
  const progressVersion = readProposalsProgressVersion();
  if (proposalsSnapshot.screen !== screen || proposalsSnapshot.progressVersion !== progressVersion) proposalsSnapshot = { screen, progressVersion };
  return proposalsSnapshot;
}
function subscribeProposalsSignalEvents(onChange: () => void): () => void {
  window.addEventListener(PROPOSALS_SCREEN_EVENT, onChange);
  window.addEventListener(PROPOSALS_PROGRESS_EVENT, onChange);
  return () => {
    window.removeEventListener(PROPOSALS_SCREEN_EVENT, onChange);
    window.removeEventListener(PROPOSALS_PROGRESS_EVENT, onChange);
  };
}

/**
 * The proposals page's screen and progress signal (after-merge wiring, PR-12a/12b `onBridge`): re-read the moment
 * ProposalsApp publishes, so the guide's card flips with the page and the stage list refetches the progress right
 * after an ask, a feasible mark, a rejection or an approval instead of on the next open. Empty on the server.
 */
export function useProposalsSignal(): ProposalsSignal {
  return useSyncExternalStore(subscribeProposalsSignalEvents, readProposalsSignal, () => NO_PROPOSALS_SIGNAL);
}

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
  /** The screen the mounted sandbox debrief shows (`useDebriefView`); null when none is mounted. */
  debriefView: DebriefViewKind | null;
  /** The page's own idle verdict (`idle.offered`): Start is on screen. */
  startOffered: boolean;
}

/**
 * The plan 7.1 phase of the staff phone, from what the page knows. Pure. Inside the debrief window the debrief's
 * own screen decides between preparing and question (round-4 D2: the config's `next_day.reason` can be one
 * re-poll stale); a screen that says nothing about the questions (closed, loading, ...) falls back to the config.
 */
export function capturePhaseFor(input: CapturePhaseInput): CapturePhase {
  if (input.session) return input.session.closingReached ? "closing" : "listening";
  if (input.profile.open_session !== null) return "open_session";
  const last = input.lastEnded;
  const debriefEndsAt = last && last.end_reason !== "discarded" ? last.debrief_ends_at_ms : null;
  if (debriefEndsAt === null) return "ready";
  if (input.debriefDoneFlag !== null && input.debriefDoneFlag === String(debriefEndsAt)) return "debrief_done";
  if (input.nowMs >= debriefEndsAt) return input.startOffered ? "ready" : "debrief_done";
  switch (input.debriefView) {
    case "done":
      return "debrief_done";
    case "question":
      return "debrief_question";
    case "preparing":
    case "waiting_more":
      return "debrief_preparing";
    default:
      return input.profile.next_day.reason === "preparing" ? "debrief_preparing" : "debrief_question";
  }
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
