import { describe, expect, it } from "vitest";
import { createEventRingBuffer, type CaptureEvent } from "@/lib/capture/browser/event-log";

function stateChanged(queuedCount: number): CaptureEvent {
  return { type: "state_changed", state: "listening", queuedCount };
}

function queuedCountOf(logged: { event: CaptureEvent }): number {
  return logged.event.type === "state_changed" ? logged.event.queuedCount : -1;
}

describe("createEventRingBuffer", () => {
  it("keeps only the latest `capacity` events, oldest dropped first, in insertion order", () => {
    const buf = createEventRingBuffer(3);
    for (let i = 0; i < 5; i++) buf.push(stateChanged(i));

    const list = buf.list();
    expect(list).toHaveLength(3);
    expect(list.map(queuedCountOf)).toEqual([2, 3, 4]);
  });

  it("returns events in insertion order when under capacity", () => {
    const buf = createEventRingBuffer(5);
    buf.push(stateChanged(0));
    buf.push(stateChanged(1));
    expect(buf.list().map(queuedCountOf)).toEqual([0, 1]);
  });

  it("list() returns a snapshot that is not mutated by a later push", () => {
    const buf = createEventRingBuffer(3);
    buf.push(stateChanged(0));
    const snapshot = buf.list();
    buf.push(stateChanged(1));
    expect(snapshot).toHaveLength(1);
  });

  it("stamps each logged event with a push-time timestamp", () => {
    const buf = createEventRingBuffer(3);
    const before = Date.now();
    buf.push(stateChanged(0));
    const after = Date.now();
    const [logged] = buf.list();
    expect(logged?.ts).toBeGreaterThanOrEqual(before);
    expect(logged?.ts).toBeLessThanOrEqual(after);
  });
});

describe("CaptureEvent", () => {
  it("has no variant that can carry transcript text or audio bytes (type-level guarantee)", () => {
    // @ts-expect-error -- state_changed must never gain a free-text field.
    const _bad1: CaptureEvent = { type: "state_changed", state: "listening", queuedCount: 0, text: "hi" };
    // @ts-expect-error -- segment_closed must never gain a free-text field.
    const _bad2: CaptureEvent = { type: "segment_closed", seg_id: "s", duration_ms: 1, transcript: "hi" };
    // @ts-expect-error -- segment_accepted carries a line COUNT only (R-19 PR-4a), never the lines.
    const _bad3: CaptureEvent = { type: "segment_accepted", lines: 1, text: "hi" };
    const ok: CaptureEvent = { type: "segment_accepted", lines: 3 };
    expect(ok.type).toBe("segment_accepted");
    void _bad1;
    void _bad2;
    void _bad3;
  });
});
