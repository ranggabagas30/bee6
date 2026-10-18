import { scrubQuestionLine, stripInvisibleChars } from "@/lib/debrief/question-line";
import type { Review, SuggestionReason } from "@/lib/firestore/schema";
import { ALWAYS_QUESTION, NEEDS_SUPERVISOR_CONFIRM, type WorkCategory } from "@/lib/pipeline/categories";
import {
  REVIEW_NARRATIVE_MAX_CHARS,
  REVIEW_NARRATIVE_MIN_CHARS,
} from "@/lib/reviews/agent/constants";
import { REVIEW_CAVEATS, ReviewDraftArgsSchema, type ReviewCaveat } from "@/lib/reviews/agent/schema";
import type { ReviewAgentInputs, ReviewAgentSession } from "@/lib/reviews/agent/types";
import { rate } from "@/lib/reviews/metric";

/**
 * `check_review`: the plain-code checker behind the ReviewAgent (docs/tasks/review-agent-18oct.md §6).
 *
 * It is the ONLY thing that decides whether the agent's narrative is used (hard rule 10 applied to the wording):
 * pure, synchronous, no I/O, no model. The tool the model calls and the service's final re-check share this one
 * function. Every failing rule is collected, in `REVIEW_CHECK_RULES` order; `schema_invalid` short-circuits. The
 * reasons are fixed literals, never shop text, so they are safe to hand back to the model and to log.
 */

export const REVIEW_CHECK_RULES = [
  "schema_invalid",
  "change_not_inspected",
  "counts_not_inspected",
  "sample_not_inspected",
  "verdict_mismatch",
  "number_not_allowed",
  "quoted_numbers_mismatch",
  "caveat_missing",
  "caveat_not_applicable",
  "too_short",
  "too_long",
  "control_chars",
  "placeholder",
  "url_or_handle",
  "date_or_time",
  "staff_name",
  "role_or_person",
  "instruction_word",
  "causal_claim",
] as const;
export type ReviewCheckRule = (typeof REVIEW_CHECK_RULES)[number];

// ── numbers shared with the tools ────────────────────────────────────────────

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** `rate()` rounded to 2 dp, or null when no day was captured. */
export function perDay(w: { days_captured: number; count: number }): number | null {
  const r = rate(w);
  return r === null ? null : round2(r);
}

/** `round(change_ratio * 100)`, or null when the rule gave no ratio. */
export function changePct(change_ratio: number | null): number | null {
  return change_ratio === null ? null : Math.round(change_ratio * 100);
}

// ── caveats ──────────────────────────────────────────────────────────────────

/** What `requiredCaveats` reads: small enough to build from the agent inputs or from a stored review. */
export interface CaveatContext {
  category: WorkCategory;
  before: { days_captured: number };
  after: { days_captured: number };
  notices: { overlapping_change: boolean; threads_truncated: boolean };
  suggestion_reason: SuggestionReason;
}

const SHORT_WINDOW_DAYS = 7;

export function caveatContextOfInputs(inputs: ReviewAgentInputs): CaveatContext {
  return {
    category: inputs.change.metric.category,
    before: inputs.counts.before,
    after: inputs.counts.after,
    notices: inputs.notices,
    suggestion_reason: inputs.suggestion.reason,
  };
}

export function caveatContextOfReview(r: Review): CaveatContext {
  return {
    category: r.metric.category,
    before: r.before,
    after: r.after,
    notices: r.notices,
    suggestion_reason: r.suggestion.reason,
  };
}

/**
 * The caveats that apply (pure). The UI renders THIS list, never the model's; the model's list must equal it.
 * Returned in `REVIEW_CAVEATS` order.
 */
export function requiredCaveats(ctx: CaveatContext): ReviewCaveat[] {
  const on: Record<ReviewCaveat, boolean> = {
    short_window: ctx.before.days_captured < SHORT_WINDOW_DAYS || ctx.after.days_captured < SHORT_WINDOW_DAYS,
    category_count_not_problem_count: true,
    staff_answers_affect_count: ALWAYS_QUESTION.has(ctx.category) || NEEDS_SUPERVISOR_CONFIRM.has(ctx.category),
    overlapping_change: ctx.notices.overlapping_change,
    threads_truncated: ctx.notices.threads_truncated,
    not_enough_days: ctx.suggestion_reason === "not_enough_days",
    no_baseline: ctx.suggestion_reason === "no_baseline",
  };
  return REVIEW_CAVEATS.filter((c) => on[c]);
}

// ── the checker ──────────────────────────────────────────────────────────────

const TOLERANCE = 1e-6;
const NUMBER_TOKEN = /\d+(?:[.,]\d+)?/g;
const PLACEHOLDER = /[[\]{}]/;
const URL_OR_HANDLE = /https?:|www\.|\.com\b|\.id\b|@/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const CLOCK_TIME = /\b\d{1,2}:\d{2}\b/;
/**
 * Month names: the full names (not "may", an ordinary verb), and the short forms only when written as a date
 * ("Oct 13", "Dec."). The plan's `\b(jan|...|dec)[a-z]*\b` also matches "decrease" and "market", which the metric
 * direction makes unavoidable, so it is narrowed here (flagged in the PR notes).
 */
const MONTH_NAME = new RegExp(
  "\\b(?:january|february|march|april|june|july|august|september|october|november|december)\\b" +
    "|\\b(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.?\\s+\\d" +
    "|\\b(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.(?!\\w)" +
    "|\\bmay\\s+\\d",
  "i",
);
const WEEKDAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i;
const ROLE_OR_PERSON = /\b(supervisor|owner|manager|boss|cashier|barista|chef|cook|he|she|him|her|his|hers|mr|mrs|ms)\b/i;
const INSTRUCTION_WORD = /\b(ignore|system prompt|instruction|assistant|as an ai|developer|override)\b/i;
const CAUSAL_CLAIM =
  /\b(caused|because of the change|thanks to the change|proves|proof that|due to the change|as a result of the change)\b/i;

/** Every digit run in `text` as a number (comma decimal read as a decimal point). */
export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER_TOKEN) ?? []).map((t) => Number(t.replace(",", ".")));
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE;
const hasNear = (set: readonly number[], n: number): boolean => set.some((m) => near(m, n));

function allowedNumbers(inputs: ReviewAgentInputs): number[] {
  const { before, after } = inputs.counts;
  const out = [
    before.count,
    before.days_captured,
    after.count,
    after.days_captured,
    inputs.change.metric.baseline_count,
    inputs.change.metric.baseline_days,
    inputs.counts.rule.min_days,
    inputs.counts.rule.threshold_pct,
  ];
  for (const w of [before, after]) {
    const r = rate(w);
    if (r !== null) out.push(round2(r), round1(r));
  }
  const pct = changePct(inputs.suggestion.change_ratio);
  if (pct !== null) out.push(Math.abs(pct));
  return out;
}

export function checkReview(
  draft: unknown,
  ctx: { inputs: ReviewAgentInputs; session: Pick<ReviewAgentSession, "inspected"> },
): { passed: boolean; reasons: ReviewCheckRule[] } {
  const parsed = ReviewDraftArgsSchema.safeParse(draft);
  if (!parsed.success) return { passed: false, reasons: ["schema_invalid"] };

  const { inputs, session } = ctx;
  const d = parsed.data;
  const q = d.narrative_en.trim();
  const reasons: ReviewCheckRule[] = [];
  const add = (cond: boolean, rule: ReviewCheckRule): void => {
    if (cond) reasons.push(rule);
  };

  add(!session.inspected.has("change"), "change_not_inspected");
  add(!session.inspected.has("counts"), "counts_not_inspected");
  add(!(session.inspected.has("before") && session.inspected.has("after")), "sample_not_inspected");
  add(d.suggested_verdict !== (inputs.suggestion.verdict ?? "none"), "verdict_mismatch");

  const found = extractNumbers(q);
  const allowed = allowedNumbers(inputs);
  add(!found.every((n) => hasNear(allowed, n)), "number_not_allowed");
  add(!(found.every((n) => hasNear(d.quoted_numbers, n)) && d.quoted_numbers.every((n) => hasNear(found, n))), "quoted_numbers_mismatch");

  const required = requiredCaveats(caveatContextOfInputs(inputs));
  add(required.some((c) => !d.caveats.includes(c)), "caveat_missing");
  add(d.caveats.some((c) => !required.includes(c)), "caveat_not_applicable");

  const points = Array.from(q).length;
  add(points < REVIEW_NARRATIVE_MIN_CHARS, "too_short");
  add(points > REVIEW_NARRATIVE_MAX_CHARS, "too_long");
  add(stripInvisibleChars(q) !== q || /[\u0000-\u001F]/.test(q), "control_chars");
  add(PLACEHOLDER.test(q), "placeholder");
  add(URL_OR_HANDLE.test(q), "url_or_handle");
  add(ISO_DATE.test(q) || CLOCK_TIME.test(q) || MONTH_NAME.test(q) || WEEKDAY.test(q), "date_or_time");
  add(scrubQuestionLine(q, inputs.staffNames) !== q, "staff_name");
  add(ROLE_OR_PERSON.test(q), "role_or_person");
  add(INSTRUCTION_WORD.test(q), "instruction_word");
  add(CAUSAL_CLAIM.test(q), "causal_claim");

  return { passed: reasons.length === 0, reasons };
}
