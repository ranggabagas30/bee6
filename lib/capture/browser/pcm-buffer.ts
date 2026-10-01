/**
 * In-memory PCM window buffer (R-03 capture pipeline). Holds recent 16 kHz mono
 * samples from the VAD so the encoder can pull the exact `[start_ms, end_ms)`
 * window the batcher decided to close. Audio lives here only transiently and is
 * never logged, never persisted (hard rule #2); `trimBeforeMs` bounds memory.
 *
 * Pure/deterministic: sample 0 maps to `baseMs`, ms↔sample conversion uses the
 * fixed sample rate, so windowing is fully unit-testable without any browser API.
 */
export class PcmWindowBuffer {
  private chunks: { startSample: number; samples: Float32Array }[] = [];
  /** Monotonic next-sample-index counter for new chunks; NOT reduced by
   * `trimBeforeMs` (it only drops old chunks) — `msToSample` needs it to keep
   * placing future samples at the right absolute position. Use `bufferedMs`
   * for how much audio is actually retained. */
  private totalSamples = 0;

  constructor(
    private readonly sampleRate: number,
    /** Device epoch ms corresponding to sample index 0. */
    private readonly baseMs = 0,
  ) {}

  /** Appends one contiguous frame of samples (in capture order). */
  append(samples: Float32Array): void {
    this.chunks.push({ startSample: this.totalSamples, samples });
    this.totalSamples += samples.length;
  }

  private msToSample(ms: number): number {
    return Math.round(((ms - this.baseMs) / 1000) * this.sampleRate);
  }

  /** Extracts the samples for `[startMs, endMs)` as one Float32Array. */
  extractByMs(startMs: number, endMs: number): Float32Array {
    const startSample = Math.max(0, this.msToSample(startMs));
    const endSample = Math.max(startSample, this.msToSample(endMs));
    const out = new Float32Array(endSample - startSample);
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.startSample + chunk.samples.length;
      if (chunkEnd <= startSample || chunk.startSample >= endSample) continue;
      const from = Math.max(startSample, chunk.startSample);
      const to = Math.min(endSample, chunkEnd);
      const srcOffset = from - chunk.startSample;
      const dstOffset = from - startSample;
      out.set(chunk.samples.subarray(srcOffset, srcOffset + (to - from)), dstOffset);
    }
    return out;
  }

  /** Drops chunks that end before `ms` to bound memory (already-encoded audio). */
  trimBeforeMs(ms: number): void {
    const cutoff = this.msToSample(ms);
    this.chunks = this.chunks.filter(
      (c) => c.startSample + c.samples.length > cutoff,
    );
  }

  /**
   * Total buffered duration in ms, counting only chunks still retained after
   * any `trimBeforeMs` (not the lifetime total appended — that's what
   * `totalSamples` is for). This is what bounds memory during idle trimming
   * (finding B-3): a caller checking this value sees the real buffer size.
   */
  get bufferedMs(): number {
    const retainedSamples = this.chunks.reduce(
      (sum, c) => sum + c.samples.length,
      0,
    );
    return (retainedSamples / this.sampleRate) * 1000;
  }
}
