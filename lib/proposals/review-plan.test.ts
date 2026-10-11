import { describe, expect, it } from "vitest";
import {
  buildDecisionWrite,
  classifyDecision,
  isSuperseded,
  supersededIds,
  type DecisionSnapshot,
} from "@/lib/proposals/review-plan";
import type { FreshThread } from "@/lib/proposals/freshness";
import { ProposalSchema, type Proposal } from "@/lib/firestore/schema";

const OUTLET = "demo-outlet";
const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "55555555-5555-4555-8555-555555555555";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const CX = "99999999-9999-4999-8999-999999999999";
const KCON = "44444444-4444-4444-8444-444444444444";
const SENTINEL_REASON = "REASON-SENTINEL-oven-small";
const NOW = 1_700_000_500_000;

const evidence = ["a", "b", "c"].map((x, i) => ({
  thread_id: `unit_DEVSENTINEL_${x}:0`,
  local_date: `2026-10-0${i + 1}`,
  category: "CUSTOMER_SERVICE" as const,
  first_line_start_ms: 1_700_000_000_000 + i,
}));

function makeProposal(overrides: Record<string, unknown> = {}): Proposal {
  return ProposalSchema.parse({
    outlet_id: OUTLET,
    proposal_id: P1,
    status: "awaiting_supervisor",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-03" },
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "global",
      agent_version: "proposal-v1",
      gate_version: "pgate-v1",
      library_version: { interventions: 1, rubric: 1 },
      sop_version_id: "o1:v1",
      attempts: 1,
    },
    gate: { passed: true, fired_rule: null, checks: [] },
    counts: { candidate_facts: 3, candidate_dates: 3, constraints: 1 },
    suppression: null,
    content: {
      intervention_id: "change_quantity_time",
      rubric_criterion_ids: ["observable"],
      target_step_id: "open-01",
      change_title: "Check the display",
      change_text: "Check the display every 30 minutes.",
      rationale: "Customers asked for sold-out items.",
      metric: {
        category: "CUSTOMER_SERVICE",
        direction: "decrease",
        description: "Sold-out requests per day.",
        baseline_count: 4,
        baseline_days: 3,
      },
      failure_condition: "No fall.",
      review_after_days: 14,
      review_date: "2026-10-24",
      evidence,
      constraint_ids_acknowledged: [C1],
      censored_floor: true,
    },
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
    ...overrides,
  });
}

const feasibleReview = {
  decision: "feasible" as const,
  reason: null,
  constraint_id: null,
  acknowledged_constraint_ids: [],
  decided_at_ms: 1_700_000_100_000,
};
const supRejectedReview = {
  decision: "rejected" as const,
  reason: SENTINEL_REASON,
  constraint_id: KCON,
  acknowledged_constraint_ids: [],
  decided_at_ms: 1_700_000_100_000,
};
const approvedDecision = { ...feasibleReview, decision: "approved" as const };
const ownerRejectedDecision = { ...supRejectedReview };

const awaitingOwner = (o: Record<string, unknown> = {}) =>
  makeProposal({ status: "awaiting_owner", supervisor_review: feasibleReview, owner_decision: null, ...o });
const approved = () =>
  makeProposal({ status: "approved", supervisor_review: feasibleReview, owner_decision: approvedDecision });
const supRejected = () =>
  makeProposal({ status: "rejected", supervisor_review: supRejectedReview, owner_decision: null });
const ownerRejected = () =>
  makeProposal({ status: "rejected", supervisor_review: feasibleReview, owner_decision: ownerRejectedDecision });

const allFresh = (): Map<string, FreshThread> =>
  new Map(evidence.map((e) => [e.thread_id, { status: "fact" } as FreshThread]));

function snap(p: Proposal | null, o: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  return {
    proposal: p,
    same_range: [],
    fresh: allFresh(),
    constraint_ids: [C1],
    current_sop_version_id: "o1:v1",
    ...o,
  };
}

function classify(
  s: DecisionSnapshot,
  actor: "supervisor" | "owner",
  requested: "feasible" | "approved" | "rejected",
  ack: string[] = [],
) {
  return classifyDecision({ snap: s, outlet_id: OUTLET, actor, requested, acknowledged_constraint_ids: ack });
}

function hasUndefined(v: unknown): boolean {
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.some(hasUndefined);
  if (v !== null && typeof v === "object") return Object.values(v).some(hasUndefined);
  return false;
}

describe("classifyDecision", () => {
  it("4.T1 not found: null proposal and foreign outlet", () => {
    expect(classify(snap(null), "supervisor", "feasible")).toEqual({ kind: "not_found" });
    expect(classify(snap(makeProposal({ outlet_id: "other" })), "supervisor", "feasible")).toEqual({
      kind: "not_found",
    });
  });

  it("4.T2 suppressed and blocked -> NOT_REVIEWABLE for both actors and every decision", () => {
    const suppressed = makeProposal({
      status: "suppressed",
      content: null,
      gate: { passed: false, fired_rule: null, checks: [] },
      suppression: {
        reason: "insufficient_evidence",
        model_reason: null,
        followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
      },
    });
    const blocked = makeProposal({
      status: "blocked",
      content: null,
      gate: { passed: false, fired_rule: "evidence_min", checks: [] },
    });
    for (const p of [suppressed, blocked]) {
      for (const r of ["feasible", "rejected"] as const) {
        expect(classify(snap(p), "supervisor", r)).toEqual({ kind: "conflict", code: "NOT_REVIEWABLE" });
      }
      for (const r of ["approved", "rejected"] as const) {
        expect(classify(snap(p), "owner", r)).toEqual({ kind: "conflict", code: "NOT_REVIEWABLE" });
      }
    }
  });

  it("4.T3 supervisor feasible proceeds and builds an awaiting_owner write", () => {
    const check = classify(snap(makeProposal()), "supervisor", "feasible");
    expect(check.kind).toBe("proceed");
    if (check.kind !== "proceed") return;
    const w = buildDecisionWrite({
      proposal: check.proposal,
      actor: "supervisor",
      requested: "feasible",
      late_ids: check.late_ids,
      reason: null,
      constraint_id: null,
      now_ms: NOW,
    });
    expect(w.proposal.status).toBe("awaiting_owner");
    expect(w.proposal.owner_decision).toBeNull();
    expect(w.proposal.supervisor_review?.decision).toBe("feasible");
    expect(ProposalSchema.safeParse(w.proposal).success).toBe(true);
    expect(w.audit.action).toBe("proposal.feasible");
    expect(w.audit.actor_role).toBe("supervisor");
  });

  it("4.T4 requested_by_role never changes the outcome", () => {
    const a = classify(snap(makeProposal({ requested_by_role: "supervisor" })), "supervisor", "feasible");
    const b = classify(snap(makeProposal({ requested_by_role: "owner" })), "supervisor", "feasible");
    expect(a.kind).toBe("proceed");
    expect(b.kind).toBe("proceed");
    if (a.kind === "proceed" && b.kind === "proceed") expect(a.late_ids).toEqual(b.late_ids);
  });

  it("4.T5 owner approve before supervisor review -> NOT_YET_REVIEWABLE (either generator); then proceeds after feasible", () => {
    for (const by of ["owner", "supervisor"] as const) {
      expect(classify(snap(makeProposal({ requested_by_role: by })), "owner", "approved")).toEqual({
        kind: "conflict",
        code: "NOT_YET_REVIEWABLE",
      });
    }
    const check = classify(snap(awaitingOwner({ requested_by_role: "owner" })), "owner", "approved");
    expect(check.kind).toBe("proceed");
    if (check.kind !== "proceed") return;
    const w = buildDecisionWrite({
      proposal: check.proposal,
      actor: "owner",
      requested: "approved",
      late_ids: check.late_ids,
      reason: null,
      constraint_id: null,
      now_ms: NOW,
    });
    expect(w.proposal.status).toBe("approved");
    expect(w.proposal.supervisor_review?.decision).toBe("feasible");
    expect(w.proposal.owner_decision?.decision).toBe("approved");
    expect(w.audit.action).toBe("proposal.approved");
  });

  it("4.T6 owner reject on awaiting_owner keeps the supervisor review and carries the constraint", () => {
    const check = classify(snap(awaitingOwner()), "owner", "rejected");
    expect(check.kind).toBe("proceed");
    if (check.kind !== "proceed") return;
    const w = buildDecisionWrite({
      proposal: check.proposal,
      actor: "owner",
      requested: "rejected",
      late_ids: check.late_ids,
      reason: SENTINEL_REASON,
      constraint_id: KCON,
      now_ms: NOW,
    });
    expect(w.proposal.status).toBe("rejected");
    expect(w.proposal.supervisor_review).toEqual(feasibleReview);
    expect(w.proposal.owner_decision).toEqual({
      decision: "rejected",
      reason: SENTINEL_REASON,
      constraint_id: KCON,
      acknowledged_constraint_ids: [],
      decided_at_ms: NOW,
    });
    expect(w.audit.action).toBe("proposal.owner_rejected");
    expect(w.audit.details).toMatchObject({ constraint_id: KCON });
  });

  it("4.T7 idempotency: the same decision again is unchanged", () => {
    expect(classify(snap(awaitingOwner()), "supervisor", "feasible")).toEqual({
      kind: "unchanged",
      status: "awaiting_owner",
    });
    expect(classify(snap(supRejected()), "supervisor", "rejected")).toEqual({
      kind: "unchanged",
      status: "rejected",
    });
    expect(classify(snap(approved()), "owner", "approved")).toEqual({ kind: "unchanged", status: "approved" });
    expect(classify(snap(ownerRejected()), "owner", "rejected")).toEqual({
      kind: "unchanged",
      status: "rejected",
    });
  });

  it("4.T8 already decided", () => {
    const already = { kind: "conflict", code: "ALREADY_DECIDED" };
    expect(classify(snap(awaitingOwner()), "supervisor", "rejected")).toEqual(already);
    expect(classify(snap(supRejected()), "supervisor", "feasible")).toEqual(already);
    expect(classify(snap(supRejected()), "owner", "approved")).toEqual(already);
    expect(classify(snap(approved()), "owner", "rejected")).toEqual(already);
  });

  it("4.T9 superseded: newer open proposal of the same range -> SUPERSEDED for feasible and reject", () => {
    const newer = makeProposal({ proposal_id: P2, created_at_ms: 1_700_000_001_000 });
    const s = snap(makeProposal(), { same_range: [newer] });
    expect(classify(s, "supervisor", "feasible")).toEqual({ kind: "conflict", code: "SUPERSEDED" });
    expect(classify(s, "supervisor", "rejected")).toEqual({ kind: "conflict", code: "SUPERSEDED" });
  });

  it("4.T9 isSuperseded details", () => {
    const base = makeProposal();
    const newerRejected = makeProposal({
      proposal_id: P2,
      created_at_ms: 1_700_000_001_000,
      status: "rejected",
      supervisor_review: supRejectedReview,
      owner_decision: null,
    });
    expect(isSuperseded(base, [newerRejected])).toBe(false);
    const newerApproved = makeProposal({
      proposal_id: P2,
      created_at_ms: 1_700_000_001_000,
      status: "approved",
      supervisor_review: feasibleReview,
      owner_decision: approvedDecision,
    });
    expect(isSuperseded(base, [newerApproved])).toBe(true);
    // tie on created_at_ms: larger proposal_id wins
    const tie = makeProposal({ proposal_id: P2 });
    expect(P2 > P1).toBe(true);
    expect(isSuperseded(base, [tie])).toBe(true);
    expect(isSuperseded(tie, [base])).toBe(false);
    // different range never supersedes
    const other = makeProposal({
      proposal_id: P2,
      created_at_ms: 1_700_000_001_000,
      range: { from_date: "2026-10-01", to_date: "2026-10-04" },
    });
    expect(isSuperseded(base, [other])).toBe(false);
    // decided proposals are never superseded
    expect(isSuperseded(supRejected(), [makeProposal({ proposal_id: P2, created_at_ms: 1_700_000_001_000 })])).toBe(
      false,
    );
    // the proposal itself never supersedes itself
    expect(isSuperseded(base, [base])).toBe(false);
  });

  it("4.T9 supersededIds over a mixed list", () => {
    const older = makeProposal();
    const newer = makeProposal({ proposal_id: P2, created_at_ms: 1_700_000_001_000 });
    const lone = makeProposal({
      proposal_id: "66666666-6666-4666-8666-666666666666",
      range: { from_date: "2026-11-01", to_date: "2026-11-02" },
    });
    const ids = supersededIds([older, newer, lone]);
    expect([...ids]).toEqual([P1]);
  });

  it("4.T10 stale evidence", () => {
    const stale = allFresh();
    stale.set(evidence[0]!.thread_id, { status: "fact", label_source: "supervisor_rejected" });
    // 3 threads on 3 dates, one stale -> still 2/2 -> proceeds
    expect(classify(snap(makeProposal(), { fresh: stale }), "supervisor", "feasible").kind).toBe("proceed");
    // one more stale -> 1 thread -> stale
    stale.set(evidence[1]!.thread_id, { status: "open" });
    expect(classify(snap(makeProposal(), { fresh: stale }), "supervisor", "feasible")).toEqual({
      kind: "conflict",
      code: "EVIDENCE_STALE",
    });
    // missing thread counts as not fresh
    const missing = allFresh();
    missing.delete(evidence[0]!.thread_id);
    expect(classify(snap(makeProposal(), { fresh: missing }), "supervisor", "feasible").kind).toBe("proceed");
    // stale + reject proceeds
    expect(classify(snap(makeProposal(), { fresh: stale }), "supervisor", "rejected").kind).toBe("proceed");
  });

  it("4.T10 stale when the remaining two share one date", () => {
    const p = makeProposal();
    const sameDate = {
      ...p,
      content: {
        ...p.content!,
        evidence: [
          { ...evidence[0]! },
          { ...evidence[1]!, local_date: evidence[0]!.local_date },
          { ...evidence[2]! },
        ],
      },
    } as Proposal;
    const fresh = allFresh();
    fresh.set(evidence[2]!.thread_id, { status: "unverified" });
    expect(classify(snap(sameDate, { fresh }), "supervisor", "feasible")).toEqual({
      kind: "conflict",
      code: "EVIDENCE_STALE",
    });
  });

  it("4.T11 late constraints need an explicit acknowledgement of every late id", () => {
    const s = snap(makeProposal(), { constraint_ids: [C1, C2] });
    expect(classify(s, "supervisor", "feasible", [])).toEqual({ kind: "conflict", code: "CONSTRAINT_ADDED" });
    const ok = classify(s, "supervisor", "feasible", [C2]);
    expect(ok).toMatchObject({ kind: "proceed", late_ids: [C2] });
    const extra = classify(s, "supervisor", "feasible", [C2, CX]);
    expect(extra).toMatchObject({ kind: "proceed", late_ids: [C2] });
    if (extra.kind === "proceed") {
      const w = buildDecisionWrite({
        proposal: extra.proposal,
        actor: "supervisor",
        requested: "feasible",
        late_ids: extra.late_ids,
        reason: null,
        constraint_id: null,
        now_ms: NOW,
      });
      expect(w.proposal.supervisor_review?.acknowledged_constraint_ids).toEqual([C2]);
    }
  });

  it("4.T11 the owner acknowledges independently of the supervisor", () => {
    const p = awaitingOwner({ supervisor_review: { ...feasibleReview, acknowledged_constraint_ids: [C2] } });
    const s = snap(p, { constraint_ids: [C1, C2] });
    expect(classify(s, "owner", "approved", [])).toEqual({ kind: "conflict", code: "CONSTRAINT_ADDED" });
    expect(classify(s, "owner", "approved", [C2]).kind).toBe("proceed");
  });

  it("4.T12 SOP changed or missing -> SOP_CHANGED; a reject is not blocked", () => {
    expect(classify(snap(makeProposal(), { current_sop_version_id: "o1:v2" }), "supervisor", "feasible")).toEqual({
      kind: "conflict",
      code: "SOP_CHANGED",
    });
    expect(classify(snap(makeProposal(), { current_sop_version_id: null }), "supervisor", "feasible")).toEqual({
      kind: "conflict",
      code: "SOP_CHANGED",
    });
    expect(classify(snap(makeProposal(), { current_sop_version_id: "o1:v2" }), "supervisor", "rejected").kind).toBe(
      "proceed",
    );
  });

  it("4.T14 precedence", () => {
    const stale = allFresh();
    stale.set(evidence[0]!.thread_id, { status: "open" });
    stale.set(evidence[1]!.thread_id, { status: "open" });
    expect(
      classify(
        snap(makeProposal(), { fresh: stale, current_sop_version_id: "o1:v2", constraint_ids: [C1, C2] }),
        "supervisor",
        "feasible",
      ),
    ).toEqual({ kind: "conflict", code: "EVIDENCE_STALE" });
    expect(
      classify(
        snap(makeProposal(), { current_sop_version_id: "o1:v2", constraint_ids: [C1, C2] }),
        "supervisor",
        "feasible",
      ),
    ).toEqual({ kind: "conflict", code: "SOP_CHANGED" });
    // idempotency beats freshness
    expect(classify(snap(awaitingOwner(), { fresh: stale }), "supervisor", "feasible")).toEqual({
      kind: "unchanged",
      status: "awaiting_owner",
    });
    // superseded beats stale
    const newer = makeProposal({ proposal_id: P2, created_at_ms: 1_700_000_001_000 });
    expect(classify(snap(makeProposal(), { fresh: stale, same_range: [newer] }), "supervisor", "feasible")).toEqual({
      kind: "conflict",
      code: "SUPERSEDED",
    });
  });

  it("throws on a decision the actor cannot make", () => {
    expect(() => classify(snap(makeProposal()), "supervisor", "approved")).toThrow(/bad supervisor decision/);
    expect(() => classify(snap(awaitingOwner()), "owner", "feasible")).toThrow(/bad owner decision/);
  });
});

describe("buildDecisionWrite", () => {
  const base = makeProposal();
  const args = {
    proposal: base,
    actor: "supervisor" as const,
    requested: "rejected" as const,
    late_ids: [],
    reason: SENTINEL_REASON,
    constraint_id: KCON,
    now_ms: NOW,
  };

  it("supervisor reject writes rejected, the reason and the constraint id", () => {
    const w = buildDecisionWrite(args);
    expect(w.proposal.status).toBe("rejected");
    expect(w.proposal.supervisor_review).toEqual({
      decision: "rejected",
      reason: SENTINEL_REASON,
      constraint_id: KCON,
      acknowledged_constraint_ids: [],
      decided_at_ms: NOW,
    });
    expect(w.proposal.owner_decision).toBeNull();
    expect(w.proposal.updated_at_ms).toBe(NOW);
    expect(w.audit.action).toBe("proposal.supervisor_rejected");
  });

  it("4.T13 audit details have exactly the documented keys and no reason", () => {
    const w = buildDecisionWrite(args);
    expect(Object.keys(w.audit.details!).sort()).toEqual(
      ["constraint_id", "from_status", "late_constraints_acknowledged", "to_status"].sort(),
    );
    expect(JSON.stringify(w.audit)).not.toContain(SENTINEL_REASON);
    expect(w.audit).toMatchObject({
      outlet_id: OUTLET,
      target_type: "proposal",
      target_id: P1,
      actor_role: "supervisor",
      ts: new Date(NOW).toISOString(),
    });
    const f = buildDecisionWrite({
      ...args,
      requested: "feasible",
      reason: null,
      constraint_id: null,
      late_ids: [C2],
    });
    expect(Object.keys(f.audit.details!).sort()).toEqual(
      ["from_status", "late_constraints_acknowledged", "to_status"].sort(),
    );
    expect(f.audit.details).toMatchObject({ late_constraints_acknowledged: 1 });
  });

  it("4.T15 throws on caller bugs", () => {
    expect(() => buildDecisionWrite({ ...args, constraint_id: null })).toThrow(/buildDecisionWrite/);
    expect(() => buildDecisionWrite({ ...args, reason: null })).toThrow(/buildDecisionWrite/);
    expect(() =>
      buildDecisionWrite({ ...args, proposal: awaitingOwner(), actor: "owner", constraint_id: null }),
    ).toThrow(/buildDecisionWrite/);
    expect(() =>
      buildDecisionWrite({
        ...args,
        proposal: awaitingOwner(),
        actor: "owner",
        requested: "approved",
        reason: null,
        constraint_id: KCON,
      }),
    ).toThrow(/buildDecisionWrite/);
    expect(() => buildDecisionWrite({ ...args, requested: "feasible", constraint_id: null })).toThrow(
      /buildDecisionWrite/,
    );
  });

  it("4.T16 the written proposal has no undefined at any depth, for all four decisions", () => {
    const writes = [
      buildDecisionWrite({ ...args, requested: "feasible", reason: null, constraint_id: null }),
      buildDecisionWrite(args),
      buildDecisionWrite({
        ...args,
        proposal: awaitingOwner(),
        actor: "owner",
        requested: "approved",
        reason: null,
        constraint_id: null,
      }),
      buildDecisionWrite({ ...args, proposal: awaitingOwner(), actor: "owner" }),
    ];
    for (const w of writes) {
      expect(hasUndefined(w.proposal)).toBe(false);
      expect(hasUndefined(w.audit)).toBe(false);
      expect(w.proposal.supervisor_review).not.toBeUndefined();
      expect(w.proposal.owner_decision).not.toBeUndefined();
    }
  });

  it("an R-08-era proposal (keys absent) still gets explicit nulls where unset", () => {
    const w = buildDecisionWrite({ ...args, requested: "feasible", reason: null, constraint_id: null });
    expect(w.proposal.owner_decision).toBeNull();
  });
});
