import { describe, expect, it } from "vitest";
import { GenerateBodySchema, GenerateResponseSchema, ProposalViewSchema } from "@/lib/proposals/contract";

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
        focus_category: null,
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

  it("R-19 PR-12a: focus_category is required on the wire (null allowed, absent rejected)", () => {
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
    expect(ProposalViewSchema.safeParse(base).success).toBe(false);
    expect(ProposalViewSchema.safeParse({ ...base, focus_category: null }).success).toBe(true);
  });

  it("R-19 PR-12a: a target step on the wire carries its current text (the old wording the detail strikes through)", () => {
    const content = {
      intervention: { id: "i", label_en: "I", label_id: "I" },
      rubric: [{ id: "r", label_en: "R", label_id: "R" }],
      target_step: { step_id: "stock-01", title: "Display check", text: "Check the display every hour." },
      change_title: "T",
      change_text: "C",
      rationale: "R",
      metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "D", baseline_count: 1, baseline_days: 1 },
      failure_condition: "F",
      review_date: "2026-10-21",
      evidence: [
        { date: "2026-10-01", start_hm: "09:00", category: "CUSTOMER_SERVICE", summary: "s" },
        { date: "2026-10-02", start_hm: "09:00", category: "CUSTOMER_SERVICE", summary: null },
      ],
      censored_floor: true,
    };
    const view = {
      proposal_id: "33333333-3333-4333-8333-333333333333",
      status: "awaiting_supervisor",
      created_at_ms: 1,
      range: { from_date: "2026-10-01", to_date: "2026-10-07" },
      focus_category: "CUSTOMER_SERVICE",
      suppression: null,
      blocked_rule: null,
      content,
    };
    expect(ProposalViewSchema.safeParse(view).success).toBe(true);
    expect(ProposalViewSchema.safeParse({ ...view, content: { ...content, target_step: { step_id: "stock-01", title: "Display check" } } }).success).toBe(false);
    expect(ProposalViewSchema.safeParse({ ...view, content: { ...content, target_step: { step_id: "gone", title: "gone", text: null } } }).success).toBe(true);
  });

  it("rejects a response with an extra top-level key", () => {
    const response = {
      proposal: {
        proposal_id: "33333333-3333-4333-8333-333333333333",
        status: "suppressed",
        created_at_ms: 1,
        range: { from_date: "2026-10-01", to_date: "2026-10-07" },
        focus_category: null,
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

// CHK-1: the optional `checked` block on the view (counts and enums only; strict).
describe("ProposalViewSchema: checked (CHK-1)", () => {
  const BASE = {
    proposal_id: "33333333-3333-4333-8333-333333333333",
    status: "suppressed",
    created_at_ms: 1,
    range: { from_date: "2026-10-01", to_date: "2026-10-07" },
    focus_category: null,
    suppression: {
      reason: "insufficient_evidence",
      model_reason: null,
      followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
    },
    blocked_rule: null,
    content: null,
  };
  const CHECKED = {
    checks_total: 18,
    checks_passed: 18,
    rule_set: "pcheck-v4",
    agent: "proposal-v4",
    revisions: 1,
    read_sections: 1,
    read_facts: 2,
  };

  it("a view without `checked` still parses (a response from a server that predates CHK-1)", () => {
    expect(ProposalViewSchema.safeParse(BASE).success).toBe(true);
  });

  it("accepts null and a full block; read counts may be null (v3)", () => {
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: null }).success).toBe(true);
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: CHECKED }).success).toBe(true);
    expect(
      ProposalViewSchema.safeParse({
        ...BASE,
        checked: { ...CHECKED, rule_set: "pgate-v1", agent: "proposal-v3", read_sections: null, read_facts: null },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown key inside `checked` (strict)", () => {
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: { ...CHECKED, tool_names: ["get_evidence"] } }).success).toBe(false);
  });

  it("rejects an unknown rule set or agent, negative counts and more than two revisions", () => {
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: { ...CHECKED, rule_set: "pcheck-v9" } }).success).toBe(false);
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: { ...CHECKED, agent: "gpt" } }).success).toBe(false);
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: { ...CHECKED, checks_total: -1 } }).success).toBe(false);
    expect(ProposalViewSchema.safeParse({ ...BASE, checked: { ...CHECKED, revisions: 3 } }).success).toBe(false);
  });
});
