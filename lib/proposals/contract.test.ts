import { describe, expect, it } from "vitest";
import { GenerateBodySchema, GenerateResponseSchema } from "@/lib/proposals/contract";

describe("GenerateBodySchema", () => {
  it("accepts a valid body", () => {
    expect(GenerateBodySchema.safeParse({ from_date: "2026-10-01", to_date: "2026-10-07" }).success).toBe(
      true,
    );
  });

  it("rejects an unreal date", () => {
    expect(GenerateBodySchema.safeParse({ from_date: "2026-02-30", to_date: "2026-10-07" }).success).toBe(
      false,
    );
  });

  it("rejects an extra key (strict)", () => {
    expect(
      GenerateBodySchema.safeParse({ from_date: "2026-10-01", to_date: "2026-10-07", extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(GenerateBodySchema.safeParse({ from_date: "2026-10-01" }).success).toBe(false);
  });

  it("R-19 3.3: accepts an optional boolean `another`, rejects a non-boolean one", () => {
    expect(GenerateBodySchema.safeParse({ from_date: "2026-10-01", to_date: "2026-10-07", another: true }).success).toBe(true);
    expect(GenerateBodySchema.safeParse({ from_date: "2026-10-01", to_date: "2026-10-07", another: false }).success).toBe(true);
    expect(GenerateBodySchema.safeParse({ from_date: "2026-10-01", to_date: "2026-10-07", another: "yes" }).success).toBe(false);
    expect(GenerateBodySchema.safeParse({ from_date: "2026-10-01", to_date: "2026-10-07", another: 1 }).success).toBe(false);
  });
});

describe("GenerateResponseSchema", () => {
  it("accepts a suppressed view", () => {
    const response = {
      proposal: {
        proposal_id: "33333333-3333-4333-8333-333333333333",
        status: "suppressed",
        created_at_ms: 1,
        range: { from_date: "2026-10-01", to_date: "2026-10-07" },
        suppression: {
          reason: "insufficient_evidence",
          model_reason: null,
          followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
        },
        blocked_rule: null,
        content: null,
      },
      reused: false,
    };
    expect(GenerateResponseSchema.safeParse(response).success).toBe(true);
  });

  it("R-19 3.3: the view carries focus_category (a work category or null); a non-category is rejected", () => {
    const base = {
      proposal_id: "33333333-3333-4333-8333-333333333333",
      status: "suppressed",
      created_at_ms: 1,
      range: { from_date: "2026-10-01", to_date: "2026-10-07" },
      suppression: {
        reason: "insufficient_evidence",
        model_reason: null,
        followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
      },
      blocked_rule: null,
      content: null,
    };
    expect(GenerateResponseSchema.safeParse({ proposal: { ...base, focus_category: null }, reused: false }).success).toBe(true);
    expect(GenerateResponseSchema.safeParse({ proposal: { ...base, focus_category: "PHONE_CALL" }, reused: false }).success).toBe(true);
    expect(GenerateResponseSchema.safeParse({ proposal: { ...base, focus_category: "NON_WORK" }, reused: false }).success).toBe(false);
    expect(GenerateResponseSchema.safeParse({ proposal: { ...base, focus_category: "x" }, reused: false }).success).toBe(false);
  });

  it("rejects a response with an extra top-level key", () => {
    const response = {
      proposal: {
        proposal_id: "33333333-3333-4333-8333-333333333333",
        status: "suppressed",
        created_at_ms: 1,
        range: { from_date: "2026-10-01", to_date: "2026-10-07" },
        suppression: {
          reason: "insufficient_evidence",
          model_reason: null,
          followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
        },
        blocked_rule: null,
        content: null,
      },
      reused: false,
      extra: 1,
    };
    expect(GenerateResponseSchema.safeParse(response).success).toBe(false);
  });
});
