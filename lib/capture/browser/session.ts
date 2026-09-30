import { CaptureEngine, type CaptureStatus } from "@/lib/capture/browser/engine";
import {
  CAPTURE_SAMPLE_RATE,
  encodeSegmentToWebmOpus,
  isOpusEncoderSupported,
} from "@/lib/capture/browser/encoder";
import { startCaptureVad, type CaptureVadHandle } from "@/lib/capture/browser/vad";
import { WakeLockManager } from "@/lib/capture/browser/wake-lock";
import { RestartController } from "@/lib/capture/browser/restart";
import { isSampleRateSupported, checkSampleRate } from "@/lib/capture/sample-rate";
import {
  createHeartbeatPoster,
  createSegmentUploader,
  type DeviceAuth,
} from "@/lib/capture/browser/client";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

/**
 * Browser capture session (web spec §5): wires the tested adapters + engine into
 * a running mic→VAD→segment→upload pipeline with heartbeat, wake lock, mic-error
 * self-restart and device-change fallback. This module is browser-only (real
 * getUserMedia/WebCodecs/wake-lock) and is verified by QA's browser pass, not
 * unit tests. The logic it depends on (batching, retry, status, request shapes)
 * is already unit-tested in the modules it composes.
 */

const HEARTBEAT_INTERVAL_MS = 60_000;

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<{ level: number }>;
}

async function readBatteryPct(): Promise<number | null> {
  try {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery === "function") {
      const battery = await nav.getBattery();
      return Math.round(battery.level * 100);
    }
  } catch {
    /* battery API unavailable */
  }
  return null;
}

export interface CaptureSessionCallbacks {
  onStatus: (status: CaptureStatus) => void;
  onMicSource: (label: string) => void;
  onUnsupported: () => void;
  onSampleRateRejected: (message: string) => void;
}

export interface CaptureSession {
  stop: () => Promise<void>;
}

/**
 * Starts capturing. Always resolves to a session handle (even if the mic is
 * initially unavailable — it shows 🔴 and self-restarts). Returns null only when
 * the browser can't encode Opus at all (no WebCodecs), after calling
 * `onUnsupported`.
 */
export async function startCaptureSession(
  auth: DeviceAuth,
  _config: CaptureConfigResponse,
  cb: CaptureSessionCallbacks,
): Promise<CaptureSession | null> {
  if (!isOpusEncoderSupported()) {
    cb.onUnsupported();
    return null;
  }

  const engine = new CaptureEngine({
    encode: encodeSegmentToWebmOpus,
    upload: createSegmentUploader(auth),
    onStatusChange: cb.onStatus,
  });
  const wakeLock = new WakeLockManager();
  const restart = new RestartController();
  const postHeartbeat = createHeartbeatPoster(auth);

  let vadHandle: CaptureVadHandle | null = null;
  let currentStream: MediaStream | null = null;
  let micSource = "microphone";
  // We capture/encode at 16 kHz regardless of the mic's native rate (the VAD
  // resamples), so the heartbeat reports the capture rate.
  const sampleRate = CAPTURE_SAMPLE_RATE;
  let stopped = false;

  const getStream = async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    currentStream = stream;
    const track = stream.getAudioTracks()[0];
    const rate = track?.getSettings().sampleRate;
    // Only refuse when the rate is known AND too low; an unreported rate is not
    // treated as a failure (many good mics don't expose it in getSettings).
    if (typeof rate === "number" && rate > 0 && !isSampleRateSupported(rate)) {
      stream.getTracks().forEach((t) => t.stop());
      currentStream = null;
      cb.onSampleRateRejected(checkSampleRate(rate).message ?? "Unsupported mic");
      throw new Error("sample-rate-too-low");
    }
    micSource = track?.label || "microphone";
    cb.onMicSource(micSource);
    return stream;
  };

  const onFrame = (frame: Parameters<typeof engine.pushFrame>[0]) =>
    engine.pushFrame(frame);
  const onError = (message: string) => {
    engine.setMicError(message);
    void scheduleRestart();
  };

  async function spinUp(): Promise<void> {
    try {
      vadHandle = await startCaptureVad({ getStream, onFrame, onError });
      engine.clearMicError();
      restart.reset();
    } catch {
      engine.setMicError("microphone-unavailable");
      void scheduleRestart();
    }
  }

  async function scheduleRestart(): Promise<void> {
    if (stopped) return;
    const delay = restart.nextDelayMs();
    setTimeout(async () => {
      if (stopped) return;
      try {
        await vadHandle?.destroy();
      } catch {
        /* ignore */
      }
      currentStream?.getTracks().forEach((t) => t.stop());
      currentStream = null;
      await spinUp();
    }, delay);
  }

  await spinUp();
  await wakeLock.acquire();

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      const snap = engine.snapshot();
      await postHeartbeat({
        ts: new Date().toISOString(),
        mic_source: micSource,
        sample_rate: sampleRate,
        speech_pct: snap.speechPct,
        queue_size: snap.queuedCount,
        battery: await readBatteryPct(),
        screen_awake: wakeLock.held,
      });
    })();
  }, HEARTBEAT_INTERVAL_MS);

  const onVisibility = () => void wakeLock.reacquireIfNeeded();
  const onDeviceChange = () => void scheduleRestart();
  document.addEventListener("visibilitychange", onVisibility);
  navigator.mediaDevices.addEventListener?.("devicechange", onDeviceChange);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
      try {
        await vadHandle?.destroy();
      } catch {
        /* ignore */
      }
      engine.flush();
      await engine.drain();
      currentStream?.getTracks().forEach((t) => t.stop());
      await wakeLock.release();
    },
  };
}
