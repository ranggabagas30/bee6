import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import {
  TRANSCRIBE_MODEL,
  TRANSCRIBE_RETRY,
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

  it("sets stage='transcribe' on ServiceUnavailableError", async () => {
    const generate: TranscribeGenerate = async () => {
      throw new Error("upstream failure");
    };
    const transcriber = geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
    });
    try {
      await transcriber.transcribe(input);
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceUnavailableError);
      expect((e as ServiceUnavailableError).stage).toBe("transcribe");
      expect((e as ServiceUnavailableError).upstream).toBeDefined();
    }
  });

  it("extracts numeric status code to upstream field", async () => {
    const generate: TranscribeGenerate = async () => {
      const err = new Error("upstream 503");
      (err as { status?: number }).status = 503;
      throw err;
    };
    const transcriber = geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
      // 503 is now retried (R-22): keep this test instant and quiet.
      sleep: async () => {},
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await transcriber.transcribe(input);
    } catch (e) {
      expect((e as ServiceUnavailableError).upstream).toBe(503);
    }
  });

  it("sets upstream='timeout' for AbortError", async () => {
    const generate: TranscribeGenerate = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    const transcriber = geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
    });
    try {
      await transcriber.transcribe(input);
    } catch (e) {
      expect((e as ServiceUnavailableError).upstream).toBe("timeout");
    }
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

describe("geminiTranscriber.transcribe retry (R-22 PR-A)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A fake generate that throws the queued errors in order, then returns text. */
  function flakyGenerate(failures: unknown[], text = "flat white") {
    const calls: GenerateContentParameters[] = [];
    const generate: TranscribeGenerate = async (params) => {
      calls.push(params);
      if (calls.length <= failures.length) throw failures[calls.length - 1];
      return { text } as GenerateContentResponse;
    };
    return { generate, calls };
  }

  function build(
    generate: TranscribeGenerate,
    extra: Partial<Parameters<typeof geminiTranscriber>[0]> = {},
  ) {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    const transcriber = geminiTranscriber({
      generate,
      resolveLocation: () => "global",
      vocabulary: [],
      sleep,
      rng: () => 1,
      ...extra,
    });
    return { transcriber, sleeps };
  }

  it("retries a 429 then succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { generate, calls } = flakyGenerate([{ status: 429 }, { status: 429 }]);
    const { transcriber, sleeps } = build(generate);
    const result = await transcriber.transcribe(input);
    expect(result.text).toBe("flat white");
    expect(calls).toHaveLength(3);
    // rng 1 => no downward jitter: exact 1000 then 2000.
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up after `attempts` and throws the sanitised 503 with the last upstream status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const leak = audio.toString("base64");
    const failure = Object.assign(new Error(`upstream 503 ${leak} fake-opus-bytes`), {
      status: 503,
    });
    const { generate, calls } = flakyGenerate([failure, failure, failure, failure, failure]);
    const { transcriber, sleeps } = build(generate);
    let caught: unknown;
    try {
      await transcriber.transcribe(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableError);
    const err = caught as ServiceUnavailableError;
    expect(err.stage).toBe("transcribe");
    expect(err.upstream).toBe(503);
    expect(err.message).toBe("Transcription upstream unavailable");
    expect(err.message).not.toContain("fake-opus-bytes");
    expect(err.message).not.toContain(leak);
    expect(calls).toHaveLength(TRANSCRIBE_RETRY.attempts);
    // Backoff capped at maxDelayMs (4 s): 1 s, 2 s, 4 s between 4 attempts.
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("does not retry a 400", async () => {
    const { generate, calls } = flakyGenerate([{ status: 400 }]);
    const { transcriber, sleeps } = build(generate);
    await expect(transcriber.transcribe(input)).rejects.toMatchObject({
      stage: "transcribe",
      upstream: 400,
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("does not retry a timeout", async () => {
    const { generate, calls } = flakyGenerate([
      new DOMException("The operation was aborted", "AbortError"),
    ]);
    const { transcriber, sleeps } = build(generate);
    await expect(transcriber.transcribe(input)).rejects.toMatchObject({
      upstream: "timeout",
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("does not retry an error without a status (network)", async () => {
    const { generate, calls } = flakyGenerate([new Error("socket hang up")]);
    const { transcriber, sleeps } = build(generate);
    await expect(transcriber.transcribe(input)).rejects.toMatchObject({
      upstream: "unknown",
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("stops early when the deadline would be exceeded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { generate, calls } = flakyGenerate([{ status: 429 }, { status: 429 }]);
    const { transcriber, sleeps } = build(generate, { timeoutMs: 1500 });
    await expect(transcriber.transcribe(input)).rejects.toMatchObject({
      stage: "transcribe",
      upstream: 429,
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("jitter is within [raw/2, raw]", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const low = build(flakyGenerate([{ status: 429 }]).generate, { rng: () => 0 });
    await low.transcriber.transcribe(input);
    expect(low.sleeps).toEqual([500]);

    const high = build(flakyGenerate([{ status: 429 }]).generate, { rng: () => 0.999 });
    await high.transcriber.transcribe(input);
    expect(high.sleeps).toHaveLength(1);
    expect(high.sleeps[0]).toBeGreaterThanOrEqual(999);
    expect(high.sleeps[0]).toBeLessThanOrEqual(1000);
  });

  it("attempts: 1 behaves like a single call (no sleep, no retry)", async () => {
    const { generate, calls } = flakyGenerate([{ status: 429 }]);
    const { transcriber, sleeps } = build(generate, { retry: { attempts: 1 } });
    await expect(transcriber.transcribe(input)).rejects.toMatchObject({ upstream: 429 });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("logs only {attempt, upstream, delayMs} per retry (no audio, body or text)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const leak = audio.toString("base64");
    const failure = Object.assign(new Error(`body ${leak}`), { status: 429 });
    const { generate } = flakyGenerate([failure, failure]);
    const { transcriber } = build(generate);
    await transcriber.transcribe(input);
    expect(warn.mock.calls).toEqual([
      ["transcribe.retry", { attempt: 1, upstream: 429, delayMs: 1000 }],
      ["transcribe.retry", { attempt: 2, upstream: 429, delayMs: 2000 }],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(leak);
  });

  it("reuses the same base64 payload on every attempt and gives each attempt a fresh abort signal within budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { generate, calls } = flakyGenerate([{ status: 503 }, { status: 503 }]);
    const { transcriber } = build(generate);
    await transcriber.transcribe(input);
    expect(calls).toHaveLength(3);
    const datas = calls.map(
      (c) => (contentsOf(c)[0] as { inlineData: { data: string } }).inlineData.data,
    );
    expect(new Set(datas)).toEqual(new Set([audio.toString("base64")]));
    const signals = calls.map((c) => c.config?.abortSignal);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
    expect(new Set(signals).size).toBe(3);
  });
});
