import { addDays, localDateOf } from "@/lib/capture/calendar";
import { SopVersionSchema, type Proposal, type SopStep, type SopVersion } from "@/lib/firestore/schema";
import { WIRE_MAX } from "@/lib/proposals/wire-schema";
import { sopConflict } from "@/lib/sop/rebase";

/**
 * Pure SOP ship planner (R-10 Task 3). Applies an approved proposal to the
 * outlet's latest SOP and returns the next immutable version, or a conflict.
 * No I/O, no model, no SDP: text is copied as stored (already redacted by
 * R-08 step 8e). PR-2 calls this inside the owner-approval transaction.
 */

export const SOP_MAX_STEPS = 200; // = SopVersionSchema steps.max
export const NEW_STEP_ROLE = "staff" as const; // R-10 §11 Q-2

/**
 * The longest step text the ProposalAgent can write back (its wire cap for
 * change_text). A change_text REPLACES the step text, so an existing step
 * longer than this cannot be rewritten without losing text: refused, never
 * truncated.
 */
export const SOP_STEP_TEXT_MODEL_CAP = WIRE_MAX.change_text;

/**
 * Agent versions whose change_text may be a description of the change rather
 * than the full new step text (the "11." prompt rule shipped with proposal-v2).
 * Such proposals must be regenerated, never shipped.
 */
export const LEGACY_AGENT_VERSIONS: readonly string[] = ["proposal-v1"];

/** "p-" + proposalId with "-" removed, lower-cased (34 chars for a UUID). */
export function newStepId(proposalId: string): string {
  return `p-${proposalId.replace(/-/g, "").toLowerCase()}`;
}

/** The outlet-local calendar date after `nowMs` (conservative: never the same day). */
export function effectiveFromDate(nowMs: number, tz: string): string {
  return addDays(localDateOf(nowMs, tz), 1);
}

/** Review date counted from the ship (effective) date, so the "after" window is review_after_days long. */
export function shipReviewDate(effectiveFrom: string, reviewAfterDays: number): string {
  return addDays(effectiveFrom, reviewAfterDays);
}

export type ShipConflictCode = "SOP_CHANGED" | "SOP_STEP_LIMIT" | "LEGACY_PROPOSAL" | "STEP_TEXT_TOO_LONG";
export type ShipPlan =
  | { kind: "conflict"; code: ShipConflictCode }
  | { kind: "ship"; sop_version: SopVersion; effective_from_date: string; review_date: string };

export function planShip(input: {
  current: SopVersion | null; // the outlet's LATEST version, read in the same transaction
  drafted: SopVersion | null; // the version the proposal was drafted on (proposal.generator.sop_version_id); null = unknown
  proposal: Proposal; // status "awaiting_owner", content non-null
  now_ms: number;
  tz: string; // outlet timezone
}): ShipPlan {
  const { current, drafted, proposal, now_ms, tz } = input;
  if (proposal.status !== "awaiting_owner" || proposal.content === null) {
    throw new Error("planShip: proposal not shippable");
  }
  if (LEGACY_AGENT_VERSIONS.includes(proposal.generator.agent_version)) {
    return { kind: "conflict", code: "LEGACY_PROPOSAL" };
  }
  // Step-level re-base (item 20): a newer SOP is fine while the step this proposal rewrites still reads as drafted.
  if (current === null || sopConflict({ proposal, drafted, current }) === "SOP_CHANGED") {
    return { kind: "conflict", code: "SOP_CHANGED" };
  }
  const c = proposal.content;

  let kind: "modify" | "add";
  let before: SopStep | null;
  let after: SopStep;
  let steps: SopStep[];
  if (c.target_step_id !== null) {
    const idx = current.steps.findIndex((s) => s.step_id === c.target_step_id);
    const target = idx === -1 ? undefined : current.steps[idx];
    if (target === undefined) return { kind: "conflict", code: "SOP_CHANGED" };
    if (target.text.length > SOP_STEP_TEXT_MODEL_CAP) return { kind: "conflict", code: "STEP_TEXT_TOO_LONG" };
    before = target;
    after = { step_id: target.step_id, title: target.title, text: c.change_text, role: target.role };
    steps = current.steps.map((s, i) => (i === idx ? after : { ...s }));
    kind = "modify";
  } else {
    if (current.steps.length >= SOP_MAX_STEPS) return { kind: "conflict", code: "SOP_STEP_LIMIT" };
    const id = newStepId(proposal.proposal_id);
    if (current.steps.some((s) => s.step_id === id)) throw new Error("planShip: new step id collision");
    before = null;
    after = { step_id: id, title: c.change_title, text: c.change_text, role: NEW_STEP_ROLE };
    steps = [...current.steps.map((s) => ({ ...s })), after];
    kind = "add";
  }

  const effective_from_date = effectiveFromDate(now_ms, tz);
  const review_date = shipReviewDate(effective_from_date, c.review_after_days);
  const n = current.version + 1;
  const sop_version = SopVersionSchema.parse({
    outlet_id: current.outlet_id,
    sop_version_id: `${current.outlet_id}:v${n}`,
    version: n,
    steps,
    source: "proposal",
    source_proposal_id: proposal.proposal_id,
    created_at_ms: now_ms,
    previous_version_id: current.sop_version_id,
    effective_from_date,
    change: {
      kind,
      step_id: after.step_id,
      before: before ? { ...before } : null,
      after: { ...after },
      change_title: c.change_title,
      intervention_id: c.intervention_id,
      metric: {
        category: c.metric.category,
        direction: c.metric.direction,
        description: c.metric.description,
        baseline_count: c.metric.baseline_count,
        baseline_days: c.metric.baseline_days,
      },
      failure_condition: c.failure_condition,
      review_after_days: c.review_after_days,
      review_date,
      approved_at_ms: now_ms,
    },
  });
  return { kind: "ship", sop_version, effective_from_date, review_date };
}
