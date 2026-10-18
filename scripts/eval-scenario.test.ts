import { describe, expect, it } from "vitest";
import type { LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { SCENARIO_V2, VARIANT_IDS, type ScenarioCard } from "@/scripts/eval-fixtures/scenario-v2";
import {
  buildUnits,
  classifyRun,
  exitCodeFor,
  formatReport,
  judgeCell,
  parseArgs,
  runScenario,
  summarizeRuns,
  type CellSummary,
  type LabelCall,
  type RunOutcome,
} from "@/scripts/eval-scenario";

const day = (n: 1 | 2 | 3 | 4 | 5) => SCENARIO_V2.find((d) => d.day === n)!;

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
  card.kind === "problem_a" ? "CUSTOMER_SERVICE" : card.kind === "problem_b" || card.kind === "after_b" ? "PHONE_CALL" : "ROUTINE_OPS";

describe("scenario fixture", () => {
  it("has 5 days x 5 variants, 5 cards each, and the expected problem cards", () => {
    expect(SCENARIO_V2.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
    for (const d of SCENARIO_V2) {
      for (const v of VARIANT_IDS) {
        expect(d.variants[v]).toHaveLength(5);
        // every variant keeps the same cards (reordered or reworded), never adds or drops one
        expect([...d.variants[v].map((c) => c.id)].sort()).toEqual([...d.variants.exact.map((c) => c.id)].sort());
      }
    }
    const kinds = (n: 1 | 2 | 3 | 4 | 5) => day(n).variants.exact.filter((c) => c.kind !== "routine").map((c) => c.kind);
    expect(kinds(1)).toEqual(["problem_a"]);
    expect(kinds(2)).toEqual(["problem_a", "problem_b"]);
    expect(kinds(3)).toEqual(["problem_b"]);
    // the after days (review-agent plan 3.4): A_after cards, ONE read-back phone order on day 4, none on day 5
    expect(kinds(4)).toEqual(["after_a", "after_b", "after_a"]);
    expect(kinds(5)).toEqual(["after_a", "after_a"]);
  });

  it("the day-4 read-back card is two staff lines in every variant but v4 (three), and no day-5 line mentions a phone", () => {
    const lines = (v: (typeof VARIANT_IDS)[number]) => day(4).variants[v].find((c) => c.kind === "after_b")!.lines;
    for (const v of ["exact", "v1", "v2"] as const) expect(lines(v), v).toHaveLength(2);
    expect(lines("v4")).toHaveLength(3);
    expect(lines("exact")[1]).toContain("read the whole order back");
    for (const v of VARIANT_IDS)
      expect(day(5).variants[v].flatMap((c) => c.lines).join(" ").toLowerCase(), v).not.toMatch(/phone|call|caller|order/);
  });

  it("the exact variant carries the script's problem lines verbatim", () => {
    expect(day(1).variants.exact.find((c) => c.kind === "problem_a")!.lines[0]).toBe(
      "Excuse me, I have a question about the egg tarts on the display. Are they fresh today, and do you know what time they were baked?",
    );
    expect(day(2).variants.exact.find((c) => c.kind === "problem_b")!.lines[0]).toBe("Hello, Demo Bakery, thanks for calling. Yes, we can do fifty egg tarts for tomorrow morning, pickup at ten o'clock. Okay, got it. Thank you, bye.");
  });

  it("the rewritten phone-order cards (round 2) carry the agreed wording in exact, v1, v2 and v4", () => {
    const b = (n: 2 | 3, v: (typeof VARIANT_IDS)[number]) => day(n).variants[v].find((c) => c.kind === "problem_b")!.lines;
    expect(b(2, "exact")).toEqual([
      "Hello, Demo Bakery, thanks for calling. Yes, we can do fifty egg tarts for tomorrow morning, pickup at ten o'clock. Okay, got it. Thank you, bye.",
      "That was a phone order for tomorrow. I did not read the order back to the caller before hanging up, so I am not sure the quantity and the pickup time are right.",
    ]);
    expect(b(3, "exact")).toEqual([
      "Hello, Demo Bakery, thanks for calling. A birthday cake and twenty croissants for Saturday. Pickup at three or four? Sorry, the line is bad. Okay, four o'clock. Bye.",
      "That was another phone order. I hung up without reading the order back to the caller, so I hope I got the pickup time right.",
    ]);
    expect(b(2, "v1")).toEqual([
      "Hello, Demo Bakery, thanks for calling. Yes, fifty egg tarts for tomorrow morning, to be picked up at ten o'clock. Alright, got it. Thanks, goodbye.",
      "I did not read that phone order back to the caller before hanging up, so I am not sure if the quantity and the pickup time are right.",
    ]);
    expect(b(3, "v1")).toEqual([
      "Hello, Demo Bakery, how can I help? So a birthday cake and twenty croissants for Saturday. Is pickup at three or at four? Sorry, the phone is breaking up. Okay, four o'clock. Goodbye.",
      "That was another phone order. I hung up without reading the order back to the caller, so I hope I heard the pickup time right.",
    ]);
    // v4 = the exact lines plus one neutral extra line
    expect(b(2, "v4")).toEqual([...b(2, "exact"), "It was a big order for a weekday."]);
    expect(b(3, "v4")).toEqual([...b(3, "exact"), "That took a while."]);
    // v2: the exact sentences with fillers added, two lines each
    for (const n of [2, 3] as const) {
      expect(b(n, "v2")).toHaveLength(2);
      expect(b(n, "v2").join(" ")).toMatch(/\bum\b/i);
    }
    expect(b(2, "v2").join(" ")).toMatch(/read the order back to the caller/);
    expect(b(3, "v2").join(" ")).toMatch(/reading the order back to the caller/);
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
      expect(out.a).toEqual({ correct: true, as_fact: true, category: "CUSTOMER_SERVICE", one_thread: true });
      expect(out.b).toEqual({ correct: true, as_fact: false, category: "PHONE_CALL", one_thread: true });
      expect(out.contaminated).toBe(false);
      expect(out.failed_calls).toBe(0);
      // B (always a question) + the 3 routine threads, which also pass the gate as facts => 1 question
      expect(out.questions).toBe(1);
    }
  });

  it("A below the 0.9 threshold is still correct but a question, not a fact", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const out = classifyRun(cards, [{ plan: plan!, wire: wireFor(plan!, byId, perfect, 0.6) }]);
    expect(out.a).toEqual({ correct: true, as_fact: false, category: "CUSTOMER_SERVICE", one_thread: true });
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
    expect(out.a).toEqual({ correct: false, as_fact: false, category: null, one_thread: false });
    expect(out.b!.correct).toBe(true);
  });

  it("tells a retryable failure (inconclusive) from a parse failure (genuine)", () => {
    const plans = buildUnits(cards, "U2", "t");
    const out = classifyRun(
      cards,
      plans.map((plan, i) => ({
        plan,
        wire: i < 2 ? null : wireFor(plan, byId, perfect),
        failure: i === 0 ? ("retryable_error" as const) : i === 1 ? ("parse_error" as const) : undefined,
      })),
    );
    expect(out.failed_calls).toBe(2);
    expect(out.retryable_failures).toBe(1);
  });

  it("NON_WORK lines are dropped: a card whose lines are all NON_WORK has no category", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const wire = wireFor(plan!, byId, (c) => (c.kind === "problem_a" ? "NON_WORK" : perfect(c)));
    const out = classifyRun(cards, [{ plan: plan!, wire }]);
    expect(out.a).toEqual({ correct: false, as_fact: false, category: null, one_thread: false });
  });

  it("one_thread: a card whose lines share one thread is true; a card split across two threads is false", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const bCard = cards.find((c) => c.kind === "problem_b")!;
    expect(bCard.lines).toHaveLength(2);
    // the model's real failure (round 2, F-1): the second phone line opens its own CORRECTION thread
    const wire = wireFor(plan!, byId, perfect);
    const bLines = plan!.unit.lines.flatMap((l, i) => (plan!.cardOfLine.get(l.line_id) === bCard.id ? [i] : []));
    const bThread = wire.threads.find((t) => t.id === wire.lines[bLines[0]!]!.thread)!;
    bThread.evidence = [bLines[0]!];
    wire.lines[bLines[1]!]!.thread = "T9";
    wire.threads.push({ id: "T9", category: "CORRECTION", confidence: 1, evidence: [bLines[1]!], summary: "fixture summary" });
    const split = classifyRun(cards, [{ plan: plan!, wire }]);
    expect(split.b).toMatchObject({ correct: true, one_thread: false });
    expect(split.a!.one_thread).toBe(true);
    // the clean run keeps the two lines together
    const joined = classifyRun(cards, [{ plan: plan!, wire: wireFor(plan!, byId, perfect) }]);
    expect(joined.b!.one_thread).toBe(true);
  });

  it("one_thread is false for a card none of whose lines reached a thread", () => {
    const [plan] = buildUnits(cards, "U1", "t");
    const wire = wireFor(plan!, byId, (c) => (c.kind === "problem_b" ? "NON_WORK" : perfect(c)));
    expect(classifyRun(cards, [{ plan: plan!, wire }]).b).toMatchObject({ category: null, one_thread: false });
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
    a: { correct: true, as_fact: true, category: "CUSTOMER_SERVICE", one_thread: true },
    b: { correct: true, as_fact: false, category: "PHONE_CALL", one_thread: true },
    after_b: null,
    cs_facts: 0,
    phone_threads: 0,
    after_a_landed: {},
    contaminated: false,
    questions: 2,
    failed_calls: 0,
    retryable_failures: 0,
    ...over,
  });
  const five = (...o: RunOutcome[]) => [...o, ...Array.from({ length: 5 - o.length }, () => ok())];

  it("counts correct, fact, contamination, question-cap hits and A category distribution", () => {
    const s = summarizeRuns(
      five(
        ok({ a: { correct: false, as_fact: false, category: "STAFF_CONSULT", one_thread: true } }),
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
      retryable_failures: 0,
      a_categories: { STAFF_CONSULT: 1, CUSTOMER_SERVICE: 4 },
    });
  });

  it("a null a/b (card not in the day) is not counted and judged as not applicable", () => {
    const s = summarizeRuns(five(...Array.from({ length: 5 }, () => ok({ b: null }))));
    expect(s.b_applicable).toBe(false);
    expect(judgeCell({ variant: "exact", day: 1, summary: s }).pass).toBe(true);
  });

  const judge = (variant: "exact" | "v1", day_: 1 | 2 | 3 | 4 | 5, s: CellSummary) => judgeCell({ variant, day: day_, summary: s });

  it("exact: needs A and B 5/5, contamination 0, questions<=5 in 5/5", () => {
    expect(judge("exact", 2, summarizeRuns(five())).pass).toBe(true);
    const aMiss = summarizeRuns(five(ok({ a: { correct: false, as_fact: false, category: "COMPLAINT", one_thread: true } })));
    expect(judge("exact", 2, aMiss)).toMatchObject({ pass: false, failures: [expect.stringContaining("A correct 4/5")] });
    const contam = summarizeRuns(five(ok({ contaminated: true })));
    expect(judge("exact", 2, contam).pass).toBe(false);
    const manyQ = summarizeRuns(five(ok({ questions: 6 })));
    expect(judge("exact", 2, manyQ).pass).toBe(false);
  });

  it("exact: A as a fact must reach 3/5 on days 1 and 2 only", () => {
    const notFact = ok({ a: { correct: true, as_fact: false, category: "CUSTOMER_SERVICE", one_thread: true } });
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
        ok({ a: { correct: false, as_fact: false, category: "STAFF_CONSULT", one_thread: true }, contaminated: true, questions: 9 }),
      ),
    );
    expect(judge("v1", 2, s).pass).toBe(true);
    const two = summarizeRuns(
      five(
        ok({ a: { correct: false, as_fact: false, category: "STAFF_CONSULT", one_thread: true } }),
        ok({ b: { correct: false, as_fact: false, category: "ROUTINE_OPS", one_thread: true } }),
        ok({ contaminated: true }),
        ok({ contaminated: true }),
      ),
    );
    const j = judge("v1", 2, two);
    expect(j.pass).toBe(false);
    expect(j.failures.some((f) => f.includes("contamination"))).toBe(true);
  });

  it("counts one-thread runs per card", () => {
    const split = { correct: true, as_fact: false, category: "PHONE_CALL", one_thread: false };
    const s = summarizeRuns(five(ok({ b: split }), ok({ b: split })));
    expect(s).toMatchObject({ a_one_thread: 5, b_one_thread: 3 });
  });

  it("exact: B one thread needs ceil(0.8 N) runs; a 1/1 split in 2 of 5 runs fails with the exact message", () => {
    const split = { correct: true, as_fact: false, category: "PHONE_CALL", one_thread: false };
    const oneSplit = summarizeRuns(five(ok({ b: split })));
    expect(judge("exact", 2, oneSplit).pass).toBe(true); // 4/5 is enough
    const twoSplit = summarizeRuns(five(ok({ b: split }), ok({ b: split })));
    expect(judge("exact", 2, twoSplit)).toMatchObject({ status: "FAIL", pass: false, failures: ["B one thread 3/5 (need 4)"] });
    expect(judge("exact", 3, twoSplit).failures).toEqual(["B one thread 3/5 (need 4)"]);
  });

  it("exact: A one thread is a regression guard with the same threshold", () => {
    const split = { correct: true, as_fact: true, category: "CUSTOMER_SERVICE", one_thread: false };
    const twoSplit = summarizeRuns(five(ok({ a: split }), ok({ a: split })));
    expect(judge("exact", 1, twoSplit).failures).toEqual(["A one thread 3/5 (need 4)"]);
  });

  it("variants: one thread is reported only, never a failure", () => {
    const split = { correct: true, as_fact: false, category: "PHONE_CALL", one_thread: false };
    const s = summarizeRuns(five(ok({ b: split }), ok({ b: split }), ok({ b: split }), ok({ b: split }), ok({ b: split })));
    expect(s.b_one_thread).toBe(0);
    expect(judge("v1", 2, s).pass).toBe(true);
  });

  it("a cell with a retryable-failed unit is INCONCLUSIVE, never PASS or FAIL; a parse failure stays a genuine FAIL", () => {
    const retry = summarizeRuns(five(ok({ a: { correct: false, as_fact: false, category: null, one_thread: false }, failed_calls: 1, retryable_failures: 1 })));
    expect(judgeCell({ variant: "exact", day: 2, summary: retry }).status).toBe("INCONCLUSIVE");
    // a retryable failure in an otherwise passing variant cell is still not a clean PASS
    const quiet = summarizeRuns(five(ok({ failed_calls: 1, retryable_failures: 1 })));
    expect(judgeCell({ variant: "v1", day: 2, summary: quiet }).status).toBe("INCONCLUSIVE");
    const parse = summarizeRuns(five(ok({ a: { correct: false, as_fact: false, category: null, one_thread: false }, failed_calls: 1 })));
    expect(judgeCell({ variant: "exact", day: 2, summary: parse })).toMatchObject({ status: "FAIL", pass: false });
    expect(judgeCell({ variant: "exact", day: 2, summary: summarizeRuns(five()) }).status).toBe("PASS");
  });

  it("scales the thresholds with the run count (--runs 3: exact still needs all, variant needs ceil(0.8*3)=3)", () => {
    const three = (b: RunOutcome) => summarizeRuns([ok(), ok(), b]);
    expect(judge("exact", 2, three(ok())).pass).toBe(true);
    expect(judge("v1", 2, three(ok({ a: { correct: false, as_fact: false, category: null, one_thread: false } }))).pass).toBe(false);
  });
});

describe("runScenario (fake label model)", () => {
  const config = loadCategoriesConfig();
  const lineKind = new Map<string, ScenarioCard["kind"]>();
  for (const d of SCENARIO_V2) for (const v of VARIANT_IDS) for (const c of d.variants[v]) for (const l of c.lines) lineKind.set(l, c.kind);

  /** A model that always gets it right, keyed on the fixture's own line text. */
  const perfectModel: LabelCall = async ({ unit }) => {
    const kinds = unit.lines.map((l) => lineKind.get(l.text)!);
    const cat = (k: ScenarioCard["kind"]) =>
      k === "problem_a" ? "CUSTOMER_SERVICE" : k === "problem_b" || k === "after_b" ? "PHONE_CALL" : "ROUTINE_OPS";
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
    // 5 days x 5 variants x 2 unitings
    expect(report.cells).toHaveLength(50);
    const text = formatReport(report);
    expect(text).toContain("PASS");
    expect(text).not.toMatch(/egg tart|croissant|Bakery/i);
    // R-21: the one-thread counts are on every row (day 2 has both problem cards, day 1 only A)
    expect(text).toMatch(/day 2 \| exact \| U2 .*A 2\/2.*B 2\/2.*A one thread 2\/2.*B one thread 2\/2/);
    expect(text).toMatch(/day 1 \| exact \| U1 .*A one thread 2\/2.*B one thread -/);
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

  it("retries 429s with 2/4/8 s backoff (plus jitter), then a unit that keeps failing is INCONCLUSIVE and names the error class", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    const one = { runs: 1, config, concurrency: 1, days: [1] as const, variants: ["exact"] as const, unitings: ["U1"] as const };
    let calls = 0;
    const flaky: LabelCall = async (input) => {
      calls += 1;
      if (calls <= 3) return { kind: "retryable_error", error: { class: "http_429" } };
      return perfectModel(input);
    };
    const recovered = await runScenario(one, { label: flaky, sleep, random: () => 0 });
    expect(recovered.cells[0]!.summary.failed_calls).toBe(0);
    expect(recovered.call_errors).toEqual({});
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);

    // jitter is added on top of the base, never below it and at most 25 % above
    sleeps.length = 0;
    calls = 0;
    await runScenario(one, { label: flaky, sleep, random: () => 0.5 });
    expect(sleeps).toEqual([2_000 + 250, 4_000 + 500, 8_000 + 1_000]);

    const dead: LabelCall = async () => ({ kind: "retryable_error", error: { class: "http_429" } });
    const bad = await runScenario(one, { label: dead, sleep, random: () => 0 });
    expect(bad.cells[0]!.summary.failed_calls).toBe(1);
    expect(bad.cells[0]!.summary.retryable_failures).toBe(1);
    expect(bad.cells[0]!.status).toBe("INCONCLUSIVE");
    expect(bad.pass).toBe(false);
    expect(bad.call_errors).toEqual({ http_429: 1 });
    expect(formatReport(bad)).toMatch(/INCONCLUSIVE/);
    expect(exitCodeFor(bad)).toBe(3);
  });

  it("a parse_error twice then ok still ends as a failed unit (production allows 2 attempts), and it is a genuine FAIL", async () => {
    const one = { runs: 1, config, concurrency: 1, days: [1] as const, variants: ["exact"] as const, unitings: ["U1"] as const };
    let calls = 0;
    const parseTwice: LabelCall = async (input) => {
      calls += 1;
      if (calls <= 2) return { kind: "parse_error", issues: [] };
      return perfectModel(input);
    };
    const sleeps: number[] = [];
    const report = await runScenario(one, { label: parseTwice, sleep: async (ms) => void sleeps.push(ms), random: () => 0 });
    expect(calls).toBe(2);
    expect(report.cells[0]!.summary.failed_calls).toBe(1);
    expect(report.cells[0]!.summary.retryable_failures).toBe(0);
    expect(report.cells[0]!.status).toBe("FAIL");
    expect(report.call_errors).toEqual({ parse_error: 1 });
    expect(exitCodeFor(report)).toBe(2);
  });

  it("exit code: 0 all pass, 2 on any genuine FAIL (even with inconclusive cells), 3 inconclusive only", async () => {
    const base = { runs: 1, config, concurrency: 1, days: [1] as const, variants: ["exact"] as const, unitings: ["U1"] as const };
    expect(exitCodeFor(await runScenario(base, { label: perfectModel, sleep: async () => {} }))).toBe(0);
    const statuses = (xs: Array<"PASS" | "FAIL" | "INCONCLUSIVE">) =>
      exitCodeFor({ runs: 1, pass: false, after_b: null, call_errors: {}, cells: xs.map((status) => ({ status }) as never) });
    expect(statuses(["PASS", "INCONCLUSIVE"])).toBe(3);
    expect(statuses(["INCONCLUSIVE", "FAIL"])).toBe(2);
  });

  it("--concurrency limits label calls in flight, not runs", async () => {
    let inFlight = 0;
    let peak = 0;
    const tracked: LabelCall = async (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return perfectModel(input);
    };
    // U2 = 5 units per run: without a call-level limit a single run alone would put 5 calls in flight
    const report = await runScenario({ runs: 3, config, concurrency: 2, days: [2], variants: ["exact"], unitings: ["U2"] }, { label: tracked });
    expect(report.pass).toBe(true);
    expect(peak).toBe(2);
  });
});

describe("parseArgs", () => {
  it("defaults to the full matrix with 5 runs", () => {
    expect(parseArgs([])).toMatchObject({ runs: 5, days: [1, 2, 3, 4, 5], variants: [...VARIANT_IDS], unitings: ["U1", "U2"] });
  });
  it("accepts the after days 4 and 5", () => {
    expect(parseArgs(["--days", "4,5"])).toMatchObject({ days: [4, 5] });
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
    expect(() => parseArgs(["--days", "6"])).toThrow();
    expect(() => parseArgs(["--variants", "v9"])).toThrow();
    expect(() => parseArgs(["--runs", "0"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});

describe("classifyRun on the after days (review-agent plan 3.5)", () => {
  const cards4 = day(4).variants.exact;
  const byId4 = new Map(cards4.map((c) => [c.id, c]));
  const cards5 = day(5).variants.exact;
  const byId5 = new Map(cards5.map((c) => [c.id, c]));

  it("a perfect day 4: the read-back card is one PHONE_CALL thread (a question), the only phone thread, no CUSTOMER_SERVICE fact", () => {
    for (const uniting of ["U1", "U2"] as const) {
      const out = classifyRun(
        cards4,
        buildUnits(cards4, uniting, "t").map((plan) => ({ plan, wire: wireFor(plan, byId4, perfect) })),
      );
      expect(out.after_b).toEqual({ correct: true, as_fact: false, category: "PHONE_CALL", one_thread: true });
      expect(out.phone_threads).toBe(1);
      expect(out.cs_facts).toBe(0);
      expect(out.contaminated).toBe(false);
      expect(out.a).toBeNull();
      expect(out.b).toBeNull();
      // the after-A cards (d4-c2, d4-c4) landed as ROUTINE_OPS facts
      expect(out.after_a_landed).toEqual({ "ROUTINE_OPS/fact": 2 });
      expect(out.questions).toBe(1);
    }
  });

  it("an after-A card labelled CUSTOMER_SERVICE with a fact-level confidence is a CUSTOMER_SERVICE fact; below the gate it is a question and not counted", () => {
    const [plan] = buildUnits(cards4, "U1", "t");
    const csA = (c: ScenarioCard) => (c.kind === "after_a" ? "CUSTOMER_SERVICE" : perfect(c));
    const fact = classifyRun(cards4, [{ plan: plan!, wire: wireFor(plan!, byId4, csA) }]);
    expect(fact.cs_facts).toBe(2);
    expect(fact.after_a_landed).toEqual({ "CUSTOMER_SERVICE/fact": 2 });
    const question = classifyRun(cards4, [{ plan: plan!, wire: wireFor(plan!, byId4, csA, 0.6) }]);
    expect(question.cs_facts).toBe(0);
    expect(question.after_a_landed).toEqual({ "CUSTOMER_SERVICE/question": 2 });
  });

  it("the read-back card split into two PHONE_CALL threads is two phone threads and not one thread (the Revert risk)", () => {
    const [plan] = buildUnits(cards4, "U1", "t");
    const bCard = cards4.find((c) => c.kind === "after_b")!;
    expect(bCard.lines).toHaveLength(2);
    const wire = wireFor(plan!, byId4, perfect);
    const bLines = plan!.unit.lines.flatMap((l, i) => (plan!.cardOfLine.get(l.line_id) === bCard.id ? [i] : []));
    const bThread = wire.threads.find((t) => t.id === wire.lines[bLines[0]!]!.thread)!;
    bThread.evidence = [bLines[0]!];
    wire.lines[bLines[1]!]!.thread = "T9";
    wire.threads.push({ id: "T9", category: "PHONE_CALL", confidence: 0.95, evidence: [bLines[1]!], summary: "fixture summary" });
    const out = classifyRun(cards4, [{ plan: plan!, wire }]);
    expect(out.phone_threads).toBe(2);
    expect(out.after_b).toMatchObject({ correct: true, one_thread: false });
  });

  it("the read-back card labelled CORRECTION is not correct and opens no phone thread", () => {
    const [plan] = buildUnits(cards4, "U1", "t");
    const wire = wireFor(plan!, byId4, (c) => (c.kind === "after_b" ? "CORRECTION" : perfect(c)));
    const out = classifyRun(cards4, [{ plan: plan!, wire }]);
    expect(out.after_b).toMatchObject({ correct: false, category: "CORRECTION" });
    expect(out.phone_threads).toBe(0);
  });

  it("a failed label call leaves the read-back card unclassified", () => {
    const out = classifyRun(
      cards4,
      buildUnits(cards4, "U2", "t").map((plan) => ({ plan, wire: plan.unit.lines[0]!.line_id.includes("c3") ? null : wireFor(plan, byId4, perfect) })),
    );
    expect(out.after_b).toEqual({ correct: false, as_fact: false, category: null, one_thread: false });
    expect(out.phone_threads).toBe(0);
  });

  it("day 5 has no read-back card (after_b null); a phone thread anywhere on day 5 is counted", () => {
    const [plan] = buildUnits(cards5, "U1", "t");
    const clean = classifyRun(cards5, [{ plan: plan!, wire: wireFor(plan!, byId5, perfect) }]);
    expect(clean.after_b).toBeNull();
    expect(clean.phone_threads).toBe(0);
    const drift = classifyRun(cards5, [{ plan: plan!, wire: wireFor(plan!, byId5, (c) => (c.id === "d5-c4" ? "PHONE_CALL" : perfect(c))) }]);
    expect(drift.phone_threads).toBe(1);
    expect(drift.contaminated).toBe(true);
  });

  it("on days 1-3 the new counts still read the threads (the A fact is one CUSTOMER_SERVICE fact) and after_b is null", () => {
    const cards2 = day(2).variants.exact;
    const [plan] = buildUnits(cards2, "U1", "t");
    const out = classifyRun(cards2, [{ plan: plan!, wire: wireFor(plan!, new Map(cards2.map((c) => [c.id, c])), perfect) }]);
    expect(out.after_b).toBeNull();
    expect(out.cs_facts).toBe(1);
    expect(out.phone_threads).toBe(1);
    expect(out.after_a_landed).toEqual({});
  });
});

describe("judging the after days (review-agent plan 3.5)", () => {
  const readBack = { correct: true, as_fact: false, category: "PHONE_CALL", one_thread: true };
  const day4 = (over: Partial<RunOutcome> = {}): RunOutcome => ({
    a: null,
    b: null,
    after_b: readBack,
    cs_facts: 0,
    phone_threads: 1,
    after_a_landed: { "ROUTINE_OPS/fact": 2 },
    contaminated: false,
    questions: 1,
    failed_calls: 0,
    retryable_failures: 0,
    ...over,
  });
  const day5 = (over: Partial<RunOutcome> = {}): RunOutcome => day4({ after_b: null, phone_threads: 0, ...over });
  const runs = (n: number, make: () => RunOutcome, ...bad: RunOutcome[]) => [...bad, ...Array.from({ length: n - bad.length }, make)];

  it("summarizes read-back runs, CUSTOMER_SERVICE-fact runs, phone-thread runs and the after-A histogram", () => {
    const s = summarizeRuns(
      runs(5, day4, day4({ phone_threads: 2, after_b: { ...readBack, one_thread: false } }), day4({ cs_facts: 1, after_a_landed: { "CUSTOMER_SERVICE/fact": 1, "ROUTINE_OPS/fact": 1 } })),
    );
    expect(s).toMatchObject({
      after_b_applicable: true,
      after_b_ok: 4,
      cs_fact_runs: 1,
      phone_runs: 5,
      after_a_landed: { "ROUTINE_OPS/fact": 9, "CUSTOMER_SERVICE/fact": 1 },
    });
    expect(summarizeRuns(runs(5, day5))).toMatchObject({ after_b_applicable: false, after_b_ok: 0, phone_runs: 0 });
  });

  it("a read-back run counts only when it is one correct PHONE_CALL thread AND the day's only phone thread", () => {
    expect(summarizeRuns([day4({ after_b: { ...readBack, category: "CORRECTION", correct: false } })]).after_b_ok).toBe(0);
    expect(summarizeRuns([day4({ phone_threads: 2 })]).after_b_ok).toBe(0);
    expect(summarizeRuns([day4()]).after_b_ok).toBe(1);
  });

  it("days 4-5: a CUSTOMER_SERVICE fact in ANY run fails the cell, exact or variant; days 1-3 ignore it", () => {
    const s = summarizeRuns(runs(5, day4, day4({ cs_facts: 1 })));
    for (const variant of ["exact", "v1"] as const) {
      expect(judgeCell({ variant, day: 4, summary: s })).toMatchObject({ status: "FAIL", failures: ["CUSTOMER_SERVICE fact in 1/5 runs (max 0)"] });
      expect(judgeCell({ variant, day: 5, summary: s }).failures).toContain("CUSTOMER_SERVICE fact in 1/5 runs (max 0)");
    }
    expect(judgeCell({ variant: "exact", day: 2, summary: summarizeRuns(runs(5, () => day4({ a: { correct: true, as_fact: true, category: "CUSTOMER_SERVICE", one_thread: true }, b: readBack, after_b: null, cs_facts: 1 }))) }).pass).toBe(true);
  });

  it("day 5: a phone thread in ANY run fails the cell (the after window has exactly one call)", () => {
    const s = summarizeRuns(runs(5, day5, day5({ phone_threads: 1 })));
    expect(judgeCell({ variant: "v2", day: 5, summary: s })).toMatchObject({ status: "FAIL", failures: ["PHONE_CALL thread in 1/5 runs (max 0)"] });
    expect(judgeCell({ variant: "exact", day: 5, summary: summarizeRuns(runs(5, day5)) }).pass).toBe(true);
  });

  it("day 4: a split read-back card does not fail the cell by itself (the 95 % bar is judged over the day, see runScenario)", () => {
    const s = summarizeRuns(runs(5, day4, day4({ phone_threads: 2, after_b: { ...readBack, one_thread: false } })));
    expect(judgeCell({ variant: "exact", day: 4, summary: s })).toMatchObject({ status: "PASS", failures: [] });
  });

  it("day 4: routine contamination and the question cap keep their existing rules", () => {
    expect(judgeCell({ variant: "exact", day: 4, summary: summarizeRuns(runs(5, day4, day4({ contaminated: true }))) }).failures).toEqual([
      "contamination 1/5 (max 0)",
    ]);
    expect(judgeCell({ variant: "exact", day: 4, summary: summarizeRuns(runs(5, day4, day4({ questions: 6 }))) }).pass).toBe(false);
  });
});

describe("runScenario on the after days (fake label model)", () => {
  const config = loadCategoriesConfig();
  const lineKind = new Map<string, ScenarioCard["kind"]>();
  for (const d of SCENARIO_V2) for (const v of VARIANT_IDS) for (const c of d.variants[v]) for (const l of c.lines) lineKind.set(l, c.kind);

  /** One thread per card, category by kind; `afterA` overrides the after-A category, `splitUnits` (unit ids, or "all") splits the read-back card's second line into its own PHONE_CALL thread. */
  const model = (opts: { afterA?: "CUSTOMER_SERVICE"; splitUnits?: readonly string[] | "all" } = {}): LabelCall => {
    return async ({ unit }) => {
      const wire: LabelWireOutput = { lines: [], threads: [], non_work_lines: [] };
      const cardOfIdx = unit.lines.map((l) => l.seg_id);
      const doSplit = opts.splitUnits === "all" || (opts.splitUnits?.includes(unit.unit_id) ?? false);
      let n = 0;
      unit.lines.forEach((l, i) => {
        const kind = lineKind.get(l.text)!;
        const newCard = i === 0 || cardOfIdx[i - 1] !== cardOfIdx[i];
        const secondBLine = kind === "after_b" && !newCard && doSplit;
        if (newCard || secondBLine) {
          n += 1;
          const category =
            kind === "after_a" ? (opts.afterA ?? "ROUTINE_OPS") : kind === "after_b" ? "PHONE_CALL" : kind === "problem_a" ? "CUSTOMER_SERVICE" : kind === "problem_b" ? "PHONE_CALL" : "ROUTINE_OPS";
          wire.threads.push({ id: `T${n}`, category, confidence: 0.95, evidence: [], summary: "s" });
        }
        wire.threads.at(-1)!.evidence.push(i);
        wire.lines.push({ i, reply_to: null, thread: `T${n}` });
      });
      return { kind: "ok", wire };
    };
  };
  const after = { runs: 2, config, concurrency: 4, days: [4, 5] as const, variants: ["exact", "v1"] as const };

  it("a perfect model passes, the report carries the day-4 read-back line and the after-A histogram, and prints counts only", async () => {
    const report = await runScenario(after, { label: model(), sleep: async () => {} });
    expect(report.pass).toBe(true);
    expect(report.after_b).toEqual({ runs: 8, ok: 8, pass: true });
    expect(exitCodeFor(report)).toBe(0);
    const text = formatReport(report);
    expect(text).toContain("day-4 read-back: exactly one PHONE_CALL thread in 8/8 runs");
    expect(text).toMatch(/after-A cards, day 4: ROUTINE_OPS\/factx/);
    expect(text).toMatch(/after-A cards, day 5: ROUTINE_OPS\/factx/);
    expect(text).not.toMatch(/egg tart|croissant|Bakery/i);
  });

  it("a CUSTOMER_SERVICE fact on an after-A card fails the run (exit 2) and the row says so", async () => {
    const report = await runScenario(after, { label: model({ afterA: "CUSTOMER_SERVICE" }), sleep: async () => {} });
    expect(report.pass).toBe(false);
    expect(exitCodeFor(report)).toBe(2);
    expect(formatReport(report)).toContain("CUSTOMER_SERVICE fact in 2/2 runs (max 0)");
  });

  it("the 95 % read-back bar is over all day-4 runs: 1 split in 40 passes the bar, 3 in 40 fails it (exit 2) even though every cell passes", async () => {
    const big = { runs: 5, config, concurrency: 8, days: [4] as const, variants: ["exact", "v1", "v2", "v4"] as const };
    const none = await runScenario(big, { label: model(), sleep: async () => {} });
    expect(none.after_b).toEqual({ runs: 40, ok: 40, pass: true });
    const one = await runScenario(big, { label: model({ splitUnits: ["d4-exact-U1-r0-u1"] }), sleep: async () => {} });
    expect(one.after_b).toEqual({ runs: 40, ok: 39, pass: true });
    const three = await runScenario(big, {
      label: model({ splitUnits: ["d4-exact-U1-r0-u1", "d4-exact-U1-r1-u1", "d4-v1-U2-r0-u3"] }),
      sleep: async () => {},
    });
    expect(three.after_b).toEqual({ runs: 40, ok: 37, pass: false });
    expect(three.cells.every((c) => c.status === "PASS")).toBe(true);
    expect(three.pass).toBe(false);
    expect(exitCodeFor(three)).toBe(2);
    expect(formatReport(three)).toContain("day-4 read-back: exactly one PHONE_CALL thread in 37/40 runs");
    expect(formatReport(three)).toContain("FAIL (exit 2)");
  });

  it("inconclusive day-4 cells are left out of the 95 % bar and report null when nothing conclusive remains", async () => {
    const quota: LabelCall = async () => ({ kind: "retryable_error", error: { class: "http_429" } });
    const report = await runScenario({ ...after, days: [4], variants: ["exact"] }, { label: quota, sleep: async () => {}, random: () => 0 });
    expect(report.after_b).toBeNull();
    expect(exitCodeFor(report)).toBe(3);
  });

  it("no day-4 cell in the selection: after_b is null", async () => {
    const report = await runScenario({ ...after, days: [5] }, { label: model(), sleep: async () => {} });
    expect(report.after_b).toBeNull();
  });
});
