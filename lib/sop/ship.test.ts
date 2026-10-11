import { describe, expect, it } from "vitest";
import { effectiveFromDate, newStepId, planShip, shipReviewDate, SOP_MAX_STEPS } from "@/lib/sop/ship";
import { PROPOSAL_ID, proposalV1, seedV1 } from "@/lib/sop/testing/fixtures";
import type { SopVersion } from "@/lib/firestore/schema";

const TZ = "Asia/Jakarta";
const NOW = Date.parse("2026-10-15T16:30:00Z"); // 23:30 WIB on 15 Oct

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object") {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
function hasUndefined(v: unknown): boolean {
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.some(hasUndefined);
  if (v !== null && typeof v === "object") return Object.values(v).some(hasUndefined);
  return false;
}
function ship(current: SopVersion | null, proposal = proposalV1(), now = NOW) {
  return planShip({ current, proposal, now_ms: now, tz: TZ });
}
function shipped(current: SopVersion | null, proposal = proposalV1(), now = NOW) {
  const plan = ship(current, proposal, now);
  if (plan.kind !== "ship") throw new Error(`expected ship, got ${plan.code}`);
  return plan;
}

describe("planShip conflicts", () => {
  it("3.T3 current null, id mismatch, or missing target step is SOP_CHANGED", () => {
    expect(ship(null)).toEqual({ kind: "conflict", code: "SOP_CHANGED" });
    const v2like = { ...seedV1(), sop_version_id: "o1:v2", version: 2 } as SopVersion;
    expect(ship(v2like)).toEqual({ kind: "conflict", code: "SOP_CHANGED" });
    const gone = proposalV1({}, { target_step_id: "gone-01" });
    expect(ship(seedV1(), gone)).toEqual({ kind: "conflict", code: "SOP_CHANGED" });
  });

  it("3.T7 a 200-step SOP refuses a new step but still modifies", () => {
    const full = seedV1(SOP_MAX_STEPS);
    expect(full.steps).toHaveLength(200);
    expect(ship(full, proposalV1({}, { target_step_id: null }))).toEqual({ kind: "conflict", code: "SOP_STEP_LIMIT" });
    expect(ship(full).kind).toBe("ship");
  });

  it("3.T9 a proposal that is not awaiting_owner, or has no content, throws", () => {
    expect(() => ship(seedV1(), proposalV1({ status: "awaiting_supervisor", supervisor_review: null }))).toThrow(
      /not shippable/,
    );
    const noContent = { ...proposalV1(), content: null } as ReturnType<typeof proposalV1>;
    expect(() => ship(seedV1(), noContent)).toThrow(/not shippable/);
  });
});

describe("planShip modify", () => {
  it("3.T4 replaces only the target step's text, keeps title and role, never mutates inputs", () => {
    const v1 = deepFreeze(seedV1());
    const proposal = deepFreeze(proposalV1());
    const plan = shipped(v1, proposal);
    const v2 = plan.sop_version;
    expect(v2.version).toBe(2);
    expect(v2.sop_version_id).toBe("o1:v2");
    expect(v2.previous_version_id).toBe("o1:v1");
    expect(v2.source).toBe("proposal");
    expect(v2.source_proposal_id).toBe(PROPOSAL_ID);
    expect(v2.steps.map((s) => s.step_id)).toEqual(v1.steps.map((s) => s.step_id));
    v2.steps.forEach((s, i) => {
      if (s.step_id === "stock-01") {
        expect(s.title).toBe(v1.steps[i]!.title);
        expect(s.role).toBe(v1.steps[i]!.role);
        expect(s.text).toBe(proposal.content!.change_text);
      } else {
        expect(s).toEqual(v1.steps[i]);
      }
    });
    expect(v2.change!.kind).toBe("modify");
    expect(v2.change!.before).toEqual(v1.steps[0]);
    expect(v2.change!.change_title).toBe(proposal.content!.change_title);
    expect(v2.change!.approved_at_ms).toBe(NOW);
    expect(v2.created_at_ms).toBe(NOW);
  });
});

describe("planShip add", () => {
  const add = () => proposalV1({}, { target_step_id: null });

  it("3.T5 appends a staff step last with a p- id and before null", () => {
    const v1 = seedV1();
    const plan = shipped(v1, add());
    const v2 = plan.sop_version;
    expect(v2.steps).toHaveLength(6);
    expect(v2.steps.slice(0, 5)).toEqual(v1.steps);
    expect(v2.steps[5]).toEqual({
      step_id: newStepId(PROPOSAL_ID),
      title: "Check the display every 30 minutes at peak",
      text: add().content!.change_text,
      role: "staff",
    });
    expect(v2.change!.kind).toBe("add");
    expect(v2.change!.before).toBeNull();
  });

  it("3.T5 newStepId is lower-case, 34 chars, and matches the step id pattern", () => {
    const id = newStepId("6F1C2D3E-4A5B-4C6D-8E7F-0A1B2C3D4E5F");
    expect(id).toBe("p-6f1c2d3e4a5b4c6d8e7f0a1b2c3d4e5f");
    expect(id).toHaveLength(34);
    expect(id).toMatch(/^[a-z0-9][a-z0-9_-]{0,39}$/);
  });

  it("3.T6 an 800-char change_text and a 160-char change_title ship", () => {
    const p = proposalV1({}, { target_step_id: null, change_text: "x".repeat(800), change_title: "t".repeat(160) });
    const v2 = shipped(seedV1(), p).sop_version;
    expect(v2.steps.at(-1)!.text).toHaveLength(800);
    expect(v2.steps.at(-1)!.title).toHaveLength(160);
  });
});

describe("dates", () => {
  it("3.T8 effective date is the outlet-local next calendar date (Asia/Jakarta)", () => {
    expect(effectiveFromDate(Date.parse("2026-10-15T16:30:00Z"), TZ)).toBe("2026-10-16"); // 23:30 WIB
    expect(effectiveFromDate(Date.parse("2026-10-15T17:30:00Z"), TZ)).toBe("2026-10-17"); // 00:30 WIB on the 16th
  });

  it("3.T8 review date counts review_after_days from the effective date", () => {
    expect(shipReviewDate("2026-10-16", 7)).toBe("2026-10-23");
    expect(shipReviewDate("2026-10-17", 7)).toBe("2026-10-24");
    expect(shipReviewDate("2026-10-16", 28)).toBe("2026-11-13");
    const a = shipped(seedV1(), proposalV1(), Date.parse("2026-10-15T16:30:00Z"));
    expect([a.effective_from_date, a.review_date]).toEqual(["2026-10-16", "2026-10-23"]);
    expect(a.sop_version.effective_from_date).toBe("2026-10-16");
    expect(a.sop_version.change!.review_date).toBe("2026-10-23");
    const b = shipped(seedV1(), proposalV1(), Date.parse("2026-10-15T17:30:00Z"));
    expect([b.effective_from_date, b.review_date]).toEqual(["2026-10-17", "2026-10-24"]);
    const c = shipped(seedV1(), proposalV1({}, { review_after_days: 28 }));
    expect(c.review_date).toBe(shipReviewDate(c.effective_from_date, 28));
  });
});

describe("planShip output", () => {
  it("3.T10 has no undefined at any depth", () => {
    expect(hasUndefined(shipped(seedV1()).sop_version)).toBe(false);
    expect(hasUndefined(shipped(seedV1(), proposalV1({}, { target_step_id: null })).sop_version)).toBe(false);
  });
});
