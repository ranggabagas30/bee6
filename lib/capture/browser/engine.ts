import { SegmentBatcher } from "@/lib/capture/batcher";
import { InMemoryQueue, type QueueItem } from "@/lib/capture/queue";
import { PcmWindowBuffer } from "@/lib/capture/browser/pcm-buffer";
import { nextUploadAction } from "@/lib/capture/retry";
import type { CaptureVadFrame } from "@/lib/capture/browser/vad";

/**
 * Headless capture engine (web spec §5) — the non-UI orchestration that turns VAD
 * frames into uploaded segments: buffer PCM → batch into segments → encode →
 * queue → upload with retry, while tracking status + heartbeat metrics. All I/O
 * (encode, upload, sleep, seg-id) is injected so this is fully unit-testable
 * without a browser; the `/capture` page just forwards frames and renders
 * `status`. Audio lives only in memory here and is never logged (hard rule #2).
 */

const DEFAULT_SAMPLE_RATE = 16_000;

export interface QueuedSegment extends QueueItem {
  id: string;
  duration_ms: number;
  seg_id: string;
  start_ms: number;
  end_ms: number;
  sample_rate: number;
  bytes: Uint8Array;
  content_type: string;
}

export type EncodeFn = (
  samples: Float32Array,
  sampleRate: number,
) => Promise<{ bytes: Uint8Array; contentType: string }>;

/** Uploads a segment; resolves to the HTTP status, or null on a network error. */
export type UploadFn = (segment: QueuedSegment) => Promise<number | null>;

export type SleepFn = (ms: number) => Promise<void>;

export type CaptureState = "listening" | "offline" | "mic_error";

export interface CaptureStatus {
  state: CaptureState;
  queuedCount: number;
  droppedCount: number;
  micError: string | null;
}

export interface CaptureSnapshot {
  queuedCount: number;
  droppedCount: number;
  /** Speech percentage over the window since the last snapshot (0–100). */
  speechPct: number;
}

export interface CaptureEngineOptions {
  encode: EncodeFn;
  upload: UploadFn;
  sampleRate?: number;
  batcher?: SegmentBatcher;
  queue?: InMemoryQueue<QueuedSegment>;
  genSegId?: () => string;
  maxAttempts?: number;
  sleep?: SleepFn;
  onStatusChange?: (status: CaptureStatus) => void;
}

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultGenSegId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `seg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class CaptureEngine {
  private readonly sampleRate: number;
  private readonly batcher: SegmentBatcher;
  private readonly queue: InMemoryQueue<QueuedSegment>;
  private readonly genSegId: () => string;
  private readonly maxAttempts: number;
  private readonly sleep: SleepFn;
  private readonly onStatusChange?: (status: CaptureStatus) => void;
  private readonly encode: EncodeFn;
  private readonly upload: UploadFn;

  private buffer: PcmWindowBuffer | null = null;
  private readonly attempts = new Map<string, number>();
  private pumping = false;
  private connectionOk = true;
  private micError: string | null = null;
  private uploadDropped = 0;
  private totalFrames = 0;
  private speechFrames = 0;
  /** Serialises segment handling so ordering holds and tests can `drain()`. */
  private pending: Promise<void> = Promise.resolve();

  constructor(options: CaptureEngineOptions) {
    this.encode = options.encode;
    this.upload = options.upload;
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.batcher = options.batcher ?? new SegmentBatcher();
    this.queue = options.queue ?? new InMemoryQueue<QueuedSegment>();
    this.genSegId = options.genSegId ?? defaultGenSegId;
    this.maxAttempts = options.maxAttempts ?? 6;
    this.sleep = options.sleep ?? defaultSleep;
    this.onStatusChange = options.onStatusChange;
  }

  /** Feeds one VAD frame. Non-blocking; segment work is chained internally. */
  pushFrame(frame: CaptureVadFrame): void {
    if (!this.buffer) this.buffer = new PcmWindowBuffer(this.sampleRate, frame.ts);
    this.buffer.append(frame.samples);
    this.totalFrames += 1;
    if (frame.speech) this.speechFrames += 1;

    const segment = this.batcher.push({ ts: frame.ts, speech: frame.speech });
    if (segment) this.chainSegment(segment);
  }

  /** Closes any open segment (call on stop / closing time). */
  flush(): void {
    const segment = this.batcher.flush();
    if (segment) this.chainSegment(segment);
  }

  setMicError(message: string): void {
    this.micError = message;
    this.emitStatus();
  }

  clearMicError(): void {
    this.micError = null;
    this.emitStatus();
  }

  /** Awaits all in-flight segment handling + uploads (tests, and stop()). */
  async drain(): Promise<void> {
    await this.pending;
  }

  get status(): CaptureStatus {
    const state: CaptureState = this.micError
      ? "mic_error"
      : !this.connectionOk && this.queue.size > 0
        ? "offline"
        : "listening";
    return {
      state,
      queuedCount: this.queue.size,
      droppedCount: this.queue.droppedCount + this.uploadDropped,
      micError: this.micError,
    };
  }

  /** Heartbeat metrics; resets the speech window so each call covers ~60 s. */
  snapshot(): CaptureSnapshot {
    const speechPct =
      this.totalFrames === 0
        ? 0
        : Math.round((this.speechFrames / this.totalFrames) * 100);
    this.totalFrames = 0;
    this.speechFrames = 0;
    return {
      queuedCount: this.queue.size,
      droppedCount: this.queue.droppedCount + this.uploadDropped,
      speechPct,
    };
  }

  private chainSegment(segment: { start_ms: number; end_ms: number }): void {
    this.pending = this.pending
      .then(() => this.handleSegment(segment))
      .catch(() => {
        // Segment handling never rejects (encode failures drop the segment);
        // this catch only guards against an unexpected throw so the chain lives.
      });
  }

  private async handleSegment(segment: {
    start_ms: number;
    end_ms: number;
  }): Promise<void> {
    if (!this.buffer) return;
    const samples = this.buffer.extractByMs(segment.start_ms, segment.end_ms);
    this.buffer.trimBeforeMs(segment.end_ms);

    let encoded: { bytes: Uint8Array; contentType: string };
    try {
      encoded = await this.encode(samples, this.sampleRate);
    } catch {
      // Cannot encode (e.g. no WebCodecs): drop this segment rather than block.
      return;
    }

    const id = this.genSegId();
    this.queue.enqueue({
      id,
      seg_id: id,
      duration_ms: segment.end_ms - segment.start_ms,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      sample_rate: this.sampleRate,
      bytes: encoded.bytes,
      content_type: encoded.contentType,
    });
    this.emitStatus();
    await this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const item = this.queue.peek();
        if (!item) break;
        const attempt = (this.attempts.get(item.id) ?? 0) + 1;
        const status = await this.upload(item);
        const action = nextUploadAction(status, attempt, {
          maxAttempts: this.maxAttempts,
          jitter: false,
        });

        if (action.action === "success") {
          this.queue.confirmUploaded(item.id);
          this.attempts.delete(item.id);
          this.connectionOk = true;
        } else if (action.action === "drop") {
          this.queue.remove(item.id);
          this.attempts.delete(item.id);
          this.uploadDropped += 1;
        } else {
          this.attempts.set(item.id, attempt);
          this.connectionOk = false;
          this.emitStatus();
          await this.sleep(action.delayMs ?? 0);
        }
        this.emitStatus();
      }
    } finally {
      this.pumping = false;
    }
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.status);
  }
}
