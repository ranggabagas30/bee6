/**
 * In-memory upload queue (web spec §5 step 5). Holds encoded segments while the
 * network is unavailable and uploads them in order. Capped by *queued audio
 * duration* (~10 min), not item count: when a new segment would push the total
 * over the cap, the oldest segments are dropped (and counted) until it fits.
 * Each segment is removed exactly once, only after the caller confirms its
 * upload succeeded. No persistence — the encrypted IndexedDB queue is P1.
 *
 * Pure/deterministic: no clock, no I/O. Duration accounting uses each segment's
 * own `duration_ms`, so behaviour is fully testable.
 */

export interface QueueItem {
  /** Stable id used for exactly-once removal (the segment's `seg_id`). */
  id: string;
  /** Segment length in ms; the cap is measured against the sum of these. */
  duration_ms: number;
}

export const DEFAULT_MAX_QUEUE_MS = 10 * 60_000; // ~10 minutes

export interface InMemoryQueueOptions {
  /** Cap on total queued audio duration in ms. */
  maxDurationMs: number;
}

export class InMemoryQueue<T extends QueueItem> {
  private entries: T[] = [];
  private queuedMs = 0;
  private dropped = 0;

  constructor(
    private readonly opts: InMemoryQueueOptions = {
      maxDurationMs: DEFAULT_MAX_QUEUE_MS,
    },
  ) {}

  get size(): number {
    return this.entries.length;
  }

  /** Total queued audio duration in ms (heartbeat metric). */
  get queuedDurationMs(): number {
    return this.queuedMs;
  }

  /** Number of segments dropped because the queue was full (heartbeat metric). */
  get droppedCount(): number {
    return this.dropped;
  }

  /**
   * Adds a segment. A duplicate id is ignored (idempotent) so a retry can't
   * double-queue. If the total queued duration would exceed the cap, the oldest
   * segments are dropped first — but the just-added newest segment is always
   * kept, even if it alone exceeds the cap.
   */
  enqueue(item: T): void {
    if (this.entries.some((e) => e.id === item.id)) return;
    this.entries.push(item);
    this.queuedMs += item.duration_ms;
    this.prune();
  }

  /**
   * Confirms a segment uploaded successfully and removes it exactly once.
   * Returns whether it was present (a repeat confirm is a safe no-op).
   */
  confirmUploaded(id: string): boolean {
    return this.remove(id);
  }

  /** Removes a segment by id exactly once; returns whether it was present. */
  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const [removed] = this.entries.splice(idx, 1);
    if (removed) this.queuedMs -= removed.duration_ms;
    return true;
  }

  /** The oldest queued segment (next to upload), or undefined when empty. */
  peek(): T | undefined {
    return this.entries[0];
  }

  /** All queued segments in FIFO order. */
  items(): T[] {
    return [...this.entries];
  }

  private prune(): void {
    // Drop oldest while over the cap, always keeping the newest segment.
    while (this.entries.length > 1 && this.queuedMs > this.opts.maxDurationMs) {
      const [dropped] = this.entries.splice(0, 1);
      if (dropped) this.queuedMs -= dropped.duration_ms;
      this.dropped++;
    }
  }
}
