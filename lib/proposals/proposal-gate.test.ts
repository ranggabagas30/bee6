import { describe, expect, it } from "vitest";
import { checkProposal, type ProposalGateContext } from "@/lib/proposals/proposal-gate";
import type { Candidate } from "@/lib/proposals/candidates";
import type { ProposalWire } from "@/lib/proposals/wire-schema";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    thread_id: "t1",
    local_date: "2026-10-07",
    start_hm: "10:00",
    category: "CUSTOMER_SERVICE",
    first_line_start_ms: 1,
    summary: "s",
    ...overrides,
  };
}

const E1 = candidate({ thread_id: "t1", local_date: "2026-10-07", category: "CUSTOMER_SERVICE" });
const E2 = candidate({ thread_id: "t2", local_date: "2026-10-08", category: "CUSTOMER_SERVICE" });

function ctx(overrides: Partial<ProposalGateContext> = {}): ProposalGateContext {
  return {
    aliasToCandidate: new Map([["E1", E1], ["E2", E2]]),
    interventionIds: new Set(["change_quantity_time"]),
    rubricIds: new Set(["observable"]),
    stepIds: new Set(["stock-01"]),
    constraintAliases: [],
    ...overrides,
  };
}

function wire(overrides: Partial<ProposalWire> = {}): ProposalWire {
  return {
    decision: "propose",
    no_proposal_reason: null,
    intervention_id: "change_quantity_time",
    rubric_criterion_ids: ["observable"],
    evidence: ["E1", "E2"],
    target_step_id: "stock-01",
    change_title: "t",
    change_text: "c",
    rationale: "r",
    metric_category: "CUSTOMER_SERVICE",
    metric_direction: "decrease",
    metric_description: "m",
    failure_condition: "f",
    review_after_days: 14,
    constraints_acknowledged: [],
    ...overrides,
  };
}

describe("checkProposal (pgate-v1)", () => {
  it("a fully valid wire -> passed: true, fired_rule: null, 8 checks all passed", () => {
    const result = checkProposal(wire(), ctx());
    expect(result.passed).toBe(true);
    expect(result.fired_rule).toBeNull();
    expect(result.checks).toHaveLength(8);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("intervention_unknown fires on an unoffered intervention id", () => {
    const result = checkProposal(wire({ intervention_id: "invented" }), ctx());
    expect(result.fired_rule).toBe("intervention_unknown");
    expect(result.passed).toBe(false);
  });

  it("rubric_missing fires on an empty rubric_criterion_ids", () => {
    const result = checkProposal(wire({ rubric_criterion_ids: [] }), ctx());
    expect(result.fired_rule).toBe("rubric_missing");
  });

  it("rubric_unknown fires on an unoffered rubric id", () => {
    const result = checkProposal(wire({ rubric_criterion_ids: ["invented"] }), ctx());
    expect(result.fired_rule).toBe("rubric_unknown");
  });

  it("evidence_unknown fires on an unoffered alias", () => {
    const result = checkProposal(wire({ evidence: ["E99"] }), ctx());
    expect(result.fired_rule).toBe("evidence_unknown");
  });

  it("evidence_min fires when fewer than 2 distinct threads/dates are cited", () => {
    const result = checkProposal(wire({ evidence: ["E1"] }), ctx());
    expect(result.fired_rule).toBe("evidence_min");
  });

  it('duplicate aliases ["E1","E1"] count once -> evidence_min fires', () => {
    const result = checkProposal(wire({ evidence: ["E1", "E1"] }), ctx());
    expect(result.fired_rule).toBe("evidence_min");
  });

  it("step_unknown fires on a step id not in the current SOP", () => {
    const result = checkProposal(wire({ target_step_id: "ghost-step" }), ctx());
    expect(result.fired_rule).toBe("step_unknown");
  });

  it('target_step_id "NEW" always passes step_unknown', () => {
    const result = checkProposal(wire({ target_step_id: "NEW" }), ctx());
    expect(result.checks.find((c) => c.rule === "step_unknown")?.passed).toBe(true);
  });

  it("0 constraints -> constraints_unacknowledged passes with []", () => {
    const result = checkProposal(wire({ constraints_acknowledged: [] }), ctx({ constraintAliases: [] }));
    expect(result.checks.find((c) => c.rule === "constraints_unacknowledged")?.passed).toBe(true);
  });

  it("2 constraints, 1 acknowledged -> constraints_unacknowledged fires", () => {
    const result = checkProposal(
      wire({ constraints_acknowledged: ["C1"] }),
      ctx({ constraintAliases: ["C1", "C2"] }),
    );
    expect(result.fired_rule).toBe("constraints_unacknowledged");
  });

  it("metric_not_in_evidence fires when the metric category is not among cited categories", () => {
    const result = checkProposal(wire({ metric_category: "ROUTINE_OPS" }), ctx());
    expect(result.fired_rule).toBe("metric_not_in_evidence");
  });

  it("precedence: two failures -> the earlier rule in GATE_RULE_ORDER fires", () => {
    // intervention_unknown (rule 1) AND evidence_min (rule 5) both fail; rule 1 wins.
    const result = checkProposal(
      wire({ intervention_id: "invented", evidence: ["E1"] }),
      ctx(),
    );
    expect(result.fired_rule).toBe("intervention_unknown");
  });
});
