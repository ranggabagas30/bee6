/**
 * Region probe (T-002, docs/specs/pipeline-and-agents.md).
 *
 * For each Gemini model bee6 uses, calls it with a 1-line prompt (a short
 * clip for audio models) at asia-southeast2 (Jakarta), then
 * asia-southeast1 (Singapore), then global — in that order — and records
 * the first location that answers plus its latency. A region that fails
 * is recorded with its error code, never silently skipped, so re-running
 * the probe twice against the same project gives the same result.
 * Results are written to config/regions.yaml, which is the only place
 * the app reads model locations from (CLAUDE.md hard rule #5).
 *
 * There is no live GCP project or service account to call yet (that is
 * Rangga-only work, see docs/tasks/R-01.md), so `callModel` below is a
 * stub: it does not import or construct a real `@google/genai` client
 * and makes no network call of any kind. It exists so the retry/fallback
 * ordering, the "record every failure" behaviour, and the YAML output
 * shape can be built and unit-tested now (scripts/probe.test.ts). Wiring
 * this to a real Vertex AI client is follow-up work once Rangga hands
 * over a project + service account.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";

/** Probe order: Jakarta first, then Singapore, then the global endpoint. */
export const REGION_ORDER = ["asia-southeast2", "asia-southeast1", "global"] as const;
export type Region = (typeof REGION_ORDER)[number];

export const MODEL_KEYS = [
  "gemini-3.5-transcribe",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  // Exact Live API model id is still to be confirmed; this key is a
  // placeholder name, not a confirmed model id (CLAUDE.md §3).
  "gemini-live-debrief",
] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

/** Raised by a model caller for any failure, real or stubbed. */
export class ProbeCallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProbeCallError";
    this.code = code;
  }
}

export interface ModelCallSuccess {
  ok: true;
  latencyMs: number;
}
export interface ModelCallFailure {
  ok: false;
  code: string;
  message: string;
}
export type ModelCallResult = ModelCallSuccess | ModelCallFailure;

/** A model caller: given a model and a candidate region, try it once. */
export type ModelCaller = (model: ModelKey, region: Region) => Promise<ModelCallResult>;

export interface RegionAttempt {
  region: Region;
  ok: boolean;
  latencyMs?: number;
  error?: { code: string; message: string };
}

export interface ProbeOutcome {
  model: ModelKey;
  /** First region that answered, or "UNPROBED" if every region failed. */
  location: Region | "UNPROBED";
  latencyMs: number | null;
  probedAt: string;
  /** Every region tried, in order, including the ones that failed. */
  attempts: RegionAttempt[];
  /** Set when every region failed: the error from the last region tried. */
  error: { code: string; message: string } | null;
}

/**
 * Tries `model` against each region in `regionOrder`, in order, stopping
 * at the first success. Every attempt (success or failure) is recorded
 * in `attempts` — a failure is never skipped without a record of why.
 */
export async function probeModel(
  model: ModelKey,
  callModel: ModelCaller,
  regionOrder: readonly Region[] = REGION_ORDER,
  now: () => string = () => new Date().toISOString(),
): Promise<ProbeOutcome> {
  const attempts: RegionAttempt[] = [];

  for (const region of regionOrder) {
    const startedAt = Date.now();
    let result: ModelCallResult;
    try {
      result = await callModel(model, region);
    } catch (err) {
      result =
        err instanceof ProbeCallError
          ? { ok: false, code: err.code, message: err.message }
          : { ok: false, code: "UNKNOWN", message: err instanceof Error ? err.message : String(err) };
    }

    if (result.ok) {
      attempts.push({ region, ok: true, latencyMs: result.latencyMs });
      return {
        model,
        location: region,
        latencyMs: result.latencyMs,
        probedAt: now(),
        attempts,
        error: null,
      };
    }

    const error = { code: result.code, message: result.message };
    attempts.push({ region, ok: false, error, latencyMs: Date.now() - startedAt });
  }

  const lastAttempt = attempts[attempts.length - 1];
  return {
    model,
    location: "UNPROBED",
    latencyMs: null,
    probedAt: now(),
    attempts,
    error: lastAttempt?.error ?? { code: "UNKNOWN", message: "no regions were tried" },
  };
}

export async function probeAllModels(
  models: readonly ModelKey[],
  callModel: ModelCaller,
  regionOrder: readonly Region[] = REGION_ORDER,
  now: () => string = () => new Date().toISOString(),
): Promise<ProbeOutcome[]> {
  const outcomes: ProbeOutcome[] = [];
  for (const model of models) {
    // Sequential on purpose: this is a one-off setup script, not a hot
    // path, and sequential runs are easier to read in the log.
    outcomes.push(await probeModel(model, callModel, regionOrder, now));
  }
  return outcomes;
}

/** Shapes the probe outcomes into the config/regions.yaml document. */
export function toRegionsYamlDoc(outcomes: readonly ProbeOutcome[], probedAt: string) {
  const models: Record<
    string,
    {
      location: string;
      latency_ms: number | null;
      probed_at: string | null;
      error: { code: string; message: string } | null;
    }
  > = {};
  for (const outcome of outcomes) {
    models[outcome.model] = {
      location: outcome.location,
      latency_ms: outcome.latencyMs,
      probed_at: outcome.location === "UNPROBED" ? null : outcome.probedAt,
      error: outcome.error,
    };
  }
  return { version: 0.1, probed_at: probedAt, models };
}

/**
 * Stub model caller. There is no live GCP project or service account
 * yet, so this makes no network call — it always fails with a code that
 * says so, which is still a correctly-recorded failure per T-002's
 * acceptance criteria (recorded, not skipped).
 *
 * Once Rangga hands over a project + service account, replace this with
 * something like:
 *
 *   import { GoogleGenAI } from "@google/genai";
 *   const client = new GoogleGenAI({ vertexai: true, project, location: region });
 *   const response = await client.models.generateContent({ model, contents: "ping" });
 *   return { ok: true, latencyMs: ... };
 */
export const stubModelCaller: ModelCaller = async (_model, _region) => {
  throw new ProbeCallError(
    "NOT_CONFIGURED",
    "No GCP project/service account wired up yet (R-01 agent-buildable slice) — see docs/tasks/R-01.md.",
  );
};

async function main(): Promise<void> {
  const probedAt = new Date().toISOString();
  const outcomes = await probeAllModels(MODEL_KEYS, stubModelCaller);
  const doc = toRegionsYamlDoc(outcomes, probedAt);

  for (const outcome of outcomes) {
    const summary =
      outcome.location === "UNPROBED"
        ? `UNPROBED (last error: ${outcome.error?.code} — ${outcome.error?.message})`
        : `${outcome.location} (${outcome.latencyMs}ms)`;
    console.log(`[probe] ${outcome.model}: ${summary}`);
  }

  const outPath = path.join(process.cwd(), "config", "regions.yaml");
  const header =
    "# Written by `npm run probe`. Do not hand-edit — see scripts/probe.ts.\n" +
    "# Probe order per model: asia-southeast2 -> asia-southeast1 -> global.\n";
  writeFileSync(outPath, header + stringify(doc), "utf8");
  console.log(`[probe] wrote ${outPath}`);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
