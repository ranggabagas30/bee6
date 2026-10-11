import type { AuditLog, OwnerDecision, Proposal, ProposalStatus, SupervisorReview } from "@/lib/firestore/schema";
import { ProposalSchema } from "@/lib/firestore/schema";
import { evidenceStillHolds, type FreshThread } from "@/lib/proposals/freshness";
import type { DecisionConflictCode } from "@/lib/proposals/review-contract";

/**
 * Pure decision logic for R-09 (supervisor Feasible / Reject, owner Approve /
 * Reject). No I/O. `classifyDecision` runs inside the store's transaction on a
 * fresh snapshot, so every terminal state is re-derived, never assumed from a
 * pre-read. It never reads `requested_by_role` (R-08 Q-10): the approval
 * sequence is the same whoever generated the proposal. Plain code, not AI
 * (hard rule #10).
 */

export type DecisionActor = "supervisor" | "owner";
export type RequestedDecision = "feasible" | "approved" | "rejected";

export interface DecisionSnapshot {
  /** null = missing, malformed, or another outlet's doc. */
  proposal: Proposal | null;
  /** Other proposals of this outlet with the identical range (the proposal itself excluded). Malformed skipped. */
  same_range: Proposal[];
  /** Cited thread id → fresh fields. Missing / foreign / malformed threads are absent. */
  fresh: Map<string, FreshThread>;
  /** Every current constraint id of the outlet. */
  constraint_ids: string[];
  /** Highest-version sop_versions id of the outlet; null if none. */
  current_sop_version_id: string | null;
}

export type DecisionCheck =
  | { kind: "not_found" }
  | { kind: "unchanged"; status: ProposalStatus }
  | { kind: "conflict"; code: DecisionConflictCode }
  | { kind: "proceed"; proposal: Proposal; late_ids: string[] };

const OPEN_STATUSES: readonly ProposalStatus[] = ["awaiting_supervisor", "awaiting_owner"];
const SUPERSEDING_STATUSES: readonly ProposalStatus[] = ["awaiting_supervisor", "awaiting_owner", "approved"];

/**
 * An open proposal is superseded when a newer proposal for the IDENTICAL range
 * is open or approved (R-09 §0 item 5). Newer = later created_at_ms, ties
 * broken by the larger proposal_id. A newer rejected / suppressed / blocked
 * proposal never supersedes.
 */
export function isSuperseded(p: Proposal, sameRange: readonly Proposal[]): boolean {
  if (!OPEN_STATUSES.includes(p.status)) return false;
  return sameRange.some(
    (q) =>
      q.proposal_id !== p.proposal_id &&
      q.range.from_date === p.range.from_date &&
      q.range.to_date === p.range.to_date &&
      SUPERSEDING_STATUSES.includes(q.status) &&
      (q.created_at_ms > p.created_at_ms || (q.created_at_ms === p.created_at_ms && q.proposal_id > p.proposal_id)),
  );
}

export function supersededIds(all: readonly Proposal[]): Set<string> {
  const groups = new Map<string, Proposal[]>();
  for (const p of all) {
    const key = `${p.range.from_date}|${p.range.to_date}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const out = new Set<string>();
  for (const group of groups.values()) {
    for (const p of group) if (isSuperseded(p, group)) out.add(p.proposal_id);
  }
  return out;
}

export function classifyDecision(input: {
  snap: DecisionSnapshot;
  outlet_id: string;
  actor: DecisionActor;
  requested: RequestedDecision;
  acknowledged_constraint_ids: readonly string[];
}): DecisionCheck {
  const { snap, actor, requested } = input;
  const p = snap.proposal;
  // 1. Existence is never revealed across outlets.
  if (!p || p.outlet_id !== input.outlet_id) return { kind: "not_found" };

  // 2. Only proposals with content can be decided.
  if (p.status === "suppressed" || p.status === "blocked" || p.content === null) {
    return { kind: "conflict", code: "NOT_REVIEWABLE" };
  }
  const content = p.content;

  // 3. Idempotency, then stage.
  const sr = p.supervisor_review ?? null;
  const od = p.owner_decision ?? null;
  if (actor === "supervisor") {
    if (requested !== "feasible" && requested !== "rejected") {
      throw new Error("classifyDecision: bad supervisor decision");
    }
    if (sr && sr.decision === requested) return { kind: "unchanged", status: p.status };
    if (p.status !== "awaiting_supervisor") return { kind: "conflict", code: "ALREADY_DECIDED" };
  } else {
    if (requested !== "approved" && requested !== "rejected") {
      throw new Error("classifyDecision: bad owner decision");
    }
    if (od && od.decision === requested) return { kind: "unchanged", status: p.status };
    if (p.status === "awaiting_supervisor") return { kind: "conflict", code: "NOT_YET_REVIEWABLE" };
    if (p.status !== "awaiting_owner") return { kind: "conflict", code: "ALREADY_DECIDED" };
  }

  // 4. A newer proposal for the same dates exists.
  if (isSuperseded(p, snap.same_range)) return { kind: "conflict", code: "SUPERSEDED" };

  // 5. A rejection is never blocked by stale evidence, a changed SOP or a late constraint.
  if (requested === "rejected") return { kind: "proceed", proposal: p, late_ids: [] };

  // 6-8. Positive decisions only.
  if (!evidenceStillHolds(content.evidence, snap.fresh).holds) return { kind: "conflict", code: "EVIDENCE_STALE" };
  if (snap.current_sop_version_id !== p.generator.sop_version_id) return { kind: "conflict", code: "SOP_CHANGED" };
  const late = snap.constraint_ids.filter((id) => !content.constraint_ids_acknowledged.includes(id));
  const ack = new Set(input.acknowledged_constraint_ids);
  if (late.some((id) => !ack.has(id))) return { kind: "conflict", code: "CONSTRAINT_ADDED" };

  // 9.
  return { kind: "proceed", proposal: p, late_ids: late };
}

export function buildDecisionWrite(input: {
  proposal: Proposal;
  actor: DecisionActor;
  requested: RequestedDecision;
  late_ids: readonly string[];
  reason: string | null; // redacted; non-null iff requested === "rejected"
  constraint_id: string | null; // any rejection (supervisor or owner): the createConstraint id; else null
  now_ms: number;
}): { proposal: Proposal; audit: AuditLog } {
  const { proposal: p, actor, requested, now_ms } = input;
  const rejected = requested === "rejected";
  if (rejected !== (input.reason !== null)) {
    throw new Error("buildDecisionWrite: reason must be set iff the decision is a rejection");
  }
  if (rejected !== (input.constraint_id !== null)) {
    throw new Error("buildDecisionWrite: constraint_id must be set iff the decision is a rejection");
  }
  if (actor === "supervisor" ? requested === "approved" : requested === "feasible") {
    throw new Error(`buildDecisionWrite: ${actor} cannot make decision "${requested}"`);
  }

  const acknowledged = rejected ? [] : [...input.late_ids];
  let status: ProposalStatus;
  let supervisor_review: SupervisorReview | null;
  let owner_decision: OwnerDecision | null;
  let action: string;

  if (actor === "supervisor") {
    owner_decision = null;
    supervisor_review = {
      decision: requested === "feasible" ? "feasible" : "rejected",
      reason: input.reason,
      constraint_id: input.constraint_id,
      acknowledged_constraint_ids: acknowledged,
      decided_at_ms: now_ms,
    };
    status = rejected ? "rejected" : "awaiting_owner";
    action = rejected ? "proposal.supervisor_rejected" : "proposal.feasible";
  } else {
    supervisor_review = p.supervisor_review ?? null;
    if (supervisor_review === null) {
      throw new Error("buildDecisionWrite: an owner decision needs a supervisor review");
    }
    owner_decision = {
      decision: requested === "approved" ? "approved" : "rejected",
      reason: input.reason,
      constraint_id: input.constraint_id,
      acknowledged_constraint_ids: acknowledged,
      decided_at_ms: now_ms,
    };
    status = rejected ? "rejected" : "approved";
    action = rejected ? "proposal.owner_rejected" : "proposal.approved";
  }

  const written = ProposalSchema.parse({ ...p, status, supervisor_review, owner_decision, updated_at_ms: now_ms });
  const audit: AuditLog = {
    outlet_id: p.outlet_id,
    ts: new Date(now_ms).toISOString(),
    actor_role: actor,
    action,
    target_type: "proposal",
    target_id: p.proposal_id,
    details: {
      from_status: p.status,
      to_status: status,
      late_constraints_acknowledged: input.late_ids.length,
      ...(input.constraint_id ? { constraint_id: input.constraint_id } : {}),
    },
  };
  return { proposal: written, audit };
}
