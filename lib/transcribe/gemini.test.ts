import { describe, expect, it, vi } from "vitest";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import {
  TRANSCRIBE_MODEL,
  geminiTranscriber,
  type TranscribeGenerate,
} from "@/lib/transcribe/gemini";
import { ServiceUnavailableError } from "@/lib/http/errors";
import type { TranscribeInput } from "@/lib/transcribe/types";

const audio = Buffer.from("fake-opus-bytes");
const input: TranscribeInput = { audio, mimeType: "audio/webm" };

/** A fake generate that records the params and returns a canned response. */
function recordingGenerate(response: Partial<GenerateContentResponse>) {
  const seen: {
    params?: GenerateContentParameters;
    ctx?: { project: string; location: string };
  } = {};
  const generate: TranscribeGenerate = async (params, ctx) => {
    seen.params = params;
    seen.ctx = ctx;
    return response as GenerateContentResponse;
  };
  return { generate, seen };
}

function contentsOf(params: GenerateContentParameters): unknown[] {
  return params.contents as unknown[];
}

describe("geminiTranscriber.transcribe", () => {
  it("maps text and usage tokens into the result with model + resolved location", async () => {
    const { generate } = recordingGenerate({
      text: "flat white for table two",
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 8,
      } as GenerateContentResponse["usageMetadata"],
    });
    const result = await geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
    }).transcribe(input);
    expect(result).toEqual({
      text: "flat white for table two",
      inputTokens: 120,
      outputTokens: 8,
      model: TRANSCRIBE_MODEL,
      location: "global",
    });
  });

  it("returns text:'' (not an error) when the model returns empty/missing text", async () => {
    const { generate } = recordingGenerate({ text: undefined });
    const result = await geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
    }).transcribe(input);
    expect(result.text).toBe("");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("sends audio inline (base64) with no text prompt, VERBATIM mode, and an abort signal", async () => {
    const { generate, seen } = recordingGenerate({ text: "" });
    await geminiTranscriber({
      generate,
      resolveLocation: () => "asia-southeast1",
      vocabulary: ["flat white"],
    }).transcribe(input);

    const contents = contentsOf(seen.params!);
    expect(contents).toHaveLength(1);
    const part = contents[0] as { inlineData?: { data?: string; mimeType?: string } };
    expect(part.inlineData?.data).toBe(audio.toString("base64"));
    expect(part.inlineData?.mimeType).toBe("audio/webm");
    // No text prompt anywhere in the request.
    expect(JSON.stringify(contents)).not.toContain("text");

    const cfg = seen.params!.config;
    expect(cfg?.audioTranscriptionConfig?.mode).toBe("VERBATIM");
    expect(cfg?.audioTranscriptionConfig?.customVocabulary).toEqual(["flat white"]);
    expect(cfg?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(seen.ctx?.location).toBe("asia-southeast1");
  });

  it("omits languageCodes by default (auto-detect) and sends them when provided", async () => {
    const auto = recordingGenerate({ text: "" });
    await geminiTranscriber({
      generate: auto.generate,
      resolveLocation: () => "global",
      vocabulary: [],
    }).transcribe(input);
    expect(
      auto.seen.params!.config?.audioTranscriptionConfig?.languageCodes,
    ).toBeUndefined();

    const hinted = recordingGenerate({ text: "" });
    await geminiTranscriber({
      generate: hinted.generate,
      resolveLocation: () => "global",
      vocabulary: [],
      languageCodes: ["id-ID"],
    }).transcribe(input);
    expect(
      hinted.seen.params!.config?.audioTranscriptionConfig?.languageCodes,
    ).toEqual(["id-ID"]);
  });

  it("omits customVocabulary when the vocabulary is empty", async () => {
    const { generate, seen } = recordingGenerate({ text: "" });
    await geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
    }).transcribe(input);
    expect(
      seen.params!.config?.audioTranscriptionConfig?.customVocabulary,
    ).toBeUndefined();
  });

  it("throws ServiceUnavailableError with no audio/base64 in the message on any upstream failure", async () => {
    const leak = audio.toString("base64");
    const generate: TranscribeGenerate = async () => {
      throw new Error(`upstream 500 ${leak}`);
    };
    const transcriber = geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
    });
    let caught: unknown;
    try {
      await transcriber.transcribe(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableError);
    const message = (caught as Error).message;
    expect(message).not.toContain(leak);
    expect(message).toBe("Transcription upstream unavailable");
  });

  it("maps an aborted/timeout rejection to ServiceUnavailableError", async () => {
    const generate: TranscribeGenerate = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    await expect(
      geminiTranscriber({
        generate,
        resolveLocation: () => "global",
        vocabulary: [],
      }).transcribe(input),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("resolves the location from config/regions.yaml by default (never a literal)", async () => {
    const spy = vi.fn(() => "global");
    const { generate } = recordingGenerate({ text: "" });
    await geminiTranscriber({ generate, resolveLocation: spy, vocabulary: [] }).transcribe(
      input,
    );
    expect(spy).toHaveBeenCalledWith(TRANSCRIBE_MODEL);
  });
});
