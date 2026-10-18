import { describe, expect, it, vi } from "vitest";
import {
  CaptureEngine,
  HEAD_BUDGET_MS,
  type CaptureEngineOptions,
} from "@/lib/capture/browser/engine";
import { SegmentBatcher } from "@/lib/capture/batcher";
import type { CaptureEvent } from "@/lib/capture/browser/event-log";

const SR = 16_000;

/** A speech frame of `n` samples at device epoch `ts`. */
function frame(ts: number, n = 1_600, speech = true) {
  return { ts, speech, samples: new Float32Array(n).fill(0.1) };
}

/**
 * Builds an engine with a fake clock (R-23): `sleep` advances the clock
 * instantly, `now` reads it, so a time-based head budget runs deterministically
 * with no real waiting. Deterministic seg ids + fakes.
 */
function makeEngine(overrides: Partial<CaptureEngineOptions> = {}) {
  let seq = 0;
  let t = 0;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
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
    now: clock.now,
    sleep: async (ms) => {
      t += ms;
    },
    // Small cap so a couple of speech frames + flush produce a segment fast.
    batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
    onStatusChange: (s) => statuses.push(s.state),
    ...overrides,
  });
  return { engine, encode, upload, statuses, clock };
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
    const { engine } = makeEngine({ upload });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(3);
    expect(engine.status.queuedCount).toBe(0);
    expect(engine.status.state).toBe("listening");
  });

  it("drops the head once it has been refused for headBudgetMs", async () => {
    const upload = vi.fn(async () => 500 as number | null); // poison 5xx
    const { engine, clock } = makeEngine({
      upload,
      headBudgetMs: 10_000,
      rng: () => 1,
    });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    // waits 500, 1000, 2000, 4000, 8000 -> the drop lands on the 6th attempt at t = 15.5 s
    expect(upload).toHaveBeenCalledTimes(6);
    expect(clock.now()).toBeGreaterThanOrEqual(10_000);
    expect(engine.status.queuedCount).toBe(0);
    expect(engine.status.droppedCount).toBe(1);
  });

  it("a 200 inside the budget delivers the segment", async () => {
    let calls = 0;
    const upload = vi.fn(async () => {
      calls += 1;
      return calls <= 4 ? 503 : 200;
    });
    const { engine } = makeEngine({ upload, headBudgetMs: 60_000 });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(5);
    expect(engine.status.queuedCount).toBe(0);
    expect(engine.status.droppedCount).toBe(0);
    expect(engine.status.state).toBe("listening");
  });

  it("the budget counts the PUT's own duration", async () => {
    // Each PUT takes 30 s before answering 503. Attempt 1 errors at t = 30 s
    // (the budget starts), attempt 2 at 60.5 s (elapsed 30.5 s, kept), attempt 3
    // at 91.5 s (elapsed 61.5 s >= 50 s) -> dropped on the 3rd attempt.
    const slow: { advance: (ms: number) => void } = { advance: () => {} };
    const upload = vi.fn(async () => {
      slow.advance(30_000);
      return 503 as number | null;
    });
    const { engine, clock } = makeEngine({
      upload,
      headBudgetMs: 50_000,
      rng: () => 1,
    });
    slow.advance = clock.advance;
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(3);
    expect(clock.now()).toBe(91_500);
    expect(engine.status.droppedCount).toBe(1);
  });

  it("headBudgetMs 0 drops on the first server error", async () => {
    const upload = vi.fn(async () => 503 as number | null);
    const { engine } = makeEngine({ upload, headBudgetMs: 0 });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(engine.status.droppedCount).toBe(1);
  });

  it("default budget is 240 s: a permanently refused head is dropped on the 14th attempt", async () => {
    expect(HEAD_BUDGET_MS).toBe(240_000);
    const upload = vi.fn(async () => 503 as number | null);
    const { engine, clock } = makeEngine({ upload, rng: () => 1 });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    // waits 0.5+1+2+4+8+16 = 31.5 s, then 30 s each: attempt 14 lands at 241.5 s
    expect(upload).toHaveBeenCalledTimes(14);
    expect(clock.now()).toBe(241_500);
    expect(engine.status.droppedCount).toBe(1);
  });

  it("does not drop a segment on the first 5xx right after reconnecting (B-4)", async () => {
    // A long offline stretch (network-unreachable, status null) must not
    // consume the server-error attempt budget. Before the fix, `count`
    // counted every attempt including network failures, so a single 5xx
    // arriving right after reconnect could push an already-high count past
    // the budget and drop the segment immediately.
    let calls = 0;
    const upload = vi.fn(async () => {
      calls += 1;
      if (calls <= 5) return null; // offline outage: 5 network failures
      if (calls === 6) return 500; // one real server error after reconnecting
      return 200; // then it recovers
    });
    const { engine } = makeEngine({ upload, headBudgetMs: 5_000 });
    engine.pushFrame(frame(0));
    engine.flush();
    await engine.drain();

    expect(upload).toHaveBeenCalledTimes(7);
    expect(engine.status.droppedCount).toBe(0);
    expect(engine.status.queuedCount).toBe(0);
  });

  describe("R-22 PR-B / R-23: jittered backoff under a time-based budget", () => {
    /** One segment against an upload that always answers `status`; returns the waits. */
    async function runAlwaysFailing(
      status: number | null,
      overrides: Partial<CaptureEngineOptions> = {},
    ) {
      const waits: number[] = [];
      let t = 0; // fake clock: the budget is time-based, so sleeping must advance it
      const upload = vi.fn(async () => status);
      const { engine } = makeEngine({
        upload,
        now: () => t,
        sleep: async (ms) => {
          waits.push(ms);
          t += ms;
        },
        ...overrides,
      });
      engine.pushFrame(frame(0));
      engine.flush();
      await engine.drain();
      return { engine, upload, waits };
    }

    it("backoff is jittered into [raw/2, raw]: rng=0 gives the lower half bound", async () => {
      const { waits } = await runAlwaysFailing(503, { rng: () => 0 });

      // raw: 500, 1000, 2000, 4000, 8000, 16000, 30000 (capped, then stays capped).
      expect(waits.slice(0, 7)).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000, 15_000]);
      expect(waits.slice(6).every((ms) => ms === 15_000)).toBe(true);
    });

    it("backoff with rng just under 1 approaches the raw delay and respects the 30 s cap", async () => {
      const { waits } = await runAlwaysFailing(503, { rng: () => 0.999 });
      const raw = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

      expect(waits.length).toBeGreaterThanOrEqual(7);
      waits.forEach((ms, i) => {
        const r = raw[Math.min(i, raw.length - 1)] ?? 0;
        expect(ms).toBeGreaterThanOrEqual(r / 2);
        expect(ms).toBeLessThanOrEqual(r);
        expect(ms).toBeGreaterThan(r * 0.99);
      });
      expect(Math.max(...waits)).toBeLessThanOrEqual(30_000);
    });

    it("two phones with different rngs do not retry in lockstep", async () => {
      const seq = (values: number[]) => {
        let i = 0;
        return () => values[i++ % values.length] ?? 0;
      };
      const a = await runAlwaysFailing(503, { rng: seq([0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8]) });
      const b = await runAlwaysFailing(503, { rng: seq([0.8, 0.2, 0.6, 0.1, 0.9, 0.4, 0.3]) });

      expect(a.waits.length).toBeGreaterThanOrEqual(7);
      expect(b.waits.length).toBeGreaterThanOrEqual(7);
      // Every one of the first six waits differs (the 30 s cap can tie the last).
      for (let i = 0; i < 6; i++) expect(a.waits[i]).not.toBe(b.waits[i]);
    });

    it("uses Math.random by default (waits stay inside the jitter band)", async () => {
      const { waits } = await runAlwaysFailing(503);

      expect(waits[0]).toBeGreaterThanOrEqual(250);
      expect(waits[0]).toBeLessThanOrEqual(500);
    });

    it("network failures (null) never start or consume the budget, even 20 in a row (B-4 guard)", async () => {
      let calls = 0;
      const upload = vi.fn(async () => {
        calls += 1;
        if (calls <= 20) return null;
        if (calls === 21) return 503;
        return 200;
      });
      const { engine } = makeEngine({ upload, headBudgetMs: 5_000 });
      engine.pushFrame(frame(0));
      engine.flush();
      await engine.drain();

      expect(upload).toHaveBeenCalledTimes(22);
      expect(engine.status.droppedCount).toBe(0);
      expect(engine.status.queuedCount).toBe(0);
    });
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
      headBudgetMs: 0, // would drop on the first server error; null never counts
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

  it("finish() also returns promptly while offline (18 Oct twin)", async () => {
    const sleep = () => new Promise<void>((r) => setTimeout(r, 5));
    const upload = vi.fn(async () => null); // never recovers
    const { engine } = makeEngine({ upload, sleep });
    engine.pushFrame(frame(0));
    engine.flush();
    await new Promise((r) => setTimeout(r, 12));
    expect(upload.mock.calls.length).toBeGreaterThan(1);

    const t0 = Date.now();
    await engine.finish();
    expect(Date.now() - t0).toBeLessThan(200); // a network outage after End exits at once
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
    // Mirrors session.stop() (finish mode): flush the open segment, then finish. The last
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
    await engine.finish();

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

  it("emits segment_opened, segment_closed, segment_upload_started and segment_upload_result, in order, sharing one seg_id", async () => {
    const events: CaptureEvent[] = [];
    const { engine } = makeEngine({ onEvent: (e) => events.push(e) });
    engine.pushFrame(frame(0));
    engine.pushFrame(frame(100));
    engine.flush();
    await engine.drain();

    expect(events.map((e) => e.type)).toEqual([
      "segment_opened",
      "segment_closed",
      "segment_upload_started",
      "segment_upload_result",
    ]);
    const segIds = new Set(
      events.map((e) => ("seg_id" in e ? e.seg_id : null)),
    );
    expect(segIds.size).toBe(1);
    expect(segIds.has("seg-1")).toBe(true);
    const result = events.find((e) => e.type === "segment_upload_result");
    expect(result).toMatchObject({ ok: true });
  });

  it("never calls onEvent when it is omitted (back-compat, no crash)", async () => {
    const { engine } = makeEngine({ onEvent: undefined });
    engine.pushFrame(frame(0));
    engine.flush();
    await expect(engine.drain()).resolves.toBeUndefined();
  });

  it("keeps the PCM buffer bounded during extended continuous silence (B-3)", () => {
    // Without the fix, trimBeforeMs only runs when a segment closes. During
    // silence the batcher never closes anything, so the buffer would grow by
    // ~64 KB/s (~230 MB/h) for as long as the mic stays muted/disconnected.
    const { engine } = makeEngine();
    const frameMs = 100; // 1_600 samples @ 16 kHz = 100 ms/frame
    const oneHourOfFrames = (60 * 60 * 1_000) / frameMs; // 36_000 frames
    for (let i = 0; i < oneHourOfFrames; i++) {
      engine.pushFrame(frame(i * frameMs, 1_600, /* speech */ false));
    }
    // Stays near the idle-trim headroom (1 s) regardless of how long the
    // silence lasted, instead of accumulating an hour of PCM.
    expect(engine.bufferedMs).toBeLessThan(2_000);
  });

  it("still buffers the full segment while one is open, even next to idle trimming", async () => {
    // The idle trim (B-3) must never eat into audio an open segment still
    // needs — only silence with no open segment should be trimmed.
    const seen: { length: number }[] = [];
    const encode = vi.fn(async (samples: Float32Array) => {
      seen.push({ length: samples.length });
      return { bytes: new Uint8Array([1]), contentType: "audio/webm;codecs=opus" };
    });
    const { engine } = makeEngine({
      encode,
      batcher: new SegmentBatcher({ maxSegmentMs: 5_000, prerollMs: 0 }),
    });
    // A long run of speech (segment open throughout) must survive intact.
    for (let i = 0; i < 40; i++) {
      engine.pushFrame(frame(i * 100, 1_600, true));
    }
    engine.flush();
    await engine.drain();

    expect(encode).toHaveBeenCalledTimes(1);
    // end_ms is the *start* of the last speech frame (pre-existing, documented
    // half-open extraction, §2.3), so the span is 39 frames' worth, not 40 —
    // the point here is that idle trimming took nothing extra off that.
    expect(seen[0]?.length).toBe(39 * 1_600);
  });

  it("preserves the full default 400 ms pre-roll across a long-silence -> speech transition (B-3 boundary, round 2)", async () => {
    // Both B-3 tests above use `prerollMs: 0`, so neither ever exercises the
    // boundary where the idle-trim headroom (1 s, IDLE_TRIM_KEEP_MS) must
    // still cover the batcher's DEFAULT 400 ms pre-roll once speech resumes.
    // Use the real default batcher config here instead of overriding it.
    const seen: Float32Array[] = [];
    const encode = vi.fn(async (samples: Float32Array) => {
      seen.push(samples);
      return { bytes: new Uint8Array([1]), contentType: "audio/webm;codecs=opus" };
    });
    const { engine } = makeEngine({
      encode,
      batcher: new SegmentBatcher(), // DEFAULT_BATCHER_CONFIG: prerollMs 400
    });

    const frameMs = 100;
    // 10 s of continuous silence — long enough for the idle trim to run many
    // times before speech starts.
    const silenceFrames = 10_000 / frameMs;
    for (let i = 0; i < silenceFrames; i++) {
      engine.pushFrame(frame(i * frameMs, 1_600, /* speech */ false));
    }
    // 400 ms of speech (5 frames) right after the silence.
    for (let i = 0; i < 5; i++) {
      engine.pushFrame(frame(silenceFrames * frameMs + i * frameMs, 1_600, true));
    }
    engine.flush();
    await engine.drain();

    expect(encode).toHaveBeenCalledTimes(1);
    // 400 ms pre-roll + 400 ms of speech (4 inter-frame gaps) = 800 ms @ 16 kHz.
    expect(seen[0]?.length).toBe(12_800);
    // No sample in the extracted window — including the 400 ms pre-roll
    // portion — is a default-initialized zero (`extractByMs` zero-fills any
    // stretch no retained chunk covers), which is what idle-trim having eaten
    // into the pre-roll window would otherwise leave behind. (Not compared
    // against the literal `0.1` fill value itself: Float32Array storage
    // can't represent 0.1 exactly, so that equality would never hold.)
    expect(Array.from(seen[0] ?? []).every((s) => s !== 0)).toBe(true);
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

  describe("finish() vs abort() (18 Oct: retry after End)", () => {
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };

    /** An engine whose backoff sleep is held until `release()` (own clock). */
    function makeHeld(overrides: Partial<CaptureEngineOptions> & { prefix?: string } = {}) {
      const { prefix = "seg", ...rest } = overrides;
      let t = 0;
      let seq = 0;
      const waits: number[] = [];
      const held: { release: () => void } = { release: () => {} };
      const engine = new CaptureEngine({
        encode: async () => ({ bytes: new Uint8Array([1]), contentType: "audio/webm;codecs=opus" }),
        upload: async () => 503,
        sampleRate: SR,
        genSegId: () => `${prefix}-${++seq}`,
        now: () => t,
        sleep: (ms) => {
          waits.push(ms);
          return new Promise<void>((r) => {
            held.release = () => {
              t += ms;
              r();
            };
          });
        },
        batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
        ...rest,
      });
      return { engine, held, waits };
    }

    function oneSegment(engine: CaptureEngine) {
      engine.pushFrame(frame(0));
      engine.pushFrame(frame(100));
      engine.flush();
    }

    it("after finish, a 503 head keeps retrying until 240 s, then drops", async () => {
      let calls = 0;
      let finishedAtStatusIndex = -1;
      const upload = vi.fn(async () => {
        calls += 1;
        if (calls === 3) {
          finishedAtStatusIndex = statuses.length;
          void engine.finish();
        }
        return 503 as number | null;
      });
      const { engine, clock, statuses } = makeEngine({ upload, rng: () => 1 });
      oneSegment(engine);
      await engine.drain();

      expect(upload).toHaveBeenCalledTimes(14);
      expect(clock.now()).toBe(241_500);
      expect(engine.status.droppedCount).toBe(1);
      expect(engine.status.queuedCount).toBe(0);
      expect(engine.status.lostSinceSuccess).toBe(true);
      expect(statuses.slice(finishedAtStatusIndex)).toContain("offline");
    });

    it("after finish, a 503 head that recovers is delivered", async () => {
      let calls = 0;
      const upload = vi.fn(async () => {
        calls += 1;
        if (calls === 2) void engine.finish();
        return calls <= 3 ? 503 : 200;
      });
      const { engine } = makeEngine({ upload });
      oneSegment(engine);
      await engine.drain();

      expect(upload).toHaveBeenCalledTimes(4);
      expect(engine.status.droppedCount).toBe(0);
      expect(engine.status.queuedCount).toBe(0);
      expect(engine.status.state).toBe("listening");
    });

    it("finish does not reset or shorten the backoff, and jitter stays in bounds", async () => {
      async function run(rng: () => number) {
        const waits: number[] = [];
        let t = 0;
        let calls = 0;
        const upload = vi.fn(async () => {
          calls += 1;
          if (calls === 1) void engine.finish();
          return 503 as number | null;
        });
        const { engine } = makeEngine({
          upload,
          rng,
          now: () => t,
          sleep: async (ms) => {
            waits.push(ms);
            t += ms;
          },
        });
        oneSegment(engine);
        await engine.drain();
        return waits;
      }

      const low = await run(() => 0);
      expect(low.slice(0, 7)).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000, 15_000]);
      expect(low.slice(6).every((ms) => ms === 15_000)).toBe(true);

      const high = await run(() => 0.999);
      const raw = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
      expect(high.length).toBeGreaterThanOrEqual(7);
      high.forEach((ms, i) => {
        const r = raw[Math.min(i, raw.length - 1)] ?? 0;
        expect(ms).toBeGreaterThanOrEqual(r / 2);
        expect(ms).toBeLessThanOrEqual(r);
      });
      expect(Math.max(...high)).toBeLessThanOrEqual(30_000);
    });

    it("a network failure after finish exits at once", async () => {
      let calls = 0;
      const upload = vi.fn(async () => {
        calls += 1;
        if (calls === 2) void engine.finish();
        return calls === 1 ? 503 : null;
      });
      const { engine } = makeEngine({ upload });
      oneSegment(engine);
      await engine.drain();

      expect(upload).toHaveBeenCalledTimes(2);
      expect(engine.status.queuedCount).toBe(1);
      expect(engine.status.droppedCount).toBe(0);
    });

    it("finish wakes a network-backoff sleep (prompt exit kept)", async () => {
      const upload = vi.fn(async () => null as number | null);
      const { engine } = makeHeld({ upload });
      oneSegment(engine);
      await settle();
      expect(upload).toHaveBeenCalledTimes(1); // asleep after the null

      await engine.finish(); // must resolve without releasing the sleep
      expect(upload).toHaveBeenCalledTimes(2); // the woken retry, then the break
      expect(engine.status.queuedCount).toBe(1);
    });

    it("finish does NOT wake a server-error backoff", async () => {
      const upload = vi.fn(async () => 503 as number | null);
      const { engine, held } = makeHeld({ upload });
      oneSegment(engine);
      await settle();
      expect(upload).toHaveBeenCalledTimes(1);

      void engine.finish();
      await settle();
      expect(upload).toHaveBeenCalledTimes(1); // still sleeping

      held.release();
      await settle();
      expect(upload).toHaveBeenCalledTimes(2);
    });

    it("the finish deadline bounds a multi-segment queue", async () => {
      let calls = 0;
      const upload = vi.fn(async () => {
        calls += 1;
        if (calls === 1) void engine.finish(); // deadline = 0 + 240 s
        return 503 as number | null;
      });
      const { engine } = makeEngine({ upload, rng: () => 1 });
      engine.pushFrame(frame(0));
      engine.pushFrame(frame(100));
      engine.flush();
      engine.pushFrame(frame(2_000));
      engine.pushFrame(frame(2_100));
      engine.flush();
      await engine.drain();

      // head 1: 14 calls ending at 241.5 s; head 2 is dropped on its first refusal (241.5 s >= 240 s)
      expect(upload).toHaveBeenCalledTimes(15);
      expect(engine.status.droppedCount).toBe(2);
      expect(engine.status.queuedCount).toBe(0);
    });

    it("abort() after finish stops at once", async () => {
      const upload = vi.fn(async () => 503 as number | null);
      const { engine } = makeHeld({ upload });
      oneSegment(engine);
      await settle();
      expect(upload).toHaveBeenCalledTimes(1);

      void engine.finish();
      await engine.abort(); // resolves without a release
      expect(upload).toHaveBeenCalledTimes(1);
      expect(engine.status.queuedCount).toBe(1);
    });

    it("abort() before the flushed segment is pumped uploads nothing", async () => {
      const { engine, upload } = makeEngine();
      oneSegment(engine);
      await engine.abort();

      expect(upload).not.toHaveBeenCalled();
    });

    it("a success already in flight at abort() is still confirmed", async () => {
      let resolveUpload: (status: number) => void = () => {};
      const upload = vi.fn(
        () =>
          new Promise<number | null>((r) => {
            resolveUpload = r;
          }),
      );
      const { engine } = makeEngine({ upload });
      oneSegment(engine);
      await settle();
      expect(upload).toHaveBeenCalledTimes(1);

      const aborted = engine.abort();
      resolveUpload(200);
      await aborted;

      expect(engine.status.queuedCount).toBe(0);
      expect(engine.status.droppedCount).toBe(0);
      expect(upload).toHaveBeenCalledTimes(1);
    });

    it("a new engine runs independently while an old one finishes", async () => {
      const uploadA = vi.fn(async (_seg: { seg_id: string }) => 503 as number | null);
      const a = makeHeld({ upload: uploadA, prefix: "a" });
      const uploadB = vi.fn(async (_seg: { seg_id: string }) => 200 as number | null);
      const b = makeEngine({ upload: uploadB, genSegId: (() => {
        let n = 0;
        return () => `b-${++n}`;
      })() });

      oneSegment(a.engine);
      await settle();
      void a.engine.finish(); // A is sleeping on a server-error backoff
      await settle();

      oneSegment(b.engine);
      await b.engine.drain();

      expect(uploadB).toHaveBeenCalledTimes(1);
      expect(uploadB.mock.calls[0]?.[0].seg_id).toBe("b-1");
      expect(uploadA).toHaveBeenCalledTimes(1);
      expect(uploadA.mock.calls.every((c) => c[0].seg_id.startsWith("a-"))).toBe(true);

      a.held.release();
      await settle();
      expect(uploadA).toHaveBeenCalledTimes(2);
      expect(uploadA.mock.calls[1]?.[0].seg_id).toBe("a-1");
      await a.engine.abort(); // stop the held retries
    });
  });
});
