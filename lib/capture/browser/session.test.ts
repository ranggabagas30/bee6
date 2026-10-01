import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceAuth } from "@/lib/capture/browser/client";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

/**
 * Finding B-2: the VAD's `getStream` wrapper (`vad.ts`) calls `onError` and
 * then rethrows on a mic failure, so without a single-flight guard, one mic
 * error schedules two concurrent restarts. We mock `startCaptureVad` to
 * reproduce that exact double-fire — call `onError`, then reject — the same
 * way the real `vad.ts` behaves, and assert `session.ts`'s guard still lets
 * only one restart attempt run.
 */
vi.mock("@/lib/capture/browser/vad", () => ({
  startCaptureVad: vi.fn(),
}));
vi.mock("@/lib/capture/browser/encoder", () => ({
  CAPTURE_SAMPLE_RATE: 16_000,
  isOpusEncoderSupported: () => true,
  encodeSegmentToWebmOpus: vi.fn(),
}));

import { startCaptureVad } from "@/lib/capture/browser/vad";
import { startCaptureSession } from "@/lib/capture/browser/session";

const startCaptureVadMock = startCaptureVad as unknown as ReturnType<typeof vi.fn>;

function stubBrowserGlobals() {
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

const auth: DeviceAuth = { deviceToken: "t", deviceId: "d" };
const config = {} as CaptureConfigResponse;
const cb = {
  onStatus: vi.fn(),
  onMicSource: vi.fn(),
  onUnsupported: vi.fn(),
  onSampleRateRejected: vi.fn(),
};

describe("startCaptureSession restart guard (B-2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubBrowserGlobals();
    startCaptureVadMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs exactly one restart when onError and the spinUp catch both fire for the same mic failure", async () => {
    let calls = 0;
    startCaptureVadMock.mockImplementation(
      async (opts: { onError?: (msg: string) => void }) => {
        calls += 1;
        if (calls === 1) {
          // Reproduce vad-web's real behaviour: call onError, THEN reject —
          // both call sites in session.ts fire for this one failure.
          opts.onError?.("NotReadableError");
          throw new Error("NotReadableError");
        }
        // The restart attempt succeeds.
        return { pause: vi.fn(), destroy: vi.fn() };
      },
    );

    const session = await startCaptureSession(auth, config, cb);
    // The initial spinUp has already failed and scheduled (at most) one
    // restart by this point.
    expect(startCaptureVadMock).toHaveBeenCalledTimes(1);

    // Without the guard, `onError` and the `spinUp` catch each schedule their
    // own timer via RestartController.nextDelayMs() (500 ms, then 1_000 ms for
    // the second). Advance past BOTH possible delays, not just the first, so
    // a second, orphaned restart attempt would have had the chance to fire.
    await vi.advanceTimersByTimeAsync(2_000);

    // Exactly one restart attempt ran — not two. Two would mean a second,
    // orphaned MicVAD is also feeding the engine (the corrupted-timeline bug).
    expect(startCaptureVadMock).toHaveBeenCalledTimes(2);

    await session?.stop();
  });

  it("leaves no lingering duplicate restart timer after the mic recovers", async () => {
    // Without the guard, onError's timer (500 ms) and spinUp's catch's timer
    // (1_000 ms) are both scheduled from the one initial failure. The first
    // one succeeding must not leave the second one to fire later and spin up
    // a second, orphaned MicVAD anyway.
    let calls = 0;
    startCaptureVadMock.mockImplementation(
      async (opts: { onError?: (msg: string) => void }) => {
        calls += 1;
        if (calls === 1) {
          opts.onError?.("NotReadableError");
          throw new Error("NotReadableError");
        }
        return { pause: vi.fn(), destroy: vi.fn() }; // every retry succeeds
      },
    );

    const session = await startCaptureSession(auth, config, cb);
    expect(startCaptureVadMock).toHaveBeenCalledTimes(1);

    // Past both of the two delays a buggy unguarded implementation would
    // have scheduled (500 ms and 1_000 ms) from the single initial failure.
    await vi.advanceTimersByTimeAsync(2_000);

    expect(startCaptureVadMock).toHaveBeenCalledTimes(2);

    await session?.stop();
  });

  it("coalesces a devicechange burst with an in-flight restart into one attempt", async () => {
    let calls = 0;
    let deviceChangeHandler: (() => void) | undefined;
    const mediaDevices = {
      getUserMedia: vi.fn(),
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === "devicechange") deviceChangeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("navigator", { mediaDevices });

    startCaptureVadMock.mockImplementation(
      async (opts: { onError?: (msg: string) => void }) => {
        calls += 1;
        if (calls === 1) {
          opts.onError?.("NotReadableError");
          throw new Error("NotReadableError");
        }
        return { pause: vi.fn(), destroy: vi.fn() };
      },
    );

    const session = await startCaptureSession(auth, config, cb);
    expect(startCaptureVadMock).toHaveBeenCalledTimes(1);

    // A devicechange burst while the restart from the mic error is still
    // pending must not add extra restart attempts.
    deviceChangeHandler?.();
    deviceChangeHandler?.();
    deviceChangeHandler?.();

    // Advance past every delay a buggy, unguarded implementation could have
    // scheduled (one from onError/catch, one or more from the devicechange
    // bursts), not just the first.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(startCaptureVadMock).toHaveBeenCalledTimes(2);

    await session?.stop();
  });

  it("reopens the guard after recovery: a later devicechange still triggers a restart (round 2)", async () => {
    // Distinguishes the guard from a one-shot latch: once a restart cycle
    // completes and the mic is healthy again, a brand-new failure must be
    // able to trigger its own restart — `restarting` must not still be stuck
    // `true` from the earlier cycle.
    let deviceChangeHandler: (() => void) | undefined;
    const mediaDevices = {
      getUserMedia: vi.fn(),
      addEventListener: vi.fn((type: string, handler: () => void) => {
        if (type === "devicechange") deviceChangeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("navigator", { mediaDevices });

    // The initial spinUp and every restart attempt succeed cleanly (no
    // onError double-fire here — that's covered by the tests above).
    startCaptureVadMock.mockImplementation(async () => ({
      pause: vi.fn(),
      destroy: vi.fn(),
    }));

    const session = await startCaptureSession(auth, config, cb);
    expect(startCaptureVadMock).toHaveBeenCalledTimes(1);

    // First devicechange: guard opens, one restart cycle runs to completion.
    deviceChangeHandler?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(startCaptureVadMock).toHaveBeenCalledTimes(2);

    // A second, later devicechange — after the first cycle fully finished —
    // must still trigger a new restart, proving the guard reopened instead
    // of staying latched closed.
    deviceChangeHandler?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(startCaptureVadMock).toHaveBeenCalledTimes(3);

    await session?.stop();
  });
});
