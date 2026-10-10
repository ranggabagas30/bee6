/**
 * Thresholds and caps for the ProposalAgent (R-08). Plain code, not AI
 * (hard rule #10) — these numbers decide what reaches the model and what
 * the gate accepts, never the model itself.
 */

/** suff-v1 `evidence` rule (technical spec §8.15): >= 2 facts on >= 2 distinct dates. */
export const MIN_EVIDENCE_FACTS = 2;
export const MIN_EVIDENCE_DATES = 2;

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

/** Single-flight proposal generation lease, per outlet. */
export const PROPOSAL_LEASE_MS = 180_000;

export const MODEL_TIMEOUT_MS = 60_000;

export const PROPOSAL_GATE_VERSION = "pgate-v1" as const;
