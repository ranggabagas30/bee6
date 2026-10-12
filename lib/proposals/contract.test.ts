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
