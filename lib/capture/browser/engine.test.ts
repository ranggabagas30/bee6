import { describe, expect, it, vi } from "vitest";
import {
  CaptureEngine,
  type CaptureEngineOptions,
} from "@/lib/capture/browser/engine";
import { SegmentBatcher } from "@/lib/capture/batcher";

const SR = 16_000;

/** A speech frame of `n` samples at device epoch `ts`. */
function frame(ts: number, n = 1_600, speech = true) {
  return { ts, speech, samples: new Float32Array(n).fill(0.1) };
}

/** Builds an engine with instant sleep + deterministic seg ids + fakes. */
function makeEngine(overrides: Partial<CaptureEngineOptions> = {}) {
  let seq = 0;
  const encode = vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "audio/webm;codecs=opus",
  }));
  const upload = vi.fn(async () => 200 as number | null);
  const statuses: string[] = [];
  const engine = new CaptureEngine({
    encode,
    upload,
    sampleRate: SR,
    genSegId: () => `seg-${++seq}`,
    sleep: async () => {},
    // Small cap so a couple of speech frames + flush produce a segment fast.
    batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
    onStatusChange: (s) => statuses.push(s.state),
    ...overrides,
  });
  return { engine, encode, upload, statuses };
}

describe("CaptureEngine", () => {
  it("encodes a closed segment, uploads it, and empties the queue on 200", async () => {
    const { engine, encode, upload } = makeEngine();
    engine.pushFrame(frame(0));
    engine.pushFrame(frame(100));
    engine.flush(); // closes the open segment
    await engine.drain();

    expect(encode).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(engine.status.queuedCount).toBe(0);
    expect(engine.status.state).toBe("listening");
  });

  it("drops (does not enqueue) a segment when encoding fails", async () => {
    const encode = vi.fn(async () => {
      throw new Error("no WebCodecs");
    });
    const { engine, upload } = makeEngine({ encode });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).not.toHaveBeenCalled();
    expect(engine.status.queuedCount).toBe(0);
  });

  it("retries a transient failure then succeeds, going offline then listening", async () => {
    let calls = 0;
    const upload = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? null : 200; // two network errors, then success
    });
    const { engine } = makeEngine({ upload, maxAttempts: 6 });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(3);
    expect(engine.status.queuedCount).toBe(0);
    expect(engine.status.state).toBe("listening");
  });

  it("gives up after maxAttempts on a repeated SERVER error and counts it", async () => {
    const upload = vi.fn(async () => 500 as number | null); // poison 5xx
    const { engine } = makeEngine({ upload, maxAttempts: 3 });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(3);
    expect(engine.status.queuedCount).toBe(0);
    expect(engine.status.droppedCount).toBe(1);
  });

  it("survives a long offline outage without dropping any segment (finding #2)", async () => {
    // Connectivity is down (null) for many attempts, then recovers. With small
    // segments the 10-min capacity is never reached, so nothing is pruned and
    // every segment is delivered exactly once — never dropped by attempt count.
    let calls = 0;
    const delivered = new Set<string>();
    const upload = vi.fn(async (seg: { seg_id: string }) => {
      calls += 1;
      if (calls < 40) return null; // long outage
      delivered.add(seg.seg_id);
      return 200 as number | null;
    });
    const { engine } = makeEngine({
      upload,
      maxAttempts: 3, // would have dropped after 3 with the old bug
      batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
    });
    // Three short segments queued during the outage.
    for (let i = 0; i < 3; i++) {
      engine.pushFrame(frame(i * 2_000));
      engine.pushFrame(frame(i * 2_000 + 100));
      engine.flush();
    }
    await engine.drain();

    expect(engine.status.droppedCount).toBe(0);
    expect(engine.status.queuedCount).toBe(0);
    expect(delivered.size).toBe(3); // each segment delivered exactly once
  });

  it("stop()/abort() returns promptly while offline (finding #3)", async () => {
    // Real (macrotask) backoff so the pump is genuinely mid-wait, offline.
    const sleep = () => new Promise<void>((r) => setTimeout(r, 5));
    const upload = vi.fn(async () => null); // never recovers
    const { engine } = makeEngine({ upload, sleep });
    engine.pushFrame(frame(0));
    engine.flush();
    // Let a couple of retries happen so we are truly stuck in the backoff loop.
    await new Promise((r) => setTimeout(r, 12));
    expect(upload.mock.calls.length).toBeGreaterThan(1);

    const t0 = Date.now();
    await engine.abort();
    expect(Date.now() - t0).toBeLessThan(200); // did not hang
  });

  it("keeps segments aligned after a simulated mic restart (finding #1)", async () => {
    const encoded: { len: number; first: number }[] = [];
    const encode = vi.fn(async (samples: Float32Array) => {
      encoded.push({ len: samples.length, first: samples[0] ?? 0 });
      return { bytes: new Uint8Array([1]), contentType: "audio/webm;codecs=opus" };
    });
    const engine = new CaptureEngine({
      encode,
      upload: async () => 200,
      sampleRate: SR,
      genSegId: () => "seg",
      sleep: async () => {},
      batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
    });

    // Session 1: speech near epoch 1000, sample value 0.3.
    engine.pushFrame({ ts: 1_000, speech: true, samples: new Float32Array(1_600).fill(0.3) });
    engine.pushFrame({ ts: 1_100, speech: true, samples: new Float32Array(1_600).fill(0.3) });
    // Restart: rebase the timeline (ships the buffered session-1 segment).
    engine.resyncTimeline();
    await engine.drain();

    // Session 2: the VAD clock jumps forward; sample value 0.7.
    engine.pushFrame({ ts: 9_000_000, speech: true, samples: new Float32Array(1_600).fill(0.7) });
    engine.pushFrame({ ts: 9_000_100, speech: true, samples: new Float32Array(1_600).fill(0.7) });
    engine.flush();
    await engine.drain();

    expect(encoded).toHaveLength(2);
    // Session-1 audio is intact...
    expect(encoded[0]?.first).toBeCloseTo(0.3);
    expect(encoded[0]?.len).toBeGreaterThan(0);
    // ...and session-2 audio is the real post-restart samples, not silence.
    expect(encoded[1]?.first).toBeCloseTo(0.7);
    expect(encoded[1]?.len).toBeGreaterThan(0);
  });

  it("uploads the final flushed segment on a graceful online stop", async () => {
    // Mirrors session.stop(): flush the open segment, then abort. The last
    // segment (e.g. at closing time) must still be delivered while online.
    const delivered: string[] = [];
    const upload = vi.fn(async (seg: { seg_id: string }) => {
      delivered.push(seg.seg_id);
      return 200 as number | null;
    });
    const { engine } = makeEngine({ upload });
    engine.pushFrame(frame(0));
    engine.pushFrame(frame(100));
    engine.flush();
    await engine.abort();

    expect(delivered).toContain("seg-1");
    expect(engine.status.queuedCount).toBe(0);
  });

  it("reflects a mic error in status and clears it", () => {
    const { engine } = makeEngine();
    engine.setMicError("NotReadableError");
    expect(engine.status.state).toBe("mic_error");
    expect(engine.status.micError).toBe("NotReadableError");
    engine.clearMicError();
    expect(engine.status.state).toBe("listening");
    expect(engine.status.micError).toBeNull();
  });

  it("uploads the encoded segment payload with matching content type", async () => {
    const seen: unknown[] = [];
    const upload = vi.fn(async (seg: unknown) => {
      seen.push(seg);
      return 200 as number | null;
    });
    const { engine } = makeEngine({ upload });
    engine.pushFrame(frame(0));
    engine.pushFrame(frame(100));
    engine.flush();
    await engine.drain();

    const seg = seen[0] as {
      seg_id: string;
      content_type: string;
      bytes: Uint8Array;
      start_ms: number;
      end_ms: number;
    };
    expect(seg.seg_id).toBe("seg-1");
    expect(seg.content_type).toBe("audio/webm;codecs=opus");
    expect(seg.bytes).toBeInstanceOf(Uint8Array);
    expect(seg.end_ms).toBeGreaterThanOrEqual(seg.start_ms);
  });

  it("computes speech percentage and resets it on snapshot", () => {
    const { engine } = makeEngine();
    engine.pushFrame(frame(0, 1_600, true));
    engine.pushFrame(frame(100, 1_600, true));
    engine.pushFrame(frame(200, 1_600, false));
    const snap = engine.snapshot();
    expect(snap.speechPct).toBe(67); // 2 of 3 frames
    // After a snapshot the window resets.
    const snap2 = engine.snapshot();
    expect(snap2.speechPct).toBe(0);
  });
});
