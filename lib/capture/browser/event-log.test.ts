import { describe, expect, it } from "vitest";
import { createEventRingBuffer, type CaptureEvent } from "@/lib/capture/browser/event-log";

function stateChanged(queuedCount: number): CaptureEvent {
  return { type: "state_changed", state: "listening", queuedCount };
}

describe("createEventRingBuffer", () => {
  it("keeps only the latest `capacity` events, oldest dropped first, in insertion order", () => {
    const buf = createEventRingBuffer(3);
    for (let i = 0; i < 5; i++) buf.push(stateChanged(i));

    const list = buf.list();
    expect(list).toHaveLength(3);
    expect(list.map((e) => (e.type === "state_changed" ? e.queuedCount : -1))).toEqual([
      2, 3, 4,
    ]);
  });

  it("returns events in insertion order when under capacity", () => {
    const buf = createEventRingBuffer(5);
    buf.push(stateChanged(0));
    buf.push(stateChanged(1));
    expect(buf.list().map((e) => (e.type === "state_changed" ? e.queuedCount : -1))).toEqual([
      0, 1,
    ]);
  });

  it("list() returns a snapshot that is not mutated by a later push", () => {
    const buf = createEventRingBuffer(3);
    buf.push(stateChanged(0));
    const snapshot = buf.list();
    buf.push(stateChanged(1));
    expect(snapshot).toHaveLength(1);
  });
});

describe("CaptureEvent", () => {
  it("has no variant that can carry transcript text or audio bytes (type-level guarantee)", () => {
    // @ts-expect-error -- state_changed must never gain a free-text field.
    const _bad1: CaptureEvent = { type: "state_changed", state: "listening", queuedCount: 0, text: "hi" };
    // @ts-expect-error -- segment_closed must never gain a free-text field.
    const _bad2: CaptureEvent = { type: "segment_closed", seg_id: "s", duration_ms: 1, transcript: "hi" };
    void _bad1;
    void _bad2;
  });
});
