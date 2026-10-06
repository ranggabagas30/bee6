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

describe("retainEngineStatus (UX-03 §5.7, decision B)", () => {
  it("keeps the latest engine status as the retained upload state", () => {
    const next = retainEngineStatus(NO_RETAINED_UPLOAD, status({ queuedCount: 2 }));
    expect(next.status?.queuedCount).toBe(2);
  });

  it("a 2xx clears a loss that the engine itself reports as cleared", () => {
    const lost: RetainedUpload = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
    );
    const cleared = retainEngineStatus(
      lost,
      status({ droppedCount: 1, lastUploadHttpStatus: 200, lostSinceSuccess: false }),
    );
    expect(cleared.status?.lostSinceSuccess).toBe(false);
    expect(cleared.carryLoss).toBe(false);
  });

  it("a 2xx is accepted even when it arrives from an engine that was already stopped", () => {
    // Stop does not decide whether an upload result is kept: the caller only
    // passes the status through, so a stopped engine's 2xx clears the loss.
    const lost = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
    );
    const afterStop = retainEngineStatus(
      lost,
      status({ droppedCount: 1, lastUploadHttpStatus: 200, lostSinceSuccess: false }),
    );
    expect(afterStop.status?.lostSinceSuccess).toBe(false);
  });

  it("keeps a carried loss through non-2xx statuses until a 2xx arrives", () => {
    let retained = beginSessionRetention(
      retainEngineStatus(NO_RETAINED_UPLOAD, status({ droppedCount: 1, lostSinceSuccess: true, lastUploadHttpStatus: 400 })),
    );
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: null, lostSinceSuccess: false }));
    expect(retained.status?.lostSinceSuccess).toBe(true);
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 503, lostSinceSuccess: false, state: "offline", queuedCount: 1 }));
    expect(retained.status?.lostSinceSuccess).toBe(true);
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }));
    expect(retained.status?.lostSinceSuccess).toBe(false);
  });

  it("does not re-carry a loss after the new engine has had its own 2xx", () => {
    let retained = beginSessionRetention(
      retainEngineStatus(NO_RETAINED_UPLOAD, status({ lostSinceSuccess: true, lastUploadHttpStatus: 400, droppedCount: 1 })),
    );
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 200, lostSinceSuccess: false }));
    retained = retainEngineStatus(retained, status({ lastUploadHttpStatus: 503, state: "offline", queuedCount: 1, lostSinceSuccess: false }));
    expect(retained.status?.lostSinceSuccess).toBe(false);
  });
});

describe("beginSessionRetention (UX-03 §5.7, D2)", () => {
  it("carries an unresolved loss into a new session", () => {
    const stopped = retainEngineStatus(
      NO_RETAINED_UPLOAD,
      status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true }),
    );
    const started = beginSessionRetention(stopped);
    expect(started.carryLoss).toBe(true);
    expect(started.status?.lostSinceSuccess).toBe(true);
  });

  it("carries nothing when no loss is open", () => {
    const stopped = retainEngineStatus(NO_RETAINED_UPLOAD, status({ lastUploadHttpStatus: 200 }));
    expect(beginSessionRetention(stopped).carryLoss).toBe(false);
    expect(beginSessionRetention(NO_RETAINED_UPLOAD).carryLoss).toBe(false);
  });

  it("the new engine's first status (no loss, no upload yet) does not clear the carried loss", () => {
    const started = beginSessionRetention(
      retainEngineStatus(NO_RETAINED_UPLOAD, status({ droppedCount: 1, lastUploadHttpStatus: 400, lostSinceSuccess: true })),
    );
    const first = retainEngineStatus(started, status({ lostSinceSuccess: false, lastUploadHttpStatus: null }));
    expect(first.status?.lostSinceSuccess).toBe(true);
  });
});
