import { SegmentBatcher } from "@/lib/capture/batcher";
import { InMemoryQueue, type QueueItem } from "@/lib/capture/queue";
import { PcmWindowBuffer } from "@/lib/capture/browser/pcm-buffer";
import { backoffDelayMs, classifyUploadResult } from "@/lib/capture/retry";
import type { CaptureVadFrame } from "@/lib/capture/browser/vad";
import type { CaptureEvent } from "@/lib/capture/browser/event-log";

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
 * server error (5xx/429) gives up once the head has been refused for `headBudgetMs`
 * (default 4 min, R-23) so one poison segment can't block the queue forever. Retry waits are jittered so several
 * phones that fail together do not retry in lockstep (R-22). `abort()` interrupts any wait so `stop()` returns
 * promptly even while offline.
 */

const DEFAULT_SAMPLE_RATE = 16_000;
const MAX_BACKOFF_MS = 30_000;
/**
 * R-23: a queue head that keeps being refused by the server (429/5xx) is dropped
 * once it has been refused for this long, measured from its first server error to
 * the latest one. Network failures (null) never count: offline retries forever,
 * only the 10-min queue capacity prunes (B-4, finding #2).
 */
export const HEAD_BUDGET_MS = 240_000;
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
  /**
   * Numeric HTTP status of the most recent segment upload, or null when the
   * last attempt was a network failure (no response) or none has run yet.
   */
  lastUploadHttpStatus: number | null;
  /**
   * True while at least one segment has been dropped (queue prune, server
   * refusal, 4xx, or server-error give-up) and no 2xx upload has happened since.
   * Drives the "some speech was not captured" line (UX-03 §5.7 row L). The
   * headline never reads this.
   */
  lostSinceSuccess: boolean;
  /**
   * Failed attempts so far for the current queue head (0 when nothing is
   * queued or the head has not failed yet). Drives the "(Nx)" retry count.
   */
  headFailedAttempts: number;
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
  /** R-23: how long a head segment may keep being refused by the server before it is dropped. */
  headBudgetMs?: number;
  /** Clock for the budget; defaults to Date.now. Injectable for tests. */
  now?: () => number;
  sleep?: SleepFn;
  /** RNG in [0,1) for retry jitter; defaults to Math.random. Injectable for tests. */
  rng?: () => number;
  onStatusChange?: (status: CaptureStatus) => void;
  /** DEV-01 dev-panel event log; optional, no behavior change when omitted. */
  onEvent?: (event: CaptureEvent) => void;
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
  private readonly headBudgetMs: number;
  private readonly now: () => number;
  private readonly sleep: SleepFn;
  private readonly rng: () => number;
  private readonly onStatusChange?: (status: CaptureStatus) => void;
  private readonly onEvent?: (event: CaptureEvent) => void;
  private readonly encode: EncodeFn;
  private readonly upload: UploadFn;

  private buffer: PcmWindowBuffer | null = null;
  /**
   * Attempt counters for the current queue head only (O(1), no leak).
   * The drop decision is time-based (R-23): `firstServerErrorAt` is the clock
   * reading at the head's first real 429/5xx, and the head is dropped once a
   * later server error lands `headBudgetMs` or more after it. `serverErrorCount`
   * is kept for observability only. Plain network-unreachable attempts (`status
   * === null`) bump `count` but never start or consume the budget, so a long
   * offline stretch can't get a segment dropped on its first 5xx right after
   * reconnecting (B-4).
   */
  private headAttempt: {
    id: string;
    count: number;
    serverErrorCount: number;
    /** Clock reading at the first server error of this head; null until then. */
    firstServerErrorAt: number | null;
    /** Transient failures of this head (network, 429, 5xx). Feeds the retry count. */
    failed: number;
  } | null = null;
  private pumping = false;
  private connectionOk = true;
  private micError: string | null = null;
  private lastUploadHttpStatus: number | null = null;
  private uploadDropped = 0;
  /** Total drops (prune + upload drops) as of the last 2xx; see `lostSinceSuccess`. */
  private droppedAtLastSuccess = 0;
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
    this.headBudgetMs = options.headBudgetMs ?? HEAD_BUDGET_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.rng = options.rng ?? Math.random;
    this.onStatusChange = options.onStatusChange;
    this.onEvent = options.onEvent;
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
      droppedCount: this.totalDropped(),
      micError: this.micError,
      lastUploadHttpStatus: this.lastUploadHttpStatus,
      lostSinceSuccess: this.totalDropped() > this.droppedAtLastSuccess,
      headFailedAttempts: this.headAttempt?.failed ?? 0,
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
      droppedCount: this.totalDropped(),
      speechPct,
    };
  }

  /**
   * Extracts a closed segment's PCM synchronously, then chains encode+upload.
   * The segment id is generated here (not after encoding) so the dev-panel
   * event log (`segment_opened`/`segment_closed`) can tag the same id the
   * later upload events use — the batcher only ever reports a segment once
   * its whole interval is known, so "opened" and "closed" are emitted
   * together here rather than at two genuinely different real-time moments.
   */
  private closeSegment(segment: { start_ms: number; end_ms: number }): void {
    if (!this.buffer) return;
    const samples = this.buffer.extractByMs(segment.start_ms, segment.end_ms);
    this.buffer.trimBeforeMs(segment.end_ms);
    const segId = this.genSegId();
    this.emitEvent({ type: "segment_opened", seg_id: segId });
    this.emitEvent({
      type: "segment_closed",
      seg_id: segId,
      duration_ms: segment.end_ms - segment.start_ms,
    });
    this.pending = this.pending
      .then(() => this.handleSegment(segId, segment, samples))
      .catch(() => {
        // handleSegment never rejects (encode failures drop the segment); this
        // only guards an unexpected throw so the chain survives.
      });
  }

  private async handleSegment(
    segId: string,
    segment: { start_ms: number; end_ms: number },
    samples: Float32Array,
  ): Promise<void> {
    let encoded: { bytes: Uint8Array; contentType: string };
    try {
      encoded = await this.encode(samples, this.sampleRate);
    } catch {
      return; // Cannot encode (e.g. no WebCodecs): drop rather than block.
    }

    this.emitEvent({
      type: "segment_upload_started",
      seg_id: segId,
      byte_count: encoded.bytes.length,
    });
    this.queue.enqueue({
      id: segId,
      seg_id: segId,
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
          this.headAttempt = {
            id: item.id,
            count: 0,
            serverErrorCount: 0,
            firstServerErrorAt: null,
            failed: 0,
          };
        }
        this.headAttempt.count += 1;

        const status = await this.upload(item);
        this.lastUploadHttpStatus = status;
        const disposition = classifyUploadResult(status);
        this.emitEvent({
          type: "segment_upload_result",
          seg_id: item.id,
          ok: disposition === "success",
          http_status: status,
        });

        if (disposition === "success") {
          this.queue.confirmUploaded(item.id);
          this.headAttempt = null;
          this.connectionOk = true;
          this.droppedAtLastSuccess = this.totalDropped();
          this.emitStatus();
          continue;
        }
        if (disposition === "drop") {
          this.dropHead(item.id);
          continue;
        }

        // Transient failure. A network loss (null) retries forever — only the
        // 10-min queue capacity prunes it (finding #2). A repeated server error
        // still gives up once it has been refused for headBudgetMs (R-23) so one
        // poison segment can't stall the queue indefinitely. Only real 429/5xx
        // responses start or consume that budget — a network-unreachable stretch
        // (status null) must not, or a segment can get dropped on its very first
        // 5xx right after reconnecting (B-4). The clock is read after the PUT
        // resolved, so the PUT's own duration counts.
        if (status !== null) {
          this.headAttempt.serverErrorCount += 1;
          const at = this.now();
          if (this.headAttempt.firstServerErrorAt === null) {
            this.headAttempt.firstServerErrorAt = at;
          }
          if (at - this.headAttempt.firstServerErrorAt >= this.headBudgetMs) {
            this.dropHead(item.id);
            continue;
          }
        }
        this.headAttempt.failed += 1;
        this.connectionOk = false;
        this.emitStatus();
        // On a graceful stop, don't wait/retry a failed upload — leave remaining
        // items in the in-memory queue (finding #3). Successful uploads above
        // still drain first, so the final flushed segment ships while online.
        if (this.stopping) break;
        await this.sleepOrAbort(
          backoffDelayMs(this.headAttempt.count, {
            jitter: true,
            rng: this.rng,
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

  /** Every segment this session has given up on: queue prune plus upload drops. */
  private totalDropped(): number {
    return this.queue.droppedCount + this.uploadDropped;
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

  private emitEvent(event: CaptureEvent): void {
    this.onEvent?.(event);
  }
}
