import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { z } from "zod";
import { getModelLocation } from "@/config/regions";
import type { LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import type { LabelUnit } from "@/lib/pipeline/windowing";

/**
 * Label client (R-05b, Task 4) — one `generateContent` call to
 * `gemini-3.5-flash-lite` with structured output, following the same
 * `@google/genai` client pattern as `lib/transcribe/gemini.ts` (R-04), with
 * one difference: ONE client instance is built and reused across calls
 * (module-level cache), not recreated per request — fixes the TSD's G-9
 * finding for this module.
 *
 * Never logs a raw error message or raw model response text (TSD L-T7):
 * every failure logs exactly `{unit_id, error_class, zod_issue_path?,
 * zod_issue_code?}`.
 */

export const LABEL_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 30_000;

export type LabelGenerate = (
  params: GenerateContentParameters,
  ctx: { project: string; location: string },
) => Promise<GenerateContentResponse>;

export interface LabelClientDeps {
  /** Override the raw model call (unit tests inject a fake). */
  generate?: LabelGenerate;
  /** Server-side timeout in ms (AbortSignal). Defaults to 30 s. */
  timeoutMs?: number;
  /** GCP project id. Defaults to `process.env.GOOGLE_CLOUD_PROJECT`. */
  project?: string;
  /** Resolves a model's location. Defaults to config/regions.yaml. */
  resolveLocation?: (model: string) => string;
}

type ZodIssue = z.core.$ZodIssue;

export type LabelClientResult =
  | { kind: "ok"; wire: LabelWireOutput }
  | { kind: "retryable_error"; error: { class: string; detail?: string } }
  | { kind: "parse_error"; issues: ZodIssue[] };

let cachedClient: GoogleGenAI | null = null;
let cachedClientKey: string | null = null;

function getOrCreateClient(project: string, location: string): GoogleGenAI {
  const key = `${project}::${location}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = new GoogleGenAI({ vertexai: true, project, location });
  cachedClientKey = key;
  return cachedClient;
}

/** The default caller: ONE cached Vertex-mode client (ADC), reused across calls. */
const realVertexGenerate: LabelGenerate = async (params, ctx) => {
  if (!ctx.project) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  }
  const client = getOrCreateClient(ctx.project, ctx.location);
  return client.models.generateContent(params);
};

/** Classifies an upstream error by class only — never by its message text. */
function classifyError(error: unknown): { class: string; detail?: string } {
  if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timeout"))) {
    return { class: "timeout" };
  }
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status === "number") {
    return { class: `http_${status}` };
  }
  return { class: "unknown" };
}

function logFailure(unitId: string, errorClass: string, issue?: ZodIssue): void {
  console.error("[label-client] failure", {
    unit_id: unitId,
    error_class: errorClass,
    zod_issue_path: issue ? issue.path.join(".") : undefined,
    zod_issue_code: issue?.code,
  });
}

export async function callLabelModel(
  input: {
    unit: LabelUnit;
    prompt: { systemInstruction: string; userContent: string };
    schema: object;
    /** The same call's strict, per-call wire schema (`buildLabelWireSchema`'s
     * output) — the caller already knows both alias counts needed to build
     * it, so the client validates the real response against the real
     * alias set directly, rather than deferring to a later, weaker check. */
    wireSchema: z.ZodType<LabelWireOutput>;
  },
  deps: LabelClientDeps = {},
): Promise<LabelClientResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const generate = deps.generate ?? realVertexGenerate;
  const resolveLocation = deps.resolveLocation ?? ((model: string) => getModelLocation(model).location);
  const location = resolveLocation(LABEL_MODEL);
  const project = deps.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";

  const params: GenerateContentParameters = {
    model: LABEL_MODEL,
    contents: [{ role: "user", parts: [{ text: input.prompt.userContent }] }],
    config: {
      systemInstruction: input.prompt.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: input.schema,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  };

  let response: GenerateContentResponse;
  try {
    response = await generate(params, { project, location });
  } catch (error) {
    const classified = classifyError(error);
    logFailure(input.unit.unit_id, classified.class);
    return { kind: "retryable_error", error: classified };
  }

  const text = response.text ?? "";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    logFailure(input.unit.unit_id, "invalid_json");
    return {
      kind: "parse_error",
      issues: [{ code: "custom", path: [], message: "response was not valid JSON", input: undefined } as ZodIssue],
    };
  }

  // Full validation against the caller's strict, per-call wire schema —
  // the same alias set Vertex's structured-output config already enforced
  // at generation time (built from generateResponseJsonSchema), checked
  // again here against the actual response. A failure becomes
  // `parse_error`, same retry path as any other parse failure.
  const result = input.wireSchema.safeParse(parsedJson);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    logFailure(input.unit.unit_id, "zod_validation", firstIssue);
    return { kind: "parse_error", issues: result.error.issues };
  }

  return { kind: "ok", wire: result.data };
}
