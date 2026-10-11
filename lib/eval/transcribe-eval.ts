import { MAX_SEGMENT_BYTES, SEGMENT_CONTENT_TYPE } from "@/lib/capture/contract";
import { parseCsv } from "@/lib/eval/csv";
import { percentile, wer } from "@/lib/eval/metrics";
import { ServiceUnavailableError } from "@/lib/http/errors";
import type { Transcriber } from "@/lib/transcribe/types";

/**
 * R-13 Transcribe quality eval, testable core (docs/specs/pipeline-and-agents.md T-207).
 *
 * Hard rules: clips are bytes handed in by the caller and go only into the in-memory transcribe
 * request, exactly like the segment route (#2). The hypothesis text is compared and dropped inside
 * `evaluateClips`: it is never returned, stored, written or logged. Error text from a failed read or
 * call is never kept either (only a fixed reason, plus the upstream status code).
 */

/** One segment is at most 15 s (the real segment contract); the eval never cuts audio. */
export const CLIP_MAX_MS = 15_000;

/**
 * List price per speech-minute (pricing page cited in the pipeline spec "Sources", checked 29 Sept).
 * Printed as "list price, not billed cost".
 */
export const TRANSCRIBE_USD_PER_MIN = 0.0051;

export interface RefRow {
  clip: string;
  /** Human transcript of fictional speech. */
  reference: string;
  /** Optional clip length from the refs file (the plan's segment length). */
  duration_ms: number | null;
}

const CLIP_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function parseRefsCsv(text: string): { refs: RefRow[]; errors: string[] } {
  const refs: RefRow[] = [];
  const errors: string[] = [];
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (error) {
    return { refs, errors: [`refs CSV could not be read: ${error instanceof Error ? error.message : "unknown"}`] };
  }
  const header = (table[0] ?? []).map((h) => h.trim());
  const iClip = header.indexOf("clip");
  const iRef = header.indexOf("reference");
  const iDur = header.indexOf("duration_ms");
  if (iClip === -1 || iRef === -1) {
    return { refs, errors: ["refs CSV header must contain: clip, reference (optional: duration_ms)"] };
  }
  const seen = new Set<string>();
  for (const [offset, row] of table.slice(1).entries()) {
    const clip = (row[iClip] ?? "").trim();
    const where = clip || `row ${offset + 2}`;
    if (!CLIP_NAME_RE.test(clip) || clip.includes("..")) {
      errors.push(`${where}: clip must be a plain file name (no path parts)`);
      continue;
    }
    if (seen.has(clip)) {
      errors.push(`${clip}: duplicate clip`);
      continue;
    }
    seen.add(clip);
    const reference = (row[iRef] ?? "").trim();
    if (reference === "") {
      errors.push(`${clip}: reference transcript is empty`);
      continue;
    }
    let duration: number | null = null;
    const rawDuration = iDur === -1 ? "" : (row[iDur] ?? "").trim();
    if (rawDuration !== "") {
      const n = Number(rawDuration);
      if (!Number.isInteger(n) || n <= 0) {
        errors.push(`${clip}: duration_ms must be a positive integer`);
        continue;
      }
      duration = n;
    }
    refs.push({ clip, reference, duration_ms: duration });
  }
  return { refs, errors };
}

export type ClipResult =
  | { clip: string; status: "ok"; words: number; edits: number; latency_ms: number; duration_ms: number | null }
  | { clip: string; status: "skipped" | "failed"; reason: string };

export interface EvaluateInput {
  refs: readonly RefRow[];
  readClip(clip: string): Promise<Buffer>;
  transcriber: Transcriber;
  /** Monotonic millisecond clock (injected for tests). */
  now(): number;
}

export async function evaluateClips(input: EvaluateInput): Promise<{ results: ClipResult[] }> {
  const results: ClipResult[] = [];
  for (const ref of input.refs) {
    if (ref.duration_ms !== null && ref.duration_ms > CLIP_MAX_MS) {
      results.push({ clip: ref.clip, status: "skipped", reason: "longer than 15 s (the eval never cuts audio)" });
      continue;
    }
    let audio: Buffer;
    try {
      audio = await input.readClip(ref.clip);
    } catch {
      results.push({ clip: ref.clip, status: "skipped", reason: "clip file could not be read" });
      continue;
    }
    if (audio.byteLength > MAX_SEGMENT_BYTES) {
      results.push({ clip: ref.clip, status: "skipped", reason: "larger than the segment size limit (likely longer than 15 s)" });
      continue;
    }
    const started = input.now();
    try {
      const { text } = await input.transcriber.transcribe({ audio, mimeType: SEGMENT_CONTENT_TYPE });
      const latency = Math.round(input.now() - started);
      const { edits, words } = wer(ref.reference, text);
      results.push({ clip: ref.clip, status: "ok", words, edits, latency_ms: latency, duration_ms: ref.duration_ms });
    } catch (error) {
      const upstream = error instanceof ServiceUnavailableError ? error.upstream : undefined;
      results.push({ clip: ref.clip, status: "failed", reason: upstream === undefined ? "error" : `upstream ${upstream}` });
    }
  }
  return { results };
}

const fmt3 = (value: number | null): string => (value === null ? "n/a" : value.toFixed(3));

export function renderTranscribeReport(results: readonly ClipResult[], runDate: string): string {
  const ok = results.filter((r): r is Extract<ClipResult, { status: "ok" }> => r.status === "ok");
  const notOk = results.filter((r): r is Extract<ClipResult, { status: "skipped" | "failed" }> => r.status !== "ok");
  const skipped = notOk.filter((r) => r.status === "skipped").length;
  const failed = notOk.filter((r) => r.status === "failed").length;

  const edits = ok.reduce((s, r) => s + r.edits, 0);
  const words = ok.reduce((s, r) => s + r.words, 0);
  const latencies = ok.map((r) => r.latency_ms);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const allDurations = ok.length > 0 && ok.every((r) => r.duration_ms !== null);
  const minutes = allDurations ? ok.reduce((s, r) => s + (r.duration_ms as number), 0) / 60_000 : null;

  const out: string[] = [
    "# Transcribe eval (R-13)",
    "",
    `- Run date: ${runDate}`,
    `- Clips evaluated: n = ${ok.length}; skipped: ${skipped}; failed: ${failed}`,
    "- Source: locally recorded fictional clips with human-written reference transcripts, not shop audio.",
    `- Pooled WER: ${words === 0 ? "n/a" : `${fmt3(edits / words)} (${edits} edits / ${words} reference words)`}`,
    `- Latency p50: ${p50 === null ? "n/a" : `${p50} ms`} (nearest rank, wall time of each transcribe call)`,
    `- Latency p95: ${p95 === null ? "n/a" : `${p95} ms`}`,
    minutes === null
      ? "- Total speech: not measured (every clip needs a duration_ms value in the refs file; the transcriber does not report audio length)"
      : `- Total speech: ${minutes.toFixed(2)} minutes (clip lengths from the duration_ms column of the refs file)`,
    `- Price: $${TRANSCRIBE_USD_PER_MIN} per speech-minute (list price, not billed cost)`,
  ];
  if (minutes !== null) {
    out.push(`- Estimated list cost for these clips: $${(minutes * TRANSCRIBE_USD_PER_MIN).toFixed(4)}`);
  }
  out.push("", "| Clip | Reference words | Edits | WER | Latency (ms) |", "|---|---|---|---|---|");
  for (const r of ok) {
    out.push(`| ${r.clip} | ${r.words} | ${r.edits} | ${fmt3(r.words === 0 ? null : r.edits / r.words)} | ${r.latency_ms} |`);
  }
  if (notOk.length > 0) {
    out.push("", "Not scored:");
    for (const r of notOk) out.push(`- ${r.clip}: ${r.reason}`);
  }
  out.push(
    "",
    "WER = (S + D + I) / N words after normalising both texts (Unicode NFKC, lower-case, punctuation removed, whitespace collapsed); pooled WER = sum of edits / sum of reference words.",
    "",
  );
  return out.join("\n");
}
