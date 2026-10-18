import { FunctionTool, Gemini, InMemoryRunner, LlmAgent, LogLevel, setLogLevel } from "@google/adk";
import { ThinkingLevel } from "@google/genai";
import { classifyAdkErrorEvent } from "@/lib/agents/adk-errors";
import { classifyError, type ProposalModelUsage } from "@/lib/agents/proposal-agent";
import {
  DEBRIEF_AGENT_BACKSTOP_MARGIN_MS,
  DEBRIEF_AGENT_MAX_MODEL_CALLS,
  DEBRIEF_AGENT_MAX_ROUNDS,
  DEBRIEF_AGENT_MODEL,
} from "@/lib/debrief/agent/constants";
import { CHECK_RULES, checkQuestion, type CheckRule } from "@/lib/debrief/agent/check";
import { buildUserContent, DEBRIEF_SYSTEM_INSTRUCTION } from "@/lib/debrief/agent/prompt";
import {
  DebriefQuestionArgsSchema,
  DebriefQuestionDraftSchema,
  type DebriefQuestionDraft,
} from "@/lib/debrief/agent/schema";
import type { DebriefQuestionMoment } from "@/lib/debrief/agent/types";

/**
 * DebriefAgent runner (docs/tasks/debrief-agent-18oct.md §5.3, option B): an ADK `LlmAgent` with EXACTLY ONE tool,
 * `check_question`. The tool's ARGUMENTS are the structured output (no `responseJsonSchema`, no `outputSchema`, no
 * planner); the tool is the plain-code checker (`checkQuestion`, hard rule 10), so the model can only ever produce
 * wording the code accepts. The run ends as soon as the tool accepts, or on the 2nd failed round
 * (`session.outcome`); everything else (limit, abort, ADK error, no decision) is a typed `error` and the caller keeps
 * the deterministic template.
 *
 * Built exactly as `proposal-agent-v4.ts` proved against `@google/adk` 2.2.1 (do not bump it):
 *  - `runConfig` is a plain object (`createRunConfig` is not exported from the package root).
 *  - The timeout is a genai-level `generateContentConfig.abortSignal` ONLY, never passed to `runEphemeral` (ADK
 *    returns silently, with no event, if that signal is aborted between responses).
 *  - ADK never throws a limit or an abort out of the generator: it yields an error EVENT, classified by fixed
 *    literals (`classifyAdkErrorEvent`); `errorMessage` is matched and never logged, returned or stored.
 *  - Each model call yields its own usage: usage is SUMMED.
 * Hard rules: Gemini on Vertex via ADK (1); text only (2); the model location arrives from the caller, which reads
 * `config/regions.yaml` via `getModelLocation(DEBRIEF_AGENT_MODEL)` (5); no staff name, role or id in the prompt or
 * the result (7). This module logs NOTHING: the result carries counts and enums only.
 */

/** Explicit (idempotent) in addition to the import side effect of the proposal module: ADK stays quiet at ERROR. */
setLogLevel(LogLevel.ERROR);

/** Same cap as the Proposal agent: LOW thinking, thought text never comes back (`includeThoughts: false`). */
export const DEBRIEF_THINKING_CONFIG = { thinkingLevel: ThinkingLevel.LOW, includeThoughts: false } as const;

export type DebriefAgentResult =
  | { kind: "accepted"; draft: DebriefQuestionDraft; rounds: number; usage: ProposalModelUsage; model_calls: number; ms: number }
  | { kind: "rejected"; reasons: CheckRule[]; rounds: number; usage: ProposalModelUsage; model_calls: number; ms: number }
  // `usage` is present on errors too: a failed run still spent tokens (cost guards, CLAUDE.md §7).
  | { kind: "error"; error_class: string; usage: ProposalModelUsage; model_calls: number; ms: number };

export interface DebriefAgentInput {
  moment: DebriefQuestionMoment;
  /** The tick's staff scrub names, for the checker's `staff_name` rule. Never sent to the model. */
  staffNames: readonly string[];
  outletName?: string;
}

export interface DebriefAgentContext {
  project: string;
  /** From `config/regions.yaml` (`getModelLocation(DEBRIEF_AGENT_MODEL)`); never a literal in this file. */
  location: string;
  timeoutMs: number;
}

/** Never throws (contract like the Proposal runners). */
export type DebriefAgent = (input: DebriefAgentInput, ctx: DebriefAgentContext) => Promise<DebriefAgentResult>;

const RUN_DECIDED_ERROR = "run already decided";

const CHECK_QUESTION_DESCRIPTION =
  "Submit the question to the plain-code checker. It answers accepted, or a list of failed rule codes to fix: " +
  CHECK_RULES.filter((rule) => rule !== "schema_invalid").join(", ") +
  ". Fix exactly those reasons and submit again. At most " +
  DEBRIEF_AGENT_MAX_ROUNDS +
  " submissions count.";

/** What the checker decided; set by the tool, read by the runner. */
type Outcome =
  | { kind: "accepted"; draft: DebriefQuestionDraft }
  | { kind: "rejected"; reasons: CheckRule[] };

interface Session {
  rounds: number;
  outcome: Outcome | null;
}

/** Mutable state of one run, shared with the backstop so it can snapshot a run that never finishes. */
interface RunState {
  startedAt: number;
  modelCalls: number;
  input: number | null;
  output: number | null;
  thoughts: number | null;
  errorClass: string | null;
}

function newRunState(): RunState {
  return { startedAt: Date.now(), modelCalls: 0, input: null, output: null, thoughts: null, errorClass: null };
}

function addTokens(total: number | null, add: number | undefined | null): number | null {
  return typeof add === "number" ? (total ?? 0) + add : total;
}

/** The slice of an ADK event this runner reads. */
interface RunnerEvent {
  errorCode?: string;
  errorMessage?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

function recordEvent(state: RunState, ev: RunnerEvent): void {
  if (!ev.usageMetadata) return;
  state.modelCalls += 1;
  state.input = addTokens(state.input, ev.usageMetadata.promptTokenCount);
  state.output = addTokens(state.output, ev.usageMetadata.candidatesTokenCount);
  state.thoughts = addTokens(state.thoughts, ev.usageMetadata.thoughtsTokenCount);
}

function usageOf(state: RunState): ProposalModelUsage {
  return { input_tokens: state.input, output_tokens: state.output, thoughts_tokens: state.thoughts };
}

/** An outcome set earlier always wins over a later limit / abort / error; otherwise the failure is typed. */
function resultOf(state: RunState, session: Session, errorClass: string | null): DebriefAgentResult {
  const common = { usage: usageOf(state), model_calls: state.modelCalls, ms: Math.max(0, Date.now() - state.startedAt) };
  const outcome = session.outcome;
  if (outcome?.kind === "accepted") return { kind: "accepted", draft: outcome.draft, rounds: session.rounds, ...common };
  if (outcome?.kind === "rejected") return { kind: "rejected", reasons: outcome.reasons, rounds: session.rounds, ...common };
  return { kind: "error", error_class: errorClass ?? "no_decision", ...common };
}

/** The single tool. Returns fixed literals only (never the draft or the shop's text) so the model cannot be fed shop text back. */
function buildCheckQuestionTool(input: DebriefAgentInput, session: Session): FunctionTool {
  return new FunctionTool({
    name: "check_question",
    description: CHECK_QUESTION_DESCRIPTION,
    parameters: DebriefQuestionArgsSchema,
    execute: (args: unknown) => {
      if (session.outcome) return { error: RUN_DECIDED_ERROR };
      // Defence in depth: ADK already parsed `args` with the same schema. A malformed call is NOT a round.
      const parsed = DebriefQuestionArgsSchema.safeParse(args);
      if (!parsed.success) return { accepted: false, reasons: ["schema_invalid"] satisfies CheckRule[] };

      const result = checkQuestion(parsed.data, {
        moment: input.moment,
        staffNames: input.staffNames,
        ...(input.outletName === undefined ? {} : { outletName: input.outletName }),
      });
      session.rounds += 1;
      if (result.passed) {
        // A passing draft satisfies the 20..140 draft schema on its trimmed text by construction of the checker.
        const draft = DebriefQuestionDraftSchema.safeParse({ question_en: parsed.data.question_en.trim() });
        if (draft.success) {
          session.outcome = { kind: "accepted", draft: draft.data };
          return { accepted: true };
        }
        // Unreachable while the checker enforces the same bounds; fail closed rather than trust it.
        session.outcome = { kind: "rejected", reasons: ["schema_invalid"] };
        return { accepted: false, final: true, reasons: ["schema_invalid"] satisfies CheckRule[] };
      }
      const final = session.rounds >= DEBRIEF_AGENT_MAX_ROUNDS;
      if (final) {
        session.outcome = { kind: "rejected", reasons: result.reasons };
        return { accepted: false, final: true, reasons: result.reasons };
      }
      return {
        accepted: false,
        round: session.rounds,
        rounds_left: DEBRIEF_AGENT_MAX_ROUNDS - session.rounds,
        reasons: result.reasons,
      };
    },
  });
}

let cachedModel: Gemini | null = null;
let cachedModelKey: string | null = null;

/** Own cache: `getOrCreateModel` in proposal-agent.ts is pinned to the Proposal model. */
function getOrCreateDebriefModel(project: string, location: string): Gemini {
  const key = `${project}::${location}::${DEBRIEF_AGENT_MODEL}`;
  if (cachedModel && cachedModelKey === key) return cachedModel;
  cachedModel = new Gemini({ model: DEBRIEF_AGENT_MODEL, vertexai: true, project, location });
  cachedModelKey = key;
  return cachedModel;
}

async function runOnce(
  input: DebriefAgentInput,
  ctx: DebriefAgentContext,
  state: RunState,
  session: Session,
): Promise<DebriefAgentResult> {
  const model = getOrCreateDebriefModel(ctx.project, ctx.location);
  // The ONLY abort surface: a genai-level signal, which always ends as an error event. Never given to runEphemeral.
  const signal = AbortSignal.timeout(ctx.timeoutMs);
  const agent = new LlmAgent({
    name: "debrief_agent",
    description: "Words one yes/no debrief question for a flagged moment.",
    model,
    // An InstructionProvider function, never a plain string (ADK substitutes `{name}` in a plain string).
    instruction: () => DEBRIEF_SYSTEM_INSTRUCTION,
    tools: [buildCheckQuestionTool(input, session)],
    generateContentConfig: { temperature: 0.3, thinkingConfig: DEBRIEF_THINKING_CONFIG, abortSignal: signal },
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    // No responseMimeType / responseJsonSchema / outputSchema and no planner: the tool arguments ARE the output.
  });
  const runner = new InMemoryRunner({ agent, appName: "bee6-debrief-q" });

  try {
    for await (const ev of runner.runEphemeral({
      userId: "debrief",
      newMessage: { role: "user", parts: [{ text: buildUserContent(input.moment) }] },
      // Plain object: `createRunConfig` is not exported from the package root (the runner applies it itself).
      runConfig: { maxLlmCalls: DEBRIEF_AGENT_MAX_MODEL_CALLS },
    }) as AsyncIterable<RunnerEvent>) {
      recordEvent(state, ev);
      if (ev.errorCode) {
        // ADK yields limit / abort / HTTP errors as an event; it is terminal for us. The message is only matched.
        state.errorClass = classifyAdkErrorEvent(ev.errorCode, ev.errorMessage).error_class;
        break;
      }
      // Decided: skip the model's trailing "DONE" turn (saves ~1 s and one model call).
      if (session.outcome) break;
    }
  } catch (error) {
    // Anything that still throws (transport before the first event). Class only, never the message.
    state.errorClass = classifyError(error);
    return resultOf(state, session, state.errorClass);
  }

  if (!state.errorClass && !session.outcome) {
    // The generator ended on its own with no decision. A silent abort (ADK returns with no event) is told by the
    // signal, not the events.
    state.errorClass = signal.aborted ? "timeout" : "no_decision";
  }
  return resultOf(state, session, state.errorClass);
}

export const adkDebriefAgent: DebriefAgent = async (input, ctx) => {
  const state = newRunState();
  const session: Session = { rounds: 0, outcome: null };
  // Fails closed with the contract (never throws), same discipline as the Proposal runners.
  if (!ctx.project) return resultOf(state, session, "no_project");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const backstop = new Promise<"backstop">((resolve) => {
    // If ADK ignores the abort signal, this still ends the call.
    timer = setTimeout(() => resolve("backstop"), ctx.timeoutMs + DEBRIEF_AGENT_BACKSTOP_MARGIN_MS);
  });
  try {
    const raced = await Promise.race([runOnce(input, ctx, state, session), backstop]);
    return raced === "backstop" ? resultOf(state, session, "backstop") : raced;
  } catch (error) {
    // runOnce handles loop throws itself; this covers construction (model / agent / runner) failures.
    return resultOf(state, session, classifyError(error));
  } finally {
    clearTimeout(timer);
  }
};
