/**
 * In-memory upload queue (web spec §5 step 5). Holds encoded segments while the
 * network is unavailable; the oldest are dropped (and counted) once the queue is
 * full, and each is removed exactly once on a 200. FIFO order is preserved so
 * segments arrive in order. No persistence — the encrypted IndexedDB queue is P1.
 *
 * Pure/deterministic: the caller supplies the enqueue timestamp (no `Date.now`
 * inside), so ageing is fully testable.
 */

export interface QueueItem {
  /** Stable id used for exactly-once removal (the segment's `seg_id`). */
  id: string;
}

export interface InMemoryQueueOptions {
  /** Hard cap on queued items; the oldest are dropped past this. */
  maxItems: number;
  /**
   * Optional rolling-window cap: items older than `maxAgeMs` before the newest
   * enqueue are dropped (the "~10 min of segments" window).
   */
  maxAgeMs?: number;
}

export class InMemoryQueue<T extends QueueItem> {
  private entries: { item: T; at: number }[] = [];
  private dropped = 0;

  constructor(private readonly opts: InMemoryQueueOptions) {}

  get size(): number {
    return this.entries.length;
  }

  /** Number of segments dropped because the queue was full (heartbeat metric). */
  get droppedCount(): number {
    return this.dropped;
  }

  /**
   * Adds an item at time `at`. A duplicate id is ignored (idempotent) so a retry
   * can't double-queue. Prunes by age then by count, counting every drop.
   */
  enqueue(item: T, at: number): void {
    if (this.entries.some((e) => e.item.id === item.id)) return;
    this.entries.push({ item, at });
    this.prune();
  }

  /** Removes an item by id exactly once; returns whether it was present. */
  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.item.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  /** The oldest queued item (next to upload), or undefined when empty. */
  peek(): T | undefined {
    return this.entries[0]?.item;
  }

  /** All queued items in FIFO order. */
  items(): T[] {
    return this.entries.map((e) => e.item);
  }

  private prune(): void {
    const newestEntry = this.entries[this.entries.length - 1];
    if (this.opts.maxAgeMs !== undefined && newestEntry) {
      const cutoff = newestEntry.at - this.opts.maxAgeMs;
      let head = this.entries[0];
      while (head && head.at < cutoff) {
        this.entries.shift();
        this.dropped++;
        head = this.entries[0];
      }
    }
    while (this.entries.length > this.opts.maxItems) {
      this.entries.shift();
      this.dropped++;
    }
  }
}
