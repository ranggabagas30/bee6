import { afterEach, describe, expect, it, vi } from "vitest";
import { FRESH_DEMO_SESSION, type DemoSessionProfile } from "@/lib/capture/contract";
import { DEBRIEF_DONE_FLAG_KEY as DEBRIEF_CONSTANT } from "@/lib/debrief/constants";
import {
  DEBRIEF_DONE_FLAG_KEY,
  capturePhaseFor,
  clearPairDone,
  publishCaptureBridge,
  publishPairDone,
  readPairDone,
  subscribePairBridge,
  readCaptureBridge,
  subscribeCaptureBridge,
  type CaptureBridge,
} from "@/app/demo/guide-bridge";

/**
 * R-19 PR-5: the seam between /capture (which owns the session, the config and the actions) and the judge guide
 * mounted in the root layout. `capturePhaseFor` is the pure phase table (plan 7.1 keys); the store is a tiny
 * external store for useSyncExternalStore.
 */
const NOW = Date.parse("2026-10-14T05:00:00Z");
const profile = (over: Partial<DemoSessionProfile> = {}): DemoSessionProfile => ({ ...FRESH_DEMO_SESSION, ...over });
const ended = (over: Partial<{ end_reason: string; debrief_ends_at_ms: number | null }> = {}) => ({
  business_date: "2026-10-14",
  end_reason: over.end_reason ?? "selesai",
  debrief_ends_at_ms: over.debrief_ends_at_ms === undefined ? NOW + 3_000_000 : over.debrief_ends_at_ms,
});

describe("capturePhaseFor", () => {
  const base = { profile: profile(), session: null, lastEnded: null, nowMs: NOW, debriefDoneFlag: null, debriefView: null, startOffered: true };

  it("no session, nothing ended: ready", () => {
    expect(capturePhaseFor(base)).toBe("ready");
  });

  it("a running session is listening until closing is reached, then closing", () => {
    expect(capturePhaseFor({ ...base, session: { closingReached: false } })).toBe("listening");
    expect(capturePhaseFor({ ...base, session: { closingReached: true } })).toBe("closing");
  });

  it("a still-open server session with no local one (PR-4b) is open_session", () => {
    const open = { session_id: "11111111-1111-4111-8111-111111111111", started_at_ms: NOW - 1000, closing_reached: true, auto_stop_at_ms: NOW + 1000 };
    expect(capturePhaseFor({ ...base, profile: profile({ open_session: open }) })).toBe("open_session");
  });

  it("the debrief window: preparing while the server says so, else question; done on the PR-3 flag or once the window is over", () => {
    const debrief = { ...base, lastEnded: ended(), startOffered: false };
    expect(capturePhaseFor(debrief)).toBe("debrief_question");
    expect(capturePhaseFor({ ...debrief, profile: profile({ next_day: { allowed: false, reason: "preparing" } }) })).toBe("debrief_preparing");
    expect(capturePhaseFor({ ...debrief, debriefDoneFlag: String(NOW + 3_000_000) })).toBe("debrief_done");
    expect(capturePhaseFor({ ...debrief, debriefDoneFlag: String(NOW + 1) })).toBe("debrief_question");
    expect(capturePhaseFor({ ...debrief, nowMs: NOW + 3_000_000 })).toBe("debrief_done");
  });

  // Round-4 D2: the debrief's own screen wins over the config's next_day.reason, which can be one re-poll stale.
  it("inside the debrief window the page's own screen decides: a question on screen is debrief_question even while the config still says preparing", () => {
    const stale = { ...base, lastEnded: ended(), startOffered: false, profile: profile({ next_day: { allowed: false, reason: "preparing" } }) };
    expect(capturePhaseFor(stale)).toBe("debrief_preparing");
    expect(capturePhaseFor({ ...stale, debriefView: "question" })).toBe("debrief_question");
    expect(capturePhaseFor({ ...stale, debriefView: "preparing" })).toBe("debrief_preparing");
    expect(capturePhaseFor({ ...stale, debriefView: "waiting_more" })).toBe("debrief_preparing");
    expect(capturePhaseFor({ ...stale, debriefView: "done" })).toBe("debrief_done");
  });

  it("a preparing or waiting screen is debrief_preparing even once the config's reason has cleared", () => {
    const cleared = { ...base, lastEnded: ended(), startOffered: false };
    expect(capturePhaseFor(cleared)).toBe("debrief_question");
    expect(capturePhaseFor({ ...cleared, debriefView: "preparing" })).toBe("debrief_preparing");
    expect(capturePhaseFor({ ...cleared, debriefView: "waiting_more" })).toBe("debrief_preparing");
  });

  it.each(["closed", "loading", "load_error", "empty"] as const)("a %s screen says nothing about the questions: the config rule applies", (kind) => {
    const debrief = { ...base, lastEnded: ended(), startOffered: false, debriefView: kind };
    expect(capturePhaseFor(debrief)).toBe("debrief_question");
    expect(capturePhaseFor({ ...debrief, profile: profile({ next_day: { allowed: false, reason: "preparing" } }) })).toBe("debrief_preparing");
  });

  it("a timed_out screen is debrief_done before the page's clock tick, whatever the config says", () => {
    const d = { ...base, lastEnded: ended(), startOffered: false, debriefView: "timed_out" as const };
    expect(capturePhaseFor(d)).toBe("debrief_done");
    expect(capturePhaseFor({ ...d, profile: profile({ next_day: { allowed: false, reason: "preparing" } }) })).toBe("debrief_done");
  });

  it("the screen never overrides a session, the done flag, the window's end or a discarded day", () => {
    expect(capturePhaseFor({ ...base, session: { closingReached: false }, debriefView: "question" })).toBe("listening");
    expect(capturePhaseFor({ ...base, lastEnded: ended(), startOffered: false, debriefDoneFlag: String(NOW + 3_000_000), debriefView: "question" })).toBe("debrief_done");
    expect(capturePhaseFor({ ...base, lastEnded: ended(), nowMs: NOW + 4_000_000, startOffered: true, debriefView: "question" })).toBe("ready");
    expect(capturePhaseFor({ ...base, lastEnded: ended({ end_reason: "discarded", debrief_ends_at_ms: null }), debriefView: "question" })).toBe("ready");
  });

  it("a discarded session has no debrief: ready; an ended day whose debrief is over but Start is offered (after the jump): ready", () => {
    expect(capturePhaseFor({ ...base, lastEnded: ended({ end_reason: "discarded", debrief_ends_at_ms: null }) })).toBe("ready");
    expect(capturePhaseFor({ ...base, lastEnded: ended(), nowMs: NOW + 4_000_000, startOffered: true })).toBe("ready");
    expect(capturePhaseFor({ ...base, lastEnded: ended(), nowMs: NOW + 4_000_000, startOffered: false })).toBe("debrief_done");
  });
});

describe("the capture bridge store", () => {
  afterEach(() => publishCaptureBridge(null));

  it("starts empty, publishes a snapshot, notifies subscribers, and clears", () => {
    expect(readCaptureBridge()).toBeNull();
    const onChange = vi.fn();
    const off = subscribeCaptureBridge(onChange);
    const bridge: CaptureBridge = {
      state: { profile: profile(), phase: "listening", sessionId: "s1", linesThisSession: 2, closingBusy: false, closingError: null, micTrouble: false, uploadBusy: false },
      actions: { jumpToClosing: () => {}, refetchConfig: async () => {} },
    };
    publishCaptureBridge(bridge);
    expect(readCaptureBridge()).toBe(bridge);
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
    publishCaptureBridge(null);
    expect(readCaptureBridge()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("re-exports the PR-3 done flag key (one definition, lib/debrief/constants), so the phase and DebriefFlow read the same flag", () => {
    expect(DEBRIEF_DONE_FLAG_KEY).toBe("bee6.debrief.done");
    expect(DEBRIEF_DONE_FLAG_KEY).toBe(DEBRIEF_CONSTANT);
  });
});

// R-25 R12: the pair bridge (/pair -> guide), same store pattern as the capture bridge.
describe("pair bridge", () => {
  afterEach(() => clearPairDone());

  it("starts unpaired; publishPairDone marks it and notifies subscribers once per change", () => {
    const seen = vi.fn();
    const off = subscribePairBridge(seen);
    expect(readPairDone()).toBe(false);
    publishPairDone();
    expect(readPairDone()).toBe(true);
    publishPairDone(); // already true: no second notification
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("the returned cleanup (and clearPairDone) take the signal back; an unsubscribed listener hears nothing", () => {
    const seen = vi.fn();
    const off = subscribePairBridge(seen);
    const cleanup = publishPairDone();
    cleanup();
    expect(readPairDone()).toBe(false);
    publishPairDone();
    clearPairDone();
    expect(readPairDone()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(4);
    off();
    publishPairDone();
    expect(seen).toHaveBeenCalledTimes(4);
  });
});
