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
 * The real model caller (`makeVertexModelCaller`) constructs a
 * `@google/genai` client in **Vertex/Google Cloud mode** — service
 * account / Application Default Credentials only, never an AI Studio API
 * key (CLAUDE.md hard rule #4) — and makes one minimal `generateContent`
 * call per candidate region. `callModel` is a parameter (a seam) on
 * `probeModel`/`probeAllModels`, so the retry/fallback ordering and the
 * "record every failure" behaviour are unit-tested with a mocked caller
 * (scripts/probe.test.ts) while `main()` wires in the real one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { DlpServiceClient } from "@google-cloud/dlp";
import { stringify } from "yaml";
import { dlpApiEndpointFor, dlpParentFor } from "@/lib/redact/dlp-endpoint";

/** Probe order: Jakarta first, then Singapore, then the global endpoint. */
export const REGION_ORDER = ["asia-southeast2", "asia-southeast1", "global"] as const;
export type Region = (typeof REGION_ORDER)[number];

export const MODEL_KEYS = [
  "gemini-3.5-transcribe-preview",
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

/**
 * Non-model Google Cloud APIs probed the same way as Gemini models
 * (Jakarta -> Singapore -> global). Today this is just Sensitive Data
 * Protection (DLP): `lib/redact/dlp.ts` must redact every transcript line
 * before storage (hard rule #3), and DLP's regional endpoints do not
 * include Jakarta, so the fallback — not a pinned literal — is what
 * actually picks its region (hard rule #5).
 */
export const SERVICE_KEYS = ["dlp"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/** A service caller: given a service and a candidate region, try it once. */
export type ServiceCaller = (service: ServiceKey, region: Region) => Promise<ModelCallResult>;

export interface ServiceProbeOutcome {
  service: ServiceKey;
  location: Region | "UNPROBED";
  latencyMs: number | null;
  probedAt: string;
  attempts: RegionAttempt[];
  error: { code: string; message: string } | null;
}

/**
 * Same retry/fallback contract as `probeModel`: tries `service` against
 * each region in `regionOrder`, in order, stopping at the first success,
 * and recording every attempt (success or failure) so a region that
 * fails (e.g. DLP has no Jakarta endpoint) is never silently skipped.
 */
export async function probeService(
  service: ServiceKey,
  callService: ServiceCaller,
  regionOrder: readonly Region[] = REGION_ORDER,
  now: () => string = () => new Date().toISOString(),
): Promise<ServiceProbeOutcome> {
  const attempts: RegionAttempt[] = [];

  for (const region of regionOrder) {
    const startedAt = Date.now();
    let result: ModelCallResult;
    try {
      result = await callService(service, region);
    } catch (err) {
      result =
        err instanceof ProbeCallError
          ? { ok: false, code: err.code, message: err.message }
          : { ok: false, code: "UNKNOWN", message: err instanceof Error ? err.message : String(err) };
    }

    if (result.ok) {
      attempts.push({ region, ok: true, latencyMs: result.latencyMs });
      return {
        service,
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
    service,
    location: "UNPROBED",
    latencyMs: null,
    probedAt: now(),
    attempts,
    error: lastAttempt?.error ?? { code: "UNKNOWN", message: "no regions were tried" },
  };
}

export async function probeAllServices(
  services: readonly ServiceKey[],
  callService: ServiceCaller,
  regionOrder: readonly Region[] = REGION_ORDER,
  now: () => string = () => new Date().toISOString(),
): Promise<ServiceProbeOutcome[]> {
  const outcomes: ServiceProbeOutcome[] = [];
  for (const service of services) {
    // Sequential on purpose, same reasoning as probeAllModels.
    outcomes.push(await probeService(service, callService, regionOrder, now));
  }
  return outcomes;
}

/** Shapes service probe outcomes into the `services:` map of config/regions.yaml. */
export function toServicesYamlDoc(outcomes: readonly ServiceProbeOutcome[]) {
  const services: Record<
    string,
    {
      location: string;
      latency_ms: number | null;
      probed_at: string | null;
      error: { code: string; message: string } | null;
    }
  > = {};
  for (const outcome of outcomes) {
    services[outcome.service] = {
      location: outcome.location,
      latency_ms: outcome.latencyMs,
      probed_at: outcome.location === "UNPROBED" ? null : outcome.probedAt,
      error: outcome.error,
    };
  }
  return services;
}

/**
 * Turns an unknown thrown value from `@google-cloud/dlp` (google-gax) into
 * a stable {code, message} pair, the same shape `normalizeGenAiError`
 * produces for `@google/genai`. gRPC errors expose a numeric `.code`
 * (e.g. 5 = NOT_FOUND, 14 = UNAVAILABLE); REST-style errors expose
 * `.status`/`.code` as strings. The message is truncated and the probe
 * sends only a fixed, non-sensitive string ("ping"), never real text
 * (hard rule #3 — nothing from a transcript reaches this path).
 */
function normalizeDlpError(err: unknown): { code: string; message: string } {
  const e = err as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  let code = "UNKNOWN";
  if (typeof e?.status === "string" && e.status) code = e.status;
  else if (typeof e?.code === "number") code = `GRPC_${e.code}`;
  else if (typeof e?.code === "string" && e.code) code = e.code;
  else if (typeof e?.name === "string" && e.name) code = e.name;

  const rawMessage = typeof e?.message === "string" ? e.message : String(err);
  const message = rawMessage.length > 400 ? `${rawMessage.slice(0, 400)}…` : rawMessage;
  return { code, message };
}

/**
 * The real DLP caller: one minimal `deidentifyContent` call against a
 * regional DLP endpoint (`dlp.<region>.rep.googleapis.com`), mirroring
 * how `lib/redact/dlp.ts` calls it for real. The probe text is a fixed,
 * non-sensitive literal ("ping") — never shop data (hard rule #3) — and
 * is not logged on failure (only the normalised error code/message is).
 */
export function makeDlpServiceCaller(project: string): ServiceCaller {
  return async (_service, region) => {
    // Shared with lib/redact/dlp.ts (lib/redact/dlp-endpoint.ts) so the
    // probe and the real redactor can never disagree about how a region
    // is reached.
    const apiEndpoint = dlpApiEndpointFor(region);
    const client = apiEndpoint ? new DlpServiceClient({ apiEndpoint }) : new DlpServiceClient();
    const startedAt = Date.now();
    try {
      await client.deidentifyContent(
        {
          parent: dlpParentFor(project, region),
          item: { value: "ping" },
          inspectConfig: { infoTypes: [{ name: "PHONE_NUMBER" }] },
          deidentifyConfig: {
            infoTypeTransformations: {
              transformations: [
                {
                  infoTypes: [{ name: "PHONE_NUMBER" }],
                  primitiveTransformation: {
                    replaceConfig: { newValue: { stringValue: "[PHONE_NUMBER]" } },
                  },
                },
              ],
            },
          },
        },
        { timeout: 10_000 },
      );
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      const { code, message } = normalizeDlpError(err);
      throw new ProbeCallError(code, message);
    }
  };
}

/** Shapes the probe outcomes into the config/regions.yaml document. */
export function toRegionsYamlDoc(
  outcomes: readonly ProbeOutcome[],
  probedAt: string,
  serviceOutcomes: readonly ServiceProbeOutcome[] = [],
) {
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
  return { version: 0.1, probed_at: probedAt, models, services: toServicesYamlDoc(serviceOutcomes) };
}

/**
 * Models that only accept audio input. A text-only `generateContent`
 * call to these would fail on the *input*, telling us nothing about
 * whether the model is reachable in the region, so we send a tiny
 * synthetic silent clip instead (never real shop audio — hard rule #2).
 */
const AUDIO_MODELS = new Set<ModelKey>(["gemini-3.5-transcribe-preview"]);

/**
 * A 1 s, 16 kHz mono, 16-bit PCM WAV of pure silence, base64-encoded.
 * Fully synthetic and generated in code — a light but valid audio payload
 * (long enough not to trip a minimum-duration check) to test reachability.
 * It is never logged (hard rule #2: no audio/base64 in logs).
 */
function tinySyntheticSilentWavBase64(): string {
  const sampleRate = 16000;
  const numSamples = sampleRate; // 1 s of silence
  const dataBytes = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataBytes); // 44-byte WAV header + samples
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // audioFormat = PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  // Samples stay zero (silence).
  return buf.toString("base64");
}

/** The minimal request body used to probe a given model. */
function probeContents(model: ModelKey) {
  if (AUDIO_MODELS.has(model)) {
    // Transcribe takes audio only: no prompt, no system instruction.
    return [{ inlineData: { data: tinySyntheticSilentWavBase64(), mimeType: "audio/wav" } }];
  }
  return "ping";
}

/**
 * Turns an unknown thrown value from the `@google/genai` SDK into a
 * stable {code, message} pair. The SDK's ApiError exposes `.status`
 * (e.g. "NOT_FOUND", 404) and `.message`; we prefer a string status,
 * fall back to an HTTP code, then the error name. The message is
 * truncated so a long server body can't bloat regions.yaml, and it
 * never contains the audio payload (only text prompts are echoed).
 */
function normalizeGenAiError(err: unknown): { code: string; message: string } {
  const e = err as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  let code = "UNKNOWN";
  if (typeof e?.status === "string" && e.status) code = e.status;
  else if (typeof e?.status === "number") code = `HTTP_${e.status}`;
  else if (typeof e?.code === "string" && e.code) code = e.code;
  else if (typeof e?.name === "string" && e.name) code = e.name;

  const rawMessage = typeof e?.message === "string" ? e.message : String(err);
  const message = rawMessage.length > 400 ? `${rawMessage.slice(0, 400)}…` : rawMessage;
  return { code, message };
}

/**
 * The real model caller: one `generateContent` against `model` at
 * `region`, using a Vertex-mode client (ADC, no API key). A response
 * (even empty) means the model is reachable in that region; any thrown
 * error is normalised and re-thrown as a ProbeCallError so `probeModel`
 * records it and falls through to the next region.
 */
export function makeVertexModelCaller(project: string): ModelCaller {
  return async (model, region) => {
    const client = new GoogleGenAI({ vertexai: true, project, location: region });
    const startedAt = Date.now();
    try {
      const response = await client.models.generateContent({
        model,
        contents: probeContents(model),
      });
      // Touch the response so a rejected/streamed body still surfaces here.
      void response.candidates;
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      const { code, message } = normalizeGenAiError(err);
      throw new ProbeCallError(code, message);
    }
  };
}

/**
 * Loads simple KEY=VALUE pairs from .env.local into process.env for keys
 * not already set, so `npm run probe` picks up GOOGLE_CLOUD_PROJECT
 * without an extra dependency. Values are never logged.
 */
function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is not set. Put it in .env.local or the environment " +
        "before running `npm run probe` (see docs/tasks/R-01-gcp-state.md).",
    );
  }

  const probedAt = new Date().toISOString();
  const callModel = makeVertexModelCaller(project);
  const outcomes = await probeAllModels(MODEL_KEYS, callModel);

  const callService = makeDlpServiceCaller(project);
  const serviceOutcomes = await probeAllServices(SERVICE_KEYS, callService);

  const doc = toRegionsYamlDoc(outcomes, probedAt, serviceOutcomes);

  for (const outcome of outcomes) {
    const summary =
      outcome.location === "UNPROBED"
        ? `UNPROBED (last error: ${outcome.error?.code} — ${outcome.error?.message})`
        : `${outcome.location} (${outcome.latencyMs}ms)`;
    console.log(`[probe] ${outcome.model}: ${summary}`);
  }
  for (const outcome of serviceOutcomes) {
    const summary =
      outcome.location === "UNPROBED"
        ? `UNPROBED (last error: ${outcome.error?.code} — ${outcome.error?.message})`
        : `${outcome.location} (${outcome.latencyMs}ms)`;
    console.log(`[probe] service:${outcome.service}: ${summary}`);
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
