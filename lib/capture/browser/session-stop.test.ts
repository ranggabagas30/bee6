// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Defect 2 (QA, major): a segment PUT that never answers must not stall stop().
 * The page's phase loop awaited `session.stop()`, which awaited `engine.abort()`,
 * which awaited the pending upload. The mic, VAD and encoder must be released at
 * once on stop, and the upload may drain in the background with a bounded wait.
 */

const hoisted = vi.hoisted(() => ({
  vadOnFrame: null as ((frame: unknown) => void) | null,
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
    await opts.getStream();
    hoisted.vadOnFrame = opts.onFrame;
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

// The segment PUT never answers: the upload promise stays pending forever.
vi.mock("@/lib/capture/browser/client", () => ({
  createHeartbeatPoster: () => async () => {},
  createSegmentUploader: () => () => new Promise<number | null>(() => {}),
}));

import { startCaptureSession } from "@/lib/capture/browser/session";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

const AUTH = { deviceToken: "t", deviceId: "d" };
const CONFIG = {
  timezone: "Asia/Jakarta",
  weekly_hours: {},
  last_ended: null,
} as unknown as CaptureConfigResponse;

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.clearAllMocks();
  hoisted.vadOnFrame = null;
});

/** One speech frame: opens a segment, so stop()'s flush has an upload to wait on. */
function pushSpeech(count: number, startMs = 0) {
  for (let i = 0; i < count; i += 1) {
    hoisted.vadOnFrame?.({
      ts: startMs + i * 100,
      samples: new Float32Array(1600),
      speech: true,
    });
  }
}

describe("startCaptureSession stop() with a held segment upload (defect 2)", () => {
  it("resolves within a bounded wait even though the segment PUT never answers", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    pushSpeech(5);
    // Let the frames reach the batcher before stop() flushes the open segment.
    await vi.advanceTimersByTimeAsync(0);

    let settled = false;
    const stopped = session!.stop().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(true);
    void stopped;
  });

  it("releases the mic track synchronously at stop(), before any upload settles", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);

    // Not awaited on purpose: the mic must already be released when stop() returns.
    void session!.stop();

    expect(hoisted.mediaTrackStop).toHaveBeenCalled();
    expect(hoisted.vadDestroy).toHaveBeenCalledTimes(1);
  });
});
