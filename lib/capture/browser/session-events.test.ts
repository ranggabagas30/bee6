// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `startCaptureSession` composes browser-only adapters (mic, VAD, wake lock,
 * encoder, HTTP) that this project otherwise verifies via QA's browser pass,
 * not unit tests (see the module's own header comment). DEV-01 adds a plain
 * translation step (status → `CaptureEvent`) inside that composition, so this
 * file fakes every adapter session.ts imports and asserts only the new
 * `onEvent` wiring + the real `stop()` release behavior the dev panel's Pause
 * button reuses — it is not a general session.ts behavior suite (that's
 * `session.test.ts`, which mocks `@/lib/capture/browser/vad` differently —
 * as a bare `vi.fn()` it drives call-by-call — so the two suites live in
 * separate files rather than one risking a `vi.mock` factory collision).
 */

const hoisted = vi.hoisted(() => ({
  vadOnFrame: null as ((frame: unknown) => void) | null,
  vadOnError: null as ((message: string) => void) | null,
  vadDestroy: vi.fn(async () => {}),
  wakeLockAcquire: vi.fn(async () => true),
  wakeLockRelease: vi.fn(async () => {}),
  mediaTrackStop: vi.fn(),
}));

vi.mock("@/lib/capture/browser/encoder", () => ({
  CAPTURE_SAMPLE_RATE: 16_000,
  isOpusEncoderSupported: () => true,
  encodeSegmentToWebmOpus: async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "audio/webm;codecs=opus",
  }),
}));

vi.mock("@/lib/capture/browser/vad", () => ({
  startCaptureVad: async (opts: {
    getStream: () => Promise<unknown>;
    onFrame: (frame: unknown) => void;
    onError: (message: string) => void;
  }) => {
    // The real VAD requests the mic stream before it starts delivering
    // frames; mirror that here so `currentStream` (and its eventual release
    // on stop()) is actually exercised, not skipped.
    await opts.getStream();
    hoisted.vadOnFrame = opts.onFrame;
    hoisted.vadOnError = opts.onError;
    return { destroy: hoisted.vadDestroy };
  },
}));

vi.mock("@/lib/capture/browser/wake-lock", () => ({
  WakeLockManager: class {
    held = true;
    acquire = hoisted.wakeLockAcquire;
    release = hoisted.wakeLockRelease;
    reacquireIfNeeded = async () => {};
  },
}));

vi.mock("@/lib/capture/browser/client", () => ({
  createHeartbeatPoster: () => async () => {},
  createSegmentUploader: () => async () => 200,
}));

import { startCaptureSession } from "@/lib/capture/browser/session";
import type { CaptureEvent } from "@/lib/capture/browser/event-log";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

const AUTH = { deviceToken: "t", deviceId: "d" };
const HOURS = { open: "08:00", close: "20:00" };
const CONFIG: CaptureConfigResponse = {
  timezone: "Asia/Jakarta",
  weekly_hours: {
    mon: HOURS,
    tue: HOURS,
    wed: HOURS,
    thu: HOURS,
    fri: HOURS,
    sat: HOURS,
    sun: null,
  },
  last_ended: null,
  capture_mode: "room",
};

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [{ label: "fake mic", getSettings: () => ({}), stop: hoisted.mediaTrackStop }],
        getTracks: () => [{ stop: hoisted.mediaTrackStop }],
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  hoisted.vadOnFrame = null;
  hoisted.vadOnError = null;
});

describe("startCaptureSession onEvent", () => {
  it("calls onEvent with a matching state_changed event when onEvent is provided", async () => {
    const events: CaptureEvent[] = [];
    const onStatusCalls: unknown[] = [];
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: (s) => onStatusCalls.push(s),
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
      onEvent: (e) => events.push(e),
    });

    const stateEvents = events.filter((e) => e.type === "state_changed");
    expect(stateEvents.length).toBeGreaterThan(0);
    const last = stateEvents.at(-1);
    const lastStatus = onStatusCalls.at(-1) as { state: string; queuedCount: number };
    expect(last).toEqual({
      type: "state_changed",
      state: lastStatus.state,
      queuedCount: lastStatus.queuedCount,
    });

    await session?.stop();
  });

  it("does nothing extra (no crash, no behavior change) when onEvent is omitted", async () => {
    const onStatusCalls: unknown[] = [];
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: (s) => onStatusCalls.push(s),
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
      // onEvent omitted on purpose.
    });
    expect(onStatusCalls.length).toBeGreaterThan(0);
    await session?.stop();
  });
});

describe("startCaptureSession mic_restart + onEvent (merge of B-2 guard and DEV-01 log)", () => {
  it("logs one mic_restart event, with the triggering reason, for a single mic error", async () => {
    vi.useFakeTimers();
    try {
      const events: CaptureEvent[] = [];
      const session = await startCaptureSession(AUTH, CONFIG, {
        onStatus: () => {},
        onMicSource: () => {},
        onUnsupported: () => {},
        onSampleRateRejected: () => {},
        onEvent: (e) => events.push(e),
      });

      // Simulate the VAD surfacing a mic error (the same path vad.ts uses),
      // the way onError triggers session.ts's single-flight restart guard.
      hoisted.vadOnError?.("NotReadableError");
      await vi.advanceTimersByTimeAsync(1_000);

      const restarts = events.filter((e) => e.type === "mic_restart");
      expect(restarts).toEqual([{ type: "mic_restart", reason: "NotReadableError" }]);
      // The restart actually ran (not just logged): a fresh VAD handle was
      // created, so destroy() was called on the old one.
      expect(hoisted.vadDestroy).toHaveBeenCalledTimes(1);

      await session?.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startCaptureSession stop()", () => {
  it("releases the mic track and the wake lock", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    expect(hoisted.wakeLockAcquire).toHaveBeenCalledTimes(1);

    await session?.stop();

    expect(hoisted.vadDestroy).toHaveBeenCalledTimes(1);
    expect(hoisted.mediaTrackStop).toHaveBeenCalled();
    expect(hoisted.wakeLockRelease).toHaveBeenCalledTimes(1);
  });
});
