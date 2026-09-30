import { Muxer, ArrayBufferTarget } from "webm-muxer";
import { SEGMENT_CONTENT_TYPE } from "@/lib/capture/contract";

/**
 * Segment encoder: 16 kHz mono PCM → Opus in a WebM container (decision 3 in
 * docs/tasks/R-03.md), the exact `Content-Type` the segment PUT accepts. Uses the
 * WebCodecs `AudioEncoder` (browser only) muxed with `webm-muxer`. The encoded
 * bytes are returned to the caller and never logged or persisted (hard rule #2).
 */

/** ~24 kbps target (web spec §5 step 4: ~24 kbps, a 15 s segment ≈ 45 KB). */
export const OPUS_BITRATE = 24_000;
export const CAPTURE_SAMPLE_RATE = 16_000;

/** Cheap synchronous feature check: is WebCodecs Opus encoding even available? */
export function isOpusEncoderSupported(): boolean {
  return (
    typeof globalThis.AudioEncoder !== "undefined" &&
    typeof globalThis.AudioData !== "undefined"
  );
}

/** Async config check (Android Chrome Opus support varies — web spec §5 risks). */
export async function checkOpusEncoderSupport(): Promise<boolean> {
  if (!isOpusEncoderSupported()) return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: CAPTURE_SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: OPUS_BITRATE,
    });
    return supported === true;
  } catch {
    return false;
  }
}

export interface EncodedSegment {
  bytes: Uint8Array;
  contentType: typeof SEGMENT_CONTENT_TYPE;
}

/**
 * Encodes one segment's PCM samples to WebM/Opus. Throws if WebCodecs Opus is
 * unavailable — the page shows a clear message and does not silently drop audio.
 */
export async function encodeSegmentToWebmOpus(
  samples: Float32Array,
  sampleRate = CAPTURE_SAMPLE_RATE,
): Promise<EncodedSegment> {
  if (!isOpusEncoderSupported()) {
    throw new Error("WebCodecs Opus encoding is not supported on this browser");
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    audio: { codec: "A_OPUS", numberOfChannels: 1, sampleRate },
    firstTimestampBehavior: "offset",
  });

  let encodeError: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
    },
  });
  encoder.configure({
    codec: "opus",
    sampleRate,
    numberOfChannels: 1,
    bitrate: OPUS_BITRATE,
  });

  // Copy into a fresh ArrayBuffer-backed view (AudioData requires a non-shared
  // BufferSource; the incoming view may be backed by any ArrayBufferLike).
  const pcm = new Float32Array(samples.length);
  pcm.set(samples);
  const audioData = new AudioData({
    format: "f32",
    sampleRate,
    numberOfFrames: pcm.length,
    numberOfChannels: 1,
    timestamp: 0,
    data: pcm,
  });
  encoder.encode(audioData);
  audioData.close();

  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;

  muxer.finalize();
  return {
    bytes: new Uint8Array(target.buffer),
    contentType: SEGMENT_CONTENT_TYPE,
  };
}
