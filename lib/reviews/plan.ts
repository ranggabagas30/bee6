import { addDays } from "@/lib/capture/calendar";
import {
  OutcomeSchema,
  ReviewSchema,
  type AuditLog,
  type Outcome,
  type Review,
  type ReviewStatus,
  type ReviewVerdict,
  type ReviewWindow,
  type SopVersion,
} from "@/lib/firestore/schema";
import { REVIEW_CONFIRM_DAYS } from "@/lib/reviews/constants";
import { suggestVerdict } from "@/lib/reviews/verdict";

/**
 * Pure review planner (R-11 Task 2.4): which shipped changes are due, the
 * review and outcome documents, the verdict state machine and the expiry.
 * No I/O and no clock: `today` and `now_ms` are inputs.
 *
 *   awaiting_supervisor --supervisor--> awaiting_owner --owner--> confirmed (+ outcome, in_memory)
 *          \________ daily run, confirm_by_date < today ________/--> unknown (+ outcome "unknown")
 *
 * Roles only, never a person (hard rule #7). No written object carries an
 * explicit `undefined`. A reason lives on the review only; it is never copied
 * into an outcome or an audit entry.
 */

/** A shipped change: a proposal-sourced version with a non-null change. */
function isShippedChange(v: SopVersion): boolean {
  return v.source === "proposal" && v.change != null;
}

const byVersion = (a: SopVersion, b: SopVersion) => a.version - b.version;

/** Shipped changes with review_date <= today and no review yet (catch-up included), by version asc. */
export function dueChanges(input: {
  versions: readonly SopVersion[];
  reviewedIds: ReadonlySet<string>;
  today: string;
}): SopVersion[] {
  return input.versions
    .filter((v) => isShippedChange(v) && v.change!.review_date <= input.today && !input.reviewedIds.has(v.sop_version_id))
    .sort(byVersion);
}

/** The lowest-version shipped change with no review yet, ignoring its review_date (demo fast-forward). */
export function nextFastForward(input: {
  versions: readonly SopVersion[];
  reviewedIds: ReadonlySet<string>;
}): SopVersion | null {
  const unreviewed = input.versions.filter((v) => isShippedChange(v) && !input.reviewedIds.has(v.sop_version_id)).sort(byVersion);
  return unreviewed[0] ?? null;
}

export function buildReview(input: {
  sop: SopVersion; // shipped change
  versions: readonly SopVersion[]; // all of the outlet's, for overlapping_change
  before: ReviewWindow;
  after: ReviewWindow;
  threads_truncated: boolean;
  simulated: boolean;
  now_ms: number;
  today: string; // outlet-local date of this run; the confirm window never starts before it
}): Review {
  const { sop, versions, before, after, now_ms, today } = input;
  const c = sop.change;
  if (!c || sop.source !== "proposal" || sop.source_proposal_id == null || sop.effective_from_date == null) {
    throw new Error("buildReview: not a shipped change");
  }
  const suggestion = suggestVerdict({ before, after, direction: c.metric.direction });
  // Any OTHER shipped change that came into force strictly inside the measured span (after the
  // "before" window opened, up to the last "after" day) mixes two changes in the numbers. Earlier
  // versions count too (a v2 landing inside v3's baseline); a change already in force on or before
  // before.from_date was there for the whole span. Same-day approvals share one effective_from_date.
  const overlapping_change = versions.some(
    (v) =>
      v.version !== sop.version &&
      isShippedChange(v) &&
      v.effective_from_date != null &&
      v.effective_from_date > before.from_date &&
      v.effective_from_date <= after.to_date,
  );
  return ReviewSchema.parse({
    outlet_id: sop.outlet_id,
    review_id: sop.sop_version_id,
    sop_version_id: sop.sop_version_id,
    version: sop.version,
    source_proposal_id: sop.source_proposal_id,
    change_title: c.change_title,
    step_id: c.step_id,
    intervention_id: c.intervention_id,
    metric: {
      category: c.metric.category,
      direction: c.metric.direction,
      description: c.metric.description,
      baseline_count: c.metric.baseline_count,
      baseline_days: c.metric.baseline_days,
    },
    failure_condition: c.failure_condition,
    effective_from_date: sop.effective_from_date,
    review_date: c.review_date,
    // Catch-up runs late: count the confirm days from the later of review_date and today, so a
    // review created N days after its review_date is not born already expired. Always > review_date.
    confirm_by_date: addDays(c.review_date > today ? c.review_date : today, REVIEW_CONFIRM_DAYS),
    before: { ...before },
    after: { ...after },
    suggestion,
    notices: { overlapping_change, threads_truncated: input.threads_truncated },
    simulated: input.simulated,
    status: "awaiting_supervisor",
    supervisor_verdict: null,
    owner_verdict: null,
    created_at_ms: now_ms,
    updated_at_ms: now_ms,
  });
}

export type VerdictActor = "supervisor" | "owner";
export type VerdictCheck =
  | { kind: "not_found" }
  | { kind: "unchanged"; status: ReviewStatus }
  | { kind: "conflict"; code: "ALREADY_DECIDED" | "NOT_YET_REVIEWABLE" | "EXPIRED" }
  | { kind: "proceed"; review: Review };

/** First match wins (R-11 §1 state machine). */
export function classifyVerdict(input: {
  review: Review | null;
  outlet_id: string;
  actor: VerdictActor;
  verdict: ReviewVerdict;
  today: string;
}): VerdictCheck {
  const { review, actor, verdict } = input;
  if (!review || review.outlet_id !== input.outlet_id) return { kind: "not_found" };
  if (review.status === "unknown") return { kind: "conflict", code: "EXPIRED" };

  if (actor === "supervisor") {
    const sv = review.supervisor_verdict;
    if (sv?.verdict === verdict) return { kind: "unchanged", status: review.status };
    if (sv !== null || review.status !== "awaiting_supervisor") return { kind: "conflict", code: "ALREADY_DECIDED" };
  } else {
    const ov = review.owner_verdict;
    if (ov?.verdict === verdict) return { kind: "unchanged", status: review.status };
    if (review.status === "awaiting_supervisor") return { kind: "conflict", code: "NOT_YET_REVIEWABLE" };
    if (review.status !== "awaiting_owner") return { kind: "conflict", code: "ALREADY_DECIDED" };
  }

  if (input.today > review.confirm_by_date) return { kind: "conflict", code: "EXPIRED" };
  return { kind: "proceed", review };
}

function auditOf(review: Review, now_ms: number, actor_role: AuditLog["actor_role"], action: string, details: Record<string, unknown>): AuditLog {
  return {
    outlet_id: review.outlet_id,
    ts: new Date(now_ms).toISOString(),
    actor_role,
    action,
    target_type: "review",
    target_id: review.review_id,
    details,
  };
}

function outcomeOf(review: Review, verdict: Outcome["verdict"], now_ms: number): Outcome {
  return OutcomeSchema.parse({
    outlet_id: review.outlet_id,
    outcome_id: review.review_id,
    review_id: review.review_id,
    sop_version_id: review.sop_version_id,
    version: review.version,
    source_proposal_id: review.source_proposal_id,
    step_id: review.step_id,
    intervention_id: review.intervention_id,
    metric_category: review.metric.category,
    metric_direction: review.metric.direction,
    before: { ...review.before },
    after: { ...review.after },
    suggested_verdict: review.suggestion.verdict,
    supervisor_verdict: review.supervisor_verdict?.verdict ?? null,
    verdict,
    in_memory: verdict !== "unknown",
    simulated: review.simulated,
    decided_at_ms: now_ms,
  });
}

export function buildVerdictWrite(input: {
  review: Review;
  actor: VerdictActor;
  verdict: ReviewVerdict;
  reason: string | null;
  now_ms: number;
}): { review: Review; outcome: Outcome | null; audit: AuditLog } {
  const { review, actor, verdict, reason, now_ms } = input;
  const entry = { verdict, reason, decided_at_ms: now_ms };
  const next = ReviewSchema.parse(
    actor === "supervisor"
      ? { ...review, status: "awaiting_owner", supervisor_verdict: entry, updated_at_ms: now_ms }
      : { ...review, status: "confirmed", owner_verdict: entry, updated_at_ms: now_ms },
  );
  const audit = auditOf(next, now_ms, actor, actor === "supervisor" ? "review.supervisor_verdict" : "review.owner_verdict", {
    version: review.version,
    verdict,
    from_status: review.status,
    to_status: next.status,
    simulated: review.simulated,
  });
  // The owner's verdict is the outcome (final say). Never carries the reason.
  const outcome = actor === "owner" ? outcomeOf(next, verdict, now_ms) : null;
  return { review: next, outcome, audit };
}

export function buildExpiry(input: { review: Review; now_ms: number }): { review: Review; outcome: Outcome; audit: AuditLog } {
  const { review, now_ms } = input;
  if (review.status !== "awaiting_supervisor" && review.status !== "awaiting_owner") {
    throw new Error(`buildExpiry: review is "${review.status}", not awaiting a verdict`);
  }
  const next = ReviewSchema.parse({ ...review, status: "unknown", updated_at_ms: now_ms });
  const audit = auditOf(next, now_ms, "system", "review.expired", {
    version: review.version,
    from_status: review.status,
    simulated: review.simulated,
  });
  return { review: next, outcome: outcomeOf(next, "unknown", now_ms), audit };
}

/** The only allowed filter for any future reader of outcomes: confirmed, remembered results (T-509). */
export function memoryOutcomes(outcomes: readonly Outcome[]): Outcome[] {
  return outcomes.filter((o) => o.in_memory && o.verdict !== "unknown");
}
