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
  // The segment PUT. Default: never answers (the promise stays pending forever).
  upload: vi.fn((_segment?: unknown): Promise<number | null> => new Promise<number | null>(() => {})),
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

// The segment PUT is controllable per test; by default it never answers.
vi.mock("@/lib/capture/browser/client", () => ({
  createHeartbeatPoster: () => async () => {},
  createSegmentUploader: () => hoisted.upload,
}));

import { CaptureEngine } from "@/lib/capture/browser/engine";
import { abortAllCaptureUploads, startCaptureSession } from "@/lib/capture/browser/session";
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
  abortAllCaptureUploads();
  vi.useRealTimers();
  vi.clearAllMocks();
  hoisted.upload.mockReset();
  hoisted.upload.mockImplementation(() => new Promise<number | null>(() => {}));
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

  it("waits at most 5 s by default: not settled at 4 s, settled by 6 s", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);

    let settled = false;
    void session!.stop().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(true);
  });

  it("stop({ drainMs: 15_000 }) keeps waiting past the 5 s default and settles by 15 s (R-19 PR-4b sign-out)", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);

    let settled = false;
    void session!.stop({ drainMs: 15_000 }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe(true);
  });

  it("stop() resolves with the engine's dropped count (a number only)", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    const stopped = session!.stop();
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(stopped).resolves.toEqual({ droppedCount: 0, queuedCount: 0 });
  });

  it("stop() also reports how many segments are still queued or in flight when the drain ends (numbers only)", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, {
      onStatus: () => {},
      onMicSource: () => {},
      onUnsupported: () => {},
      onSampleRateRejected: () => {},
    });
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);
    const stopped = session!.stop();
    await vi.advanceTimersByTimeAsync(6_000);
    // The segment PUT never answers, so the closed segment is still the queue head after the 5 s drain.
    await expect(stopped).resolves.toEqual({ droppedCount: 0, queuedCount: 1 });
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

describe("startCaptureSession stop modes (18 Oct: retry after End)", () => {
  const callbacks = {
    onStatus: () => {},
    onMicSource: () => {},
    onUnsupported: () => {},
    onSampleRateRejected: () => {},
  };

  it('stop({ mode: "hard" }) does not flush or upload', async () => {
    const session = await startCaptureSession(AUTH, CONFIG, callbacks);
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);

    const stopped = session!.stop({ mode: "hard" });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(hoisted.upload).not.toHaveBeenCalled();
    await expect(stopped).resolves.toEqual({ droppedCount: 0, queuedCount: 0 });
    expect(hoisted.mediaTrackStop).toHaveBeenCalled();
  });

  it("finish keeps retrying a 503 after stop() settles", async () => {
    hoisted.upload.mockResolvedValue(503);
    const session = await startCaptureSession(AUTH, CONFIG, callbacks);
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);

    const stopped = session!.stop();
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(stopped).resolves.toBeDefined();
    const before = hoisted.upload.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(hoisted.upload.mock.calls.length).toBeGreaterThan(before);
  });

  it("abortAllCaptureUploads() ends a background drain", async () => {
    hoisted.upload.mockResolvedValue(503);
    const session = await startCaptureSession(AUTH, CONFIG, callbacks);
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);
    void session!.stop();
    await vi.advanceTimersByTimeAsync(6_000);

    abortAllCaptureUploads();
    await vi.advanceTimersByTimeAsync(1); // allow one already-scheduled retry
    const after = hoisted.upload.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(hoisted.upload.mock.calls.length).toBe(after);
  });

  it("a session that fails to start leaves no engine in the abort registry", async () => {
    hoisted.wakeLockAcquire.mockRejectedValueOnce(new Error("wake lock exploded"));
    const abort = vi.spyOn(CaptureEngine.prototype, "abort");
    await expect(startCaptureSession(AUTH, CONFIG, callbacks)).rejects.toThrow("wake lock exploded");

    abortAllCaptureUploads();
    expect(abort).not.toHaveBeenCalled();
    abort.mockRestore();
  });

  it("the finish drain ends at the budget", async () => {
    hoisted.upload.mockResolvedValue(503);
    const session = await startCaptureSession(AUTH, CONFIG, callbacks);
    pushSpeech(5);
    await vi.advanceTimersByTimeAsync(0);
    void session!.stop();

    await vi.advanceTimersByTimeAsync(300_000);
    const at300 = hoisted.upload.mock.calls.length;
    expect(at300).toBeGreaterThan(5);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(hoisted.upload.mock.calls.length).toBe(at300);
    expect(() => abortAllCaptureUploads()).not.toThrow();
  });
});
