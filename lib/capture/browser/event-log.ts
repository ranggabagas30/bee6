import type { CaptureState } from "@/lib/capture/browser/engine";

/**
 * Capture pipeline event log (DEV-01). A discriminated union of the capture
 * state machine's observable transitions — VAD/segment/wake-lock — for the
 * dev panel's on-page log. Deliberately carries only state names, segment
 * ids, byte counts and durations: **no variant has a free-text field**, so a
 * transcript or audio payload can never end up here even by accident (hard
 * rule #2). A future variant that tried to add one would be a reviewable type
 * change (caught by `lib/capture/browser/event-log.test.ts`'s
 * `@ts-expect-error` check), not a silent runtime leak.
 *
 * Fed from the same state-reporting path that already drives
 * `StatusBanner`'s single current state (`CaptureSessionCallbacks.onStatus` /
 * `onMicSource`, plus the engine's own segment lifecycle) — recorded here as
 * a timestamped list instead of just the latest value.
 */
export type CaptureEvent =
  | { type: "state_changed"; state: CaptureState; queuedCount: number }
  | { type: "segment_opened"; seg_id: string }
  | { type: "segment_closed"; seg_id: string; duration_ms: number }
  | { type: "segment_upload_started"; seg_id: string; byte_count: number }
  | { type: "segment_upload_result"; seg_id: string; ok: boolean }
  | { type: "wake_lock_changed"; held: boolean }
  | { type: "mic_restart"; reason: string };

export interface EventRingBuffer {
  push(event: CaptureEvent): void;
  /** A snapshot array; later `push()` calls never mutate a returned list. */
  list(): readonly CaptureEvent[];
}

/**
 * A fixed-capacity, oldest-dropped-first event buffer. `capacity` must be a
 * positive integer; `list()` returns events in insertion (oldest-first)
 * order.
 */
export function createEventRingBuffer(capacity: number): EventRingBuffer {
  let items: CaptureEvent[] = [];
  return {
    push(event) {
      items.push(event);
      if (items.length > capacity) items = items.slice(items.length - capacity);
    },
    list() {
      return items.slice();
    },
  };
}
