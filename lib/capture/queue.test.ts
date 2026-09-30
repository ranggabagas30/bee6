import { describe, expect, it } from "vitest";
import { InMemoryQueue } from "@/lib/capture/queue";

interface Seg {
  id: string;
}

describe("InMemoryQueue", () => {
  it("keeps FIFO order", () => {
    const q = new InMemoryQueue<Seg>({ maxItems: 10 });
    q.enqueue({ id: "a" }, 0);
    q.enqueue({ id: "b" }, 1);
    q.enqueue({ id: "c" }, 2);
    expect(q.items().map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(q.peek()?.id).toBe("a");
  });

  it("ignores a duplicate id (retry can't double-queue)", () => {
    const q = new InMemoryQueue<Seg>({ maxItems: 10 });
    q.enqueue({ id: "a" }, 0);
    q.enqueue({ id: "a" }, 1);
    expect(q.size).toBe(1);
    expect(q.droppedCount).toBe(0);
  });

  it("removes an item exactly once on success", () => {
    const q = new InMemoryQueue<Seg>({ maxItems: 10 });
    q.enqueue({ id: "a" }, 0);
    q.enqueue({ id: "b" }, 1);
    expect(q.remove("a")).toBe(true);
    expect(q.remove("a")).toBe(false); // already gone
    expect(q.items().map((i) => i.id)).toEqual(["b"]);
  });

  it("drops the oldest and counts it when over the item cap", () => {
    const q = new InMemoryQueue<Seg>({ maxItems: 2 });
    q.enqueue({ id: "a" }, 0);
    q.enqueue({ id: "b" }, 1);
    q.enqueue({ id: "c" }, 2);
    expect(q.items().map((i) => i.id)).toEqual(["b", "c"]);
    expect(q.droppedCount).toBe(1);
  });

  it("drops items older than the rolling age window", () => {
    const q = new InMemoryQueue<Seg>({ maxItems: 100, maxAgeMs: 10_000 });
    q.enqueue({ id: "old" }, 0);
    q.enqueue({ id: "mid" }, 5_000);
    q.enqueue({ id: "new" }, 11_000); // window cutoff = 11000 - 10000 = 1000
    expect(q.items().map((i) => i.id)).toEqual(["mid", "new"]);
    expect(q.droppedCount).toBe(1);
  });

  it("survives an offline burst then delivers the survivors in order", () => {
    const q = new InMemoryQueue<Seg>({ maxItems: 3 });
    for (let i = 0; i < 6; i++) q.enqueue({ id: `s${i}` }, i);
    // Only the last 3 survive, in order.
    expect(q.items().map((i) => i.id)).toEqual(["s3", "s4", "s5"]);
    expect(q.droppedCount).toBe(3);
    // Reconnect: drain in order, each removed exactly once.
    expect(q.remove("s3")).toBe(true);
    expect(q.remove("s4")).toBe(true);
    expect(q.remove("s5")).toBe(true);
    expect(q.size).toBe(0);
  });
});
