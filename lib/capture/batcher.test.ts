import { describe, expect, it } from "vitest";
import {
  SegmentBatcher,
  type Segment,
  type VadFrame,
} from "@/lib/capture/batcher";

/** Feeds a whole frame stream and collects every emitted segment. */
function run(frames: VadFrame[], batcher = new SegmentBatcher()): Segment[] {
  const out: Segment[] = [];
  for (const f of frames) {
    const seg = batcher.push(f);
    if (seg) out.push(seg);
  }
  return out;
}

/** Builds `count` frames at `stepMs` cadence starting at `startMs`. */
function frames(
  startMs: number,
  count: number,
  stepMs: number,
  speech: boolean,
): VadFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: startMs + i * stepMs,
    speech,
  }));
}

describe("SegmentBatcher", () => {
  it("emits nothing for a silent stream (silence never uploaded)", () => {
    expect(run(frames(0, 100, 100, false))).toEqual([]);
  });

  it("prepends a 400 ms pre-roll to the first speech frame", () => {
    const b = new SegmentBatcher();
    // First speech at 5000 ms, then long silence to close.
    b.push({ ts: 5_000, speech: true });
    let seg: Segment | null = null;
    for (let ts = 5_100; ts <= 13_100 && !seg; ts += 100) {
      seg = b.push({ ts, speech: false });
    }
    expect(seg).toEqual({ start_ms: 4_600, end_ms: 5_000 });
  });

  it("clamps the pre-roll so start never goes negative", () => {
    const b = new SegmentBatcher();
    b.push({ ts: 100, speech: true });
    const seg = run(frames(8_100, 1, 100, false), b);
    expect(seg[0]?.start_ms).toBe(0);
  });

  it("cuts at the 15 s hard cap during continuous speech", () => {
    // 30 s of continuous speech at 100 ms cadence → two 15 s segments.
    const segs = run(frames(0, 301, 100, true));
    expect(segs.length).toBe(2);
    expect(segs[0]).toEqual({ start_ms: 0, end_ms: 15_000 });
    // New segment starts contiguously at the cut (no words lost between them).
    expect(segs[1]?.start_ms).toBe(15_000);
  });

  it("produces >= 12 segments for 3 minutes of continuous talk", () => {
    const segs = run(frames(0, 1_801, 100, true));
    expect(segs.length).toBeGreaterThanOrEqual(12);
  });

  it("closes early on a >= 2 s pause once >= 6 s is collected", () => {
    const b = new SegmentBatcher();
    // 6 s of speech (frames 0..6000), then silence; pause-cut at 2 s.
    run(frames(0, 61, 100, true), b);
    const seg = b.push({ ts: 8_000, speech: false }); // gap 2000 from 6000
    expect(seg).toEqual({ start_ms: 0, end_ms: 6_000 });
  });

  it("does NOT pause-cut before 6 s is collected", () => {
    const b = new SegmentBatcher();
    run(frames(0, 31, 100, true), b); // 3 s of speech (0..3000)
    const seg = b.push({ ts: 5_100, speech: false }); // gap 2.1 s, only 3 s collected
    expect(seg).toBeNull();
  });

  it("closes after 8 s of continuous silence for a short utterance", () => {
    const b = new SegmentBatcher();
    run(frames(3_000, 21, 100, true), b); // 2 s of speech (3000..5000)
    const seg = b.push({ ts: 13_000, speech: false }); // gap 8 s from 5000
    expect(seg).toEqual({ start_ms: 2_600, end_ms: 5_000 });
  });

  it("flush() closes an open segment", () => {
    const b = new SegmentBatcher();
    run(frames(1_000, 11, 100, true), b); // speech 1000..2000
    expect(b.isActive).toBe(true);
    expect(b.flush()).toEqual({ start_ms: 600, end_ms: 2_000 });
    expect(b.isActive).toBe(false);
    expect(b.flush()).toBeNull();
  });

  it("respects custom config", () => {
    const b = new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 });
    const segs = run(frames(0, 21, 100, true), b); // 2 s continuous
    expect(segs[0]).toEqual({ start_ms: 0, end_ms: 1_000 });
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });
});
