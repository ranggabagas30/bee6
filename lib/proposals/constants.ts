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

/** Single-flight proposal generation lease, per outlet. */
export const PROPOSAL_LEASE_MS = 180_000;

export const MODEL_TIMEOUT_MS = 60_000;

export const PROPOSAL_GATE_VERSION = "pgate-v1" as const;
