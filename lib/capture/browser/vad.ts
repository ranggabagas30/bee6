import { MicVAD } from "@ricky0123/vad-web";
import { CAPTURE_SAMPLE_RATE } from "@/lib/capture/browser/encoder";
import {
  ORT_WASM_PATH,
  VAD_ASSET_PATH,
  VAD_MODEL,
} from "@/lib/capture/browser/assets";

/**
 * Silero VAD wrapper (web spec §5 step 2). Runs @ricky0123/vad-web in the browser
 * with all assets served from our own origin (no CDN). Emits one 16 kHz frame at
 * a time: the caller feeds `speech` into the SegmentBatcher and `samples` into the
 * PcmWindowBuffer, so the batcher decides boundaries and the encoder pulls audio.
 * The VAD is local signal processing, not a hosted AI provider (hard rule #1).
 */

export interface CaptureVadFrame {
  /** Device epoch ms for this frame (sample-accurate from the capture start). */
  ts: number;
  /** True when the frame is classified as speech. */
  speech: boolean;
  /** 16 kHz mono samples for this frame. Never logged or persisted. */
  samples: Float32Array;
}

export interface CaptureVadOptions {
  /** Supplies the mic stream (built from the selected input device). */
  getStream: () => Promise<MediaStream>;
  onFrame: (frame: CaptureVadFrame) => void;
  onError?: (error: string) => void;
  /** Speech probability threshold (0–1). Default 0.5. */
  speechThreshold?: number;
}

export interface CaptureVadHandle {
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
}

/**
 * Starts the mic VAD. Timestamps are derived from a running sample count so they
 * stay in lock-step with the audio the PcmWindowBuffer stores.
 */
export async function startCaptureVad(
  options: CaptureVadOptions,
): Promise<CaptureVadHandle> {
  const threshold = options.speechThreshold ?? 0.5;
  const baseEpochMs = Date.now();
  let samplesSoFar = 0;

  // Mic acquisition is the main "mic problem" source; surface its failures so the
  // page can show 🔴 and self-restart (web spec §5). Never log the error object
  // itself — it can't hold audio, but we keep to a plain message by convention.
  const getStream = async () => {
    try {
      return await options.getStream();
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error.name : "microphone-unavailable",
      );
      throw error;
    }
  };

  const vad = await MicVAD.new({
    model: VAD_MODEL,
    baseAssetPath: VAD_ASSET_PATH,
    onnxWASMBasePath: ORT_WASM_PATH,
    getStream,
    startOnLoad: true,
    onFrameProcessed: (probabilities, frame) => {
      const ts = baseEpochMs + (samplesSoFar / CAPTURE_SAMPLE_RATE) * 1000;
      samplesSoFar += frame.length;
      options.onFrame({
        ts,
        speech: probabilities.isSpeech >= threshold,
        samples: frame,
      });
    },
  });

  return {
    pause: async () => vad.pause(),
    destroy: async () => vad.destroy(),
  };
}
