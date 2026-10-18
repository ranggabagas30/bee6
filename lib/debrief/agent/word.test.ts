import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wordGateQuestions, type WordGateInput } from "@/lib/debrief/agent/word";
import { CHECK_RULES } from "@/lib/debrief/agent/check";
import {
  DEBRIEF_AGENT_BACKSTOP_MARGIN_MS,
  DEBRIEF_AGENT_MAX_PER_UNIT,
  DEBRIEF_AGENT_MODEL,
  DEBRIEF_AGENT_TIMEOUT_MS,
  DEBRIEF_AGENT_UNIT_BUDGET_MS,
  DEBRIEF_AGENT_UNIT_GUARD_MS,
  DEBRIEF_AGENT_COLD_START_MARGIN_MS,
  DEBRIEF_AGENT_VERSION,
} from "@/lib/debrief/agent/constants";
import type { DebriefAgent, DebriefAgentResult } from "@/lib/agents/debrief-agent";
import type { GateDecision, GateRule } from "@/lib/pipeline/gate";
import type { QuestionWrite, StoredThread, ThreadWrite } from "@/lib/pipeline/tick/types";

const TZ = "Asia/Jakarta";
// 2026-10-14 07:05 UTC = 14:05 Jakarta
const T0 = Date.UTC(2026, 9, 14, 7, 5, 0);
const NOW = T0 + 10 * 60_000;
const GOOD = "Around 14:05, was there a phone order for twelve egg tarts?";
const USAGE = { input_tokens: 700, output_tokens: 40, thoughts_tokens: 0 };

function gate(verdict: "fact" | "question", rule: GateRule): GateDecision {
  return {
    verdict,
    fired_rule: rule,
    checks: [],
    category: "PHONE_CALL",
    confidence: 0.6,
    threshold: 0.8,
    evidence_count: 1,
    gate_version: "1",
  } as GateDecision;
}

function thread(id: string, over: Partial<ThreadWrite> = {}): ThreadWrite {
  return {
    outlet_id: "sbx-1",
    device_id: "d1",
    thread_id: id,
    category: "PHONE_CALL",
    confidence: 0.6,
    line_ids: [`${id}#0`],
    evidence_line_ids: [`${id}#0`],
    lines: [{ line_id: `${id}#0`, start_ms: T0, end_ms: T0 + 10_000, text: "There was a phone order for twelve egg tarts." }],
    first_line_start_ms: T0,
    last_line_end_ms: T0 + 3 * 60_000,
    summary: "Phone order taken.",
    label_conflict: false,
    status: "open",
    gate: gate("question", "always_question"),
    created_at_ms: NOW,
    updated_at_ms: NOW,
    ...over,
  };
}

function question(threadId: string | null, over: Partial<QuestionWrite> = {}): QuestionWrite {
  return {
    outlet_id: "sbx-1",
    device_id: "d1",
    question_id: threadId ? `q_thread_${threadId}` : "q_unit_x",
    thread_id: threadId,
    kind: threadId ? "gate" : "unlabelled_unit",
    status: "open",
    category: threadId ? "PHONE_CALL" : null,
    window_start_ms: T0,
    window_end_ms: T0 + 3 * 60_000,
    created_at_ms: NOW,
    ...over,
  };
}

function stored(id: string, over: Partial<StoredThread> = {}): StoredThread {
  return {
    thread_id: id,
    category: "PHONE_CALL",
    confidence: 0.6,
    line_ids: [],
    evidence_line_ids: [],
    lines: [],
    first_line_start_ms: T0,
    last_line_end_ms: T0,
    summary: "",
    label_conflict: false,
    status: "open",
    created_at_ms: 1,
    ...over,
  };
}

const accepted = (question_en = GOOD, rounds = 1): DebriefAgentResult => ({
  kind: "accepted",
  draft: { question_en },
  rounds,
  usage: USAGE,
  model_calls: rounds,
  ms: 1234,
});

function setup(
  ids: string[],
  run: DebriefAgent,
  over: Partial<WordGateInput> = {},
  threadOver: Partial<ThreadWrite> = {},
) {
  const threadWrites = ids.map((id) => thread(id, threadOver));
  const questionWrites = ids.map((id) => question(id));
  const input: WordGateInput = {
    outlet_id: "sbx-1",
    unit_id: "u1",
    questionWrites,
    threadWrites,
    storedByThread: new Map(ids.map((id) => [id, null])),
    staffNames: ["Sari Demo"],
    tz: TZ,
    now_ms: NOW,
    deps: { run, project: "proj", resolveLocation: () => "LOC", now_ms: NOW },
    ...over,
  };
  return { input, questionWrites, threadWrites };
}

describe("wordGateQuestions", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("which questions reach the agent (the gate decides, the agent only words)", () => {
    const WORDED: GateRule[] = ["always_question", "needs_supervisor_confirm", "below_threshold", "no_evidence", "label_conflict"];
    it.each(WORDED)("a thread the gate flagged with %s is worded", async (rule) => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, { gate: gate("question", rule) });
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
      expect(questionWrites[0]!.agent?.question_en).toBe(GOOD);
    });

    it("a thread whose gate verdict is fact is never worded", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, { gate: gate("fact", "passed") });
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect(questionWrites[0]!.agent).toBeUndefined();
    });

    it("an unlabelled_unit question (no thread, no lines) is never worded", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup([], run, { questionWrites: [question(null)] });
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect(input.questionWrites[0]!.agent).toBeUndefined();
    });

    it("a gate question whose thread is not in this unit's writes, or is NON_WORK, is skipped", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run, { threadWrites: [] });
      await wordGateQuestions(input);
      const nonWork = setup(["t2"], run);
      nonWork.input.questionWrites[0]!.category = "NON_WORK";
      await wordGateQuestions(nonWork.input);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("outcomes", () => {
    it("accepted: stores exactly the agent object (no text beyond the wording, no id, no role)", async () => {
      const { input, questionWrites } = setup(["t1"], async () => accepted(`  ${GOOD}  `, 2));
      await wordGateQuestions(input);
      expect(questionWrites[0]!.agent).toEqual({
        version: DEBRIEF_AGENT_VERSION,
        model: DEBRIEF_AGENT_MODEL,
        category: "PHONE_CALL",
        start_hm: "14:05",
        question_en: GOOD,
        rounds: 2,
        generated_at_ms: NOW,
      });
    });

    it("M5: an agent object that fails the storage schema is NOT assigned (the template stays), logged as agent_schema, never thrown", async () => {
      // rounds 3 passes the plain-code checker (the runner counts) but is outside the stored 1..2
      const { input, questionWrites } = setup(["t1"], async () => accepted(GOOD, 3));
      await expect(wordGateQuestions(input)).resolves.toBeUndefined();
      expect("agent" in questionWrites[0]!).toBe(false);
      const entries = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((l: string) => l.includes("debrief_agent.call"))
        .map((l: string) => JSON.parse(l) as Record<string, unknown>);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: "error", error_class: "agent_schema", outlet_id: "sbx-1", unit_id: "u1" });
      // numbers and enums only: no wording, no zod message
      expect(JSON.stringify(entries[0])).not.toContain("twelve");
      expect(JSON.stringify(entries[0])).not.toContain("Around");
    });

    it("M5: a negative generated_at_ms also keeps the template", async () => {
      const { input, questionWrites } = setup(["t1"], async () => accepted(), {
        now_ms: -1,
        deps: { run: async () => accepted(), project: "proj", resolveLocation: () => "LOC", now_ms: -1 },
      });
      await wordGateQuestions(input);
      expect("agent" in questionWrites[0]!).toBe(false);
    });

    it("rejected after 2 rounds: no agent field (the template stays)", async () => {
      const { input, questionWrites } = setup(["t1"], async () => ({
        kind: "rejected", reasons: ["too_long"], rounds: 2, usage: USAGE, model_calls: 2, ms: 900,
      }));
      await wordGateQuestions(input);
      expect("agent" in questionWrites[0]!).toBe(false);
    });

    it.each(["timeout", "limit", "no_decision", "adk_500"])("error %s: no agent field, no throw", async (error_class) => {
      const { input, questionWrites } = setup(["t1"], async () => ({
        kind: "error", error_class, usage: USAGE, model_calls: 1, ms: 8000,
      }));
      await expect(wordGateQuestions(input)).resolves.toBeUndefined();
      expect("agent" in questionWrites[0]!).toBe(false);
    });

    it("a run that throws (contract violation) is caught: no agent, log carries the error class only", async () => {
      const { input, questionWrites } = setup(["t1"], async () => {
        throw new TypeError("boom: 'There was a phone order' secret text");
      });
      await expect(wordGateQuestions(input)).resolves.toBeUndefined();
      expect("agent" in questionWrites[0]!).toBe(false);
      const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(logged).toContain("TypeError");
      expect(logged).not.toContain("secret text");
    });

    it("accepted by the runner but failing the final checkQuestion re-run: no agent field", async () => {
      // 'croissant' is in no input line: the checker's word_not_in_input rule fails it.
      const { input, questionWrites } = setup(["t1"], async () => accepted("Around 14:05, was there a croissant order for a customer?"));
      await wordGateQuestions(input);
      expect("agent" in questionWrites[0]!).toBe(false);
      const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(logged).toContain("word_not_in_input");
      expect(logged).not.toContain("croissant");
    });

    it("the staff-name scrub applies to the final re-run too (a name in the wording is refused)", async () => {
      const { input, questionWrites } = setup(["t1"], async () => accepted("Around 14:05, did Sari take a phone order for twelve egg tarts?"));
      await wordGateQuestions(input);
      expect("agent" in questionWrites[0]!).toBe(false);
    });
  });

  describe("negated notes pre-skip (M1 rework: a Yes on a moment whose notes are a negative fact must not be able to drop true evidence)", () => {
    const skipLogs = () =>
      logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((l: string) => l.includes("debrief_agent.call"));
    const withText = (text: string, summary = "Phone order taken."): Partial<ThreadWrite> => ({
      lines: [{ line_id: "t1#0", start_ms: T0, end_ms: T0 + 10_000, text }],
      summary,
    });

    it("a negated line: the runner is never invoked, no agent on the question, one numbers-only skip line", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, withText("I did not read the order back to the caller."));
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect("agent" in questionWrites[0]!).toBe(false);
      const logs = skipLogs();
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0]!)).toEqual({
        event: "debrief_agent.call",
        outlet_id: "sbx-1",
        unit_id: "u1",
        outcome: "skipped",
        reason: "negated_notes",
      });
      expect(logs[0]).not.toContain("order back");
    });

    it("a negated summary alone also skips", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, withText("There was a phone order for twelve egg tarts.", "Phone order taken, not read back."));
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect(questionWrites[0]!.agent).toBeUndefined();
      expect(skipLogs()[0]).toContain('"outcome":"skipped","reason":"negated_notes"');
    });

    it.each([
      "Saya tidak membaca ulang pesanan itu.",
      "Pesanan nggak dibacakan.",
      "Belum dibacakan ke pelanggan.",
      "Itu bukan pesanan.",
      "Dilayani tanpa struk.",
    ])("a Bahasa negation skips: %s", async (text) => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, withText(text));
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect(questionWrites[0]!.agent).toBeUndefined();
    });

    it("positive notes still run the agent", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, withText("There was a phone order for twelve egg tarts."));
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
      expect(questionWrites[0]!.agent?.question_en).toBe(GOOD);
      expect(skipLogs().some((l: string) => l.includes("negated_notes"))).toBe(false);
    });

    it("only the negated moment is skipped; its positive sibling in the same unit is still worded", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const a = setup(["t1"], run, {}, withText("I did not read the order back."));
      const b = setup(["t2"], run, {}, withText("There was a phone order for twelve egg tarts."));
      const input: WordGateInput = {
        ...a.input,
        questionWrites: [...a.questionWrites, ...b.questionWrites],
        threadWrites: [...a.threadWrites, ...b.threadWrites],
        storedByThread: new Map([["t1", null], ["t2", null]]),
      };
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
      expect(input.questionWrites[0]!.agent).toBeUndefined();
      expect(input.questionWrites[1]!.agent?.question_en).toBe(GOOD);
    });
  });

  describe("negated notes without 'not' (the tech-lead's REQUIRED change) and filter-before-cap (M1 rework 2)", () => {
    const skipLogs = () =>
      logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((l: string) => l.includes("debrief_agent.call"));
    const textOf = (id: string, text: string): Partial<ThreadWrite> => ({
      lines: [{ line_id: `${id}#0`, start_ms: T0, end_ms: T0 + 10_000, text }],
    });
    const NEG = "I did not read the order back.";
    const POS = "There was a phone order for twelve egg tarts.";
    /** One unit with one thread per text, in order. */
    function unit(texts: string[], over: Partial<WordGateInput> = {}, run: DebriefAgent = vi.fn<DebriefAgent>(async () => accepted())) {
      const ids = texts.map((_, i) => `t${i + 1}`);
      const threadWrites = ids.map((id, i) => thread(id, textOf(id, texts[i]!)));
      const questionWrites = ids.map((id) => question(id));
      const input: WordGateInput = {
        outlet_id: "sbx-1",
        unit_id: "u1",
        questionWrites,
        threadWrites,
        storedByThread: new Map(ids.map((id) => [id, null])),
        staffNames: ["Sari Demo"],
        tz: TZ,
        now_ms: NOW,
        deps: { run, project: "proj", resolveLocation: () => "LOC", now_ms: NOW },
        ...over,
      };
      return { input, questionWrites, run };
    }

    it("end to end: 'I forgot to read the order back' keeps the template, runner never invoked, one negated_notes skip line", async () => {
      const { input, questionWrites, run } = unit(["Phone order, I forgot to read the order back to the caller."]);
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect("agent" in questionWrites[0]!).toBe(false);
      const logs = skipLogs();
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0]!)).toEqual({
        event: "debrief_agent.call",
        outlet_id: "sbx-1",
        unit_id: "u1",
        outcome: "skipped",
        reason: "negated_notes",
      });
      expect(logs[0]).not.toContain("forgot");
    });

    it("3 negated moments + a positive 4th: the positive one is worded (negated moments use no cap slot)", async () => {
      const { input, questionWrites, run } = unit([NEG, NEG, NEG, POS]);
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
      expect(questionWrites.map((q) => q.agent !== undefined)).toEqual([false, false, false, true]);
      expect(skipLogs().filter((l: string) => l.includes('"reason":"negated_notes"'))).toHaveLength(3);
    });

    it("4 positives: the cap is still 3, in unit order", async () => {
      const { input, questionWrites, run } = unit([POS, POS, POS, POS]);
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(DEBRIEF_AGENT_MAX_PER_UNIT);
      expect(questionWrites.map((q) => q.agent !== undefined)).toEqual([true, true, true, false]);
    });

    it("no_lines moments also use no cap slot", async () => {
      const { input, questionWrites, run } = unit(["\u200b", "\u200b", "\u200b", POS]);
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
      expect(questionWrites.map((q) => q.agent !== undefined)).toEqual([false, false, false, true]);
    });

    it("low unit budget: a negated moment logs negated_notes (its real reason), the positive one logs unit_budget", async () => {
      const { input, run } = unit([NEG, POS], { unit_budget_left_ms: DEBRIEF_AGENT_UNIT_GUARD_MS - 1 });
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      const reasons = skipLogs().map((l: string) => (JSON.parse(l) as { reason: string }).reason);
      expect(reasons).toEqual(["negated_notes", "unit_budget"]);
    });

    it("low unit budget with only negated moments: no unit_budget line at all", async () => {
      const { input } = unit([NEG, NEG], { unit_budget_left_ms: DEBRIEF_AGENT_UNIT_GUARD_MS - 1 });
      await wordGateQuestions(input);
      const reasons = skipLogs().map((l: string) => (JSON.parse(l) as { reason: string }).reason);
      expect(reasons).toEqual(["negated_notes", "negated_notes"]);
    });
  });

  describe("continuation skip (F3: an existing open question keeps its wording)", () => {
    it("stored open + same category: not called", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, { storedByThread: new Map([["t1", stored("t1")]]) });
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect("agent" in questionWrites[0]!).toBe(false);
    });

    it("stored open + category changed: called", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run, { storedByThread: new Map([["t1", stored("t1", { category: "CUSTOMER_SERVICE" })]]) });
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("stored fact (re-opened now): called", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run, { storedByThread: new Map([["t1", stored("t1", { status: "fact" })]]) });
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("a thread missing from the stored map is treated as new", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run, { storedByThread: new Map() });
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe("cap and parallelism", () => {
    it(`5 candidates: only ${DEBRIEF_AGENT_MAX_PER_UNIT} are called, in unit order, and the rest are untouched`, async () => {
      const seen: string[] = [];
      const run: DebriefAgent = async (inp) => {
        seen.push(inp.moment.start_hm);
        return accepted();
      };
      const ids = ["t1", "t2", "t3", "t4", "t5"];
      const { input, questionWrites } = setup(ids, run);
      await wordGateQuestions(input);
      expect(seen).toHaveLength(3);
      expect(questionWrites.map((q) => q.agent !== undefined)).toEqual([true, true, true, false, false]);
    });

    it("the capped candidates run in parallel (all started before any finishes)", async () => {
      let inFlight = 0;
      let peak = 0;
      const run: DebriefAgent = async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
        return accepted();
      };
      const { input } = setup(["t1", "t2", "t3"], run);
      await wordGateQuestions(input);
      expect(peak).toBe(3);
    });

    it("the cap counts worded candidates, not skipped continuations", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const ids = ["t1", "t2", "t3", "t4", "t5"];
      const { input } = setup(ids, run, {
        storedByThread: new Map([
          ["t1", stored("t1")],
          ["t2", stored("t2")],
          ["t3", null],
          ["t4", null],
          ["t5", null],
        ]),
      });
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(3);
    });
  });

  describe("no lines", () => {
    it("every line scrubbed away: the agent is not called and the template stays", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {}, {
        lines: [{ line_id: "t1#0", start_ms: T0, end_ms: T0 + 1, text: "​" }],
      });
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect("agent" in questionWrites[0]!).toBe(false);
    });
  });

  describe("what the runner is given", () => {
    it("the moment is built from the thread in the outlet tz; project and location come from the deps (never a literal)", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run);
      await wordGateQuestions(input);
      const [agentInput, ctx] = run.mock.calls[0]!;
      expect(agentInput.moment.start_hm).toBe("14:05");
      expect(agentInput.moment.end_hm).toBe("14:08");
      expect(agentInput.moment.fired_rule).toBe("always_question");
      expect(agentInput.staffNames).toEqual(["Sari Demo"]);
      expect(ctx).toEqual({ project: "proj", location: "LOC", timeoutMs: DEBRIEF_AGENT_TIMEOUT_MS });
    });

    it("the location is resolved for the DebriefAgent model", async () => {
      const resolveLocation = vi.fn(() => "LOC");
      const { input } = setup(["t1"], async () => accepted(), { deps: { run: async () => accepted(), project: "p", resolveLocation } });
      await wordGateQuestions(input);
      expect(resolveLocation).toHaveBeenCalledWith(DEBRIEF_AGENT_MODEL);
    });

    it("a location that cannot be resolved never throws and never calls the agent", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input, questionWrites } = setup(["t1"], run, {
        deps: {
          run,
          project: "p",
          resolveLocation: () => {
            throw new Error("not probed");
          },
        },
      });
      await expect(wordGateQuestions(input)).resolves.toBeUndefined();
      expect(run).not.toHaveBeenCalled();
      expect("agent" in questionWrites[0]!).toBe(false);
    });
  });

  describe("unit time budget (the lease arithmetic stays true)", () => {
    it("is skipped when the unit has less than one agent budget left", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run, { unit_budget_left_ms: DEBRIEF_AGENT_UNIT_GUARD_MS - 1 });
      await wordGateQuestions(input);
      expect(run).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"outcome":"skipped","reason":"unit_budget"'));
    });

    it("runs when exactly one agent budget is left", async () => {
      const run = vi.fn<DebriefAgent>(async () => accepted());
      const { input } = setup(["t1"], run, { unit_budget_left_ms: DEBRIEF_AGENT_UNIT_GUARD_MS });
      await wordGateQuestions(input);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("the agent's per-unit budget is the timeout plus the backstop margin (parallel questions share it)", () => {
      expect(DEBRIEF_AGENT_UNIT_BUDGET_MS).toBe(DEBRIEF_AGENT_TIMEOUT_MS + DEBRIEF_AGENT_BACKSTOP_MARGIN_MS);
    });

    it("the guard adds the one-off cold ADK import margin on top of the per-unit budget", () => {
      expect(DEBRIEF_AGENT_COLD_START_MARGIN_MS).toBe(2_000);
      expect(DEBRIEF_AGENT_UNIT_GUARD_MS).toBe(DEBRIEF_AGENT_UNIT_BUDGET_MS + DEBRIEF_AGENT_COLD_START_MARGIN_MS);
    });
  });

  describe("log line (counts and enums only)", () => {
    it("writes ONE debrief_agent.call line per worded candidate with no text and no wording", async () => {
      const { input } = setup(["t1", "t2"], async () => accepted());
      await wordGateQuestions(input);
      const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((s: string) => s.includes("debrief_agent.call"));
      expect(lines).toHaveLength(2);
      const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(entry).toEqual({
        event: "debrief_agent.call",
        outlet_id: "sbx-1",
        unit_id: "u1",
        outcome: "accepted",
        rounds: 1,
        reject_reasons: [],
        model_calls: 1,
        ms: 1234,
        input_tokens: 700,
        output_tokens: 40,
        thoughts_tokens: 0,
      });
      const all = lines.join("\n");
      expect(all).not.toContain("egg tarts");
      expect(all).not.toContain("phone order");
      expect(all).not.toContain("Sari");
    });

    it("reject_reasons: the first-round codes are logged on accepted, rejected and error; codes only, never text", async () => {
      const acc = setup(["t1"], async () => ({ ...accepted(GOOD, 2), reject_reasons: ["negation"] }));
      await wordGateQuestions(acc.input);
      const rej = setup(["t2"], async () => ({
        kind: "rejected", reasons: ["too_long", "time_missing"], reject_reasons: ["word_not_in_input", "compound"], rounds: 2, usage: USAGE, model_calls: 2, ms: 5,
      }));
      await wordGateQuestions(rej.input);
      const err = setup(["t3"], async () => ({ kind: "error", error_class: "timeout", reject_reasons: ["not_yes_no"], usage: USAGE, model_calls: 1, ms: 8000 }));
      await wordGateQuestions(err.input);
      // the tick's own re-check fails on a draft the runner accepted: the runner's first-round codes still ride along
      const recheck = setup(["t4"], async () => ({ ...accepted("Around 14:05, was there a prompt injection about theft?", 2), reject_reasons: ["too_long"] }));
      await wordGateQuestions(recheck.input);
      const raw = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("debrief_agent.call"));
      const entries = raw.map((l: string) => JSON.parse(l) as Record<string, unknown>);
      expect(entries[0]).toMatchObject({ outcome: "accepted", reject_reasons: ["negation"] });
      expect(entries[1]).toMatchObject({ outcome: "rejected", reasons: ["too_long", "time_missing"], reject_reasons: ["word_not_in_input", "compound"] });
      expect(entries[2]).toMatchObject({ outcome: "error", reject_reasons: ["not_yes_no"] });
      expect(entries[3]).toMatchObject({ outcome: "rejected", reject_reasons: ["too_long"] });
      expect(entries[3]!.reasons).toContain("word_not_in_input");
      // every logged reject code is a known fixed rule code, and no shop text or wording is in any line
      for (const e of entries) for (const code of (e.reject_reasons as string[])) expect(CHECK_RULES).toContain(code);
      const all = raw.join("\n");
      for (const text of ["egg tarts", "phone order", "prompt injection", "theft", "Sari", "Around 14:05"]) expect(all).not.toContain(text);
    });

    it("rejected: carries the rule codes; error: carries the error class; skipped: carries the reason", async () => {
      const rejected = setup(["t1"], async () => ({ kind: "rejected", reasons: ["too_long", "time_missing"], rounds: 2, usage: USAGE, model_calls: 2, ms: 5 }));
      await wordGateQuestions(rejected.input);
      const errored = setup(["t2"], async () => ({ kind: "error", error_class: "timeout", usage: USAGE, model_calls: 1, ms: 8000 }));
      await wordGateQuestions(errored.input);
      const skipped = setup(["t3"], async () => accepted(), { storedByThread: new Map([["t3", stored("t3")]]) });
      await wordGateQuestions(skipped.input);
      const entries = logSpy.mock.calls
        .map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>)
        .filter((e: Record<string, unknown>) => e.event === "debrief_agent.call");
      expect(entries[0]).toMatchObject({ outcome: "rejected", reasons: ["too_long", "time_missing"], rounds: 2 });
      expect(entries[1]).toMatchObject({ outcome: "error", error_class: "timeout" });
      expect(entries[2]).toMatchObject({ outcome: "skipped", reason: "continuation_same_category" });
    });
  });
});
