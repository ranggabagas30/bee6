import { describe, expect, it } from "vitest";
import {
  ApproveBodySchema,
  DECISION_CONFLICT_CODES,
  ListProposalsResponseSchema,
  ProposalIdSchema,
  ProposalListItemSchema,
  ReviewBodySchema,
} from "@/lib/proposals/review-contract";

describe("DECISION_CONFLICT_CODES (R-10)", () => {
  it("carries the ship refusals so a refused approval is a typed 409", () => {
    expect(DECISION_CONFLICT_CODES).toEqual(
      expect.arrayContaining(["SOP_CHANGED", "SOP_STEP_LIMIT", "LEGACY_PROPOSAL", "STEP_TEXT_TOO_LONG"]),
    );
  });
});

const U1 = "11111111-1111-4111-8111-111111111111";

describe("ReviewBodySchema", () => {
  it("feasible without an ack defaults to []", () => {
    expect(ReviewBodySchema.parse({ decision: "feasible" })).toEqual({
      decision: "feasible",
      acknowledged_constraint_ids: [],
    });
  });
  it("reject trims the reason; 2 chars after trim fails; 300 ok; 301 fails", () => {
    expect(ReviewBodySchema.safeParse({ decision: "reject", reason: "  ok  " }).success).toBe(false);
    expect(ReviewBodySchema.parse({ decision: "reject", reason: "  oven is small  " })).toEqual({
      decision: "reject",
      reason: "oven is small",
    });
    expect(ReviewBodySchema.safeParse({ decision: "reject", reason: "x".repeat(300) }).success).toBe(true);
    expect(ReviewBodySchema.safeParse({ decision: "reject", reason: "x".repeat(301) }).success).toBe(false);
  });
  it("rejects the wrong decision, extra keys, a missing reason and bad acks", () => {
    expect(ReviewBodySchema.safeParse({ decision: "approve" }).success).toBe(false);
    expect(ReviewBodySchema.safeParse({ decision: "feasible", extra: 1 }).success).toBe(false);
    expect(ReviewBodySchema.safeParse({ decision: "reject" }).success).toBe(false);
    expect(
      ReviewBodySchema.safeParse({ decision: "feasible", acknowledged_constraint_ids: ["nope"] }).success,
    ).toBe(false);
    const many = Array.from({ length: 201 }, () => U1);
    expect(
      ReviewBodySchema.safeParse({ decision: "feasible", acknowledged_constraint_ids: many }).success,
    ).toBe(false);
    expect(ReviewBodySchema.safeParse({ decision: "feasible", acknowledged_constraint_ids: [U1] }).success).toBe(
      true,
    );
  });
});

describe("ApproveBodySchema", () => {
  it("approve without an ack defaults to []", () => {
    expect(ApproveBodySchema.parse({ decision: "approve" })).toEqual({
      decision: "approve",
      acknowledged_constraint_ids: [],
    });
  });
  it("reject bounds mirror the review body", () => {
    expect(ApproveBodySchema.safeParse({ decision: "reject", reason: "  ok  " }).success).toBe(false);
    expect(ApproveBodySchema.safeParse({ decision: "reject", reason: "x".repeat(300) }).success).toBe(true);
    expect(ApproveBodySchema.safeParse({ decision: "reject", reason: "x".repeat(301) }).success).toBe(false);
    expect(ApproveBodySchema.safeParse({ decision: "reject" }).success).toBe(false);
  });
  it("rejects feasible, extra keys and bad acks", () => {
    expect(ApproveBodySchema.safeParse({ decision: "feasible" }).success).toBe(false);
    expect(ApproveBodySchema.safeParse({ decision: "approve", extra: 1 }).success).toBe(false);
    expect(
      ApproveBodySchema.safeParse({ decision: "approve", acknowledged_constraint_ids: ["nope"] }).success,
    ).toBe(false);
  });
});

describe("ProposalIdSchema", () => {
  it("accepts a uuid only", () => {
    expect(ProposalIdSchema.safeParse(U1).success).toBe(true);
    expect(ProposalIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("ListProposalsResponseSchema", () => {
  const item = {
    proposal: {
      proposal_id: U1,
      status: "suppressed",
      created_at_ms: 1,
      range: { from_date: "2026-10-01", to_date: "2026-10-02" },
      focus_category: null,
      suppression: {
        reason: "insufficient_evidence",
        model_reason: null,
        followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
      },
      blocked_rule: null,
      content: null,
    },
    review: { supervisor: null, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
  };
  it("an item parses and an extra key fails", () => {
    expect(ProposalListItemSchema.safeParse(item).success).toBe(true);
    expect(ProposalListItemSchema.safeParse({ ...item, extra: 1 }).success).toBe(false);
  });
  const watch = { from_date: "2026-10-01", to_date: "2026-10-07", categories: [] };
  it("rejects 21 open items", () => {
    const open = Array.from({ length: 21 }, () => item);
    expect(ListProposalsResponseSchema.safeParse({ open, decided: [], watch }).success).toBe(false);
    expect(ListProposalsResponseSchema.safeParse({ open: open.slice(0, 20), decided: [], watch }).success).toBe(true);
  });
  it("R-19 PR-12a: `watch` is required on the wire", () => {
    expect(ListProposalsResponseSchema.safeParse({ open: [], decided: [] }).success).toBe(false);
    expect(ListProposalsResponseSchema.safeParse({ open: [], decided: [], watch }).success).toBe(true);
  });
});
