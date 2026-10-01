/**
 * Transcriber interface (R-04, slice 0). Frozen first so the segment service and
 * the Gemini implementation can be built against the same contract.
 *
 * INVARIANT (hard rule #2): the raw audio bytes live only in `TranscribeInput`,
 * in memory, for the duration of one call. They are never returned, never
 * attached to an Error, never logged. The base64 encoding the wire needs is done
 * inside the implementation and never escapes it. Any upstream failure surfaces
 * as `ServiceUnavailableError` (503) with a short, sanitised message.
 */

export interface TranscribeInput {
  /** In-memory segment bytes. Dropped after the call; never stored or logged. */
  audio: Buffer;
  /** IANA MIME type of `audio`, e.g. "audio/webm". */
  mimeType: string;
}

export interface TranscribeResult {
  /** Redaction happens downstream — this text is NOT yet safe to store. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model id that produced the text (for the segment record + usage log). */
  model: string;
  /** The Google Cloud location used, read from config/regions.yaml. */
  location: string;
}

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
