import { describe, expect, it } from "vitest";
import type { Review, SopVersion } from "@/lib/firestore/schema";
import {
  buildExpiry,
  buildReview,
  buildVerdictWrite,
  classifyVerdict,
  dueChanges,
  memoryOutcomes,
  nextFastForward,
} from "@/lib/reviews/plan";
import { OUTLET, outcomeDoc, REASON_SENTINEL, reviewDoc, seedV1, shippedVersion, verdictEntry, windowDoc } from "@/lib/reviews/testing/fixtures";

const NOW = 1_700_000_300_000;
const v1 = seedV1();
const v2 = shippedVersion(2, "2026-10-16", "2026-10-23");

function hasUndefined(x: unknown): boolean {
  if (x === undefined) return true;
  if (Array.isArray(x)) return x.some(hasUndefined);
  if (x && typeof x === "object") return Object.values(x).some(hasUndefined);
  return false;
}

describe("dueChanges", () => {
  const ids = (vs: SopVersion[]) => vs.map((v) => v.version);
  const none = new Set<string>();

  it("2.T6 review_date today -> due; yesterday (catch-up) -> due; tomorrow -> not", () => {
    expect(ids(dueChanges({ versions: [v1, v2], reviewedIds: none, today: "2026-10-23" }))).toEqual([2]);
    expect(ids(dueChanges({ versions: [v1, v2], reviewedIds: none, today: "2026-10-25" }))).toEqual([2]);
    expect(ids(dueChanges({ versions: [v1, v2], reviewedIds: none, today: "2026-10-22" }))).toEqual([]);
  });

  it("2.T6 already reviewed -> not due; seed v1 never; sorted by version asc", () => {
    const v3 = shippedVersion(3, "2026-10-17", "2026-10-24");
    expect(ids(dueChanges({ versions: [v3, v1, v2], reviewedIds: new Set([`${OUTLET}:v2`]), today: "2026-11-01" }))).toEqual([3]);
    expect(ids(dueChanges({ versions: [v3, v1, v2], reviewedIds: none, today: "2026-11-01" }))).toEqual([2, 3]);
    expect(ids(dueChanges({ versions: [v1], reviewedIds: none, today: "2099-01-01" }))).toEqual([]);
  });
});

describe("nextFastForward", () => {
  it("2.T7 includes a future review_date; lowest version first; null when all reviewed", () => {
    const v3 = shippedVersion(3, "2026-10-17", "2026-12-01");
    const none = new Set<string>();
    expect(nextFastForward({ versions: [v3, v1, v2], reviewedIds: none })?.version).toBe(2);
    expect(nextFastForward({ versions: [v3, v1, v2], reviewedIds: new Set([`${OUTLET}:v2`]) })?.version).toBe(3);
    expect(nextFastForward({ versions: [v1, v2, v3], reviewedIds: new Set([`${OUTLET}:v2`, `${OUTLET}:v3`]) })).toBeNull();
    expect(nextFastForward({ versions: [v1], reviewedIds: none })).toBeNull();
  });
});

describe("buildReview", () => {
  const before = windowDoc();
  const after = windowDoc({ from_date: "2026-10-16", to_date: "2026-10-22", count: 2 });
  const build = (versions: SopVersion[], over: Record<string, unknown> = {}) =>
    buildReview({ sop: v2, versions, before, after, threads_truncated: false, simulated: false, now_ms: NOW, ...over });

  it("2.T8 is schema-valid with confirm_by_date review_date + 7 and the worked suggestion", () => {
    const r = build([v1, v2]);
    expect(r.review_id).toBe(`${OUTLET}:v2`);
    expect(r.confirm_by_date).toBe("2026-10-30");
    expect(r.status).toBe("awaiting_supervisor");
    expect(r.suggestion).toMatchObject({ verdict: "worked", reason: "improved" });
    expect(r.created_at_ms).toBe(NOW);
    expect(hasUndefined(r)).toBe(false);
  });

  it("2.T8 overlapping_change true when v3 is effective 2026-10-20, false when effective 2026-10-23", () => {
    expect(build([v1, v2, shippedVersion(3, "2026-10-20", "2026-10-27")]).notices.overlapping_change).toBe(true);
    expect(build([v1, v2, shippedVersion(3, "2026-10-23", "2026-10-30")]).notices.overlapping_change).toBe(false);
  });

  it("2.T8 R-10 handoff: v3 approved the SAME day as v2 (same effective_from_date) is an overlap", () => {
    const sameDay = shippedVersion(3, "2026-10-16", "2026-10-23");
    expect(build([v1, v2, sameDay]).notices.overlapping_change).toBe(true);
    // the later version's own review has no later version, so no notice
    expect(buildReview({ sop: sameDay, versions: [v1, v2, sameDay], before, after, threads_truncated: false, simulated: false, now_ms: NOW }).notices.overlapping_change).toBe(false);
  });

  it("2.T8 an earlier version never counts as overlapping; carries simulated and truncated", () => {
    const r = build([v1, v2], { simulated: true, threads_truncated: true });
    expect(r.notices).toEqual({ overlapping_change: false, threads_truncated: true });
    expect(r.simulated).toBe(true);
  });
});

describe("classifyVerdict", () => {
  const base = { outlet_id: OUTLET, today: "2026-10-24" };
  const sup = (r: Review | null, verdict: "worked" | "revise" | "revert" = "revise", today = base.today) =>
    classifyVerdict({ review: r, outlet_id: OUTLET, actor: "supervisor", verdict, today });
  const own = (r: Review | null, verdict: "worked" | "revise" | "revert" = "worked", today = base.today) =>
    classifyVerdict({ review: r, outlet_id: OUTLET, actor: "owner", verdict, today });
  const awaitingOwner = () => reviewDoc({ status: "awaiting_owner", supervisor_verdict: verdictEntry("revise") });
  const confirmed = () =>
    reviewDoc({ status: "confirmed", supervisor_verdict: verdictEntry("revise"), owner_verdict: verdictEntry("worked") });

  it("2.T9 missing or foreign review -> not_found", () => {
    expect(sup(null)).toEqual({ kind: "not_found" });
    expect(classifyVerdict({ review: reviewDoc(), outlet_id: "other", actor: "supervisor", verdict: "worked", today: base.today })).toEqual({ kind: "not_found" });
  });

  it("2.T9 owner on awaiting_supervisor -> NOT_YET_REVIEWABLE", () => {
    expect(own(reviewDoc())).toEqual({ kind: "conflict", code: "NOT_YET_REVIEWABLE" });
  });

  it("2.T9 supervisor: proceed / unchanged / ALREADY_DECIDED", () => {
    expect(sup(reviewDoc())).toMatchObject({ kind: "proceed" });
    expect(sup(awaitingOwner(), "revise")).toEqual({ kind: "unchanged", status: "awaiting_owner" });
    expect(sup(awaitingOwner(), "worked")).toEqual({ kind: "conflict", code: "ALREADY_DECIDED" });
    expect(sup(confirmed(), "revise")).toEqual({ kind: "unchanged", status: "confirmed" });
  });

  it("2.T9 owner: proceed / unchanged / ALREADY_DECIDED", () => {
    expect(own(awaitingOwner())).toMatchObject({ kind: "proceed" });
    expect(own(confirmed(), "worked")).toEqual({ kind: "unchanged", status: "confirmed" });
    expect(own(confirmed(), "revert")).toEqual({ kind: "conflict", code: "ALREADY_DECIDED" });
  });

  it("2.T9 anything on unknown -> EXPIRED", () => {
    const u = reviewDoc({ status: "unknown" });
    expect(sup(u)).toEqual({ kind: "conflict", code: "EXPIRED" });
    expect(own(u)).toEqual({ kind: "conflict", code: "EXPIRED" });
  });

  it("2.T9 after confirm_by_date -> EXPIRED; on it -> proceed", () => {
    expect(sup(reviewDoc(), "revise", "2026-10-31")).toEqual({ kind: "conflict", code: "EXPIRED" });
    expect(sup(reviewDoc(), "revise", "2026-10-30")).toMatchObject({ kind: "proceed" });
    expect(own(awaitingOwner(), "worked", "2026-10-31")).toEqual({ kind: "conflict", code: "EXPIRED" });
  });
});

describe("buildVerdictWrite", () => {
  it("2.T10 supervisor -> awaiting_owner, no outcome, audit without reason", () => {
    const w = buildVerdictWrite({ review: reviewDoc(), actor: "supervisor", verdict: "revise", reason: REASON_SENTINEL, now_ms: NOW });
    expect(w.review.status).toBe("awaiting_owner");
    expect(w.review.supervisor_verdict).toEqual({ verdict: "revise", reason: REASON_SENTINEL, decided_at_ms: NOW });
    expect(w.review.updated_at_ms).toBe(NOW);
    expect(w.outcome).toBeNull();
    expect(w.audit).toMatchObject({ actor_role: "supervisor", action: "review.supervisor_verdict", target_type: "review", target_id: `${OUTLET}:v2` });
    expect(w.audit.details).toEqual({ version: 2, verdict: "revise", from_status: "awaiting_supervisor", to_status: "awaiting_owner", simulated: false });
    expect(JSON.stringify(w.audit)).not.toContain(REASON_SENTINEL);
    expect(hasUndefined(w)).toBe(false);
  });

  it("2.T10 owner picking a different verdict -> outcome is the owner's; both stored; no reason in outcome/audit", () => {
    const r = reviewDoc({ status: "awaiting_owner", supervisor_verdict: verdictEntry("revise", "sup reason") });
    const w = buildVerdictWrite({ review: r, actor: "owner", verdict: "worked", reason: REASON_SENTINEL, now_ms: NOW });
    expect(w.review.status).toBe("confirmed");
    expect(w.review.owner_verdict?.verdict).toBe("worked");
    expect(w.outcome).toMatchObject({
      outcome_id: `${OUTLET}:v2`,
      verdict: "worked",
      supervisor_verdict: "revise",
      suggested_verdict: "worked",
      in_memory: true,
      simulated: false,
      decided_at_ms: NOW,
      metric_category: "CUSTOMER_SERVICE",
      metric_direction: "decrease",
    });
    expect(JSON.stringify(w.outcome)).not.toContain(REASON_SENTINEL);
    expect(JSON.stringify(w.outcome)).not.toContain("sup reason");
    expect(JSON.stringify(w.audit)).not.toContain(REASON_SENTINEL);
    expect(w.audit).toMatchObject({ actor_role: "owner", action: "review.owner_verdict" });
    expect(hasUndefined(w)).toBe(false);
  });

  it("2.T10 a simulated review makes a simulated outcome", () => {
    const r = reviewDoc({ simulated: true, status: "awaiting_owner", supervisor_verdict: verdictEntry("revise") });
    expect(buildVerdictWrite({ review: r, actor: "owner", verdict: "revert", reason: null, now_ms: NOW }).outcome?.simulated).toBe(true);
  });
});

describe("buildExpiry", () => {
  it("2.T11 from awaiting_supervisor -> unknown, outcome unknown, not in memory", () => {
    const w = buildExpiry({ review: reviewDoc(), now_ms: NOW });
    expect(w.review.status).toBe("unknown");
    expect(w.review.updated_at_ms).toBe(NOW);
    expect(w.outcome).toMatchObject({ verdict: "unknown", in_memory: false, supervisor_verdict: null, outcome_id: `${OUTLET}:v2`, decided_at_ms: NOW });
    expect(w.audit).toMatchObject({ actor_role: "system", action: "review.expired", target_id: `${OUTLET}:v2` });
    expect(w.audit.details).toEqual({ version: 2, from_status: "awaiting_supervisor", simulated: false });
    expect(hasUndefined(w)).toBe(false);
  });

  it("2.T11 from awaiting_owner keeps the supervisor's verdict on review and outcome", () => {
    const r = reviewDoc({ status: "awaiting_owner", supervisor_verdict: verdictEntry("revise", "kept") });
    const w = buildExpiry({ review: r, now_ms: NOW });
    expect(w.review.supervisor_verdict).toEqual(verdictEntry("revise", "kept"));
    expect(w.outcome).toMatchObject({ verdict: "unknown", in_memory: false, supervisor_verdict: "revise" });
    expect(JSON.stringify(w.outcome)).not.toContain("kept");
  });

  it("2.T11 throws from confirmed and from unknown", () => {
    const c = reviewDoc({ status: "confirmed", supervisor_verdict: verdictEntry("revise"), owner_verdict: verdictEntry("worked") });
    expect(() => buildExpiry({ review: c, now_ms: NOW })).toThrow();
    expect(() => buildExpiry({ review: reviewDoc({ status: "unknown" }), now_ms: NOW })).toThrow();
  });
});

describe("memoryOutcomes", () => {
  it("2.T13 drops unknown and keeps the rest", () => {
    const worked = outcomeDoc();
    const unknown = outcomeDoc({ verdict: "unknown", in_memory: false, supervisor_verdict: null });
    const revert = outcomeDoc({ verdict: "revert" });
    expect(memoryOutcomes([worked, unknown, revert])).toEqual([worked, revert]);
  });
});
