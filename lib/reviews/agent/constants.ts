/**
 * ReviewAgent constants (docs/tasks/review-agent-18oct.md §5.2). Plain values, no logic, no I/O.
 *
 * The model is ONE constant: flash-lite by default (Rangga, 18 Oct); switch to `gemini-3.5-flash` here (and only
 * here) if the eval's E2 bar (>= 90 % accepted within two rounds with the verdict agreed) fails. The model's
 * location is NEVER a literal in this feature: callers read it from `config/regions.yaml` via
 * `getModelLocation(REVIEW_AGENT_MODEL)` (hard rule 5).
 */
export const REVIEW_AGENT_VERSION = "review-v1" as const;

/** The only two models a stored `agent.model` may name (the storage schema is an enum of exactly these). */
export const REVIEW_AGENT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"] as const;
export type ReviewAgentModel = (typeof REVIEW_AGENT_MODELS)[number];

export const REVIEW_AGENT_MODEL: ReviewAgentModel = "gemini-3.5-flash-lite";

export const REVIEW_AGENT_MAX_ROUNDS = 2;
/** ADK `runConfig.maxLlmCalls`: 4 reads + draft + 1 revise + stop, with margin. */
export const REVIEW_AGENT_MAX_MODEL_CALLS = 10;
/** genai `abortSignal` timeout per run. */
export const REVIEW_AGENT_TIMEOUT_MS = 20_000;
/** Extra wall time past the timeout before the backstop gives up on a runner that ignores the abort signal. */
export const REVIEW_AGENT_BACKSTOP_MARGIN_MS = 5_000;
export const REVIEW_NARRATIVE_MIN_CHARS = 60;
/** Code points; the storage bound is twice this. */
export const REVIEW_NARRATIVE_MAX_CHARS = 600;
export const REVIEW_SAMPLE_PER_WINDOW = 6;
export const REVIEW_SAMPLE_SUMMARY_MAX_CHARS = 200;
/**
 * Shown while the fast-forward runs (whole seconds). The usual-time range is measured (p50 about 4-5 s, p95 about
 * 8 s); `cap_s` is the hard wait cap, derived from the agent timeout so the copy can never drift from it.
 */
export const REVIEW_AGENT_ESTIMATE = { min_s: 5, max_s: 15, cap_s: REVIEW_AGENT_TIMEOUT_MS / 1000 } as const;
