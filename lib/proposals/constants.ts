import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Thresholds and caps for the ProposalAgent (R-08). Plain code, not AI
 * (hard rule #10) — these numbers decide what reaches the model and what
 * the gate accepts, never the model itself.
 */

/** `evidence` rule (technical spec §8.15): >= 2 facts on >= 2 distinct dates, inside ONE category (floor-v2). */
export const MIN_EVIDENCE_FACTS = 2;
export const MIN_EVIDENCE_DATES = 2;

/**
 * R-19 D-3 (product rule, pilot and demo alike): categories that never count as proposal evidence.
 * The evidence gate itself (`lib/pipeline/gate.ts`) is unchanged: a ROUTINE_OPS thread still becomes a
 * fact or a question by the same rules; it simply never reaches a proposal.
 */
export const EVIDENCE_EXCLUDED: ReadonlySet<WorkCategory> = new Set<WorkCategory>(["ROUTINE_OPS"]);

/** The evidence-floor rule written on every proposal doc made after R-19 (`generator.floor_version`). */
export const FLOOR_VERSION = "floor-v2" as const;

/** suff-v1 `range_valid`: at most 14 days in one generate call. */
export const MAX_RANGE_DAYS = 14;

/** Token budget: only the most recent candidates are offered to the model. */
export const MAX_CANDIDATES_IN_PROMPT = 80;

/** Defensive cap on one range read; more than this is truncated and logged. */
export const MAX_THREADS_READ = 5000;

export const MAX_CONSTRAINTS = 200;

export const MAX_CITED_EVIDENCE = 10;

export const REVIEW_AFTER_DAYS_MIN = 7;
export const REVIEW_AFTER_DAYS_MAX = 28;

/** R-20: per-fact quote of the thread's own (scrubbed, redacted) lines offered to the Proposal agent. Code points. */
export const FACT_EXCERPT_MAX_CHARS = 320;

/** R-20: per-fact staff debrief note (corrections.reason_text, already scrubbed + redacted). Code points. */
export const FACT_REASON_MAX_CHARS = 200;

/** R-20: an Ask tries at most this many READY focus categories when the model declines the first. */
export const MAX_FOCUS_PER_ASK = 2;

/**
 * Single-flight proposal generation lease, per outlet. Must outlast the worst-case Ask: up to
 * `MAX_FOCUS_PER_ASK` focuses x (a model call raced at `MODEL_TIMEOUT_MS` + 5 s, then a slow decline) = 260 s,
 * so an expired lease can never let a second Ask commit a duplicate doc. Fits Cloud Run's 300 s request timeout.
 */
export const PROPOSAL_LEASE_MS = 300_000;

export const MODEL_TIMEOUT_MS = 60_000;

export const PROPOSAL_GATE_VERSION = "pgate-v1" as const;

/** R-24: the v4 (tool-using) Proposal agent. */
export const PROPOSAL_CHECK_VERSION = "pcheck-v4" as const;
export const V4_MAX_CHECK_ROUNDS = 3;
/** ADK `RunConfig.maxLlmCalls`; spike: plain max 8, one revise round max 11; 3 rounds ~ 12. */
export const V4_MAX_MODEL_CALLS = 14;
/** One v4 run (wall): `generateContentConfig.abortSignal` + a `Promise.race` backstop (+5 s). Spike S5: 3 rounds ~ 38 s. */
export const V4_TIMEOUT_MS = 45_000;
/** A focus runs v4 only if `(now - askStart) + V4_TIMEOUT_MS + 65_000 <= this`; both focuses fit the 300 s lease. */
export const V4_ASK_BUDGET_MS = 270_000;
export const V4_QUOTE_MIN_CHARS = 8;
export const V4_QUOTE_MAX_CHARS = 160;
/** Minimum token length on both sides of the `scope_unsupported` rule; 3 so "Ube" counts (D15). */
export const V4_SCOPE_TOKEN_MIN = 3;
/** Words that never make a section "distinctive" (short English and Indonesian function words included, D15). */
export const V4_SCOPE_STOP_WORDS: ReadonlySet<string> = new Set([
  "step", "steps", "check", "shop", "staff", "customer", "order",
  "and", "the", "for", "with", "into", "from", "out", "off", "put", "set", "all", "per", "then", "each",
  "dan", "yang", "dari", "untuk", "lalu", "ke", "di", "ini", "itu",
]);
