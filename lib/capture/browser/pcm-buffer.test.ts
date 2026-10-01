import { describe, expect, it } from "vitest";
import { PcmWindowBuffer } from "@/lib/capture/browser/pcm-buffer";

const SR = 16_000; // 16 samples per ms

/** A frame of `n` samples all set to `value` (easy to assert on). */
const frame = (n: number, value: number) => new Float32Array(n).fill(value);

describe("PcmWindowBuffer", () => {
  it("tracks buffered duration in ms", () => {
    const buf = new PcmWindowBuffer(SR);
    buf.append(frame(16_000, 0)); // 1 s
    buf.append(frame(8_000, 0)); // 0.5 s
    expect(buf.bufferedMs).toBe(1_500);
  });

  it("extracts the exact sample window for [startMs, endMs)", () => {
    const buf = new PcmWindowBuffer(SR);
    buf.append(frame(1_600, 0.1)); // ms 0..100
    buf.append(frame(1_600, 0.2)); // ms 100..200
    const out = buf.extractByMs(100, 200);
    expect(out.length).toBe(1_600);
    expect(out[0]).toBeCloseTo(0.2);
    expect(out[out.length - 1]).toBeCloseTo(0.2);
  });

  it("stitches a window that spans multiple frames", () => {
    const buf = new PcmWindowBuffer(SR);
    buf.append(frame(1_600, 0.1)); // ms 0..100
    buf.append(frame(1_600, 0.2)); // ms 100..200
    const out = buf.extractByMs(50, 150); // half of each frame
    expect(out.length).toBe(1_600);
    expect(out[0]).toBeCloseTo(0.1); // from first frame
    expect(out[out.length - 1]).toBeCloseTo(0.2); // from second frame
  });

  it("honours a non-zero base epoch", () => {
    const buf = new PcmWindowBuffer(SR, 10_000); // sample 0 = 10_000 ms
    buf.append(frame(1_600, 0.3)); // ms 10_000..10_100
    const out = buf.extractByMs(10_000, 10_100);
    expect(out.length).toBe(1_600);
    expect(out[0]).toBeCloseTo(0.3);
  });

  it("returns zero-filled samples for a window past the buffered data", () => {
    const buf = new PcmWindowBuffer(SR);
    buf.append(frame(1_600, 0.5)); // ms 0..100
    const out = buf.extractByMs(100, 200); // nothing buffered here
    expect(out.length).toBe(1_600);
    expect(out.every((s) => s === 0)).toBe(true);
  });

  it("drops fully-consumed chunks on trim to bound memory", () => {
    const buf = new PcmWindowBuffer(SR);
    buf.append(frame(1_600, 0.1)); // ms 0..100
    buf.append(frame(1_600, 0.2)); // ms 100..200
    buf.trimBeforeMs(100); // drop the first frame
    // The first frame's data is gone → its window now reads as zeros.
    const gone = buf.extractByMs(0, 100);
    expect(gone.every((s) => s === 0)).toBe(true);
    // The second frame is still intact.
    const kept = buf.extractByMs(100, 200);
    expect(kept[0]).toBeCloseTo(0.2);
  });

  it("reports bufferedMs as what's actually retained after a trim, not the lifetime total", () => {
    // bufferedMs must reflect real memory use after trimming, otherwise a
    // caller (CaptureEngine's idle-trim, finding B-3) can't verify the trim
    // actually bounded anything.
    const buf = new PcmWindowBuffer(SR);
    buf.append(frame(16_000, 0)); // 1 s
    buf.append(frame(16_000, 0)); // 1 s
    expect(buf.bufferedMs).toBe(2_000);
    buf.trimBeforeMs(1_000); // drop the first second
    expect(buf.bufferedMs).toBe(1_000);
  });
});
