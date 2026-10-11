import { describe, expect, it } from "vitest";
import {
  FastForwardBodySchema,
  FastForwardResponseSchema,
  ListReviewsResponseSchema,
  ReviewViewSchema,
  RunResponseSchema,
  VerdictBodySchema,
  VerdictResponseSchema,
  VersionParamSchema,
} from "@/lib/reviews/contract";

const win = { from_date: "2026-10-06", to_date: "2026-10-12", days_captured: 3, count: 6 };
const view = {
  version: 2,
  change_title: "Check the display",
  metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 4, baseline_days: 3 },
  failure_condition: "f",
  effective_from_date: "2026-10-16",
  review_date: "2026-10-23",
  confirm_by_date: "2026-10-30",
  before: win,
  after: { ...win, from_date: "2026-10-16", to_date: "2026-10-22", count: 2 },
  suggestion: { verdict: "worked", reason: "improved", change_ratio: -0.667 },
  notices: { overlapping_change: false, threads_truncated: false },
  simulated: false,
  status: "awaiting_supervisor",
  supervisor: null,
  owner: null,
};

describe("review contract", () => {
  it("VerdictBodySchema: reason optional; trims; 3..300; strict", () => {
    expect(VerdictBodySchema.safeParse({ verdict: "worked" }).success).toBe(true);
    expect(VerdictBodySchema.safeParse({ verdict: "worked", reason: "  ab " }).success).toBe(false);
    expect(VerdictBodySchema.safeParse({ verdict: "worked", reason: "x".repeat(300) }).success).toBe(true);
    expect(VerdictBodySchema.safeParse({ verdict: "worked", reason: "x".repeat(301) }).success).toBe(false);
    expect(VerdictBodySchema.safeParse({ verdict: "worked", reason: "  abc  " })).toMatchObject({ success: true, data: { reason: "abc" } });
    expect(VerdictBodySchema.safeParse({ verdict: "unknown" }).success).toBe(false);
    expect(VerdictBodySchema.safeParse({ verdict: "worked", extra: 1 }).success).toBe(false);
  });

  it("VersionParamSchema: '2' -> 2; '1', 'x', '2.5' fail", () => {
    expect(VersionParamSchema.parse("2")).toBe(2);
    for (const bad of ["1", "x", "2.5", "", "-3"]) expect(VersionParamSchema.safeParse(bad).success).toBe(false);
  });

  it("FastForwardBodySchema is an empty strict object", () => {
    expect(FastForwardBodySchema.safeParse({}).success).toBe(true);
    expect(FastForwardBodySchema.safeParse({ a: 1 }).success).toBe(false);
  });

  it("ReviewViewSchema is strict and carries no internal ids", () => {
    expect(ReviewViewSchema.safeParse(view).success).toBe(true);
    expect(ReviewViewSchema.safeParse({ ...view, source_proposal_id: "x" }).success).toBe(false);
    expect(ReviewViewSchema.safeParse({ ...view, sop_version_id: "x" }).success).toBe(false);
  });

  it("ListReviewsResponseSchema rejects 21 open and 11 decided", () => {
    const ok = { fast_forward_available: false, open: [view], decided: [] };
    expect(ListReviewsResponseSchema.safeParse(ok).success).toBe(true);
    expect(ListReviewsResponseSchema.safeParse({ ...ok, open: Array(21).fill(view) }).success).toBe(false);
    expect(ListReviewsResponseSchema.safeParse({ ...ok, open: Array(20).fill(view) }).success).toBe(true);
    expect(ListReviewsResponseSchema.safeParse({ ...ok, decided: Array(11).fill(view) }).success).toBe(false);
  });

  it("responses are strict", () => {
    expect(VerdictResponseSchema.safeParse({ result: "recorded", status: "awaiting_owner" }).success).toBe(true);
    expect(VerdictResponseSchema.safeParse({ result: "done", status: "awaiting_owner" }).success).toBe(false);
    expect(FastForwardResponseSchema.safeParse({ version: 2 }).success).toBe(true);
    expect(FastForwardResponseSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(RunResponseSchema.safeParse({ outlets: 1, created: 0, expired: 0, errors: 0 }).success).toBe(true);
    expect(RunResponseSchema.safeParse({ outlets: 1, created: 0, expired: 0 }).success).toBe(false);
  });
});
