import { describe, expect, it, vi } from "vitest";
import type { ProposalModel, ProposalModelResult } from "@/lib/agents/proposal-agent";
import { loadProposalLibrary } from "@/config/proposal-library";
import {
  CASES,
  DEMO_PROJECT_ID,
  buildCaseInput,
  exitCodeFor,
  formatReport,
  judgeCase,
  parseArgs,
  runEval,
  singleDateIsBlockedByFloor,
  type CaseSummary,
  type RunResult,
} from "@/scripts/eval-proposal";

const library = loadProposalLibrary({ allowDraft: true });

function ok(wire: object): ProposalModelResult {
  return { kind: "ok", text: JSON.stringify(wire), usage: { input_tokens: 100, output_tokens: 20, thoughts_tokens: 5 } };
}

const DECLINE = ok({
  decision: "no_proposal",
  no_proposal_reason: "no_clear_pattern",
  intervention_id: null,
  rubric_criterion_ids: [],
  evidence: [],
  target_step_id: null,
  change_title: "",
  change_text: "",
  rationale: "",
  metric_category: null,
  metric_direction: null,
  metric_description: "",
  failure_condition: "",
  review_after_days: null,
  constraints_acknowledged: [],
});

function propose(category: string, extra: Record<string, unknown> = {}): ProposalModelResult {
  const intervention = library.interventions.entries[0]!.id;
  const rubric = library.rubric.entries[0]!.id;
  return ok({
    decision: "propose",
    no_proposal_reason: null,
    intervention_id: intervention,
    rubric_criterion_ids: [rubric],
    evidence: ["E1", "E2"],
    target_step_id: "NEW",
    change_title: "t",
    change_text: "c",
    rationale: "r",
    metric_category: category,
    metric_direction: "decrease",
    metric_description: "d",
    failure_condition: "f",
    review_after_days: 7,
    constraints_acknowledged: [],
    ...extra,
  });
}

const byId = (id: string) => CASES.find((c) => c.id === id)!;

describe("eval-proposal cases (offline, no model)", () => {
  it("A and B each hold two facts on two dates in ONE category and clear floor-v2; the weak control too (so the model decides)", () => {
    for (const c of CASES) {
      const input = buildCaseInput(c, library);
      expect(input.aliased).toHaveLength(2);
      expect(new Set(input.aliased.map((a) => a.c.local_date)).size).toBe(2);
      expect(new Set(input.aliased.map((a) => a.c.category)).size).toBe(1);
    }
  });

  it("the prompt carries quotes, and staff notes for B only", () => {
    expect(buildCaseInput(byId("A"), library).prompt.userContent).toContain('said: "');
    expect(buildCaseInput(byId("A"), library).prompt.userContent).not.toContain("staff note:");
    expect(buildCaseInput(byId("B"), library).prompt.userContent).toContain('staff note: "');
  });

  it("(d) a single-date variant is blocked by the floor offline and never sent to a model", () => {
    expect(singleDateIsBlockedByFloor()).toBe(true);
  });
});

describe("judgeCase", () => {
  const pass: RunResult = { kind: "propose_pass" };
  const declined: RunResult = { kind: "declined", reason: "no_clear_pattern" };
  const err: RunResult = { kind: "model_error", error_class: "http_429" };
  const blocked: RunResult = { kind: "propose_blocked", rule: "evidence_min" };

  it("A/B expect propose with the gate passing >= 2 of 3", () => {
    expect(judgeCase(byId("A"), [pass, pass, declined]).status).toBe("PASS");
    expect(judgeCase(byId("A"), [pass, declined, declined]).status).toBe("FAIL");
    expect(judgeCase(byId("B"), [pass, blocked, pass]).status).toBe("PASS");
    expect(judgeCase(byId("B"), [blocked, blocked, pass]).status).toBe("FAIL");
  });

  it("the weak control expects no_proposal >= 2 of 3", () => {
    expect(judgeCase(byId("weak_cs"), [declined, declined, pass]).status).toBe("PASS");
    expect(judgeCase(byId("weak_cs"), [pass, pass, declined]).status).toBe("FAIL");
  });

  it("errors that could still have made it pass are INCONCLUSIVE, not FAIL", () => {
    expect(judgeCase(byId("A"), [pass, err, err]).status).toBe("INCONCLUSIVE");
    expect(judgeCase(byId("A"), [declined, declined, err]).status).toBe("FAIL");
  });
});

describe("runEval with a stub model", () => {
  it("good model: A and B propose, weak declines -> exit 0; the report prints counts and aliases, no fixture text", async () => {
    const model = vi.fn<ProposalModel>().mockImplementation(async (input) => {
      const u = input.userContent;
      if (u.includes("Two croissants") || u.includes("paper bag")) return DECLINE;
      return propose(u.includes("PHONE_CALL") ? "PHONE_CALL" : "CUSTOMER_SERVICE");
    });
    const report = await runEval({ runs: 3 }, { model, library, sleep: async () => {} });
    expect(report.cases.map((c) => c.status)).toEqual(["PASS", "PASS", "PASS"]);
    expect(exitCodeFor(report)).toBe(0);
    expect(model).toHaveBeenCalledTimes(9);
    const text = formatReport(report);
    expect(text).not.toContain("croissant");
    expect(text).not.toContain("baking time");
    expect(text).toContain("A");
  });

  it("the old behaviour (declines everything) fails A and B -> exit 2", async () => {
    const model = vi.fn<ProposalModel>().mockResolvedValue(DECLINE);
    const report = await runEval({ runs: 3 }, { model, library, sleep: async () => {} });
    expect(report.cases.map((c) => c.status)).toEqual(["FAIL", "FAIL", "PASS"]);
    expect(exitCodeFor(report)).toBe(2);
  });

  it("a gate failure (citing a single fact) is counted as propose_blocked, never as a pass", async () => {
    const model = vi.fn<ProposalModel>().mockImplementation(async (input) =>
      input.userContent.includes("Two croissants") || input.userContent.includes("paper bag")
        ? DECLINE
        : propose("CUSTOMER_SERVICE", { evidence: ["E1"] }),
    );
    const report = await runEval({ runs: 3 }, { model, library, sleep: async () => {} });
    expect(report.cases[0]!.counts.propose_blocked).toBe(3);
    expect(report.cases[0]!.status).toBe("FAIL");
  });

  it("all-error model -> INCONCLUSIVE everywhere, exit 3", async () => {
    const model = vi.fn<ProposalModel>().mockResolvedValue({ kind: "error", error_class: "http_429" });
    const report = await runEval({ runs: 3 }, { model, library, sleep: async () => {} });
    expect(report.cases.every((c) => c.status === "INCONCLUSIVE")).toBe(true);
    expect(exitCodeFor(report)).toBe(3);
  });
});

describe("exit codes and args", () => {
  const cell = (status: CaseSummary["status"]): CaseSummary => ({ id: "A", label: "x", status, counts: {}, expected: "propose" } as CaseSummary);
  it("FAIL beats INCONCLUSIVE", () => {
    expect(exitCodeFor({ cases: [cell("PASS")], floor_blocks_single_date: true })).toBe(0);
    expect(exitCodeFor({ cases: [cell("INCONCLUSIVE"), cell("FAIL")], floor_blocks_single_date: true })).toBe(2);
    expect(exitCodeFor({ cases: [cell("PASS")], floor_blocks_single_date: false })).toBe(2);
  });

  it("parseArgs: --runs, default 3, rejects junk", () => {
    expect(parseArgs([]).runs).toBe(3);
    expect(parseArgs(["--runs", "5"]).runs).toBe(5);
    expect(() => parseArgs(["--runs", "0"])).toThrow();
    expect(() => parseArgs(["--nope", "1"])).toThrow();
  });

  it("the project guard constant is the demo project", () => {
    expect(DEMO_PROJECT_ID).toBe("bee6-playground");
  });
});
