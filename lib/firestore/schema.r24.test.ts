import { describe, expect, it } from "vitest";
import { PGATE_V1_RULES, PROPOSAL_RULES, ProposalSchema } from "@/lib/firestore/schema";
import { ProposalViewSchema } from "@/lib/proposals/contract";
// Importing the gate runs its module-load assertion that its own rules are all members of PROPOSAL_RULES.
import "@/lib/proposals/proposal-gate";

const base = {
  outlet_id: "demo-outlet",
  proposal_id: "44444444-4444-4444-8444-444444444444",
  status: "blocked" as const,
  requested_by_role: "supervisor" as const,
  range: { from_date: "2026-10-01", to_date: "2026-10-02" },
  generator: {
    kind: "adk" as const,
    model: "gemini-3.5-flash",
    location: "global",
    agent_version: "proposal-v4",
    gate_version: "pgate-v1" as const,
    library_version: { interventions: 2, rubric: 1 },
    sop_version_id: "demo-outlet:v1",
    attempts: 1,
  },
  gate: { passed: false, fired_rule: "scope_unsupported", checks: [{ rule: "evidence_min", passed: true }, { rule: "scope_unsupported", passed: false }] },
  counts: { candidate_facts: 4, candidate_dates: 2, constraints: 0 },
  suppression: null,
  content: null,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const v4 = {
  model_calls: 9,
  tool_calls: [
    { name: "list_sop_sections", ok: true },
    { name: "get_record_step", ok: false },
  ],
  check_rounds: 3,
  ms: 31_000,
  ended_by: "decided" as const,
  fell_back: false,
};

describe("R-24 ProposalSchema additions", () => {
  it("a doc without generator.v4 / check_version still parses (every v3 and flag-off doc)", () => {
    expect(ProposalSchema.safeParse(base).success).toBe(true);
  });

  it("a doc with generator.v4 and check_version parses", () => {
    const g = { ...base.generator, check_version: "pcheck-v4" as const, v4 };
    expect(ProposalSchema.safeParse({ ...base, generator: g }).success).toBe(true);
  });

  it("check_version accepts only the literal pcheck-v4", () => {
    const g = (check_version: unknown) => ({ ...base.generator, check_version });
    expect(ProposalSchema.safeParse({ ...base, generator: g("pcheck-v4") }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...base, generator: g("pcheck-v3") }).success).toBe(false);
  });

  it("generator.v4 is strict and bounded", () => {
    const parse = (patch: Record<string, unknown>) =>
      ProposalSchema.safeParse({ ...base, generator: { ...base.generator, v4: { ...v4, ...patch } } }).success;
    expect(parse({})).toBe(true);
    expect(parse({ extra: 1 })).toBe(false);
    expect(parse({ ended_by: "weird" })).toBe(false);
    expect(parse({ check_rounds: 4 })).toBe(false);
    expect(parse({ model_calls: -1 })).toBe(false);
    expect(parse({ fell_back: "no" })).toBe(false);
    expect(parse({ tool_calls: [{ name: "", ok: true }] })).toBe(false);
    expect(parse({ tool_calls: [{ name: "x".repeat(41), ok: true }] })).toBe(false);
    expect(parse({ tool_calls: [{ name: "get_evidence", ok: true, extra: 1 }] })).toBe(false);
    expect(parse({ tool_calls: Array.from({ length: 41 }, () => ({ name: "a", ok: true })) })).toBe(false);
  });

  it("gate.fired_rule and gate.checks[].rule accept the v4 rule names", () => {
    expect(ProposalSchema.safeParse(base).success).toBe(true);
    expect(
      ProposalSchema.safeParse({ ...base, gate: { passed: false, fired_rule: "bogus_rule", checks: [] } }).success,
    ).toBe(false);
  });

  it("PROPOSAL_RULES is the superset of the pgate-v1 rules and keeps their order first", () => {
    expect([...PROPOSAL_RULES].slice(0, PGATE_V1_RULES.length)).toEqual([...PGATE_V1_RULES]);
    expect(PROPOSAL_RULES).toHaveLength(PGATE_V1_RULES.length + 10);
  });

  it("the proposal view contract accepts a v4 blocked_rule", () => {
    const rule = ProposalViewSchema.shape.blocked_rule;
    expect(rule.safeParse("quote_not_in_evidence").success).toBe(true);
    expect(rule.safeParse("evidence_min").success).toBe(true);
    expect(rule.safeParse("nope").success).toBe(false);
  });
});
