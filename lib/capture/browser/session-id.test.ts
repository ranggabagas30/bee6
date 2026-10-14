// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R-P1: the session's X-Session-Id must reach the segment uploader, or a
 * Batalkan discard deletes 0 segments while telling staff "removed" (web
 * spec §6.6.4, release gate). `createSegmentUploader` itself is tested in
 * client.test.ts; this only checks session.ts passes the id through.
 */

const hoisted = vi.hoisted(() => ({
  createSegmentUploader: vi.fn(() => vi.fn()),
  wakeLockAcquire: vi.fn(async () => true),
  wakeLockRelease: vi.fn(async () => {}),
}));

vi.mock("@/lib/capture/browser/encoder", () => ({
  CAPTURE_SAMPLE_RATE: 16_000,
  isOpusEncoderSupported: () => true,
  encodeSegmentToWebmOpus: vi.fn(),
}));

vi.mock("@/lib/capture/browser/vad", () => ({
  startCaptureVad: async (opts: { getStream: () => Promise<unknown> }) => {
    await opts.getStream();
    return { destroy: vi.fn(async () => {}) };
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
  createSegmentUploader: hoisted.createSegmentUploader,
}));

import { startCaptureSession } from "@/lib/capture/browser/session";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

const AUTH = { deviceToken: "t", deviceId: "d" };
const CONFIG = { timezone: "Asia/Jakarta", weekly_hours: {}, last_ended: null } as unknown as CaptureConfigResponse;
const cb = { onStatus: vi.fn(), onMicSource: vi.fn(), onUnsupported: vi.fn(), onSampleRateRejected: vi.fn() };

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [{ label: "fake mic", getSettings: () => ({}), stop: vi.fn() }],
        getTracks: () => [{ stop: vi.fn() }],
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("startCaptureSession wires the session id to the segment uploader", () => {
  it("passes the session id through to createSegmentUploader", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, cb, "11111111-1111-1111-1111-111111111111");
    // The third argument is the R-19 line-count callback (plan 5.2); the id stays the second.
    expect(hoisted.createSegmentUploader).toHaveBeenCalledWith(
      AUTH,
      "11111111-1111-1111-1111-111111111111",
      expect.any(Function),
    );
    await session?.stop();
  });

  it("omits the session id when none is given (no behaviour change for an existing caller)", async () => {
    const session = await startCaptureSession(AUTH, CONFIG, cb);
    expect(hoisted.createSegmentUploader).toHaveBeenCalledWith(AUTH, undefined, expect.any(Function));
    await session?.stop();
  });
});
