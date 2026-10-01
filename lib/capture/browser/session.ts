import { CaptureEngine, type CaptureStatus } from "@/lib/capture/browser/engine";
import {
  CAPTURE_SAMPLE_RATE,
  encodeSegmentToWebmOpus,
  isOpusEncoderSupported,
} from "@/lib/capture/browser/encoder";
import { startCaptureVad, type CaptureVadHandle } from "@/lib/capture/browser/vad";
import { classifyMicSource, type MicSourceClass } from "@/lib/capture/mic-source";
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
  /** Always a classified value (hard rule #7, B-5) — never a raw device label. */
  onMicSource: (source: MicSourceClass) => void;
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
  // Classified value only (B-5); never a raw label. Typed as `MicSourceClass`
  // (not `string`) so a future edit can't accidentally assign a raw label
  // without a type error.
  let micSource: MicSourceClass = "unknown";
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
    // Classify rather than store the raw label: it commonly carries a device
    // owner's name (e.g. "Dina's AirPods"), and names must never live outside
    // the `staff` collection — not in `heartbeats`, and not on screen (B-5).
    micSource = classifyMicSource(track?.label || "");
    cb.onMicSource(micSource);
    return stream;
  };

  const onFrame = (frame: Parameters<typeof engine.pushFrame>[0]) =>
    engine.pushFrame(frame);
  const onError = (message: string) => {
    engine.setMicError(message);
    scheduleRestart();
  };

  async function spinUp(): Promise<void> {
    try {
      vadHandle = await startCaptureVad({ getStream, onFrame, onError });
      engine.clearMicError();
      restart.reset();
    } catch {
      engine.setMicError("microphone-unavailable");
      scheduleRestart();
    }
  }

  /**
   * Single in-flight-restart guard (finding B-2). The VAD's `getStream`
   * wrapper rethrows a mic failure after already calling `onError`
   * (`vad.ts`), so one mic error fires both `onError` (above) and this same
   * `spinUp`/`runRestartAttempt` call's own catch below — without a guard,
   * both call sites would each schedule and run their own restart, leaving
   * two `MicVAD`s feeding one engine with different time bases and a
   * corrupted PCM timeline. `restarting` stays true for the whole retry
   * cycle (possibly several attempts) and is only ever cleared once the mic
   * comes back healthy, or the session stops — so external triggers
   * (another `onError`, a `devicechange` burst) during that time are
   * no-ops, coalesced into the one cycle already running.
   */
  let restarting = false;

  /**
   * Stops and drops the current media stream's tracks. Factored into its own
   * function (rather than inlined at each call site) so each call gets a
   * fresh type-narrowing pass on `currentStream` — inlining this after an
   * explicit `currentStream = null` would otherwise have TypeScript narrow it
   * to literal `null` straight through the following `await`, which is wrong
   * once `getStream` (reachable through that same `await`) may have
   * reassigned it in the meantime.
   */
  function stopCurrentStream(): void {
    currentStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    currentStream = null;
  }

  function scheduleRestart(): void {
    if (stopped || restarting) return;
    restarting = true;
    runRestartAttempt();
  }

  /**
   * Runs one restart attempt after backoff. On failure it chains directly
   * into the next attempt instead of going through `scheduleRestart` — that
   * guard must stay closed for the whole cycle, not reopen between its own
   * attempts.
   *
   * The whole body (round 2 fix) runs inside one try/catch: if anything
   * throws — including a synchronous throw from `engine.resyncTimeline()`,
   * not just a `startCaptureVad` rejection — the catch chains into another
   * attempt instead of letting the async IIFE reject silently, which would
   * otherwise leave `restarting` stuck `true` forever and permanently
   * disable mic self-restart for the rest of the session. A chained retry
   * that fires after `stop()` is a no-op: it immediately hits the `stopped`
   * check at the top of the next attempt and clears the guard without
   * spinning up a new mic.
   */
  function runRestartAttempt(): void {
    const delay = restart.nextDelayMs();
    setTimeout(() => {
      void (async () => {
        if (stopped) {
          restarting = false;
          return;
        }
        try {
          try {
            await vadHandle?.destroy();
          } catch {
            /* ignore */
          }
          stopCurrentStream();
          // Rebase the engine timeline onto the new VAD clock so post-restart
          // frames extract the right audio instead of silence (finding #1).
          engine.resyncTimeline();
          const handle = await startCaptureVad({ getStream, onFrame, onError });
          if (stopped) {
            // `stop()` ran while `startCaptureVad` was in flight: it already
            // tore down the previous mic, so don't let this late-arriving
            // handle become the live one — destroy it and the stream it
            // opened, or the mic stays on and frames keep reaching an
            // aborted engine (finding #2).
            try {
              await handle.destroy();
            } finally {
              stopCurrentStream();
            }
            restarting = false;
            return;
          }
          vadHandle = handle;
          engine.clearMicError();
          restart.reset();
          restarting = false;
        } catch {
          engine.setMicError("microphone-unavailable");
          runRestartAttempt();
        }
      })();
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
  const onDeviceChange = () => scheduleRestart();
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
      // abort() stops the upload pump even mid-backoff, so stop() returns
      // promptly even while offline (finding #3), instead of hanging on retries.
      await engine.abort();
      currentStream?.getTracks().forEach((t) => t.stop());
      await wakeLock.release();
    },
  };
}
