import { describe, expect, it } from "vitest";
import { ServiceUnavailableError } from "@/lib/http/errors";
import { MAX_SEGMENT_BYTES, SEGMENT_CONTENT_TYPE } from "@/lib/capture/contract";
import type { Transcriber, TranscribeInput } from "@/lib/transcribe/types";
import { WER_NORMALIZATION_RULE } from "@/lib/eval/metrics";
import {
  CLIP_MAX_MS,
  TRANSCRIBE_USD_PER_MIN,
  evaluateClips,
  parseRefsCsv,
  renderTranscribeReport,
  type RefRow,
} from "@/lib/eval/transcribe-eval";

const SENTINEL = "SENTINEL_HYPOTHESIS_TEXT";

function fakeTranscriber(texts: Record<string, string | Error>, seen: TranscribeInput[] = []): Transcriber {
  return {
    async transcribe(input) {
      seen.push(input);
      const key = input.audio.toString("utf8");
      const value = texts[key];
      if (value instanceof Error) throw value;
      return { text: value ?? "", inputTokens: 1, outputTokens: 1, model: "m", location: "global" };
    },
  };
}

/** A clock that advances by the given step list on each reading. */
function clock(steps: number[]): () => number {
  let t = 0;
  let i = 0;
  return () => {
    const now = t;
    t += steps[i++ % steps.length] as number;
    return now;
  };
}

describe("parseRefsCsv", () => {
  it("reads clip, reference and the optional duration_ms column", () => {
    const { refs, errors } = parseRefsCsv('clip,reference,duration_ms\na.webm,"buka toko, jam tujuh",12000\nb.webm,halo,\n');
    expect(errors).toEqual([]);
    expect(refs).toEqual([
      { clip: "a.webm", reference: "buka toko, jam tujuh", duration_ms: 12000 },
      { clip: "b.webm", reference: "halo", duration_ms: null },
    ]);
  });

  it("works without a duration_ms column", () => {
    expect(parseRefsCsv("clip,reference\na.webm,halo").refs[0]?.duration_ms).toBeNull();
  });

  it("rejects path parts in a clip name, a missing header, a duplicate clip, a bad duration", () => {
    expect(parseRefsCsv("clip,reference\n../x.webm,halo").errors[0]).toMatch(/x\.webm/);
    expect(parseRefsCsv("name,text\na,b").errors[0]).toMatch(/header/i);
    expect(parseRefsCsv("clip,reference\na.webm,x\na.webm,y").errors.join()).toMatch(/duplicate/i);
    expect(parseRefsCsv("clip,reference,duration_ms\na.webm,x,abc").errors.join()).toMatch(/duration/i);
  });

  it("rejects an empty reference", () => {
    expect(parseRefsCsv("clip,reference\na.webm,").errors.join()).toMatch(/reference/i);
  });

  it.each(["...", "- ,", "!?"])("rejects a punctuation-only reference %j (0 words after normalisation)", (ref) => {
    const { refs, errors } = parseRefsCsv(`clip,reference\na.webm,"${ref}"`);
    expect(refs).toEqual([]);
    expect(errors.join()).toMatch(/a\.webm.*no words/i);
  });

  it("ignores fully empty rows", () => {
    const { refs, errors } = parseRefsCsv("clip,reference,duration_ms\na.webm,halo,\n,,\n , , \nb.webm,hai,\n,,\n");
    expect(errors).toEqual([]);
    expect(refs.map((r) => r.clip)).toEqual(["a.webm", "b.webm"]);
  });

  it("still reports a row with a reference but no clip name", () => {
    expect(parseRefsCsv("clip,reference\n,halo").errors.length).toBe(1);
  });
});

describe("evaluateClips", () => {
  const refs: RefRow[] = [
    { clip: "a.webm", reference: "buka toko jam tujuh", duration_ms: 10_000 },
    { clip: "b.webm", reference: "tutup kas hitung dua kali", duration_ms: 5_000 },
  ];
  const readClip = async (name: string) => Buffer.from(name.replace(".webm", ""), "utf8");

  it("computes edits, words and latency per clip, and sends audio in memory with the segment content type", async () => {
    const seen: TranscribeInput[] = [];
    const { results } = await evaluateClips({
      refs,
      readClip,
      transcriber: fakeTranscriber({ a: "buka toko jam delapan", b: "tutup kas hitung dua kali" }, seen),
      now: clock([120, 0, 340, 0]),
    });
    expect(results).toEqual([
      { clip: "a.webm", status: "ok", words: 4, edits: 1, latency_ms: 120, duration_ms: 10_000 },
      { clip: "b.webm", status: "ok", words: 5, edits: 0, latency_ms: 340, duration_ms: 5_000 },
    ]);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.mimeType).toBe(SEGMENT_CONTENT_TYPE);
    expect(Buffer.isBuffer(seen[0]?.audio)).toBe(true);
  });

  it("never keeps the hypothesis text in the results", async () => {
    const { results } = await evaluateClips({
      refs: [refs[0] as RefRow],
      readClip,
      transcriber: fakeTranscriber({ a: SENTINEL }),
      now: clock([1]),
    });
    expect(JSON.stringify(results)).not.toContain(SENTINEL);
  });

  it("skips a clip longer than 15 s (by plan) or larger than the segment limit, without calling the model", async () => {
    const seen: TranscribeInput[] = [];
    const { results } = await evaluateClips({
      refs: [
        { clip: "long.webm", reference: "x", duration_ms: CLIP_MAX_MS + 1 },
        { clip: "big.webm", reference: "x", duration_ms: null },
      ],
      readClip: async (name) => (name === "big.webm" ? Buffer.alloc(MAX_SEGMENT_BYTES + 1) : Buffer.from("x")),
      transcriber: fakeTranscriber({}, seen),
      now: clock([1]),
    });
    expect(seen).toHaveLength(0);
    expect(results.map((r) => r.status)).toEqual(["skipped", "skipped"]);
  });

  it("records an unreadable clip as skipped and an upstream failure as failed, and keeps going", async () => {
    const { results } = await evaluateClips({
      refs: [
        { clip: "missing.webm", reference: "x", duration_ms: null },
        { clip: "a.webm", reference: "x", duration_ms: null },
        { clip: "b.webm", reference: "x", duration_ms: null },
      ],
      readClip: async (name) => {
        if (name === "missing.webm") throw new Error("ENOENT secret/path");
        return Buffer.from(name.replace(".webm", ""));
      },
      transcriber: fakeTranscriber({ a: new ServiceUnavailableError("x", "transcribe", 429), b: "ok" }),
      now: clock([1]),
    });
    expect(results.map((r) => r.status)).toEqual(["skipped", "failed", "ok"]);
    expect(results[1]).toMatchObject({ status: "failed", reason: "upstream 429" });
    expect(JSON.stringify(results)).not.toContain("secret/path");
  });
});

describe("renderTranscribeReport", () => {
  const ok = (clip: string, words: number, edits: number, latency_ms: number, duration_ms: number | null) =>
    ({ clip, status: "ok" as const, words, edits, latency_ms, duration_ms });

  it("prints n, pooled WER, per-clip rows, latency p50/p95 and the list price", () => {
    const md = renderTranscribeReport(
      [ok("a.webm", 4, 1, 100, 6_000), ok("b.webm", 6, 0, 300, 6_000), ok("c.webm", 10, 2, 200, 6_000)],
      "2026-10-11",
    );
    expect(md).toMatch(/Clips evaluated: n = 3/);
    // pooled = (1 + 0 + 2) / (4 + 6 + 10) = 0.15
    expect(md).toMatch(/Pooled WER: 0\.150 \(3 edits \/ 20 reference words\)/);
    expect(md).toMatch(/\| a\.webm \| 4 \| 1 \| 0\.250 \| 100 \|/);
    expect(md).toMatch(/Latency p50: 200 ms/);
    expect(md).toMatch(/Latency p95: 300 ms/);
    expect(md).toMatch(/Total speech: 0\.30 minutes/);
    expect(md).toContain(`$${TRANSCRIBE_USD_PER_MIN} per speech-minute`);
    expect(md).toMatch(/list price, not billed cost/);
    expect(md).toMatch(/Estimated list cost for these clips: \$0\.0015/);
  });

  it("says speech minutes are not measured when any evaluated clip has no duration", () => {
    const md = renderTranscribeReport([ok("a.webm", 4, 1, 100, null)], "2026-10-11");
    expect(md).toMatch(/Total speech: not measured/);
    expect(md).not.toMatch(/Estimated list cost/);
  });

  it("lists skipped and failed clips with a reason and counts them", () => {
    const md = renderTranscribeReport(
      [ok("a.webm", 4, 1, 100, null), { clip: "x.webm", status: "skipped", reason: "longer than 15 s" }, { clip: "y.webm", status: "failed", reason: "upstream 503" }],
      "2026-10-11",
    );
    expect(md).toMatch(/Clips evaluated: n = 1; skipped: 1; failed: 1/);
    expect(md).toContain("x.webm: longer than 15 s");
    expect(md).toContain("y.webm: upstream 503");
  });

  it("prints n/a, not 0, for a clip with no reference words and when nothing was evaluated", () => {
    expect(renderTranscribeReport([ok("a.webm", 0, 2, 100, null)], "d")).toMatch(/\| a\.webm \| 0 \| 2 \| n\/a \| 100 \|/);
    expect(renderTranscribeReport([], "d")).toMatch(/Pooled WER: n\/a/);
  });

  it("prints the exact WER normalisation rule in the method line", () => {
    expect(renderTranscribeReport([], "d")).toContain(WER_NORMALIZATION_RULE);
  });

  it("names the sample as local fictional clips", () => {
    expect(renderTranscribeReport([], "d")).toMatch(/fictional/i);
  });
});
