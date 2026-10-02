import { SegmentBatcher } from "@/lib/capture/batcher";
import { InMemoryQueue, type QueueItem } from "@/lib/capture/queue";
import { PcmWindowBuffer } from "@/lib/capture/browser/pcm-buffer";
import { backoffDelayMs, classifyUploadResult } from "@/lib/capture/retry";
import type { CaptureVadFrame } from "@/lib/capture/browser/vad";

/**
 * Headless capture engine (web spec §5) — the non-UI orchestration that turns VAD
 * frames into uploaded segments: buffer PCM → batch into segments → encode →
 * queue → upload with retry, while tracking status + heartbeat metrics. All I/O
 * (encode, upload, sleep, seg-id) is injected so this is fully unit-testable
 * without a browser; the `/capture` page just forwards frames and renders
 * `status`. Audio lives only in memory here and is never logged (hard rule #2).
 *
 * Offline behaviour (web spec §5 "10 min offline → every segment exactly once"):
 * a connectivity loss (upload resolves `null`) retries indefinitely — only the
 * 10-minute queue *capacity* prunes segments, never an attempt count. A repeated
 * server error (5xx/429) still gives up after `maxAttempts` so one poison segment
 * can't block the queue forever. `abort()` interrupts any wait so `stop()` returns
 * promptly even while offline.
 */

const DEFAULT_SAMPLE_RATE = 16_000;
const MAX_BACKOFF_MS = 30_000;
/**
 * How much PCM to keep as headroom while idle (no open segment), so the next
 * segment's pre-roll (default 400 ms, `batcher.ts`) is still in the buffer
 * when speech resumes. Trimming to this little during silence is what bounds
 * memory during a long quiet period (finding B-3) instead of only trimming on
 * segment close.
 */
const IDLE_TRIM_KEEP_MS = 1_000;

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
  /**
   * Attempt counters for the current queue head only (O(1), no leak).
   * `serverErrorCount` is what `maxAttempts` is checked against — it counts
   * only real 429/5xx responses. Plain network-unreachable attempts (`status
   * === null`) bump `count` for observability but never `serverErrorCount`,
   * so a long offline stretch can't consume the server-error budget and get
   * a segment dropped on its first 5xx right after reconnecting (B-4).
   */
  private headAttempt: { id: string; count: number; serverErrorCount: number } | null =
    null;
  private pumping = false;
  private connectionOk = true;
  private micError: string | null = null;
  private uploadDropped = 0;
  private totalFrames = 0;
  private speechFrames = 0;
  /** Serialises segment handling so ordering holds and tests can `drain()`. */
  private pending: Promise<void> = Promise.resolve();
  /** Set by `abort()`; makes the pump loop and its waits bail out promptly. */
  private stopping = false;
  /** Resolver used to interrupt the current backoff wait on abort. */
  private wake: (() => void) | null = null;

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
    if (segment) {
      this.closeSegment(segment);
    } else if (!this.batcher.isActive) {
      // No segment is open (continuous silence, or a muted/disconnected mic):
      // the batcher never closes anything to trigger `closeSegment`'s trim, so
      // trim here too, independent of segment closure. This bounds memory
      // during an arbitrarily long quiet period instead of growing ~64 KB/s
      // forever (finding B-3).
      this.buffer.trimBeforeMs(frame.ts - IDLE_TRIM_KEEP_MS);
    }
  }

  /** Closes any open segment (call on stop / closing time). */
  flush(): void {
    const segment = this.batcher.flush();
    if (segment) this.closeSegment(segment);
  }

  /**
   * Rebases the timeline after a mic/VAD restart. Ships any segment buffered
   * before the interruption (so its audio isn't lost), then drops the stale PCM
   * buffer so the next frame re-bases `baseMs` onto the restarted VAD clock —
   * otherwise the new frames' jumped timestamps would map to sample indices past
   * the buffer and extract silence (finding #1).
   */
  resyncTimeline(): void {
    const segment = this.batcher.flush();
    if (segment) this.closeSegment(segment); // extracts from the old buffer now
    this.buffer = null;
  }

  setMicError(message: string): void {
    this.micError = message;
    this.emitStatus();
  }

  clearMicError(): void {
    this.micError = null;
    this.emitStatus();
  }

  /** Awaits all in-flight segment handling + uploads. */
  async drain(): Promise<void> {
    await this.pending;
  }

  /** Stops the pump promptly (even mid-backoff while offline) and drains. */
  async abort(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.drain();
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

  /** Approximate PCM buffer size in ms (observability / test hook, B-3). */
  get bufferedMs(): number {
    return this.buffer?.bufferedMs ?? 0;
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

  /** Extracts a closed segment's PCM synchronously, then chains encode+upload. */
  private closeSegment(segment: { start_ms: number; end_ms: number }): void {
    if (!this.buffer) return;
    const samples = this.buffer.extractByMs(segment.start_ms, segment.end_ms);
    this.buffer.trimBeforeMs(segment.end_ms);
    this.pending = this.pending
      .then(() => this.handleSegment(segment, samples))
      .catch(() => {
        // handleSegment never rejects (encode failures drop the segment); this
        // only guards an unexpected throw so the chain survives.
      });
  }

  private async handleSegment(
    segment: { start_ms: number; end_ms: number },
    samples: Float32Array,
  ): Promise<void> {
    let encoded: { bytes: Uint8Array; contentType: string };
    try {
      encoded = await this.encode(samples, this.sampleRate);
    } catch {
      return; // Cannot encode (e.g. no WebCodecs): drop rather than block.
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

        if (this.headAttempt?.id !== item.id) {
          this.headAttempt = { id: item.id, count: 0, serverErrorCount: 0 };
        }
        this.headAttempt.count += 1;

        const status = await this.upload(item);
        const disposition = classifyUploadResult(status);

        if (disposition === "success") {
          this.queue.confirmUploaded(item.id);
          this.headAttempt = null;
          this.connectionOk = true;
          this.emitStatus();
          continue;
        }
        if (disposition === "drop") {
          this.dropHead(item.id);
          continue;
        }

        // Transient failure. A network loss (null) retries forever — only the
        // 10-min queue capacity prunes it (finding #2). A repeated server error
        // still gives up after maxAttempts so one poison segment can't stall the
        // queue indefinitely. Only real 429/5xx responses count toward that
        // budget (`serverErrorCount`) — a network-unreachable stretch (status
        // null) must not consume it, or a segment can get dropped on its very
        // first 5xx right after reconnecting (B-4).
        if (status !== null) this.headAttempt.serverErrorCount += 1;
        if (status !== null && this.headAttempt.serverErrorCount >= this.maxAttempts) {
          this.dropHead(item.id);
          continue;
        }
        this.connectionOk = false;
        this.emitStatus();
        // On a graceful stop, don't wait/retry a failed upload — leave remaining
        // items in the in-memory queue (finding #3). Successful uploads above
        // still drain first, so the final flushed segment ships while online.
        if (this.stopping) break;
        await this.sleepOrAbort(
          backoffDelayMs(this.headAttempt.count, {
            jitter: false,
            maxMs: MAX_BACKOFF_MS,
          }),
        );
      }
    } finally {
      this.pumping = false;
    }
  }

  private dropHead(id: string): void {
    this.queue.remove(id);
    this.headAttempt = null;
    this.uploadDropped += 1;
    this.emitStatus();
  }

  /** Waits `ms`, but resolves immediately if `abort()` is called meanwhile. */
  private sleepOrAbort(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.wake = null;
        resolve();
      };
      this.wake = finish;
      void this.sleep(ms).then(finish);
    });
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.status);
  }
}
