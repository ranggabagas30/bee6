import { defaultAllowDraft, loadProposalLibrary, type ProposalLibrary } from "@/config/proposal-library";
import type { ReviewAgent } from "@/lib/agents/review-agent";
import type { SopVersion } from "@/lib/firestore/schema";
import { caveatContextOfInputs, checkReview, requiredCaveats } from "@/lib/reviews/agent/check";
import { REVIEW_AGENT_MODEL, REVIEW_AGENT_TIMEOUT_MS, REVIEW_AGENT_VERSION } from "@/lib/reviews/agent/constants";
import { buildReviewAgentInputs, type MeasuredWindow } from "@/lib/reviews/agent/inputs";
import { REVIEW_SYSTEM_INSTRUCTION, buildUserContent } from "@/lib/reviews/agent/prompt";
import { ReviewAgentStoredSchema, type ReviewAgentStored } from "@/lib/reviews/agent/schema";
import { buildReviewTools } from "@/lib/reviews/agent/tools";
import { newReviewAgentSession, type ReviewAgentInputs } from "@/lib/reviews/agent/types";
import type { Suggestion } from "@/lib/reviews/verdict";

/**
 * Runs the ReviewAgent for one review (docs/tasks/review-agent-18oct.md §5.11, D15/D16). NEVER throws: every
 * failure, decline, limit, timeout or a draft the final re-check refuses is `null`, and the caller then writes the
 * review exactly as it does without the agent (the plain-code card is the fallback).
 *
 * Hard rules: the runner is injected (`deps.run`) so this module imports no ADK; the model location is read by the
 * caller from `config/regions.yaml` (`resolveLocation`), never a literal here (5); text only (2); the one log line
 * carries counts and enums, never the narrative, a note, a name or a thread id (7).
 */

export interface ReviewAgentDeps {
  run: ReviewAgent;
  env: Record<string, string | undefined>;
  project: string;
  /** `(model) => getModelLocation(model).location`, supplied by the route. */
  resolveLocation: (model: string) => string;
  now_ms: number;
}

export type ReviewAgentLogOutcome = "accepted" | "rejected" | "declined" | "timeout" | "limit" | "error" | "no_decision";

export interface GenerateReviewAgentInput {
  deps: ReviewAgentDeps;
  outlet_id: string;
  sop: SopVersion;
  /** The source proposal's stored rationale (already redacted). */
  rationale: string;
  before: MeasuredWindow;
  after: MeasuredWindow;
  notices: ReviewAgentInputs["notices"];
  suggestion: Suggestion;
  staffNames: readonly string[];
  /** Test seam; the default reads `config/` like the proposal routes do. */
  loadLibrary?: () => ProposalLibrary;
}

interface LogLine {
  outcome: ReviewAgentLogOutcome;
  reason?: string;
  rounds: number;
  model_calls: number;
  ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  thoughts_tokens: number | null;
}

const EMPTY_LIBRARY: ProposalLibrary = {
  interventions: { version: 0, entries: [] },
  rubric: { version: 0, entries: [] },
  draft: true,
};

function libraryOf(input: GenerateReviewAgentInput): ProposalLibrary {
  try {
    return (input.loadLibrary ?? (() => loadProposalLibrary({ allowDraft: defaultAllowDraft() })))();
  } catch {
    // The intervention label is context only; `buildReviewAgentInputs` falls back to the id when it is unknown.
    return EMPTY_LIBRARY;
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)));

export async function generateReviewAgent(input: GenerateReviewAgentInput): Promise<ReviewAgentStored | null> {
  const { deps, outlet_id, sop } = input;
  const started = Date.now();
  const version = sop.version;
  const log = (line: LogLine): void => {
    console.info("[review] agent", { outlet_id, version, ...line });
  };
  try {
    const inputs = buildReviewAgentInputs({
      sop,
      rationale: input.rationale,
      library: libraryOf(input),
      before: input.before,
      after: input.after,
      notices: input.notices,
      suggestion: input.suggestion,
      staffNames: input.staffNames,
    });
    const session = newReviewAgentSession();
    const tools = buildReviewTools(inputs, session);
    const location = deps.resolveLocation(REVIEW_AGENT_MODEL);

    const result = await deps.run(
      { systemInstruction: REVIEW_SYSTEM_INSTRUCTION, userContent: buildUserContent(inputs), tools, session },
      { project: deps.project, location, timeoutMs: REVIEW_AGENT_TIMEOUT_MS },
    );
    const base = {
      rounds: session.checkRounds,
      model_calls: result.trace.model_calls,
      ms: Math.max(0, Date.now() - started),
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      thoughts_tokens: result.usage.thoughts_tokens,
    };

    if (result.kind === "error") {
      const outcome: ReviewAgentLogOutcome =
        result.error_class === "timeout" || result.error_class === "backstop"
          ? "timeout"
          : result.error_class === "limit"
            ? "limit"
            : result.error_class === "no_decision"
              ? "no_decision"
              : "error";
      log({ ...base, outcome, ...(outcome === "error" ? { reason: result.error_class } : {}) });
      return null;
    }

    const outcome = result.outcome;
    if (!outcome) {
      // The runner contract says a decided run has an outcome; fail closed if one ever does not.
      log({ ...base, outcome: "no_decision" });
      return null;
    }
    if (outcome.kind === "declined") {
      log({ ...base, outcome: "declined", reason: outcome.reason });
      return null;
    }
    if (outcome.kind === "rejected") {
      log({ ...base, outcome: "rejected", reason: outcome.reasons.join(",") });
      return null;
    }

    // Defence in depth: the only acceptor of the narrative runs once more on the very draft that will be stored.
    const recheck = checkReview(outcome.draft, { inputs, session });
    if (!recheck.passed) {
      log({ ...base, outcome: "rejected", reason: recheck.reasons.join(",") });
      return null;
    }
    const stored = ReviewAgentStoredSchema.safeParse({
      version: REVIEW_AGENT_VERSION,
      model: REVIEW_AGENT_MODEL,
      narrative_en: outcome.draft.narrative_en.trim(),
      suggested_verdict: outcome.draft.suggested_verdict,
      caveats: requiredCaveats(caveatContextOfInputs(inputs)),
      rounds: clamp(session.checkRounds, 1, 2),
      model_calls: clamp(result.trace.model_calls, 0, 40),
      generated_at_ms: deps.now_ms,
    });
    if (!stored.success) {
      log({ ...base, outcome: "error", reason: "stored_shape" });
      return null;
    }
    log({ ...base, outcome: "accepted" });
    return stored.data;
  } catch (error) {
    // Class only: an error message from the model client or a store could carry shop text.
    console.error("[review] agent failed", { outlet_id, version, error_class: error instanceof Error ? error.constructor.name : "unknown" });
    return null;
  }
}
