import { describe, expect, it, vi } from "vitest";
import {
  CaptureEngine,
  type CaptureStatus,
  type UploadFn,
} from "@/lib/capture/browser/engine";
import { SegmentBatcher } from "@/lib/capture/batcher";

// Lost-line truth (UX-03 §5.7 row L): a dropped segment stays "lost" on the
// engine status until the next 2xx upload clears it. Head failure count feeds
// the "(Nx)" suffix on the retry row (UX-03 §5.7 row 1).

const SR = 16_000;

function frame(ts: number, n = 1_600, speech = true) {
  return { ts, speech, samples: new Float32Array(n).fill(0.1) };
}

/** Closes one speech segment, starting at `startMs`. */
function speakSegment(engine: CaptureEngine, startMs: number) {
  engine.pushFrame(frame(startMs));
  engine.pushFrame(frame(startMs + 100));
  engine.flush();
}

function makeEngine(opts: {
  upload: UploadFn;
  headBudgetMs?: number;
}) {
  const statuses: CaptureStatus[] = [];
  let seq = 0;
  const engine = new CaptureEngine({
    encode: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm;codecs=opus",
    }),
    upload: opts.upload,
    sampleRate: SR,
    genSegId: () => `seg-${++seq}`,
    sleep: async () => {},
    headBudgetMs: opts.headBudgetMs,
    batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
    onStatusChange: (s) => statuses.push(s),
  });
  return { engine, statuses };
}

describe("lostSinceSuccess (lost line, UX-03 §5.7 row L)", () => {
  it("is false before any drop", () => {
    const { engine } = makeEngine({ upload: async () => 200 });
    expect(engine.status.lostSinceSuccess).toBe(false);
  });

  it("turns true after a 4xx drop, and a later 2xx clears it", async () => {
    const results: Array<number | null> = [400, 200];
    const upload = vi.fn(async () => results.shift() ?? 200);
    const { engine } = makeEngine({ upload });

    speakSegment(engine, 0);
    await engine.drain();
    expect(engine.status.droppedCount).toBe(1);
    expect(engine.status.lostSinceSuccess).toBe(true);

    speakSegment(engine, 1_000);
    await engine.drain();
    expect(engine.status.lastUploadHttpStatus).toBe(200);
    expect(engine.status.lostSinceSuccess).toBe(false);
    // The cumulative count is unchanged: the ledger still has the drop.
    expect(engine.status.droppedCount).toBe(1);
  });

  it("turns true after a server-error give-up (headBudgetMs), and a 2xx clears it", async () => {
    const results: Array<number | null> = [503, 200];
    const upload = vi.fn(async () => results.shift() ?? 200);
    const { engine } = makeEngine({ upload, headBudgetMs: 0 });

    speakSegment(engine, 0);
    await engine.drain();
    expect(engine.status.droppedCount).toBe(1);
    expect(engine.status.lostSinceSuccess).toBe(true);

    speakSegment(engine, 1_000);
    await engine.drain();
    expect(engine.status.lostSinceSuccess).toBe(false);
  });
});

describe("headFailedAttempts (retry count, UX-03 §5.7 row 1)", () => {
  it("is 0 before any failure", () => {
    const { engine } = makeEngine({ upload: async () => 200 });
    expect(engine.status.headFailedAttempts).toBe(0);
  });

  it("counts the failed attempts of the head segment, and resets on success", async () => {
    // null = network failure; `??` would swallow it, so index explicitly.
    const results: Array<number | null> = [null, null, 200];
    const upload = vi.fn(async () => (results.length > 0 ? (results.shift() as number | null) : 200));
    const { engine, statuses } = makeEngine({ upload });

    speakSegment(engine, 0);
    await engine.drain();

    // The status emitted after the second failure reports two failed attempts.
    const afterSecondFailure = statuses.filter((s) => s.headFailedAttempts === 2);
    expect(afterSecondFailure.length).toBeGreaterThan(0);
    expect(afterSecondFailure[0]?.state).toBe("offline");
    expect(engine.status.headFailedAttempts).toBe(0);
    expect(engine.status.queuedCount).toBe(0);
  });
});
