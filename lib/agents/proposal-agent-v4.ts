import { FunctionTool, InMemoryRunner, LlmAgent } from "@google/adk";
import { classifyAdkErrorEvent } from "@/lib/agents/adk-errors";
import {
  PROPOSAL_THINKING_CONFIG,
  classifyError,
  getOrCreateModel,
  type ProposalModelUsage,
} from "@/lib/agents/proposal-agent";
import { V4_MAX_MODEL_CALLS } from "@/lib/proposals/constants";
import type { V4Outcome, V4Session, V4ToolSpec, V4Trace } from "@/lib/proposals/v4/types";

/**
 * ProposalAgent v4 runner (R-24 slice B3, plan §3.5): the tool-using Proposal agent. ADK drives a tool loop over the
 * read-only tools in `lib/proposals/v4/tools.ts` (built by B2, this file never imports them); the run ends when
 * `check_proposal` accepts / blocks a draft or `decline` is called (`session.outcome`). Everything that decides is
 * plain code in those tools (hard rule 10); this file only runs the loop and reports what happened.
 *
 * Why it is written the way it is (all verified against `@google/adk` 2.2.1, plan §0.3 and the 16 Oct spike):
 *  - `runConfig` is a plain object: `createRunConfig` is not exported from the package root.
 *  - The timeout is a genai-level `generateContentConfig.abortSignal` ONLY. The signal is NEVER passed to
 *    `runEphemeral`: ADK returns silently, with no event, if that signal is aborted between responses.
 *  - ADK never throws a limit or an abort out of the generator: it yields an error EVENT. Those are classified by
 *    fixed literals (`classifyAdkErrorEvent`); `errorMessage` is matched and never logged, returned or stored.
 *  - Every model call yields its own usage: usage is SUMMED, not overwritten.
 *  - No `responseMimeType` / `responseJsonSchema` / `outputSchema` / planner: the structured output IS the
 *    `check_proposal` arguments (plan D2, §2.3).
 * Hard rules: Gemini on Vertex via ADK (1); no audio (2); the model location arrives from the caller, which reads
 * `config/regions.yaml` (5); nothing here logs prompt, tool or model text (the module logs nothing at all).
 */

export const PROPOSAL_AGENT_V4_VERSION = "proposal-v4";

/** `generator.v4.tool_calls` is capped at 40 entries in the stored schema (plan §3.7). */
const MAX_TRACED_TOOL_CALLS = 40;
const MAX_TOOL_NAME_CHARS = 40;
/** Extra wall time past `timeoutMs` before the backstop gives up on a runner that ignores the abort signal. */
const BACKSTOP_MARGIN_MS = 5000;

export type ProposalAgentV4Result =
  | { kind: "decided"; outcome: V4Outcome; usage: ProposalModelUsage; trace: V4Trace }
  // `usage` is present on errors too: a failed run still spent tokens (cost guards, CLAUDE.md §7).
  | { kind: "error"; error_class: string; usage: ProposalModelUsage; trace: V4Trace };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- specs are heterogeneous (one zod shape per tool)
export type V4RunnerToolSpec = V4ToolSpec<any>;

export type ProposalAgentV4 = (
  input: { systemInstruction: string; userContent: string; tools: V4RunnerToolSpec[]; session: V4Session },
  ctx: { project: string; location: string; timeoutMs: number },
) => Promise<ProposalAgentV4Result>;

/** A tool name is model output (it can be hallucinated): lowercase, `[^a-z0-9_]` -> `_`, max 40 chars, never empty. */
export function sanitiseToolName(name: string | undefined): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, MAX_TOOL_NAME_CHARS);
  return cleaned.length > 0 ? cleaned : "unknown";
}

type EndedBy = V4Trace["ended_by"];

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
  if (typeof add !== "number") return total;
  return (total ?? 0) + add;
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
    if (fc) {
      if (state.toolCalls.length < MAX_TRACED_TOOL_CALLS) {
        if (typeof fc.id === "string") state.callIndexById.set(fc.id, state.toolCalls.length);
        state.toolCalls.push({ name: sanitiseToolName(fc.name), ok: true });
      }
    }
    const fr = part.functionResponse;
    if (fr) {
      const resp = fr.response;
      const failed =
        typeof resp === "object" && resp !== null && typeof (resp as { error?: unknown }).error === "string";
      if (failed) {
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
  }
}

function snapshotTrace(state: RunState, session: V4Session, endedBy: EndedBy): V4Trace {
  return {
    model_calls: state.modelCalls,
    tool_calls: state.toolCalls.map((t) => ({ ...t })),
    check_rounds: session.checkRounds,
    ms: Math.max(0, Date.now() - state.startedAt),
    ended_by: endedBy,
  };
}

function usageOf(state: RunState): ProposalModelUsage {
  return { input_tokens: state.input, output_tokens: state.output, thoughts_tokens: state.thoughts };
}

/** An outcome set earlier always wins over a later limit / abort / error; otherwise the failure is typed. */
function resultOf(state: RunState, session: V4Session, endedBy: EndedBy, errorClass: string | null): ProposalAgentV4Result {
  const outcome = session.outcome;
  if (outcome) {
    return { kind: "decided", outcome, usage: usageOf(state), trace: snapshotTrace(state, session, endedBy) };
  }
  return {
    kind: "error",
    error_class: errorClass ?? "no_decision",
    usage: usageOf(state),
    trace: snapshotTrace(state, session, endedBy),
  };
}

async function runOnce(
  input: Parameters<ProposalAgentV4>[0],
  ctx: Parameters<ProposalAgentV4>[1],
  state: RunState,
): Promise<ProposalAgentV4Result> {
  const { session } = input;
  const model = getOrCreateModel(ctx.project, ctx.location);
  // The ONLY abort surface: a genai-level signal, which always ends as an error event. Never given to runEphemeral.
  const signal = AbortSignal.timeout(ctx.timeoutMs);
  const agent = new LlmAgent({
    name: "proposal_agent_v4",
    description: "Reads the SOP section, the evidence and the library with tools, then proposes one checked SOP change.",
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
    generateContentConfig: {
      temperature: 0.2,
      thinkingConfig: PROPOSAL_THINKING_CONFIG,
      abortSignal: signal,
    },
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    // No responseMimeType / responseJsonSchema / outputSchema and no planner (plan D2, §2.3).
  });
  const runner = new InMemoryRunner({ agent, appName: "bee6-proposal-v4" });

  try {
    for await (const ev of runner.runEphemeral({
      userId: "proposal",
      newMessage: { role: "user", parts: [{ text: input.userContent }] },
      // Plain object: `createRunConfig` is not exported from the package root (the runner applies it itself).
      runConfig: { maxLlmCalls: V4_MAX_MODEL_CALLS },
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

export const adkProposalAgentV4: ProposalAgentV4 = async (input, ctx) => {
  // Fails closed with the contract (never throws), same discipline as the v3 runner.
  if (!ctx.project) {
    const state = newRunState();
    return {
      kind: "error",
      error_class: "no_project",
      usage: usageOf(state),
      trace: snapshotTrace(state, input.session, "error"),
    };
  }
  const state = newRunState();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const backstop = new Promise<"backstop">((resolve) => {
    // If ADK ignores the abort signal, this still ends the call.
    timer = setTimeout(() => resolve("backstop"), ctx.timeoutMs + BACKSTOP_MARGIN_MS);
  });
  try {
    const raced = await Promise.race([runOnce(input, ctx, state), backstop]);
    if (raced === "backstop") return resultOf(state, input.session, "timeout", "backstop");
    return raced;
  } catch (error) {
    // runOnce handles loop throws itself; this covers construction (model / agent / runner) failures.
    const errorClass = classifyError(error);
    return resultOf(state, input.session, errorClass === "timeout" ? "timeout" : "error", errorClass);
  } finally {
    clearTimeout(timer);
  }
};
