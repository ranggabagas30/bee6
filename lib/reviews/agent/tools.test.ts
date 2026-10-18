import { describe, expect, it } from "vitest";
import { buildReviewTools } from "@/lib/reviews/agent/tools";
import { goodDraft, makeInputs } from "@/lib/reviews/agent/testing";
import { newReviewAgentSession, type ReviewAgentSession } from "@/lib/reviews/agent/types";

function setup(opts: Parameters<typeof makeInputs>[0] = {}) {
  const inputs = makeInputs(opts);
  const session = newReviewAgentSession();
  const tools = buildReviewTools(inputs, session);
  const by = (name: string) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t;
  };
  const call = (name: string, args: unknown = {}) => {
    const t = by(name);
    return t.execute(t.parameters.parse(args));
  };
  return { inputs, session, tools, by, call };
}

const FORBIDDEN_KEYS = ["thread_id", "device_id", "question_id", "verdict", "suggestion", "suggested_verdict", "answer", "staffNames", "role", "name"];
function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe("buildReviewTools", () => {
  it("offers exactly the five tools of the plan", () => {
    expect(setup().tools.map((t) => t.name)).toEqual(["get_change", "get_counts", "get_evidence_sample", "check_review", "decline"]);
  });

  it("each read tool marks what it inspected and records the call", () => {
    const { call, session } = setup();
    call("get_change");
    expect([...session.inspected]).toEqual(["change"]);
    call("get_counts");
    call("get_evidence_sample", { window: "before" });
    expect(session.inspected.has("before")).toBe(true);
    expect(session.inspected.has("after")).toBe(false);
    call("get_evidence_sample", { window: "after" });
    expect(new Set(session.inspected)).toEqual(new Set(["change", "counts", "before", "after"]));
    expect(session.toolCalls.map((c) => c.name)).toEqual(["get_change", "get_counts", "get_evidence_sample", "get_evidence_sample"]);
    expect(session.toolCalls.every((c) => c.ok)).toBe(true);
  });

  it("get_change returns the change as given", () => {
    const { call, inputs } = setup();
    expect(call("get_change")).toEqual(inputs.change);
  });

  it("get_counts returns numbers and the rule in words, never a verdict", () => {
    const { call } = setup();
    const out = call("get_counts") as Record<string, unknown>;
    expect(out).toMatchObject({
      before: { days_captured: 3, count: 2, per_day: 0.67 },
      after: { days_captured: 2, count: 0, per_day: 0 },
      change_pct: -100,
    });
    expect(typeof out.rule).toBe("string");
    expect(out.rule).toContain("20 percent");
    expect(keysDeep(out)).not.toContain("verdict");
    expect(JSON.stringify(out)).not.toMatch(/"(worked|revise|revert)"/);
  });

  it("get_counts lists the caveats the code computed, so the model can list exactly them", () => {
    const a = setup().call("get_counts") as { caveats: string[] };
    expect(a.caveats).toEqual(["short_window", "category_count_not_problem_count"]);
    const b = setup({ overlapping: true, after: { days: 1, count: 0 } }).call("get_counts") as { caveats: string[] };
    expect(b.caveats).toEqual(["short_window", "category_count_not_problem_count", "overlapping_change", "not_enough_days"]);
  });

  it("get_counts states every condition under which the rule gives no suggestion (both windows >= 2 days, before count > 0)", () => {
    const rule = (setup().call("get_counts") as { rule: string }).rule;
    expect(rule).toMatch(/at least 2 captured days in both windows/i);
    expect(rule).toMatch(/before .*count is 0.*no suggestion/i);
    expect(rule).toContain("20 percent");
  });

  it("get_counts gives null per_day / change_pct when the rule gave none", () => {
    const { call } = setup({ before: { days: 3, count: 0 }, after: { days: 0, count: 0 } });
    const out = call("get_counts") as { after: { per_day: number | null }; change_pct: number | null };
    expect(out.after.per_day).toBeNull();
    expect(out.change_pct).toBeNull();
  });

  it("get_evidence_sample returns scrubbed items for one window and the window total", () => {
    const { call } = setup({ beforeSummaries: ["A customer asked about baking time."] });
    const out = call("get_evidence_sample", { window: "before" }) as { window: string; items: unknown[]; total_in_window: number };
    expect(out.window).toBe("before");
    expect(out.items).toEqual([{ date: "2026-10-10", time: "08:15", category: "CUSTOMER_SERVICE", summary: "A customer asked about baking time." }]);
    expect(out.total_in_window).toBe(2);
  });

  it("get_evidence_sample rejects a window outside the enum", () => {
    const { by } = setup();
    expect(by("get_evidence_sample").parameters.safeParse({ window: "later" }).success).toBe(false);
    expect(by("get_evidence_sample").parameters.safeParse({}).success).toBe(false);
  });

  it("no tool result carries an id, an answer or a verdict key", () => {
    const { call } = setup();
    const results = [
      call("get_change"),
      call("get_counts"),
      call("get_evidence_sample", { window: "before" }),
      call("get_evidence_sample", { window: "after" }),
    ];
    for (const r of results) for (const k of keysDeep(r)) expect(FORBIDDEN_KEYS).not.toContain(k);
    expect(JSON.stringify(results)).not.toContain("Sari");
  });

  describe("check_review", () => {
    const readAll = (call: (n: string, a?: unknown) => unknown) => {
      call("get_change");
      call("get_counts");
      call("get_evidence_sample", { window: "before" });
      call("get_evidence_sample", { window: "after" });
    };

    it("accepts a correct draft after the reads and stores the trimmed draft as the outcome", () => {
      const { call, session } = setup();
      readAll(call);
      const out = call("check_review", { ...goodDraft(), narrative_en: `  ${goodDraft().narrative_en}  ` });
      expect(out).toEqual({ accepted: true });
      expect(session.checkRounds).toBe(1);
      expect(session.outcome).toMatchObject({ kind: "accepted", draft: { narrative_en: goodDraft().narrative_en } });
    });

    it("answers with reasons and rounds left on a first failure, without deciding", () => {
      const { call, session } = setup();
      const out = call("check_review", goodDraft()) as Record<string, unknown>;
      expect(out).toMatchObject({ accepted: false, final: false, round: 1, rounds_left: 1 });
      expect(out.reasons).toEqual(["change_not_inspected", "counts_not_inspected", "sample_not_inspected"]);
      expect(session.outcome).toBeNull();
    });

    it("the second failed round decides: outcome rejected with the reasons", () => {
      const { call, session } = setup();
      call("check_review", goodDraft());
      const out = call("check_review", goodDraft()) as Record<string, unknown>;
      expect(out).toMatchObject({ accepted: false, final: true, round: 2, rounds_left: 0 });
      expect(session.outcome).toEqual({ kind: "rejected", reasons: ["change_not_inspected", "counts_not_inspected", "sample_not_inspected"] });
    });

    it("a revise round can still pass", () => {
      const { call, session } = setup();
      call("check_review", goodDraft());
      readAll(call);
      expect(call("check_review", goodDraft())).toEqual({ accepted: true });
      expect(session.checkRounds).toBe(2);
      expect(session.outcome?.kind).toBe("accepted");
    });

    it("quoted_numbers_mismatch also returns the numbers found in the narrative so the model can fix its list", () => {
      const { call } = setup();
      readAll(call);
      const out = call("check_review", { ...goodDraft(), quoted_numbers: [2, 3, 0, 2, 100, 7] }) as { reasons: string[]; numbers_in_narrative?: number[] };
      expect(out.reasons).toEqual(["quoted_numbers_mismatch"]);
      expect(out.numbers_in_narrative).toEqual([0, 2, 3, 100]);
    });

    it("other failures carry no numbers_in_narrative", () => {
      const { call } = setup();
      const out = call("check_review", goodDraft()) as { numbers_in_narrative?: number[] };
      expect(out).not.toHaveProperty("numbers_in_narrative");
    });

    it("a zod-invalid draft names the path and does not count as a round", () => {
      const { call, session, by } = setup();
      // The runner's own parse would reject this earlier; the tool is defence in depth, so bypass `parameters.parse`.
      const out = by("check_review").execute({ ...goodDraft(), suggested_verdict: "maybe" } as never) as { reasons: string[]; final: boolean };
      expect(out.reasons).toEqual(["schema_invalid:suggested_verdict"]);
      expect(out.final).toBe(false);
      expect(session.checkRounds).toBe(0);
      expect(session.outcome).toBeNull();
      void call;
    });

    it("a call after the outcome returns the fixed error and changes nothing", () => {
      const { call, session } = setup();
      readAll(call);
      call("check_review", goodDraft());
      const before = structuredClone({ rounds: session.checkRounds, outcome: session.outcome });
      expect(call("check_review", goodDraft())).toEqual({ error: "run already decided" });
      expect(call("decline", { reason: "cannot_explain" })).toEqual({ error: "run already decided" });
      expect({ rounds: session.checkRounds, outcome: session.outcome }).toEqual(before);
      expect(session.toolCalls.at(-1)).toEqual({ name: "decline", ok: false });
    });

    it("a too-short narrative reaches the checker and is named too_short", () => {
      const { call } = setup();
      readAll(call);
      const out = call("check_review", { ...goodDraft(), narrative_en: "Fewer.", quoted_numbers: [] }) as { reasons: string[] };
      expect(out.reasons).toContain("too_short");
    });
  });

  describe("decline", () => {
    it("sets a declined outcome", () => {
      const { call, session } = setup();
      expect(call("decline", { reason: "insufficient_evidence" })).toEqual({ accepted: true });
      expect(session.outcome).toEqual({ kind: "declined", reason: "insufficient_evidence" });
    });
    it("only accepts the two reasons", () => {
      const { by } = setup();
      expect(by("decline").parameters.safeParse({ reason: "because" }).success).toBe(false);
    });
  });

  it("session type is the same object the tools mutate", () => {
    const s: ReviewAgentSession = newReviewAgentSession();
    buildReviewTools(makeInputs(), s);
    expect(s.toolCalls).toEqual([]);
  });
});
