import { describe, expect, it } from "vitest";
import type { LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { SCENARIO_V2, VARIANT_IDS, type ScenarioCard } from "@/scripts/eval-fixtures/scenario-v2";
import {
  buildUnits,
  classifyRun,
  formatReport,
  judgeCell,
  parseArgs,
  runScenario,
  summarizeRuns,
  type CellSummary,
  type LabelCall,
  type RunOutcome,
} from "@/scripts/eval-scenario";

const day = (n: 1 | 2 | 3) => SCENARIO_V2.find((d) => d.day === n)!;

/** Wire output for one planned unit: one thread per card, category chosen by `categoryOf(card)`. */
function wireFor(
  plan: ReturnType<typeof buildUnits>[number],
  cardsById: Map<string, ScenarioCard>,
  categoryOf: (card: ScenarioCard) => LabelWireOutput["threads"][number]["category"],
  confidence = 0.95,
): LabelWireOutput {
  const cardIds = [...new Set(plan.unit.lines.map((l) => plan.cardOfLine.get(l.line_id)!))];
  const alias = new Map(cardIds.map((id, k) => [id, `T${k + 1}`]));
  return {
    lines: plan.unit.lines.map((l, i) => ({
      i,
      reply_to: null,
      thread: alias.get(plan.cardOfLine.get(l.line_id)!)!,
    })),
    threads: cardIds.map((id) => ({
      id: alias.get(id)!,
      category: categoryOf(cardsById.get(id)!),
      confidence,
      evidence: plan.unit.lines.flatMap((l, i) => (plan.cardOfLine.get(l.line_id) === id ? [i] : [])),
      summary: "fixture summary",
    })),
    non_work_lines: [],
  };
}

const perfect = (card: ScenarioCard) =>
  card.kind === "problem_a" ? "CUSTOMER_SERVICE" : card.kind === "problem_b" ? "PHONE_CALL" : "ROUTINE_OPS";

describe("scenario fixture", () => {
  it("has 3 days x 5 variants, 5 cards each, and the expected problem cards", () => {
    expect(SCENARIO_V2.map((d) => d.day)).toEqual([1, 2, 3]);
    for (const d of SCENARIO_V2) {
      for (const v of VARIANT_IDS) {
        expect(d.variants[v]).toHaveLength(5);
        // every variant keeps the same cards (reordered or reworded), never adds or drops one
        expect([...d.variants[v].map((c) => c.id)].sort()).toEqual([...d.variants.exact.map((c) => c.id)].sort());
      }
    }
    const kinds = (n: 1 | 2 | 3) => day(n).variants.exact.filter((c) => c.kind !== "routine").map((c) => c.kind);
    expect(kinds(1)).toEqual(["problem_a"]);
    expect(kinds(2)).toEqual(["problem_a", "problem_b"]);
    expect(kinds(3)).toEqual(["problem_b"]);
  });

  it("the exact variant carries the script's problem lines verbatim", () => {
    expect(day(1).variants.exact.find((c) => c.kind === "problem_a")!.lines[0]).toBe(
      "Excuse me, are these egg tarts fresh today? When were they baked?",
    );
    expect(day(2).variants.exact.find((c) => c.kind === "problem_b")!.lines[0]).toBe("Hello, Demo Bakery, good afternoon.");
  });

  it("v3 is a real reorder and v4 adds exactly one line to each problem card", () => {
    for (const d of SCENARIO_V2) {
      expect(d.variants.v3.map((c) => c.id)).not.toEqual(d.variants.exact.map((c) => c.id));
      for (const exactCard of d.variants.exact) {
        const v4Card = d.variants.v4.find((c) => c.id === exactCard.id)!;
        expect(v4Card.lines.length).toBe(exactCard.lines.length + (exactCard.kind === "routine" ? 0 : 1));
      }
    }
  });

  it("is fictional: no digit runs (phone numbers) and no currency", () => {
    for (const d of SCENARIO_V2)
      for (const v of VARIANT_IDS)
        for (const c of d.variants[v])
          for (const line of c.lines) {
            expect(line).not.toMatch(/\d/);
            expect(line).not.toMatch(/rp\b|idr|\$/i);
          }
  });
});

describe("buildUnits", () => {
  const cards = day(2).variants.exact;
  it("U1 is one unit holding every line in order; U2 is one unit per card", () => {
    const total = cards.reduce((n, c) => n + c.lines.length, 0);
    const u1 = buildUnits(cards, "U1", "t");
    expect(u1).toHaveLength(1);
    expect(u1[0]!.unit.lines).toHaveLength(total);
    const u2 = buildUnits(cards, "U2", "t");
    expect(u2).toHaveLength(cards.length);
    expect(u2.map((p) => p.unit.lines.length)).toEqual(cards.map((c) => c.lines.length));
  });

  it("maps every line id to its card id, and line ids are unique", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const ids = plan!.unit.lines.map((l) => l.line_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan!.cardOfLine.get(ids[0]!)).toBe(cards[0]!.id);
    expect(plan!.cardOfLine.get(ids.at(-1)!)).toBe(cards.at(-1)!.id);
  });
});

describe("classifyRun", () => {
  const cards = day(2).variants.exact;
  const byId = new Map(cards.map((c) => [c.id, c]));

  it("a perfect label: A is a fact (0.95), B is a question, nothing contaminated", () => {
    for (const uniting of ["U1", "U2"] as const) {
      const plans = buildUnits(cards, uniting, "t");
      const out = classifyRun(
        cards,
        plans.map((plan) => ({ plan, wire: wireFor(plan, byId, perfect) })),
      );
      expect(out.a).toEqual({ correct: true, as_fact: true, category: "CUSTOMER_SERVICE" });
      expect(out.b).toEqual({ correct: true, as_fact: false, category: "PHONE_CALL" });
      expect(out.contaminated).toBe(false);
      expect(out.failed_calls).toBe(0);
      // B (always a question) + the 3 routine threads, which also pass the gate as facts => 1 question
      expect(out.questions).toBe(1);
    }
  });

  it("A below the 0.9 threshold is still correct but a question, not a fact", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const out = classifyRun(cards, [{ plan: plan!, wire: wireFor(plan!, byId, perfect, 0.6) }]);
    expect(out.a).toEqual({ correct: true, as_fact: false, category: "CUSTOMER_SERVICE" });
    expect(out.questions).toBe(5); // every thread is below the threshold => one question each
  });

  it("A labelled STAFF_CONSULT is incorrect", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const out = classifyRun(cards, [
      { plan: plan!, wire: wireFor(plan!, byId, (c) => (c.kind === "problem_a" ? "STAFF_CONSULT" : perfect(c))) },
    ]);
    expect(out.a).toMatchObject({ correct: false, category: "STAFF_CONSULT" });
    expect(out.b!.correct).toBe(true);
  });

  it("a routine card labelled CUSTOMER_SERVICE or PHONE_CALL is contamination", () => {
    for (const bad of ["CUSTOMER_SERVICE", "PHONE_CALL"] as const) {
      const [plan] = buildUnits(cards, "U1", "t");
      const out = classifyRun(cards, [
        { plan: plan!, wire: wireFor(plan!, byId, (c) => (c.id === "d2-c4" ? bad : perfect(c))) },
      ]);
      expect(out.contaminated).toBe(true);
    }
  });

  it("a routine card merged into the A thread is contamination too", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const wire = wireFor(plan!, byId, perfect);
    // move the routine card d2-c4's line into the A thread
    const aThread = wire.lines.find((_, i) => plan!.cardOfLine.get(plan!.unit.lines[i]!.line_id) === "d2-c2")!.thread;
    wire.lines.forEach((l, i) => {
      if (plan!.cardOfLine.get(plan!.unit.lines[i]!.line_id) === "d2-c4") l.thread = aThread;
    });
    expect(classifyRun(cards, [{ plan: plan!, wire }]).contaminated).toBe(true);
  });

  it("a failed label call leaves its cards unclassified and counts as one question", () => {
    const plans = buildUnits(cards, "U2", "t");
    const out = classifyRun(
      cards,
      plans.map((plan) => ({ plan, wire: plan.unit.lines[0]!.line_id.includes("c2") ? null : wireFor(plan, byId, perfect) })),
    );
    expect(out.failed_calls).toBe(1);
    expect(out.a).toEqual({ correct: false, as_fact: false, category: null });
    expect(out.b!.correct).toBe(true);
  });

  it("NON_WORK lines are dropped: a card whose lines are all NON_WORK has no category", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const wire = wireFor(plan!, byId, (c) => (c.kind === "problem_a" ? "NON_WORK" : perfect(c)));
    const out = classifyRun(cards, [{ plan: plan!, wire }]);
    expect(out.a).toEqual({ correct: false, as_fact: false, category: null });
  });

  it("reports null for a problem card the day does not have", () => {
    const d1 = day(1).variants.exact;
    const [plan] = buildUnits(d1, "U1", "t");
    const out = classifyRun(d1, [{ plan: plan!, wire: wireFor(plan!, new Map(d1.map((c) => [c.id, c])), perfect) }]);
    expect(out.b).toBeNull();
    expect(out.a!.correct).toBe(true);
  });
});

describe("summarizeRuns and judgeCell", () => {
  const ok = (over: Partial<RunOutcome> = {}): RunOutcome => ({
    a: { correct: true, as_fact: true, category: "CUSTOMER_SERVICE" },
    b: { correct: true, as_fact: false, category: "PHONE_CALL" },
    contaminated: false,
    questions: 2,
    failed_calls: 0,
    ...over,
  });
  const five = (...o: RunOutcome[]) => [...o, ...Array.from({ length: 5 - o.length }, () => ok())];

  it("counts correct, fact, contamination, question-cap hits and A category distribution", () => {
    const s = summarizeRuns(
      five(
        ok({ a: { correct: false, as_fact: false, category: "STAFF_CONSULT" } }),
        ok({ contaminated: true }),
        ok({ questions: 6 }),
        ok({ failed_calls: 1 }),
      ),
    );
    expect(s).toMatchObject({
      runs: 5,
      a_correct: 4,
      a_fact: 4,
      b_correct: 5,
      contamination: 1,
      questions_ok: 4,
      max_questions: 6,
      failed_calls: 1,
      a_categories: { STAFF_CONSULT: 1, CUSTOMER_SERVICE: 4 },
    });
  });

  it("a null a/b (card not in the day) is not counted and judged as not applicable", () => {
    const s = summarizeRuns(five(...Array.from({ length: 5 }, () => ok({ b: null }))));
    expect(s.b_applicable).toBe(false);
    expect(judgeCell({ variant: "exact", day: 1, summary: s }).pass).toBe(true);
  });

  const judge = (variant: "exact" | "v1", day_: 1 | 2 | 3, s: CellSummary) => judgeCell({ variant, day: day_, summary: s });

  it("exact: needs A and B 5/5, contamination 0, questions<=5 in 5/5", () => {
    expect(judge("exact", 2, summarizeRuns(five())).pass).toBe(true);
    const aMiss = summarizeRuns(five(ok({ a: { correct: false, as_fact: false, category: "COMPLAINT" } })));
    expect(judge("exact", 2, aMiss)).toMatchObject({ pass: false, failures: [expect.stringContaining("A correct 4/5")] });
    const contam = summarizeRuns(five(ok({ contaminated: true })));
    expect(judge("exact", 2, contam).pass).toBe(false);
    const manyQ = summarizeRuns(five(ok({ questions: 6 })));
    expect(judge("exact", 2, manyQ).pass).toBe(false);
  });

  it("exact: A as a fact must reach 3/5 on days 1 and 2 only", () => {
    const notFact = ok({ a: { correct: true, as_fact: false, category: "CUSTOMER_SERVICE" } });
    const twoFacts = summarizeRuns([notFact, notFact, notFact, ok(), ok()]);
    expect(twoFacts.a_fact).toBe(2);
    expect(judge("exact", 1, twoFacts).pass).toBe(false);
    expect(judge("exact", 2, twoFacts).pass).toBe(false);
    const threeFacts = summarizeRuns([notFact, notFact, ok(), ok(), ok()]);
    expect(judge("exact", 1, threeFacts).pass).toBe(true);
  });

  it("variants: A and B >= 4/5, contamination <= 1/5, no question cap, no fact requirement", () => {
    const s = summarizeRuns(
      five(
        ok({ a: { correct: false, as_fact: false, category: "STAFF_CONSULT" }, contaminated: true, questions: 9 }),
      ),
    );
    expect(judge("v1", 2, s).pass).toBe(true);
    const two = summarizeRuns(
      five(
        ok({ a: { correct: false, as_fact: false, category: "STAFF_CONSULT" } }),
        ok({ b: { correct: false, as_fact: false, category: "ROUTINE_OPS" } }),
        ok({ contaminated: true }),
        ok({ contaminated: true }),
      ),
    );
    const j = judge("v1", 2, two);
    expect(j.pass).toBe(false);
    expect(j.failures.some((f) => f.includes("contamination"))).toBe(true);
  });

  it("scales the thresholds with the run count (--runs 3: exact still needs all, variant needs ceil(0.8*3)=3)", () => {
    const three = (b: RunOutcome) => summarizeRuns([ok(), ok(), b]);
    expect(judge("exact", 2, three(ok())).pass).toBe(true);
    expect(judge("v1", 2, three(ok({ a: { correct: false, as_fact: false, category: null } }))).pass).toBe(false);
  });
});

describe("runScenario (fake label model)", () => {
  const config = loadCategoriesConfig();
  const lineKind = new Map<string, ScenarioCard["kind"]>();
  for (const d of SCENARIO_V2) for (const v of VARIANT_IDS) for (const c of d.variants[v]) for (const l of c.lines) lineKind.set(l, c.kind);

  /** A model that always gets it right, keyed on the fixture's own line text. */
  const perfectModel: LabelCall = async ({ unit }) => {
    const kinds = unit.lines.map((l) => lineKind.get(l.text)!);
    const cat = (k: ScenarioCard["kind"]) => (k === "problem_a" ? "CUSTOMER_SERVICE" : k === "problem_b" ? "PHONE_CALL" : "ROUTINE_OPS");
    // one thread per contiguous run of the same kind
    const wire: LabelWireOutput = { lines: [], threads: [], non_work_lines: [] };
    let current = "";
    let n = 0;
    kinds.forEach((k, i) => {
      const key = k === "routine" || kinds[i - 1] !== k ? `T${++n}` : current;
      if (key !== current) {
        current = key;
        wire.threads.push({ id: key, category: cat(k), confidence: 0.95, evidence: [], summary: "s" });
      }
      wire.threads.at(-1)!.evidence.push(i);
      wire.lines.push({ i, reply_to: null, thread: key });
    });
    return { kind: "ok", wire };
  };

  it("passes with a perfect model and prints a table of counts only", async () => {
    const report = await runScenario({ runs: 2, config, concurrency: 4 }, { label: perfectModel, sleep: async () => {} });
    expect(report.pass).toBe(true);
    // 3 days x 5 variants x 2 unitings
    expect(report.cells).toHaveLength(30);
    const text = formatReport(report);
    expect(text).toContain("PASS");
    expect(text).not.toMatch(/egg tart|croissant|Bakery/i);
  });

  it("fails (and says which cell) when the model calls the egg-tart moment STAFF_CONSULT", async () => {
    const drifting: LabelCall = async (input) => {
      const res = await perfectModel(input);
      if (res.kind !== "ok") return res;
      for (const t of res.wire.threads) if (t.category === "CUSTOMER_SERVICE") t.category = "STAFF_CONSULT";
      return res;
    };
    const report = await runScenario({ runs: 2, config, concurrency: 4, variants: ["exact"] }, { label: drifting });
    expect(report.pass).toBe(false);
    const text = formatReport(report);
    expect(text).toContain("FAIL");
    expect(text).toContain("STAFF_CONSULT");
  });

  it("retries with backoff, then counts a unit that keeps failing and names the error class", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    const one = { runs: 1, config, concurrency: 1, days: [1] as const, variants: ["exact"] as const, unitings: ["U1"] as const };
    let calls = 0;
    const flaky: LabelCall = async (input) => {
      calls += 1;
      if (calls <= 3) return { kind: "retryable_error", error: { class: "http_429" } };
      return perfectModel(input);
    };
    const recovered = await runScenario(one, { label: flaky, sleep });
    expect(recovered.cells[0]!.summary.failed_calls).toBe(0);
    expect(recovered.call_errors).toEqual({});
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);

    const dead: LabelCall = async () => ({ kind: "retryable_error", error: { class: "http_429" } });
    const bad = await runScenario(one, { label: dead, sleep });
    expect(bad.cells[0]!.summary.failed_calls).toBe(1);
    expect(bad.pass).toBe(false);
    expect(bad.call_errors).toEqual({ http_429: 1 });
    expect(formatReport(bad)).toMatch(/INCONCLUSIVE/);
  });
});

describe("parseArgs", () => {
  it("defaults to the full matrix with 5 runs", () => {
    expect(parseArgs([])).toMatchObject({ runs: 5, days: [1, 2, 3], variants: [...VARIANT_IDS], unitings: ["U1", "U2"] });
  });
  it("parses filters", () => {
    expect(parseArgs(["--runs", "3", "--days", "2,3", "--variants", "exact,v3", "--uniting", "U2", "--concurrency", "2"])).toMatchObject({
      runs: 3,
      days: [2, 3],
      variants: ["exact", "v3"],
      unitings: ["U2"],
      concurrency: 2,
    });
  });
  it("rejects unknown values", () => {
    expect(() => parseArgs(["--days", "4"])).toThrow();
    expect(() => parseArgs(["--variants", "v9"])).toThrow();
    expect(() => parseArgs(["--runs", "0"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});
