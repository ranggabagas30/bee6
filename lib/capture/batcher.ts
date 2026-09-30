/**
 * Segment batcher (web spec §5 step 3). A pure, deterministic state machine that
 * turns a stream of VAD frame decisions into segment boundaries:
 *
 *   - a segment is at most 15 s long (cut and continue if speech keeps going);
 *   - it is closed early on a >= 2 s pause once >= 6 s has been collected;
 *   - or after 8 s of continuous silence;
 *   - a 400 ms pre-roll is prepended to the first speech frame so the first
 *     syllables aren't clipped.
 *
 * It emits only start/end times (device epoch ms). Slice 4's audio adapter reads
 * the encoded bytes between those times. Silence is never emitted, so it is never
 * uploaded. No browser API here — fully unit-testable.
 */

export interface VadFrame {
  /** Device epoch ms for this frame. */
  ts: number;
  /** VAD decision: true when the frame contains speech. */
  speech: boolean;
}

export interface Segment {
  start_ms: number;
  end_ms: number;
}

export interface BatcherConfig {
  maxSegmentMs: number;
  minForPauseCutMs: number;
  pauseCutMs: number;
  silenceTimeoutMs: number;
  prerollMs: number;
}

export const DEFAULT_BATCHER_CONFIG: BatcherConfig = {
  maxSegmentMs: 15_000,
  minForPauseCutMs: 6_000,
  pauseCutMs: 2_000,
  silenceTimeoutMs: 8_000,
  prerollMs: 400,
};

export class SegmentBatcher {
  private readonly cfg: BatcherConfig;
  private active = false;
  private startMs = 0;
  private lastSpeechMs = 0;

  constructor(config: Partial<BatcherConfig> = {}) {
    this.cfg = { ...DEFAULT_BATCHER_CONFIG, ...config };
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Feeds one VAD frame; returns a closed segment when a boundary is hit. */
  push(frame: VadFrame): Segment | null {
    return frame.speech ? this.onSpeech(frame.ts) : this.onSilence(frame.ts);
  }

  /** Closes any open segment (call when capture stops at closing time). */
  flush(): Segment | null {
    return this.active ? this.close() : null;
  }

  private onSpeech(ts: number): Segment | null {
    if (!this.active) {
      // Open a segment, prepending the pre-roll (clamped to >= 0).
      this.active = true;
      this.startMs = Math.max(0, ts - this.cfg.prerollMs);
      this.lastSpeechMs = ts;
      return null;
    }

    this.lastSpeechMs = ts;

    if (ts - this.startMs >= this.cfg.maxSegmentMs) {
      // Hard cap reached while speech continues: emit and start a new
      // contiguous segment at ts (no pre-roll — speech never stopped).
      const seg: Segment = { start_ms: this.startMs, end_ms: ts };
      this.startMs = ts;
      this.lastSpeechMs = ts;
      return seg;
    }
    return null;
  }

  private onSilence(ts: number): Segment | null {
    if (!this.active) return null;

    const gap = ts - this.lastSpeechMs;
    const collected = this.lastSpeechMs - this.startMs;

    if (collected >= this.cfg.maxSegmentMs) return this.close();
    if (collected >= this.cfg.minForPauseCutMs && gap >= this.cfg.pauseCutMs) {
      return this.close();
    }
    if (gap >= this.cfg.silenceTimeoutMs) return this.close();
    return null;
  }

  private close(): Segment {
    const seg: Segment = { start_ms: this.startMs, end_ms: this.lastSpeechMs };
    this.active = false;
    this.startMs = 0;
    this.lastSpeechMs = 0;
    return seg;
  }
}
