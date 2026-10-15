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
 * A ~30 s TOTAL budget (R-22): transient upstream failures (429/500/502/503/504)
 * are retried inside that budget with jittered backoff (1 s -> 4 s, 4 attempts),
 * reusing the same in-memory payload. A timeout or any other failure is not
 * retried, so the route still answers 503 within ~30 s and the phone retries.
 */

export const TRANSCRIBE_MODEL = "gemini-3.5-transcribe-preview";
const DEFAULT_TIMEOUT_MS = 30_000;
/** Headroom kept for the next attempt: do not sleep if less than this would remain after it. */
const MIN_ATTEMPT_HEADROOM_MS = 2_000;

export interface TranscribeRetryOptions {
  /** Total attempts including the first. */
  attempts: number;
  baseMs: number;
  factor: number;
  maxDelayMs: number;
  /** Upstream HTTP statuses that are retried. Timeouts and everything else are NOT. */
  statuses: readonly number[];
  /** Per-attempt abort; the whole sequence is still bounded by `timeoutMs` (30 s). */
  attemptTimeoutMs: number;
}

export const TRANSCRIBE_RETRY: TranscribeRetryOptions = {
  attempts: 4,
  baseMs: 1_000,
  factor: 2,
  maxDelayMs: 4_000,
  statuses: [429, 500, 502, 503, 504],
  attemptTimeoutMs: 15_000,
};

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
  /** Retry policy for transient upstream failures (429/5xx) inside ONE request. Defaults in TRANSCRIBE_RETRY. */
  retry?: Partial<TranscribeRetryOptions>;
  /** Injectable sleep (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG in [0,1) for jitter. */
  rng?: () => number;
}

type Upstream = number | "timeout" | "unknown";

/**
 * Reduce an upstream error to a status code or a timeout signal, never message
 * text (the message could carry request data; hard rule #2).
 */
function classifyUpstream(error: unknown): Upstream {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message.includes("timeout")) {
      return "timeout";
    }
  }
  return typeof status === "number" ? status : "unknown";
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const retry: TranscribeRetryOptions = { ...TRANSCRIBE_RETRY, ...deps.retry };
  const sleep = deps.sleep ?? defaultSleep;
  const rng = deps.rng ?? Math.random;

  return {
    async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
      const location = resolveLocation(TRANSCRIBE_MODEL);
      const project = deps.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";

      const deadline = Date.now() + timeoutMs;
      // Encoded once and reused by every attempt; never logged (hard rule #2).
      const data = input.audio.toString("base64");

      const buildParams = (): GenerateContentParameters => ({
        model: TRANSCRIBE_MODEL,
        // Audio only — no text prompt, no system instruction, no structured output.
        contents: [
          {
            inlineData: {
              data,
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
          // Per attempt, always clipped to what is left of the total budget.
          abortSignal: AbortSignal.timeout(
            Math.max(1, Math.min(retry.attemptTimeoutMs, deadline - Date.now())),
          ),
        },
      });

      let response: GenerateContentResponse | undefined;
      for (let attempt = 1; ; attempt++) {
        try {
          response = await generate(buildParams(), { project, location });
          break;
        } catch (error) {
          // Sanitised: do NOT interpolate the upstream error — it could be large and
          // we never risk the audio/base64 reaching an Error (hard rule #2). Only the
          // numeric status or a timeout signal survives.
          const upstream = classifyUpstream(error);
          const retryable =
            typeof upstream === "number" &&
            retry.statuses.includes(upstream) &&
            attempt < retry.attempts;
          if (retryable) {
            const raw = Math.min(
              retry.maxDelayMs,
              retry.baseMs * retry.factor ** (attempt - 1),
            );
            const delayMs = Math.round(raw / 2 + rng() * (raw / 2));
            if (Date.now() + delayMs + MIN_ATTEMPT_HEADROOM_MS <= deadline) {
              // Whitelisted fields only: no message, body, text or audio.
              console.warn("transcribe.retry", { attempt, upstream, delayMs });
              await sleep(delayMs);
              continue;
            }
          }
          throw new ServiceUnavailableError(
            "Transcription upstream unavailable",
            "transcribe",
            upstream,
          );
        }
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
