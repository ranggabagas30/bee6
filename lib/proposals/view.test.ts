import { describe, expect, it } from "vitest";
import type { ProposalLibrary } from "@/config/proposal-library";
import type { Proposal, SopVersion } from "@/lib/firestore/schema";
import { toProposalView } from "@/lib/proposals/view";

const TZ = "Asia/Jakarta";

const LIBRARY: ProposalLibrary = {
  interventions: {
    version: 1,
    entries: [
      { id: "change_quantity_time", label_en: "Change quantity or time", label_id: "Ubah jumlah", definition: "d" },
    ],
  },
  rubric: {
    version: 1,
    entries: [{ id: "observable", label_en: "Observable", label_id: "Dapat diamati", definition: "d" }],
  },
  draft: false,
};

const SOP: SopVersion = {
  outlet_id: "demo-outlet",
  sop_version_id: "demo-outlet:v1",
  version: 1,
  steps: [{ step_id: "stock-01", title: "Display check", text: "t", role: "staff" }],
  source: "seed",
  source_proposal_id: null,
  created_at_ms: 1,
};

function baseProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    outlet_id: "demo-outlet",
    proposal_id: "33333333-3333-4333-8333-333333333333",
    status: "suppressed",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-07" },
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "asia-southeast1",
      agent_version: "proposal-v1",
      gate_version: "pgate-v1",
      library_version: { interventions: 1, rubric: 1 },
      sop_version_id: "demo-outlet:v1",
      attempts: 0,
    },
    gate: { passed: false, fired_rule: null, checks: [] },
    counts: { candidate_facts: 1, candidate_dates: 1, constraints: 0 },
    suppression: {
      reason: "insufficient_evidence",
      model_reason: null,
      followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
    },
    content: null,
    created_at_ms: 1,
    updated_at_ms: 1,
    ...overrides,
  };
}

describe("toProposalView", () => {
  it("suppressed: content null, blocked_rule null", () => {
    const view = toProposalView(baseProposal(), new Map(), LIBRARY, SOP, TZ);
    expect(view.content).toBeNull();
    expect(view.blocked_rule).toBeNull();
    expect(view.suppression?.reason).toBe("insufficient_evidence");
  });

  it("blocked: blocked_rule from gate.fired_rule", () => {
    const view = toProposalView(
      baseProposal({ status: "blocked", suppression: null, gate: { passed: false, fired_rule: "evidence_min", checks: [] } }),
      new Map(),
      LIBRARY,
      SOP,
      TZ,
    );
    expect(view.blocked_rule).toBe("evidence_min");
    expect(view.content).toBeNull();
  });

  it("awaiting_supervisor: builds the full content with labels, step, metric, evidence summaries", () => {
    const proposal = baseProposal({
      status: "awaiting_supervisor",
      suppression: null,
      gate: { passed: true, fired_rule: null, checks: [] },
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: "stock-01",
        change_title: "Check more often",
        change_text: "Check every 30 minutes.",
        rationale: "Two dates show the issue.",
        metric: {
          category: "CUSTOMER_SERVICE",
          direction: "decrease",
          description: "Requests per day.",
          baseline_count: 4,
          baseline_days: 2,
        },
        failure_condition: "Requests do not fall.",
        review_after_days: 14,
        review_date: "2026-10-21",
        evidence: [
          { thread_id: "t1", local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: 1 },
          { thread_id: "t2", local_date: "2026-10-02", category: "CUSTOMER_SERVICE", first_line_start_ms: 2 },
        ],
        constraint_ids_acknowledged: [],
        censored_floor: true,
      },
    });
    const summaries = new Map([["t1", "a customer asked for a sold-out item"], ["t2", null]]);
    const view = toProposalView(proposal, summaries, LIBRARY, SOP, TZ);
    expect(view.content?.intervention).toEqual({
      id: "change_quantity_time",
      label_en: "Change quantity or time",
      label_id: "Ubah jumlah",
    });
    expect(view.content?.rubric).toEqual([{ id: "observable", label_en: "Observable", label_id: "Dapat diamati" }]);
    expect(view.content?.target_step).toEqual({ step_id: "stock-01", title: "Display check" });
    expect(view.content?.evidence[0]).toMatchObject({ date: "2026-10-01", summary: "a customer asked for a sold-out item" });
    expect(view.content?.evidence[1]).toMatchObject({ date: "2026-10-02", summary: null });
    expect(view.content?.censored_floor).toBe(true);
  });

  it("target_step_id NEW -> target_step: null", () => {
    const proposal = baseProposal({
      status: "awaiting_supervisor",
      suppression: null,
      gate: { passed: true, fired_rule: null, checks: [] },
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: null,
        change_title: "t",
        change_text: "c",
        rationale: "r",
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
        failure_condition: "f",
        review_after_days: 14,
        review_date: "2026-10-21",
        evidence: [
          { thread_id: "t1", local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: 1 },
          { thread_id: "t2", local_date: "2026-10-02", category: "CUSTOMER_SERVICE", first_line_start_ms: 2 },
        ],
        constraint_ids_acknowledged: [],
        censored_floor: true,
      },
    });
    const view = toProposalView(proposal, new Map(), LIBRARY, SOP, TZ);
    expect(view.content?.target_step).toBeNull();
  });

  it("an intervention id no longer in the library renders id as both labels", () => {
    const proposal = baseProposal({
      status: "awaiting_supervisor",
      suppression: null,
      gate: { passed: true, fired_rule: null, checks: [] },
      content: {
        intervention_id: "retired_intervention",
        rubric_criterion_ids: ["observable"],
        target_step_id: "stock-01",
        change_title: "t",
        change_text: "c",
        rationale: "r",
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
        failure_condition: "f",
        review_after_days: 14,
        review_date: "2026-10-21",
        evidence: [
          { thread_id: "t1", local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: 1 },
          { thread_id: "t2", local_date: "2026-10-02", category: "CUSTOMER_SERVICE", first_line_start_ms: 2 },
        ],
        constraint_ids_acknowledged: [],
        censored_floor: true,
      },
    });
    const view = toProposalView(proposal, new Map(), LIBRARY, SOP, TZ);
    expect(view.content?.intervention).toEqual({
      id: "retired_intervention",
      label_en: "retired_intervention",
      label_id: "retired_intervention",
    });
  });

  it("no thread_id, device_id or question_id key anywhere in the view", () => {
    const view = toProposalView(baseProposal(), new Map(), LIBRARY, SOP, TZ);
    const text = JSON.stringify(view);
    expect(text).not.toContain("thread_id");
    expect(text).not.toContain("device_id");
    expect(text).not.toContain("question_id");
  });
});
