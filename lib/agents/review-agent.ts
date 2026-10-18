import { FunctionTool, Gemini, InMemoryRunner, LlmAgent, LogLevel, setLogLevel } from "@google/adk";
import { classifyAdkErrorEvent } from "@/lib/agents/adk-errors";
import { PROPOSAL_THINKING_CONFIG, classifyError, type ProposalModelUsage } from "@/lib/agents/proposal-agent";
import { sanitiseToolName } from "@/lib/agents/proposal-agent-v4";
import {
  REVIEW_AGENT_BACKSTOP_MARGIN_MS,
  REVIEW_AGENT_MAX_MODEL_CALLS,
  REVIEW_AGENT_MODEL,
} from "@/lib/reviews/agent/constants";
import type { ReviewAgentOutcome, ReviewAgentSession, ReviewToolSpec, ReviewTrace } from "@/lib/reviews/agent/types";

/**
 * ReviewAgent runner (docs/tasks/review-agent-18oct.md §5.10, option B): an ADK `LlmAgent` that reads the change,
 * the counts and a sample of the notes with read-only tools (`lib/reviews/agent/tools.ts`, built elsewhere; this file
 * never imports them), then submits its narrative to `check_review`. The run ends when `check_review` accepts /
 * rejects (2nd failed round) or `decline` is called (`session.outcome`). Everything that decides is plain code in
 * those tools (hard rule 10); this file only runs the loop and reports what happened.
 *
 * Built exactly as `proposal-agent-v4.ts` and `debrief-agent.ts` proved against `@google/adk` 2.2.1 (do not bump):
 *  - `runConfig` is a plain object (`createRunConfig` is not exported from the package root).
 *  - The timeout is a genai-level `generateContentConfig.abortSignal` ONLY, never passed to `runEphemeral` (ADK
 *    returns silently, with no event, if that signal is aborted between responses).
 *  - ADK never throws a limit or an abort out of the generator: it yields an error EVENT, classified by fixed
 *    literals (`classifyAdkErrorEvent`); `errorMessage` is matched and never logged, returned or stored.
 *  - Each model call yields its own usage: usage is SUMMED.
 *  - No `responseMimeType` / `responseJsonSchema` / `outputSchema` / planner: the structured output IS the
 *    `check_review` arguments.
 * Hard rules: Gemini on Vertex via ADK (1); text only (2); the model location arrives from the caller, which reads
 * `config/regions.yaml` via `getModelLocation(REVIEW_AGENT_MODEL)` (5); no staff name, role or id in the prompt or the
 * result (7). This module logs NOTHING: the result carries counts and enums only. The caller never sees a throw.
 */

/** Explicit (idempotent) in addition to the import side effect of the proposal module: ADK stays quiet at ERROR. */
setLogLevel(LogLevel.ERROR);

/** `reviews/{id}.agent.model_calls` is capped at 40 and the trace at 40 tool calls (stored schema limits). */
const MAX_TRACED_TOOL_CALLS = 40;

export type ReviewAgentResult =
  | { kind: "decided"; outcome: ReviewAgentOutcome; usage: ProposalModelUsage; trace: ReviewTrace }
  // `usage` is present on errors too: a failed run still spent tokens (cost guards, CLAUDE.md §7).
  | { kind: "error"; error_class: string; usage: ProposalModelUsage; trace: ReviewTrace };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- specs are heterogeneous (one zod shape per tool)
export type ReviewRunnerToolSpec = ReviewToolSpec<any>;

export type ReviewAgent = (
  input: { systemInstruction: string; userContent: string; tools: ReviewRunnerToolSpec[]; session: ReviewAgentSession },
  ctx: { project: string; location: string; timeoutMs: number },
) => Promise<ReviewAgentResult>;

type EndedBy = ReviewTrace["ended_by"];

/** Mutable state of one run, shared with the backstop so it can snapshot a run that never finishes. */
interface RunState {
  startedAt: number;
  modelCalls: number;
  input: number | null;
  output: number | null;
  thoughts: number | null;
  toolCalls: { name: string; ok: boolean }[];
  callIndexById: Map<string, number>;
  endedBy: EndedBy;
  errorClass: string | null;
}

function newRunState(): RunState {
  return {
    startedAt: Date.now(),
    modelCalls: 0,
    input: null,
    output: null,
    thoughts: null,
    toolCalls: [],
    callIndexById: new Map(),
    endedBy: "model_done",
    errorClass: null,
  };
}

function addTokens(total: number | null, add: number | undefined | null): number | null {
  return typeof add === "number" ? (total ?? 0) + add : total;
}

/** The slice of an ADK event this runner reads. Structural, so the runner reads parts directly. */
interface RunnerEvent {
  errorCode?: string;
  errorMessage?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  content?: {
    parts?: {
      functionCall?: { id?: string; name?: string };
      functionResponse?: { id?: string; name?: string; response?: unknown };
    }[];
  };
}

function recordEvent(state: RunState, ev: RunnerEvent): void {
  if (ev.usageMetadata) {
    state.modelCalls += 1;
    state.input = addTokens(state.input, ev.usageMetadata.promptTokenCount);
    state.output = addTokens(state.output, ev.usageMetadata.candidatesTokenCount);
    state.thoughts = addTokens(state.thoughts, ev.usageMetadata.thoughtsTokenCount);
  }
  for (const part of ev.content?.parts ?? []) {
    const fc = part.functionCall;
    if (fc && state.toolCalls.length < MAX_TRACED_TOOL_CALLS) {
      if (typeof fc.id === "string") state.callIndexById.set(fc.id, state.toolCalls.length);
      state.toolCalls.push({ name: sanitiseToolName(fc.name), ok: true });
    }
    const fr = part.functionResponse;
    if (!fr) continue;
    const resp = fr.response;
    const failed = typeof resp === "object" && resp !== null && typeof (resp as { error?: unknown }).error === "string";
    if (!failed) continue;
    let idx = typeof fr.id === "string" ? state.callIndexById.get(fr.id) : undefined;
    if (idx === undefined) {
      // No usable id: fall back to the latest still-ok call with the same (sanitised) name.
      const name = sanitiseToolName(fr.name);
      for (let i = state.toolCalls.length - 1; i >= 0; i--) {
        if (state.toolCalls[i]!.name === name && state.toolCalls[i]!.ok) {
          idx = i;
          break;
        }
      }
    }
    if (idx !== undefined) state.toolCalls[idx] = { ...state.toolCalls[idx]!, ok: false };
  }
}

function usageOf(state: RunState): ProposalModelUsage {
  return { input_tokens: state.input, output_tokens: state.output, thoughts_tokens: state.thoughts };
}

function snapshotTrace(state: RunState, session: ReviewAgentSession, endedBy: EndedBy): ReviewTrace {
  return {
    model_calls: state.modelCalls,
    tool_calls: state.toolCalls.map((t) => ({ ...t })),
    check_rounds: session.checkRounds,
    ms: Math.max(0, Date.now() - state.startedAt),
    ended_by: endedBy,
  };
}

/** An outcome set earlier always wins over a later limit / abort / error; otherwise the failure is typed. */
function resultOf(state: RunState, session: ReviewAgentSession, endedBy: EndedBy, errorClass: string | null): ReviewAgentResult {
  const trace = snapshotTrace(state, session, endedBy);
  if (session.outcome) return { kind: "decided", outcome: session.outcome, usage: usageOf(state), trace };
  return { kind: "error", error_class: errorClass ?? "no_decision", usage: usageOf(state), trace };
}

let cachedModel: Gemini | null = null;
let cachedModelKey: string | null = null;

/** Own cache: `getOrCreateModel` in proposal-agent.ts is pinned to the Proposal model (flash). */
function getOrCreateReviewModel(project: string, location: string): Gemini {
  const key = `${project}::${location}::${REVIEW_AGENT_MODEL}`;
  if (cachedModel && cachedModelKey === key) return cachedModel;
  cachedModel = new Gemini({ model: REVIEW_AGENT_MODEL, vertexai: true, project, location });
  cachedModelKey = key;
  return cachedModel;
}

async function runOnce(
  input: Parameters<ReviewAgent>[0],
  ctx: Parameters<ReviewAgent>[1],
  state: RunState,
): Promise<ReviewAgentResult> {
  const { session } = input;
  const model = getOrCreateReviewModel(ctx.project, ctx.location);
  // The ONLY abort surface: a genai-level signal, which always ends as an error event. Never given to runEphemeral.
  const signal = AbortSignal.timeout(ctx.timeoutMs);
  const agent = new LlmAgent({
    name: "review_agent",
    description: "Explains the before/after counts of one SOP change and suggests the verdict the rule implies.",
    model,
    // An InstructionProvider function, never a plain string (ADK substitutes `{name}` in a plain string).
    instruction: () => input.systemInstruction,
    tools: input.tools.map(
      (spec) =>
        new FunctionTool({
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
          execute: spec.execute,
        }),
    ),
    generateContentConfig: { temperature: 0.2, thinkingConfig: PROPOSAL_THINKING_CONFIG, abortSignal: signal },
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    // No responseMimeType / responseJsonSchema / outputSchema and no planner: the tool arguments ARE the output.
  });
  const runner = new InMemoryRunner({ agent, appName: "bee6-review" });

  try {
    for await (const ev of runner.runEphemeral({
      userId: "review",
      newMessage: { role: "user", parts: [{ text: input.userContent }] },
      // Plain object: `createRunConfig` is not exported from the package root (the runner applies it itself).
      runConfig: { maxLlmCalls: REVIEW_AGENT_MAX_MODEL_CALLS },
    }) as AsyncIterable<RunnerEvent>) {
      recordEvent(state, ev);
      if (ev.errorCode) {
        // ADK yields limit / abort / HTTP errors as an event; it is terminal for us. The message is only matched.
        const cls = classifyAdkErrorEvent(ev.errorCode, ev.errorMessage);
        state.endedBy = cls.ended_by;
        state.errorClass = cls.error_class;
        break;
      }
      if (session.outcome) {
        // Decided: skip the model's trailing "DONE" turn (saves ~1 s and one model call).
        state.endedBy = "decided";
        break;
      }
    }
  } catch (error) {
    // Anything that still throws (transport before the first event). Class only, never the message.
    const errorClass = classifyError(error);
    state.endedBy = errorClass === "timeout" ? "timeout" : "error";
    state.errorClass = errorClass;
    return resultOf(state, session, state.endedBy, errorClass);
  }

  if (!state.errorClass) {
    // The generator ended on its own. An outcome set meanwhile is a decision; otherwise a silent abort (ADK returns
    // with no event) is told by the signal, not the events.
    if (session.outcome) {
      state.endedBy = "decided";
    } else if (signal.aborted) {
      state.endedBy = "timeout";
      state.errorClass = "timeout";
    } else {
      state.endedBy = "model_done";
      state.errorClass = "no_decision";
    }
  }
  return resultOf(state, session, state.endedBy, state.errorClass);
}

export const adkReviewAgent: ReviewAgent = async (input, ctx) => {
  const state = newRunState();
  // Fails closed with the contract (never throws), same discipline as the Proposal runners.
  if (!ctx.project) return resultOf(state, input.session, "error", "no_project");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const backstop = new Promise<"backstop">((resolve) => {
    // If ADK ignores the abort signal, this still ends the call.
    timer = setTimeout(() => resolve("backstop"), ctx.timeoutMs + REVIEW_AGENT_BACKSTOP_MARGIN_MS);
  });
  try {
    const raced = await Promise.race([runOnce(input, ctx, state), backstop]);
    return raced === "backstop" ? resultOf(state, input.session, "timeout", "backstop") : raced;
  } catch (error) {
    // runOnce handles loop throws itself; this covers construction (model / agent / runner) failures.
    const errorClass = classifyError(error);
    return resultOf(state, input.session, errorClass === "timeout" ? "timeout" : "error", errorClass);
  } finally {
    clearTimeout(timer);
  }
};
