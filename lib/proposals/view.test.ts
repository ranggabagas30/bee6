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
      library_version: { interventions: 2, rubric: 1 },
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

  it("R-19 3.3: exposes focus_category; a legacy doc without one reads null", () => {
    expect(toProposalView(baseProposal(), new Map(), LIBRARY, SOP, TZ).focus_category).toBeNull();
    expect(toProposalView(baseProposal({ focus_category: null }), new Map(), LIBRARY, SOP, TZ).focus_category).toBeNull();
    expect(toProposalView(baseProposal({ focus_category: "CUSTOMER_SERVICE" }), new Map(), LIBRARY, SOP, TZ).focus_category).toBe(
      "CUSTOMER_SERVICE",
    );
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
    expect(view.content?.target_step).toEqual({ step_id: "stock-01", title: "Display check", text: SOP.steps.find((s) => s.step_id === "stock-01")!.text });
    expect(view.content?.evidence[0]).toMatchObject({ date: "2026-10-01", summary: "a customer asked for a sold-out item" });
    expect(view.content?.evidence[1]).toMatchObject({ date: "2026-10-02", summary: null });
    expect(view.content?.censored_floor).toBe(true);
  });

  it("a target step id no longer in the SOP keeps the id as the title and has no text", () => {
    const proposal = baseProposal({
      status: "awaiting_supervisor",
      suppression: null,
      gate: { passed: true, fired_rule: null, checks: [] },
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: "gone-01",
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
    expect(view.content?.target_step).toEqual({ step_id: "gone-01", title: "gone-01", text: null });
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

// CHK-1: how the proposal was checked. Counts and enums only (hard rule 7); built from gate.checks and the generator.
describe("toProposalView: checked (CHK-1)", () => {
  const CONTENT: NonNullable<Proposal["content"]> = {
    intervention_id: "change_quantity_time",
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
  };
  const V3_RULES = [
    "schema_invalid",
    "intervention_unknown",
    "rubric_missing",
    "evidence_unknown",
    "evidence_min",
    "step_unknown",
    "constraints_unacknowledged",
    "output_too_long",
  ] as const;
  const V4_RULES = [
    ...V3_RULES,
    "section_not_fetched",
    "step_not_in_section",
    "evidence_not_inspected",
    "intervention_not_inspected",
    "quote_alias_not_cited",
    "quotes_insufficient",
    "quote_not_in_evidence",
    "scope_unsupported",
    "change_is_noop",
    "text_rule_violation",
  ] as const;
  const passing = (rules: readonly Proposal["gate"]["checks"][number]["rule"][]) => rules.map((rule) => ({ rule, passed: true }));
  const withContent = (overrides: Partial<Proposal> = {}): Proposal =>
    baseProposal({ status: "awaiting_supervisor", suppression: null, content: CONTENT, ...overrides });
  const generator = (extra: Partial<Proposal["generator"]>): Proposal["generator"] => ({ ...baseProposal().generator, ...extra });
  const V4_TOOLS = [
    { name: "get_sop_section", ok: true },
    { name: "get_evidence", ok: true },
    { name: "get_evidence", ok: true },
    { name: "get_evidence", ok: false },
    { name: "check_proposal", ok: true },
    { name: "check_proposal", ok: true },
  ];

  it("a suppressed doc (no checks ran) reads checked: null", () => {
    expect(toProposalView(baseProposal(), new Map(), LIBRARY, SOP, TZ).checked).toBeNull();
  });

  it("a v3 doc after two attempts: 8 of 8, pgate-v1, one revision, no read counts", () => {
    const proposal = withContent({
      generator: generator({ agent_version: "proposal-v3", attempts: 2 }),
      gate: { passed: true, fired_rule: null, checks: passing(V3_RULES) },
    });
    expect(toProposalView(proposal, new Map(), LIBRARY, SOP, TZ).checked).toEqual({
      checks_total: 8,
      checks_passed: 8,
      rule_set: "pgate-v1",
      agent: "proposal-v3",
      revisions: 1,
      read_sections: null,
      read_facts: null,
    });
  });

  it("a v3 doc on its first attempt has no revisions", () => {
    const proposal = withContent({
      generator: generator({ agent_version: "proposal-v3", attempts: 1 }),
      gate: { passed: true, fired_rule: null, checks: passing(V3_RULES) },
    });
    expect(toProposalView(proposal, new Map(), LIBRARY, SOP, TZ).checked?.revisions).toBe(0);
  });

  it("v3 revisions are clamped to 0..2 (attempts span up to four focus tries; zero attempts never goes negative)", () => {
    const at = (attempts: number) =>
      toProposalView(
        withContent({ generator: generator({ attempts }), gate: { passed: true, fired_rule: null, checks: passing(V3_RULES) } }),
        new Map(),
        LIBRARY,
        SOP,
        TZ,
      ).checked?.revisions;
    expect(at(0)).toBe(0);
    expect(at(4)).toBe(2);
  });

  it("a v4 doc: 18 of 18, pcheck-v4, rounds minus one as revisions, and the ok tool calls as read counts", () => {
    const proposal = withContent({
      generator: generator({
        agent_version: "proposal-v4",
        check_version: "pcheck-v4",
        attempts: 1,
        v4: { model_calls: 5, tool_calls: V4_TOOLS, check_rounds: 2, ms: 9000, ended_by: "decided", fell_back: false },
      }),
      gate: { passed: true, fired_rule: null, checks: passing(V4_RULES) },
    });
    expect(toProposalView(proposal, new Map(), LIBRARY, SOP, TZ).checked).toEqual({
      checks_total: 18,
      checks_passed: 18,
      rule_set: "pcheck-v4",
      agent: "proposal-v4",
      revisions: 1,
      read_sections: 1,
      read_facts: 2,
    });
  });

  it("a v4 doc that passed at round one has no revisions; zero rounds never goes negative", () => {
    const at = (check_rounds: number) =>
      toProposalView(
        withContent({
          generator: generator({
            agent_version: "proposal-v4",
            check_version: "pcheck-v4",
            v4: { model_calls: 3, tool_calls: [], check_rounds, ms: 1, ended_by: "decided", fell_back: false },
          }),
          gate: { passed: true, fired_rule: null, checks: passing(V4_RULES) },
        }),
        new Map(),
        LIBRARY,
        SOP,
        TZ,
      ).checked;
    expect(at(1)?.revisions).toBe(0);
    expect(at(0)?.revisions).toBe(0);
    expect(at(1)?.read_sections).toBe(0);
  });

  it("a v4 run that fell back to v3 reads as the v3 shape: pgate-v1, proposal-v3, no read counts", () => {
    const proposal = withContent({
      generator: generator({
        agent_version: "proposal-v3",
        attempts: 1,
        v4: { model_calls: 6, tool_calls: V4_TOOLS, check_rounds: 3, ms: 20000, ended_by: "limit", fell_back: true },
      }),
      gate: { passed: true, fired_rule: null, checks: passing(V3_RULES) },
    });
    expect(toProposalView(proposal, new Map(), LIBRARY, SOP, TZ).checked).toEqual({
      checks_total: 8,
      checks_passed: 8,
      rule_set: "pgate-v1",
      agent: "proposal-v3",
      revisions: 0,
      read_sections: null,
      read_facts: null,
    });
  });

  it("a fell-back doc never claims v4 even if a stray v4 marker is on the generator", () => {
    const proposal = withContent({
      generator: generator({
        agent_version: "proposal-v4",
        check_version: "pcheck-v4",
        v4: { model_calls: 6, tool_calls: V4_TOOLS, check_rounds: 3, ms: 20000, ended_by: "limit", fell_back: true },
      }),
      gate: { passed: true, fired_rule: null, checks: passing(V3_RULES) },
    });
    const checked = toProposalView(proposal, new Map(), LIBRARY, SOP, TZ).checked;
    expect(checked?.agent).toBe("proposal-v3");
    expect(checked?.rule_set).toBe("pgate-v1");
    expect(checked?.read_sections).toBeNull();
  });

  it("a pre-R-19 doc (agent_version proposal-v1, no check_version, no v4) reads the v3 shape; an unknown agent is 'other'", () => {
    const old = withContent({
      generator: generator({ agent_version: "proposal-v1", attempts: 1 }),
      gate: { passed: true, fired_rule: null, checks: passing(V3_RULES) },
    });
    const view = toProposalView(old, new Map(), LIBRARY, SOP, TZ);
    expect(view.checked).toMatchObject({ rule_set: "pgate-v1", agent: "other", read_sections: null, read_facts: null });
  });

  it("a blocked doc shows how many checks passed (7 of 8) next to blocked_rule", () => {
    const checks = V3_RULES.map((rule) => ({ rule, passed: rule !== "evidence_min" }));
    const proposal = baseProposal({
      status: "blocked",
      suppression: null,
      generator: generator({ agent_version: "proposal-v3", attempts: 2 }),
      gate: { passed: false, fired_rule: "evidence_min", checks },
    });
    const view = toProposalView(proposal, new Map(), LIBRARY, SOP, TZ);
    expect(view.blocked_rule).toBe("evidence_min");
    expect(view.checked).toMatchObject({ checks_total: 8, checks_passed: 7 });
  });

  it("never carries a tool name, a rule name, an id or a name: counts and enums only", () => {
    const proposal = withContent({
      generator: generator({
        agent_version: "proposal-v4",
        check_version: "pcheck-v4",
        v4: { model_calls: 5, tool_calls: V4_TOOLS, check_rounds: 2, ms: 9000, ended_by: "decided", fell_back: false },
      }),
      gate: { passed: true, fired_rule: null, checks: passing(V4_RULES) },
    });
    const view = toProposalView(proposal, new Map(), LIBRARY, SOP, TZ);
    const text = JSON.stringify(view.checked);
    expect(text).not.toContain("get_sop_section");
    expect(text).not.toContain("get_evidence");
    expect(text).not.toContain("check_proposal");
    expect(text).not.toContain("evidence_min");
    expect(Object.keys(view.checked!).sort()).toEqual(
      ["agent", "checks_passed", "checks_total", "read_facts", "read_sections", "revisions", "rule_set"].sort(),
    );
    const whole = JSON.stringify(view);
    expect(whole).not.toContain("thread_id");
    expect(whole).not.toContain("device_id");
    expect(whole).not.toContain("question_id");
  });
});
