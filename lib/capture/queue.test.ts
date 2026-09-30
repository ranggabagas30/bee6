import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_QUEUE_MS, InMemoryQueue } from "@/lib/capture/queue";

interface Seg {
  id: string;
  duration_ms: number;
}

const seg = (id: string, duration_ms = 15_000): Seg => ({ id, duration_ms });

describe("InMemoryQueue", () => {
  it("defaults to a ~10 minute duration cap", () => {
    expect(DEFAULT_MAX_QUEUE_MS).toBe(600_000);
  });

  it("keeps FIFO order and tracks queued duration", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 600_000 });
    q.enqueue(seg("a", 10_000));
    q.enqueue(seg("b", 5_000));
    q.enqueue(seg("c", 12_000));
    expect(q.items().map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(q.peek()?.id).toBe("a");
    expect(q.queuedDurationMs).toBe(27_000);
  });

  it("ignores a duplicate id (retry can't double-queue)", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 600_000 });
    q.enqueue(seg("a", 10_000));
    q.enqueue(seg("a", 10_000));
    expect(q.size).toBe(1);
    expect(q.queuedDurationMs).toBe(10_000);
    expect(q.droppedCount).toBe(0);
  });

  it("removes a segment exactly once on confirmed upload", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 600_000 });
    q.enqueue(seg("a", 10_000));
    q.enqueue(seg("b", 5_000));
    expect(q.confirmUploaded("a")).toBe(true);
    expect(q.confirmUploaded("a")).toBe(false); // already gone — safe no-op
    expect(q.items().map((i) => i.id)).toEqual(["b"]);
    expect(q.queuedDurationMs).toBe(5_000);
  });

  it("drops the oldest and counts it when over the duration cap", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 30_000 });
    q.enqueue(seg("a", 15_000));
    q.enqueue(seg("b", 15_000)); // total 30_000, exactly at cap → kept
    expect(q.size).toBe(2);
    q.enqueue(seg("c", 15_000)); // 45_000 > cap → drop oldest "a"
    expect(q.items().map((i) => i.id)).toEqual(["b", "c"]);
    expect(q.droppedCount).toBe(1);
    expect(q.queuedDurationMs).toBe(30_000);
  });

  it("drops multiple oldest when one large segment arrives", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 30_000 });
    q.enqueue(seg("a", 10_000));
    q.enqueue(seg("b", 10_000));
    q.enqueue(seg("big", 30_000)); // must drop a and b to fit
    expect(q.items().map((i) => i.id)).toEqual(["big"]);
    expect(q.droppedCount).toBe(2);
    expect(q.queuedDurationMs).toBe(30_000);
  });

  it("keeps the newest segment even if it alone exceeds the cap", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 15_000 });
    q.enqueue(seg("huge", 40_000));
    expect(q.items().map((i) => i.id)).toEqual(["huge"]);
    expect(q.size).toBe(1);
  });

  it("survives an offline burst then delivers the survivors in order", () => {
    const q = new InMemoryQueue<Seg>({ maxDurationMs: 45_000 });
    for (let i = 0; i < 6; i++) q.enqueue(seg(`s${i}`, 15_000));
    // Cap 45s = 3 segments; only the last 3 survive, in order.
    expect(q.items().map((i) => i.id)).toEqual(["s3", "s4", "s5"]);
    expect(q.droppedCount).toBe(3);
    // Reconnect: drain in order, each removed exactly once.
    expect(q.confirmUploaded("s3")).toBe(true);
    expect(q.confirmUploaded("s4")).toBe(true);
    expect(q.confirmUploaded("s5")).toBe(true);
    expect(q.size).toBe(0);
    expect(q.queuedDurationMs).toBe(0);
  });
});
