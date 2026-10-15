import { Gemini, InMemoryRunner, LlmAgent, isFinalResponse, setLogLevel, LogLevel } from "@google/adk";
import { ThinkingLevel, type GenerateContentResponseUsageMetadata } from "@google/genai";

/**
 * ProposalAgent (R-08 Task 4.4) — the one model step of the proposal state
 * machine (lib/proposals/service.ts). Everything around this file is plain
 * code (hard rule #10): the gate, the evidence floor and the status
 * decision are never delegated to the model. ADK runs exactly this one
 * structured decision, with no tools and no planner.
 *
 * Built exactly as Task 0's spike proved it (R-08.md §0 item 2, "Task 0
 * result: SPIKE PASSED"): `new Gemini({ vertexai: true, project, location })`
 * takes the region programmatically (hard rule #5, never the process-wide
 * `GOOGLE_CLOUD_LOCATION` env var); `LlmAgent` + `InMemoryRunner` with no
 * database, no Cloud Storage (hard rule #2).
 */

export const PROPOSAL_MODEL = "gemini-3.5-flash";
export const PROPOSAL_AGENT_VERSION = "proposal-v3"; // R-20: facts carry a quote and the staff note; rule 8 defines a repeated problem

/**
 * Thinking ruling (tech-lead, 10 Oct; Task 0 saw default thinking ON: 284
 * thought tokens vs 22 visible). Caps, never disables — this is the one
 * agent whose job is judgement, running once per human tap under a lease,
 * with the plain-code gate checking its output anyway. Only `thinkingLevel`
 * is set: Gemini 3.x rejects `thinkingBudget` alongside it.
 * `includeThoughts: false` — thought text must never come back, be logged
 * or be stored. From the TOP-LEVEL `@google/genai` (2.24.0), never the
 * nested copy under `@google-cloud/vertexai`.
 */
export const PROPOSAL_THINKING_CONFIG = { thinkingLevel: ThinkingLevel.LOW, includeThoughts: false } as const;

export interface ProposalModelUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  thoughts_tokens: number | null;
}

export type ProposalModelResult =
  | { kind: "ok"; text: string; usage: ProposalModelUsage }
  | { kind: "error"; error_class: string };

export type ProposalModel = (
  input: { systemInstruction: string; userContent: string; responseJsonSchema: object },
  ctx: { project: string; location: string; timeoutMs: number },
) => Promise<ProposalModelResult>;

/** "adk" here; the fallback (`directProposalModel`) would set "direct" — moot, Task 0's spike passed. */
export const PROPOSAL_GENERATOR_KIND: "adk" | "direct" = "adk";

// ADK's own logger writes through `console`; set to ERROR once at module
// load so it never echoes a prompt or a response (review focus #7).
setLogLevel(LogLevel.ERROR);

let cachedModel: Gemini | null = null;
let cachedModelKey: string | null = null;

function getOrCreateModel(project: string, location: string): Gemini {
  const key = `${project}::${location}`;
  if (cachedModel && cachedModelKey === key) return cachedModel;
  cachedModel = new Gemini({ model: PROPOSAL_MODEL, vertexai: true, project, location });
  cachedModelKey = key;
  return cachedModel;
}

/** Classifies a thrown error by class only — never by its message text (same discipline as label/client.ts). */
function classifyError(error: unknown): string {
  if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timeout"))) {
    return "timeout";
  }
  const status =
    error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
  if (typeof status === "number") return `http_${status}`;
  return "unknown";
}

/** `[a-z0-9_]`, max 40 chars — a stable, loggable error class from an arbitrary ADK errorCode string. */
function sanitizeErrorCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 40);
}

function usageFrom(meta: GenerateContentResponseUsageMetadata | undefined): ProposalModelUsage {
  return {
    input_tokens: meta?.promptTokenCount ?? null,
    output_tokens: meta?.candidatesTokenCount ?? null,
    thoughts_tokens: meta?.thoughtsTokenCount ?? null,
  };
}

async function runOnce(
  input: { systemInstruction: string; userContent: string; responseJsonSchema: object },
  ctx: { project: string; location: string; timeoutMs: number },
): Promise<ProposalModelResult> {
  // Fails closed with the ProposalModel contract (never throws) — same
  // discipline as lib/pipeline/label/client.ts's project guard.
  if (!ctx.project) return { kind: "error", error_class: "no_project" };
  const model = getOrCreateModel(ctx.project, ctx.location);
  const agent = new LlmAgent({
    name: "proposal_agent",
    description: "Picks one SOP change from dated facts, a rubric and an intervention library.",
    model,
    // An InstructionProvider function, never a plain string (R-08.md §1: ADK
    // substitutes `{name}` from session state on a plain string; the
    // provider form avoids that even though this prompt has no braces).
    instruction: () => input.systemInstruction,
    generateContentConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseJsonSchema: input.responseJsonSchema,
      thinkingConfig: PROPOSAL_THINKING_CONFIG,
      abortSignal: AbortSignal.timeout(ctx.timeoutMs),
    },
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    // No `planner`: a planner's own thinkingConfig would override ours.
  });
  const runner = new InMemoryRunner({ agent, appName: "bee6-proposal" });

  let usage: ProposalModelUsage = { input_tokens: null, output_tokens: null, thoughts_tokens: null };

  try {
    for await (const ev of runner.runEphemeral({
      userId: "proposal",
      newMessage: { role: "user", parts: [{ text: input.userContent }] },
    })) {
      if (ev.usageMetadata) usage = usageFrom(ev.usageMetadata);
      if (ev.errorCode) {
        return { kind: "error", error_class: `adk_${sanitizeErrorCode(ev.errorCode)}` };
      }
      if (isFinalResponse(ev)) {
        // Thought parts are excluded even though `includeThoughts: false`
        // should stop them arriving: a thought part in the text breaks
        // JSON.parse and would be model reasoning, which is never stored.
        const text = (ev.content?.parts ?? [])
          .filter((p) => p.thought !== true)
          .map((p) => p.text ?? "")
          .join("");
        if (text.length === 0) return { kind: "error", error_class: "empty_response" };
        return { kind: "ok", text, usage };
      }
    }
    return { kind: "error", error_class: "empty_response" };
  } catch (error) {
    return { kind: "error", error_class: classifyError(error) };
  }
}

export const adkProposalModel: ProposalModel = async (input, ctx) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProposalModelResult>((resolve) => {
    // If ADK ignores the abort signal, this backstop still ends the call.
    timer = setTimeout(() => resolve({ kind: "error", error_class: "timeout" }), ctx.timeoutMs + 5000);
  });
  try {
    return await Promise.race([runOnce(input, ctx), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
