import { describe, expect, it } from "vitest";
import type { CaptureStatus } from "@/lib/capture/browser/engine";
import {
  NO_RETAINED_UPLOAD,
  beginSessionRetention,
  retainEngineStatus,
  type RetainedUpload,
} from "@/app/capture/upload-retention";

function status(overrides: Partial<CaptureStatus> = {}): CaptureStatus {
  return {
    state: "listening",
    queuedCount: 0,
    droppedCount: 0,
    micError: null,
    lastUploadHttpStatus: null,
    lostSinceSuccess: false,
    headFailedAttempts: 0,
    ...overrides,
  };
}

// Engine generations: each start of a session gets the next number (page.tsx sessionGenRef).
const GEN_A = 1;
const GEN_B = 2;

describe("retainEngineStatus (UX-03 §5.7, decision B)", () => {
  it("keeps the latest engine status as the retained upload state", () => {
    const next = retainEngineStatus(NO_RETAINED_UPLOAD, status({ queuedCount: 2 }), GEN_A);
    expect(next.status?.queuedCount).toBe(2);
  });

  it("a 2xx clears a loss that the engine itself reports as cleared", () => {
    const lost: RetainedUpload = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_A,
    );
    const cleared = retainEngineStatus(
      lost,
      status({ droppedCount: 1, lastUploadHttpStatus: 200, lostSinceSuccess: false }),
      GEN_A,
    );
    expect(cleared.status?.lostSinceSuccess).toBe(false);
    expect(cleared.carryLoss).toBe(false);
  });

  it("a 2xx is accepted even when it arrives from an engine that was already stopped", () => {
    // Stop does not decide whether an upload result is kept: the newest engine
    // generation's 2xx clears the loss, whether or not that engine is still running.
    const lost = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_A,
    );
    const afterStop = retainEngineStatus(
      lost,
      status({ droppedCount: 1, lastUploadHttpStatus: 200, lostSinceSuccess: false }),
      GEN_A,
    );
    expect(afterStop.status?.lostSinceSuccess).toBe(false);
  });

  it("keeps a carried loss through non-2xx statuses until a 2xx arrives", () => {
    let retained = beginSessionRetention(
      retainEngineStatus(
        NO_RETAINED_UPLOAD,
        status({ droppedCount: 1, lostSinceSuccess: true, lastUploadHttpStatus: 400 }),
        GEN_A,
      ),
    );
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: null, lostSinceSuccess: false }), GEN_B);
    expect(retained.status?.lostSinceSuccess).toBe(true);
    retained = retainEngineStatus(
      retained,
      status({ lastUploadHttpStatus: 503, lostSinceSuccess: false, state: "offline", queuedCount: 1 }),
      GEN_B,
    );
    expect(retained.status?.lostSinceSuccess).toBe(true);
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }), GEN_B);
    expect(retained.status?.lostSinceSuccess).toBe(false);
  });

  it("does not re-carry a loss after the new engine has had its own 2xx", () => {
    let retained = beginSessionRetention(
      retainEngineStatus(
        NO_RETAINED_UPLOAD,
        status({ lostSinceSuccess: true, lastUploadHttpStatus: 400, droppedCount: 1 }),
        GEN_A,
      ),
    );
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }), GEN_B);
    retained = retainEngineStatus(
      retained,
      status({ lastUploadHttpStatus: 503, state: "offline", queuedCount: 1, lostSinceSuccess: false }),
      GEN_B,
    );
    expect(retained.status?.lostSinceSuccess).toBe(false);
  });
});

describe("retainEngineStatus: stale generations (tech-lead ruling 1)", () => {
  it("(a) a stopped engine's late non-2xx loss cannot revive a loss the newer engine's 2xx cleared", () => {
    // A drops (lost), stop, start B, B returns 2xx, then A's late report arrives.
    let retained = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_A,
    );
    retained = beginSessionRetention(retained);
    retained = retainEngineStatus(
      retained,
      status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }),
      GEN_B,
    );
    expect(retained.status?.lostSinceSuccess).toBe(false);

    retained = retainEngineStatus(
      retained,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true, queuedCount: 9 }),
      GEN_A,
    );
    expect(retained.status?.lostSinceSuccess).toBe(false);
    expect(retained.carryLoss).toBe(false);
    expect(retained.status?.lastUploadHttpStatus).toBe(200);
    expect(retained.status?.queuedCount).toBe(0);
  });

  it("(b) a stopped engine's late genuine drop (false to true) raises the loss but keeps the newer status", () => {
    // A had a 2xx before stop, then B's 2xx arrives, then A's late 4xx drop (lost flips false to true).
    let retained = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }),
      GEN_A,
    );
    retained = beginSessionRetention(retained);
    retained = retainEngineStatus(
      retained,
      status({ lastUploadHttpStatus: 200, lostSinceSuccess: false, queuedCount: 3 }),
      GEN_B,
    );
    retained = retainEngineStatus(
      retained,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true, queuedCount: 7 }),
      GEN_A,
    );
    expect(retained.status?.lostSinceSuccess).toBe(true);
    expect(retained.carryLoss).toBe(true);
    expect(retained.status?.queuedCount).toBe(3);
    expect(retained.status?.lastUploadHttpStatus).toBe(200);
  });

  it("(c) a late 2xx from a stopped engine does not clear a loss the newer engine raised", () => {
    let retained = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }),
      GEN_A,
    );
    retained = beginSessionRetention(retained);
    retained = retainEngineStatus(
      retained,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_B,
    );
    expect(retained.status?.lostSinceSuccess).toBe(true);

    retained = retainEngineStatus(
      retained,
      status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }),
      GEN_A,
    );
    expect(retained.status?.lostSinceSuccess).toBe(true);
    // The loss was raised by B itself, not carried from before B's first 2xx,
    // so the stale 2xx leaves carryLoss alone (B's own lostSinceSuccess holds it).
    expect(retained.carryLoss).toBe(false);
  });

  it("a stale report that is still losing (true to true) does not re-raise anything or change the status", () => {
    let retained = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_A,
    );
    retained = beginSessionRetention(retained);
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }), GEN_B);
    retained = retainEngineStatus(
      retained,
      status({ droppedCount: 2, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_A,
    );
    expect(retained.status?.lostSinceSuccess).toBe(false);
    expect(retained.carryLoss).toBe(false);
  });
});

describe("beginSessionRetention (UX-03 §5.7, D2)", () => {
  it("carries an unresolved loss into a new session", () => {
    const stopped = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
      GEN_A,
    );
    const started = beginSessionRetention(stopped);
    expect(started.carryLoss).toBe(true);
    expect(started.status?.lostSinceSuccess).toBe(true);
  });

  it("carries nothing when no loss is open", () => {
    const stopped = retainEngineStatus(NO_RETAINED_UPLOAD, status({ lastUploadHttpStatus: 200 }), GEN_A);
    expect(beginSessionRetention(stopped).carryLoss).toBe(false);
    expect(beginSessionRetention(NO_RETAINED_UPLOAD).carryLoss).toBe(false);
  });

  it("the new engine's first status (no loss, no upload yet) does not clear the carried loss", () => {
    const started = beginSessionRetention(
      retainEngineStatus(
        NO_RETAINED_UPLOAD,
        status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
        GEN_A,
      ),
    );
    const first = retainEngineStatus(started, status({ lostSinceSuccess: false, lastUploadHttpStatus: null }), GEN_B);
    expect(first.status?.lostSinceSuccess).toBe(true);
  });
});
