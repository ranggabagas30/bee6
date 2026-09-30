import {
  AudioTranscriptionConfigMode,
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { getModelLocation } from "@/config/regions";
import { ServiceUnavailableError } from "@/lib/http/errors";
import { loadCustomVocabulary } from "@/lib/transcribe/vocabulary";
import type {
  Transcriber,
  TranscribeInput,
  TranscribeResult,
} from "@/lib/transcribe/types";

/**
 * Gemini 3.5 Transcribe implementation of the Transcriber (R-04, slice 1).
 *
 * Hard rules honoured here:
 *  - #1: Google AI only, via `@google/genai` in Vertex/Google Cloud mode (ADC,
 *    never an API key — the client is built the same way as scripts/probe.ts).
 *  - #2: audio lives only in memory for one call. It is base64-encoded inline in
 *    `contents` and never returned, never logged, never placed in an Error — on
 *    any failure a fixed, sanitised message is thrown (the upstream error is not
 *    interpolated, so nothing from the request or a large body can leak).
 *  - #5: the model location comes from `getModelLocation()` (config/regions.yaml),
 *    never a literal.
 *
 * The call is audio-only (no text prompt / system instruction / structured
 * output), VERBATIM mode, with an optional language hint and custom vocabulary.
 * A ~30 s AbortSignal bounds a stuck upstream so the route returns 503 quickly.
 */

export const TRANSCRIBE_MODEL = "gemini-3.5-transcribe-preview";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Test seam: performs one `generateContent` call. `ctx` carries the project and
 * the resolved location so the default implementation can build a Vertex client.
 */
export type TranscribeGenerate = (
  params: GenerateContentParameters,
  ctx: { project: string; location: string },
) => Promise<GenerateContentResponse>;

export interface GeminiTranscriberDeps {
  /** Override the raw model call (unit tests inject a fake). */
  generate?: TranscribeGenerate;
  /** Custom vocabulary (<= 100 terms). Defaults to `loadCustomVocabulary()`. */
  vocabulary?: string[];
  /** BCP-47 language hints. Omitted by default (auto-detect). */
  languageCodes?: string[];
  /** Server-side timeout in ms (AbortSignal). Defaults to 30 s. */
  timeoutMs?: number;
  /** GCP project id. Defaults to `process.env.GOOGLE_CLOUD_PROJECT`. */
  project?: string;
  /** Resolves a model's location. Defaults to config/regions.yaml. */
  resolveLocation?: (model: string) => string;
}

/** The default caller: a Vertex-mode client (ADC), one `generateContent`. */
const realVertexGenerate: TranscribeGenerate = async (params, ctx) => {
  if (!ctx.project) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  }
  const client = new GoogleGenAI({
    vertexai: true,
    project: ctx.project,
    location: ctx.location,
  });
  return client.models.generateContent(params);
};

export function geminiTranscriber(deps: GeminiTranscriberDeps = {}): Transcriber {
  const generate = deps.generate ?? realVertexGenerate;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolveLocation =
    deps.resolveLocation ?? ((model: string) => getModelLocation(model).location);
  const vocabulary = deps.vocabulary ?? loadCustomVocabulary();

  return {
    async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
      const location = resolveLocation(TRANSCRIBE_MODEL);
      const project = deps.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";

      const params: GenerateContentParameters = {
        model: TRANSCRIBE_MODEL,
        // Audio only — no text prompt, no system instruction, no structured output.
        contents: [
          {
            inlineData: {
              data: input.audio.toString("base64"),
              mimeType: input.mimeType,
            },
          },
        ],
        config: {
          audioTranscriptionConfig: {
            mode: AudioTranscriptionConfigMode.VERBATIM,
            ...(deps.languageCodes && deps.languageCodes.length > 0
              ? { languageCodes: deps.languageCodes }
              : {}),
            ...(vocabulary.length > 0 ? { customVocabulary: vocabulary } : {}),
          },
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      };

      let response: GenerateContentResponse;
      try {
        response = await generate(params, { project, location });
      } catch {
        // Sanitised: do NOT interpolate the upstream error — it could be large and
        // we never risk the audio/base64 reaching an Error (hard rule #2). Every
        // failure (5xx/429/timeout/400/network) becomes a retryable 503.
        throw new ServiceUnavailableError("Transcription upstream unavailable");
      }

      // Empty/missing text is a valid result (silence / non-speech), not an error.
      const usage = response.usageMetadata;
      return {
        text: response.text ?? "",
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        model: TRANSCRIBE_MODEL,
        location,
      };
    },
  };
}
