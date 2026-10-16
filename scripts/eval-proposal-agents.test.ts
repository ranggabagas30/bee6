import { describe, expect, it, vi } from "vitest";
import { loadProposalLibrary } from "@/config/proposal-library";
import type { ProposalModel, ProposalModelResult } from "@/lib/agents/proposal-agent";
import type { ProposalAgentV4, ProposalAgentV4Result } from "@/lib/agents/proposal-agent-v4";
import { validDraft } from "@/lib/proposals/testing/v4-world";
import type { ProposalDraftV4 } from "@/lib/proposals/v4/draft-schema";
import {
  CASES,
  EXTENDED_CASES,
  SCOPE_CASES,
  analyseRounds,
  assertDemoProject,
  buildCaseInput,
  countNameHits,
  evaluateBar,
  exitCodeForExtended,
  formatExtendedReport,
  instrumentTools,
  judgeScope,
  mean,
  parseArgs,
  percentile,
  ruleCodesOf,
  runEvalExtended,
  sectionOfStep,
  summariseCell,
  type CellSummary,
  type CheckRound,
  type MeasuredRun,
  type RunMeasure,
  type RunResult,
} from "@/scripts/eval-proposal";

const library = loadProposalLibrary({ allowDraft: true });
const byId = (id: string) => EXTENDED_CASES.find((c) => c.id === id)!;

describe("parseArgs (R-24 C1)", () => {
  it("without --agent the shape is the legacy one (no agent, no cases keys)", () => {
    expect(parseArgs([])).toEqual({ runs: 3, texts: false });
    expect(Object.keys(parseArgs(["--runs", "2"]))).toEqual(["runs", "texts"]);
  });

  it("--agent accepts v3|v4|both, in any order with the other flags", () => {
    expect(parseArgs(["--agent", "both", "--runs", "2"])).toEqual({ runs: 2, texts: false, agent: "both" });
    expect(parseArgs(["--texts", "--agent", "v4"]).agent).toBe("v4");
    expect(parseArgs(["--agent", "v3"]).agent).toBe("v3");
  });

  it("rejects an unknown or missing agent", () => {
    expect(() => parseArgs(["--agent", "v5"])).toThrow(/--agent/);
    expect(() => parseArgs(["--agent"])).toThrow(/--agent/);
  });

  it("--cases selects known ids, dedupes, and needs --agent", () => {
    expect(parseArgs(["--agent", "both", "--cases", "A,scope_ube,A"]).cases).toEqual(["A", "scope_ube"]);
    expect(() => parseArgs(["--agent", "both", "--cases", "A,nope"])).toThrow(/unknown case nope/);
    expect(() => parseArgs(["--cases", "A"])).toThrow(/--agent/);
    expect(() => parseArgs(["--agent", "v4", "--cases"])).toThrow(/--cases/);
  });
});

describe("the project guard", () => {
  it("accepts only the demo project", () => {
    expect(assertDemoProject("bee6-playground")).toBe("bee6-playground");
    expect(() => assertDemoProject(undefined)).toThrow(/demo project only/);
    expect(() => assertDemoProject("project-a10437b4-b198-402e-97e")).toThrow(/demo project only/);
  });
});

describe("case lists", () => {
  it("the default case list is still exactly the three R-20 cases", () => {
    expect(CASES.map((c) => c.id)).toEqual(["A", "B", "weak_cs"]);
  });

  it("the extended list adds the four R-24 cases", () => {
    expect(EXTENDED_CASES.map((c) => c.id)).toEqual(["A", "B", "weak_cs", "scope_dubai", "scope_ube", "mixed_one_wrong", "pii_probe"]);
    expect(SCOPE_CASES.every((c) => c.expected === "propose")).toBe(true);
  });

  it("scope cases run over the four-section fixture SOP; the legacy cases keep the 1-section demo SOP", () => {
    expect(buildCaseInput(byId("scope_dubai"), library).sections.map((s) => s.section_id)).toEqual(["bake-dubai", "bake-ube", "serve", "close"]);
    expect(buildCaseInput(byId("A"), library).sections.map((s) => s.section_id)).toEqual(["all"]);
  });

  it("every case offers two facts on two dates in one category (the model decides, not the floor); mixed offers three", () => {
    for (const c of EXTENDED_CASES) {
      const input = buildCaseInput(c, library);
      expect(input.aliased).toHaveLength(c.id === "mixed_one_wrong" ? 3 : 2);
      expect(new Set(input.aliased.map((a) => a.c.local_date)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(input.aliased.map((a) => a.c.category)).size).toBe(1);
    }
  });

  it("scope_ube never offers the routine ube fact as evidence", () => {
    const summaries = buildCaseInput(byId("scope_ube"), library).aliased.map((a) => a.c.summary).join(" | ");
    expect(summaries).not.toContain("baked correctly");
  });

  it("pii_probe: the planted name is scrubbed before the prompt (real scrub), and the plain-code names list is set", () => {
    const spec = byId("pii_probe");
    expect(spec.staffNames).toEqual(["Sari"]);
    const input = buildCaseInput(spec, library);
    expect(input.prompt.userContent).not.toMatch(/sari/i);
    expect(input.prompt.userContent).toContain("[STAFF]");
  });

  it("mixed_one_wrong marks the Ube-fine fact as the decoy", () => {
    const input = buildCaseInput(byId("mixed_one_wrong"), library);
    const decoy = input.aliased.filter((a) => byId("mixed_one_wrong").decoyThreadIds!.includes(a.c.thread_id));
    expect(decoy).toHaveLength(1);
  });
});

describe("metric maths", () => {
  it("mean and nearest-rank percentile", () => {
    expect(mean([])).toBeNull();
    expect(mean([2, 4])).toBe(3);
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([...Array(20).keys()].map((i) => (i + 1) * 100), 95)).toBe(1900);
    expect(percentile([40, 10, 30, 20], 25)).toBe(10);
  });

  it("countNameHits is case-insensitive over every text and ignores empty names", () => {
    expect(countNameHits(["Ask Sari to call", "nothing", "SARI again, sari"], ["Sari"])).toBe(3);
    expect(countNameHits(["Ask Sari"], [" ", ""])).toBe(0);
    expect(countNameHits(["Ask Sari"], [])).toBe(0);
  });

  it("sectionOfStep: NEW and unknown steps are a miss", () => {
    const sections = buildCaseInput(byId("scope_dubai"), library).sections;
    expect(sectionOfStep(sections, "bake-ube-02")).toBe("bake-ube");
    expect(sectionOfStep(sections, "NEW")).toBe("unknown");
    expect(sectionOfStep(sections, null)).toBe("unknown");
    expect(sectionOfStep(sections, "nope-01")).toBe("unknown");
  });

  it("ruleCodesOf keeps only the code before ':' and dedupes; no reasons -> undefined", () => {
    expect(ruleCodesOf({ reasons: ["text_rule_violation:change_text:[staff]", "text_rule_violation:rationale:ISO date", "scope_unsupported"] })).toEqual([
      "text_rule_violation",
      "scope_unsupported",
    ]);
    expect(ruleCodesOf({ passed: true, reasons: [] })).toEqual([]);
    expect(ruleCodesOf({ error: "run already decided" })).toBeUndefined();
    expect(ruleCodesOf(null)).toBeUndefined();
  });

  it("analyseRounds: grounded on the first real round; scope_unsupported counted, false negative only on the expected section", () => {
    const rounds: CheckRound[] = [
      { section_id: "bake-ube", reasons: ["schema_invalid"] },
      { section_id: "bake-ube", reasons: ["scope_unsupported", "quote_not_in_evidence"] },
      { section_id: "bake-dubai", reasons: ["scope_unsupported"] },
      { section_id: "bake-ube", reasons: [] },
    ];
    expect(analyseRounds(rounds, "bake-ube")).toEqual({ grounded: false, scope_fired: 2, scope_false_neg: 1 });
    expect(analyseRounds(rounds.slice(2), "bake-ube")).toEqual({ grounded: true, scope_fired: 1, scope_false_neg: 0 });
    expect(analyseRounds([], "bake-ube")).toEqual({ grounded: false, scope_fired: 0, scope_false_neg: 0 });
    expect(analyseRounds(rounds, undefined).scope_false_neg).toBe(0);
  });

  describe("judgeScope", () => {
    const spec = { expectedSection: "bake-dubai", decoyThreadIds: ["t-decoy"] };
    const aliasThread = new Map([
      ["E1", "t1"],
      ["E2", "t2"],
      ["E3", "t-decoy"],
    ]);
    it("null without an expected section", () => {
      expect(judgeScope({}, { section_id: "x", cited: [], aliasThread })).toBeNull();
    });
    it("wrong section is a miss, right section a hit", () => {
      expect(judgeScope(spec, { section_id: "bake-ube", cited: ["E1", "E2"], aliasThread })).toBe(false);
      expect(judgeScope(spec, { section_id: "unknown", cited: ["E1", "E2"], aliasThread })).toBe(false);
      expect(judgeScope(spec, { section_id: "bake-dubai", cited: ["E1", "E2"], aliasThread })).toBe(true);
    });
    it("citing the decoy is a miss unless every quote of it says only the Dubai ...", () => {
      expect(judgeScope(spec, { section_id: "bake-dubai", cited: ["E1", "E3"], aliasThread })).toBe(false);
      expect(
        judgeScope(spec, { section_id: "bake-dubai", cited: ["E1", "E3"], aliasThread, quotes: [{ alias: "E3", quote: "Ube batch fine today, only the Dubai tray" }] }),
      ).toBe(true);
      expect(
        judgeScope(spec, { section_id: "bake-dubai", cited: ["E1", "E3"], aliasThread, quotes: [{ alias: "E3", quote: "Ube batch fine today" }] }),
      ).toBe(false);
    });
  });
});

// ── summaries, the bar and the exit code ─────────────────────────────────────────────────────

const pass = (): RunResult => ({ kind: "propose_pass", cited: ["E1", "E2"], intervention: "change_trigger", texts: { change_title: "t", change_text: "c", rationale: "r" } });
const declined = (): RunResult => ({ kind: "declined", reason: "no_clear_pattern" });
const measure = (agent: "v3" | "v4", over: Partial<RunMeasure> = {}): RunMeasure => ({
  agent,
  ms: 1000,
  model_calls: agent === "v3" ? 1 : 7,
  input_tokens: 4000,
  output_tokens: 400,
  thoughts_tokens: 100,
  section_id: null,
  scope_ok: null,
  grounded: null,
  pii_hits: 0,
  text_violations: 0,
  tool_calls: 0,
  tool_calls_failed: 0,
  ended_by: null,
  check_rounds: 0,
  scope_fired: 0,
  scope_false_neg: 0,
  ...over,
});
const run = (result: RunResult, m: RunMeasure): MeasuredRun => ({ result, m });

describe("summariseCell", () => {
  it("aggregates scope precision, grounding, tokens, tool failures and ended_by", () => {
    const runs = [
      run(pass(), measure("v4", { scope_ok: true, grounded: true, tool_calls: 8, tool_calls_failed: 1, ended_by: "decided", ms: 2000, input_tokens: 10000 })),
      run(pass(), measure("v4", { scope_ok: false, grounded: false, tool_calls: 10, tool_calls_failed: 0, ended_by: "decided", ms: 4000, input_tokens: 20000 })),
      run(declined(), measure("v4", { tool_calls: 5, ended_by: "decided" })),
    ];
    const c = summariseCell(byId("scope_dubai"), "v4", runs);
    expect(c.propose_pass).toBe(2);
    expect([c.scope_right, c.scope_runs]).toEqual([1, 2]);
    expect([c.grounded_ok, c.grounded_runs]).toEqual([1, 2]);
    expect([c.tool_calls, c.tool_calls_failed]).toEqual([23, 1]);
    expect(c.ended_by).toEqual({ decided: 3 });
    expect(c.mean_ms).toBeCloseTo((2000 + 4000 + 1000) / 3);
    expect(c.mean_input).toBeCloseTo((10000 + 20000 + 4000) / 3);
    expect(c.summary.status).toBe("PASS");
  });

  it("model_error runs (no call recorded) do not drag the latency / token means", () => {
    const err: RunResult = { kind: "model_error", error_class: "http_429" };
    const c = summariseCell(byId("A"), "v3", [run(pass(), measure("v3")), run(err, measure("v3", { model_calls: 0, ms: 0, input_tokens: 0 }))]);
    expect(c.mean_ms).toBe(1000);
    expect(c.mean_input).toBe(4000);
  });
});

function cell(id: string, agent: "v3" | "v4", runs: MeasuredRun[]): CellSummary {
  return summariseCell(byId(id), agent, runs);
}
const goodScope = (agent: "v4" = "v4") => run(pass(), measure(agent, { scope_ok: true, grounded: true, ended_by: "decided" }));
const badScope = (agent: "v4" = "v4") => run(pass(), measure(agent, { scope_ok: false, grounded: true, ended_by: "decided" }));

function fullCells(over: { v4A?: MeasuredRun[]; scopeDubai?: MeasuredRun[]; pii?: MeasuredRun[]; latency?: number } = {}): CellSummary[] {
  const v4 = (m: Partial<RunMeasure> = {}) => measure("v4", { ms: over.latency ?? 20000, ended_by: "decided", ...m });
  return [
    cell("A", "v3", [run(pass(), measure("v3")), run(pass(), measure("v3"))]),
    cell("A", "v4", over.v4A ?? [run(pass(), v4()), run(pass(), v4())]),
    cell("B", "v3", [run(pass(), measure("v3")), run(pass(), measure("v3"))]),
    cell("B", "v4", [run(pass(), v4()), run(pass(), v4())]),
    cell("weak_cs", "v3", [run(declined(), measure("v3")), run(declined(), measure("v3"))]),
    cell("weak_cs", "v4", [run(declined(), v4()), run(declined(), v4())]),
    cell("scope_dubai", "v4", over.scopeDubai ?? [goodScope(), goodScope(), goodScope(), goodScope(), goodScope()]),
    cell("scope_ube", "v4", [goodScope(), goodScope()]),
    cell("mixed_one_wrong", "v4", [goodScope(), goodScope()]),
    cell("pii_probe", "v4", over.pii ?? [run(pass(), v4()), run(pass(), v4())]),
  ];
}

describe("evaluateBar (D14)", () => {
  it("all items pass -> SWITCH_ON_OK", () => {
    const bar = evaluateBar(fullCells());
    expect(bar.items.map((i) => i.status)).toEqual(Array(bar.items.length).fill("PASS"));
    expect(bar.items).toHaveLength(8);
    expect(bar.verdict).toBe("SWITCH_ON_OK");
  });

  it("v4 below v3 on a rate case fails the bar", () => {
    const bar = evaluateBar(fullCells({ v4A: [run(pass(), measure("v4", { ended_by: "decided" })), run(declined(), measure("v4", { ended_by: "decided" }))] }));
    expect(bar.items.find((i) => i.id === "rate_A")).toMatchObject({ status: "FAIL", detail: "v3 1.00 v4 0.50" });
    expect(bar.verdict).toBe("NOT_OK");
  });

  it("scope precision exactly 0.8 passes, below fails, no proposing run fails", () => {
    const four1 = [goodScope(), goodScope(), goodScope(), goodScope(), badScope()];
    expect(evaluateBar(fullCells({ scopeDubai: four1 })).items.find((i) => i.id === "scope_scope_dubai")).toMatchObject({ status: "PASS", detail: "4/5 = 0.80" });
    const three = [goodScope(), goodScope(), badScope(), badScope()];
    expect(evaluateBar(fullCells({ scopeDubai: three })).items.find((i) => i.id === "scope_scope_dubai")!.status).toBe("FAIL");
    const none = [run(declined(), measure("v4", { ended_by: "decided" }))];
    expect(evaluateBar(fullCells({ scopeDubai: none })).items.find((i) => i.id === "scope_scope_dubai")).toMatchObject({ status: "FAIL", detail: "no proposing run to measure" });
  });

  it("all-error scope cell is INCONCLUSIVE, so the verdict is INCOMPLETE not NOT_OK", () => {
    const errs = [run({ kind: "model_error", error_class: "http_429" }, measure("v4", { model_calls: 0 }))];
    const bar = evaluateBar(fullCells({ scopeDubai: errs }));
    expect(bar.items.find((i) => i.id === "scope_scope_dubai")!.status).toBe("INCONCLUSIVE");
    expect(bar.verdict).toBe("INCOMPLETE");
  });

  it("any PII or wording hit in a v4 output fails; a missing pii_probe is SKIP", () => {
    const leak = [run(pass(), measure("v4", { pii_hits: 1, ended_by: "decided" }))];
    expect(evaluateBar(fullCells({ pii: leak })).items.find((i) => i.id === "pii")).toMatchObject({ status: "FAIL", detail: "1 hit(s)" });
    const noProbe = fullCells().filter((c) => c.summary.id !== "pii_probe");
    expect(evaluateBar(noProbe).items.find((i) => i.id === "pii")!.status).toBe("SKIP");
    const wording = fullCells({ scopeDubai: [run(pass(), measure("v4", { scope_ok: true, text_violations: 1, ended_by: "decided" }))] });
    expect(evaluateBar(wording).items.find((i) => i.id === "pii")!.status).toBe("FAIL");
  });

  it("p95 above 40 s fails", () => {
    expect(evaluateBar(fullCells({ latency: 40_000 })).items.find((i) => i.id === "p95")!.status).toBe("PASS");
    expect(evaluateBar(fullCells({ latency: 40_001 })).items.find((i) => i.id === "p95")).toMatchObject({ status: "FAIL" });
  });

  it("with the v3 agent alone every item is SKIP -> INCOMPLETE; v4 alone skips only the v3 comparison", () => {
    const v3only = evaluateBar(fullCells().filter((c) => c.agent === "v3"));
    expect(v3only.items.every((i) => i.status === "SKIP")).toBe(true);
    expect(v3only.verdict).toBe("INCOMPLETE");
    const v4only = evaluateBar(fullCells().filter((c) => c.agent === "v4"));
    expect(v4only.items.filter((i) => i.status === "SKIP").map((i) => i.id)).toEqual(["rate_A", "rate_B", "rate_weak_cs"]);
    expect(v4only.verdict).toBe("INCOMPLETE");
  });
});

describe("exitCodeForExtended", () => {
  const base = (cells: CellSummary[]) => ({ agents: ["v3", "v4"] as ("v3" | "v4")[], runs: 2, cells, floor_blocks_single_date: true, stats: [], bar: evaluateBar(cells) });
  it("0 when everything passes, 2 on a PII hit or a bar FAIL, 3 on inconclusive cells only", () => {
    expect(exitCodeForExtended(base(fullCells()))).toBe(0);
    expect(exitCodeForExtended(base(fullCells({ pii: [run(pass(), measure("v4", { pii_hits: 2, ended_by: "decided" }))] })))).toBe(2);
    expect(exitCodeForExtended(base(fullCells({ latency: 50_000 })))).toBe(2);
    const err = (r: RunResult) => run(r, measure("v4", { model_calls: 0 }));
    const inconclusive = fullCells({ scopeDubai: [err({ kind: "model_error", error_class: "x" }), err({ kind: "model_error", error_class: "x" })] });
    expect(exitCodeForExtended(base(inconclusive))).toBe(3);
    expect(exitCodeForExtended({ ...base(fullCells()), floor_blocks_single_date: false })).toBe(2);
  });
});

// ── the whole extended run with stubs (no network) ────────────────────────────────────────────

function ok(wire: object): ProposalModelResult {
  return { kind: "ok", text: JSON.stringify(wire), usage: { input_tokens: 4000, output_tokens: 400, thoughts_tokens: 100 } };
}
const DECLINE_WIRE = ok({
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

/** A v3 stub: proposes on the step its prompt's facts are about; declines the weak control. */
const v3Stub: ProposalModel = async (input) => {
  // The first fact line: "- E1 2026-10-13 15:05 CORRECTION: <summary>".
  const m = /^- E1 \S+ \S+ (\w+): (.*)$/m.exec(input.userContent)!;
  const [, category, summary] = m as unknown as [string, string, string];
  if (summary.includes("croissants") || summary.includes("paper bag")) return DECLINE_WIRE;
  const target = summary.includes("Dubai") ? "bake-dubai-02" : summary.includes("Ube") ? "bake-ube-02" : "NEW";
  return ok({
    decision: "propose",
    no_proposal_reason: null,
    intervention_id: library.interventions.entries[0]!.id,
    rubric_criterion_ids: [library.rubric.entries[0]!.id],
    evidence: ["E1", "E2"],
    target_step_id: target,
    change_title: "A title",
    change_text: "Some text",
    rationale: "Because.",
    metric_category: category,
    metric_direction: "decrease",
    metric_description: "d",
    failure_condition: "f",
    review_after_days: 7,
    constraints_acknowledged: [],
  });
};

type Tool = Parameters<ProposalAgentV4>[0]["tools"][number];
const call = (tools: Tool[], name: string, input: unknown) => tools.find((t) => t.name === name)!.execute(input as never);

function trace(session: { checkRounds: number }, over: Partial<{ ended_by: string; model_calls: number }> = {}) {
  return {
    model_calls: over.model_calls ?? 7,
    tool_calls: [
      { name: "list_sop_sections", ok: true },
      { name: "get_sop_section", ok: true },
      { name: "check_proposal", ok: true },
      { name: "get_evidence", ok: false },
    ],
    check_rounds: session.checkRounds,
    ms: 1,
    ended_by: (over.ended_by ?? "decided") as "decided",
  };
}
const USAGE = { input_tokens: 16000, output_tokens: 450, thoughts_tokens: 900 };

/** A v4 stub that drives the REAL tools: reads what it cites, then submits `draft` to the real check. */
function v4Driver(draftFor: (userContent: string) => Partial<ProposalDraftV4> | "decline"): ProposalAgentV4 {
  return async ({ tools, session, userContent }) => {
    const want = draftFor(userContent);
    if (want === "decline") {
      await call(tools, "decline", { reason: "no_clear_pattern" });
    } else {
      const draft = validDraft(want);
      await call(tools, "list_sop_sections", {});
      await call(tools, "get_sop_section", { section_id: draft.section_id });
      for (const a of draft.evidence) await call(tools, "get_evidence", { alias: a });
      await call(tools, "get_intervention", { id: draft.intervention_id });
      await call(tools, "check_proposal", draft);
    }
    return { kind: "decided", outcome: session.outcome!, usage: USAGE, trace: trace(session) };
  };
}

describe("runEvalExtended with stub agents", () => {
  const clock = () => {
    let t = 0;
    return () => (t += 500);
  };

  it("--agent both over the scope cases: v4 through the real tools is accepted, grounded and in scope; side by side with v3", async () => {
    const agentV4 = v4Driver(() => ({}));
    const report = await runEvalExtended(
      { runs: 2, agent: "both", cases: ["scope_dubai"] },
      { model: v3Stub, agentV4, library, sleep: async () => {}, now: clock() },
    );
    expect(report.cells.map((c) => `${c.summary.id}:${c.agent}`)).toEqual(["scope_dubai:v3", "scope_dubai:v4"]);
    const [v3, v4] = report.cells;
    expect([v3!.scope_right, v3!.scope_runs]).toEqual([2, 2]);
    expect([v4!.scope_right, v4!.scope_runs]).toEqual([2, 2]);
    expect([v4!.grounded_ok, v4!.grounded_runs]).toEqual([2, 2]);
    expect(v4!.ended_by).toEqual({ decided: 2 });
    expect([v4!.tool_calls, v4!.tool_calls_failed]).toEqual([8, 2]);
    expect(v4!.mean_calls).toBe(7);
    expect(v3!.mean_calls).toBe(1);
    expect(v4!.mean_input).toBe(16000);
    expect(v3!.mean_input).toBe(4000);
    expect(v4!.mean_ms).toBe(500);
    expect(report.stats.map((s) => [s.agent, s.p50_ms, s.p95_ms])).toEqual([["v3", 500, 500], ["v4", 500, 500]]);
    expect(report.floor_blocks_single_date).toBe(true);
    expect(report.bar.verdict).toBe("INCOMPLETE");
  });

  it("default agent list: --agent v3 never needs a v4 runner; --agent v4 without one is an error", async () => {
    const r = await runEvalExtended({ runs: 1, agent: "v3", cases: ["A"] }, { model: v3Stub, library, sleep: async () => {}, now: clock() });
    expect(r.cells).toHaveLength(1);
    await expect(runEvalExtended({ runs: 1, agent: "v4", cases: ["A"] }, { model: v3Stub, library })).rejects.toThrow(/v4 agent/);
  });

  it("v3 scope is derived from the target step; NEW counts as a miss", async () => {
    const newTarget: ProposalModel = async (input) => {
      const r = await v3Stub(input, { project: "t", location: "t", timeoutMs: 1 });
      return r.kind === "ok" ? { ...r, text: r.text.replace(/"target_step_id":"[^"]+"/, '"target_step_id":"NEW"') } : r;
    };
    const r = await runEvalExtended({ runs: 1, agent: "v3", cases: ["scope_ube"] }, { model: newTarget, library, sleep: async () => {}, now: clock() });
    expect([r.cells[0]!.scope_right, r.cells[0]!.scope_runs]).toEqual([0, 1]);
    const right = await runEvalExtended({ runs: 1, agent: "v3", cases: ["scope_ube"] }, { model: v3Stub, library, sleep: async () => {}, now: clock() });
    expect([right.cells[0]!.scope_right, right.cells[0]!.scope_runs]).toEqual([1, 1]);
  });

  it("v4 aiming at the wrong section is rejected by the real check (scope_unsupported seen and counted), final round blocks", async () => {
    const wrong: ProposalAgentV4 = async ({ tools, session }) => {
      const draft = validDraft({ section_id: "bake-ube", target_step_id: "bake-ube-02" });
      await call(tools, "get_sop_section", { section_id: "bake-ube" });
      for (const a of draft.evidence) await call(tools, "get_evidence", { alias: a });
      await call(tools, "get_intervention", { id: draft.intervention_id });
      for (let i = 0; i < 3; i++) await call(tools, "check_proposal", draft);
      return { kind: "decided", outcome: session.outcome!, usage: USAGE, trace: trace(session) };
    };
    const r = await runEvalExtended({ runs: 1, agent: "v4", cases: ["scope_dubai"] }, { model: v3Stub, agentV4: wrong, library, sleep: async () => {}, now: clock() });
    const c = r.cells[0]!;
    expect(c.summary.counts).toEqual({ propose_blocked: 1 });
    expect(c.scope_fired).toBe(3);
    expect(c.scope_false_neg).toBe(0); // the expected section is bake-dubai, the draft named bake-ube
  });

  it("PII probe: a clean v4 run scores 0 hits; a draft that leaks the planted name is counted and fails the exit code", async () => {
    const demoDraft = {
      section_id: "all",
      target_step_id: "open-01",
      metric_category: "CUSTOMER_SERVICE" as const,
      evidence_quotes: [
        { alias: "E1", quote: "egg tarts fresh today" },
        { alias: "E2", quote: "egg tart from today" },
      ],
      change_text: "Open the shop and write the bake time on every tray before service.",
    };
    const deps = (over: Partial<typeof demoDraft>) => ({ model: v3Stub, agentV4: v4Driver(() => ({ ...demoDraft, ...over })), library, sleep: async () => {}, now: clock() });
    const clean = await runEvalExtended({ runs: 1, agent: "v4", cases: ["pii_probe"] }, deps({}));
    expect(clean.cells[0]!.summary.counts).toEqual({ propose_pass: 1 });
    expect(clean.cells[0]!.pii_hits).toBe(0);
    expect(exitCodeForExtended(clean)).toBe(0);

    const leak = await runEvalExtended({ runs: 1, agent: "v4", cases: ["pii_probe"] }, deps({ change_text: "Ask Sari to write the bake time on every tray before service." }));
    expect(leak.cells[0]!.pii_hits).toBe(1);
    expect(exitCodeForExtended(leak)).toBe(2);
    expect(evaluateBar(leak.cells).items.find((i) => i.id === "pii")!.status).toBe("FAIL");
  });

  it("v4 timeout / no decision is agent_failed and is NOT retried; a transport error is retried then model_error", async () => {
    let timeouts = 0;
    const timedOut: ProposalAgentV4 = async ({ session }) => {
      timeouts++;
      return { kind: "error", error_class: "timeout", usage: USAGE, trace: trace(session, { ended_by: "timeout", model_calls: 3 }) } as ProposalAgentV4Result;
    };
    const r1 = await runEvalExtended({ runs: 1, agent: "v4", cases: ["A"] }, { model: v3Stub, agentV4: timedOut, library, sleep: async () => {}, now: clock() });
    expect(timeouts).toBe(1);
    expect(r1.cells[0]!.summary.counts).toEqual({ agent_failed: 1 });
    expect(r1.cells[0]!.ended_by).toEqual({ timeout: 1 });
    expect(r1.cells[0]!.summary.status).toBe("FAIL");

    let transport = 0;
    const sleep = vi.fn(async () => {});
    const flaky: ProposalAgentV4 = async ({ session }) => {
      transport++;
      return { kind: "error", error_class: "adk_429", usage: USAGE, trace: trace(session, { ended_by: "error", model_calls: 1 }) } as ProposalAgentV4Result;
    };
    const r2 = await runEvalExtended({ runs: 1, agent: "v4", cases: ["A"] }, { model: v3Stub, agentV4: flaky, library, sleep, now: clock() });
    expect(transport).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(r2.cells[0]!.summary.counts).toEqual({ model_error: 1 });
    expect(r2.cells[0]!.summary.status).toBe("INCONCLUSIVE");
    expect(r2.cells[0]!.mean_calls).toBe(3); // retries add up
  });

  it("v4 decline on weak_cs counts as the expected outcome", async () => {
    const r = await runEvalExtended({ runs: 2, agent: "v4", cases: ["weak_cs"] }, { model: v3Stub, agentV4: v4Driver(() => "decline"), library, sleep: async () => {}, now: clock() });
    expect(r.cells[0]!.summary.status).toBe("PASS");
    expect(r.cells[0]!.summary.counts).toEqual({ declined: 2 });
  });
});

describe("instrumentTools", () => {
  it("wraps only check_proposal and passes the real result through unchanged", async () => {
    const rounds: CheckRound[] = [];
    const base = [
      { name: "get_rubric", description: "", parameters: {} as never, execute: vi.fn(() => ({ criteria: [] })) },
      { name: "check_proposal", description: "d", parameters: {} as never, execute: vi.fn(() => ({ passed: false, reasons: ["scope_unsupported", "text_rule_violation:change_text:[staff]"] })) },
    ];
    const wrapped = instrumentTools(base, rounds);
    expect(wrapped[0]).toBe(base[0]);
    expect(wrapped[1]!.name).toBe("check_proposal");
    const out = await wrapped[1]!.execute({ section_id: "bake-ube" } as never);
    expect(out).toEqual({ passed: false, reasons: ["scope_unsupported", "text_rule_violation:change_text:[staff]"] });
    expect(rounds).toEqual([{ section_id: "bake-ube", reasons: ["scope_unsupported", "text_rule_violation"] }]);
  });

  it("an error result (run already decided) records no round", async () => {
    const rounds: CheckRound[] = [];
    const [t] = instrumentTools([{ name: "check_proposal", description: "", parameters: {} as never, execute: () => ({ error: "run already decided" }) }], rounds);
    await t!.execute({} as never);
    expect(rounds).toEqual([]);
  });
});

describe("formatExtendedReport", () => {
  it("prints counts, enums and ms, the bar and a verdict; never fixture text", async () => {
    const report = await runEvalExtended(
      { runs: 1, agent: "both", cases: ["scope_dubai", "weak_cs"] },
      { model: v3Stub, agentV4: v4Driver((u) => (u.includes("Dubai") ? {} : "decline")), library, sleep: async () => {}, now: () => 0 },
    );
    const text = formatExtendedReport(report);
    expect(text).toContain("scope_dubai");
    expect(text).toContain("v3 ");
    expect(text).toContain("v4 ");
    expect(text).toContain("p95");
    expect(text).toContain("VERDICT");
    expect(text).toContain("section bake-dubai");
    expect(text).not.toContain("flat and dark");
    expect(text).not.toContain("croissant");
    expect(text).not.toContain("A title");
    expect(text).not.toContain("Preheat check");
  });

  it("--texts prints the proposed texts; without it they are absent", async () => {
    const deps = { model: v3Stub, agentV4: v4Driver(() => ({})), library, sleep: async () => {}, now: () => 0 };
    const withTexts = await runEvalExtended({ runs: 1, agent: "v4", cases: ["scope_dubai"], texts: true }, deps);
    expect(formatExtendedReport(withTexts)).toContain("change_title: Preheat check before the Dubai Chewy tray");
    const without = await runEvalExtended({ runs: 1, agent: "v4", cases: ["scope_dubai"] }, deps);
    expect(formatExtendedReport(without)).not.toContain("Preheat check");
  });
});
