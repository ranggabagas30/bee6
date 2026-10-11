import { describe, expect, it } from "vitest";
import type { Category } from "@/lib/pipeline/categories";
import {
  accuracy,
  cohensKappa,
  confusion,
  inRushHour,
  macroF1,
  normalizeForWer,
  parseGoldCsv,
  percentile,
  perCategory,
  wer,
  type LabelRow,
} from "@/lib/eval/metrics";

const A: Category = "ROUTINE_OPS";
const B: Category = "CUSTOMER_SERVICE";
const C: Category = "TRAINING";

function rowsFrom(pairs: [gold: Category, predicted: Category][]): LabelRow[] {
  return pairs.map(([gold, predicted], i) => ({
    episode: `E${String(i + 1).padStart(4, "0")}`,
    start_hm: "09:00",
    model_category: predicted,
    gold,
    gold_2: null,
  }));
}

// Hand-computed 3x3 (gold -> predicted): A->A x4, A->B x1, B->B x2, B->A x1, B->C x1, C->C x1, C->A x1.
const HAND = rowsFrom([
  [A, A], [A, A], [A, A], [A, A], [A, B],
  [B, B], [B, B], [B, A], [B, C],
  [C, C], [C, A],
]);

describe("confusion", () => {
  it("rows = gold, columns = predicted, labels in canonical category order", () => {
    const { labels, matrix } = confusion(HAND);
    expect(labels).toEqual([A, B, C]);
    expect(matrix).toEqual([
      [4, 1, 0],
      [1, 2, 1],
      [1, 0, 1],
    ]);
  });

  it("includes a category that is only ever predicted", () => {
    const { labels, matrix } = confusion(rowsFrom([[A, "COMPLAINT"]]));
    expect(labels).toEqual([A, "COMPLAINT"]);
    expect(matrix).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });
});

describe("perCategory / macroF1 / accuracy", () => {
  it("matches hand-computed precision, recall and F1", () => {
    const per = perCategory(HAND);
    const get = (c: Category) => per.find((p) => p.category === c)!;
    expect(get(A).support).toBe(5);
    expect(get(A).precision).toBeCloseTo(4 / 6, 10);
    expect(get(A).recall).toBeCloseTo(4 / 5, 10);
    expect(get(A).f1).toBeCloseTo(8 / 11, 10);
    expect(get(B).precision).toBeCloseTo(2 / 3, 10);
    expect(get(B).recall).toBeCloseTo(0.5, 10);
    expect(get(B).f1).toBeCloseTo(4 / 7, 10);
    expect(get(C).f1).toBeCloseTo(0.5, 10);
    expect(macroF1(per)).toBeCloseTo((8 / 11 + 4 / 7 + 0.5) / 3, 10);
    expect(accuracy(HAND)).toBeCloseTo(7 / 11, 10);
  });

  it("precision is null (n/a, never 0) when a category is never predicted", () => {
    const per = perCategory(rowsFrom([[A, A], [B, A]]));
    const b = per.find((p) => p.category === B)!;
    expect(b.support).toBe(1);
    expect(b.precision).toBeNull();
    expect(b.recall).toBe(0);
    expect(b.f1).toBe(0);
  });

  it("recall is null for a category that is only predicted (support 0)", () => {
    const per = perCategory(rowsFrom([[A, "COMPLAINT"]]));
    const c = per.find((p) => p.category === "COMPLAINT")!;
    expect(c.support).toBe(0);
    expect(c.recall).toBeNull();
    expect(c.precision).toBe(0);
  });

  it("macro-F1 ignores zero-support categories", () => {
    // COMPLAINT is predicted once but never in gold: F1 0 must not drag the mean down.
    const per = perCategory(rowsFrom([[A, A], [A, "COMPLAINT"]]));
    expect(macroF1(per)).toBeCloseTo(per.find((p) => p.category === A)!.f1!, 10);
  });

  it("returns null on an empty set", () => {
    expect(perCategory([])).toEqual([]);
    expect(macroF1([])).toBeNull();
    expect(accuracy([])).toBeNull();
  });
});

describe("inRushHour", () => {
  it("covers 11:00-13:59 and 17:00-19:59 inclusive", () => {
    for (const hm of ["11:00", "12:30", "13:59", "17:00", "19:59"]) expect(inRushHour(hm)).toBe(true);
    for (const hm of ["10:59", "14:00", "16:59", "20:00", "07:30"]) expect(inRushHour(hm)).toBe(false);
  });

  it("accepts custom windows", () => {
    expect(inRushHour("08:15", [["08:00", "08:59"]])).toBe(true);
    expect(inRushHour("12:00", [["08:00", "08:59"]])).toBe(false);
  });
});

describe("cohensKappa", () => {
  it("is 0.4 on the textbook 2x2 example", () => {
    // both yes 20, A yes/B no 5, A no/B yes 10, both no 15 (n = 50): po 0.7, pe 0.5.
    const pairs: [Category, Category][] = [
      ...Array.from({ length: 20 }, () => [A, A] as [Category, Category]),
      ...Array.from({ length: 5 }, () => [A, B] as [Category, Category]),
      ...Array.from({ length: 10 }, () => [B, A] as [Category, Category]),
      ...Array.from({ length: 15 }, () => [B, B] as [Category, Category]),
    ];
    expect(cohensKappa(pairs)).toBeCloseTo(0.4, 10);
  });

  it("is 1 for perfect agreement across several labels", () => {
    expect(cohensKappa([[A, A], [B, B], [C, C]])).toBeCloseTo(1, 10);
  });

  it("is null when undefined: no pairs, or chance agreement is 1", () => {
    expect(cohensKappa([])).toBeNull();
    expect(cohensKappa([[A, A], [A, A]])).toBeNull();
  });
});

describe("normalizeForWer / wer", () => {
  it("lower-cases, strips punctuation and collapses whitespace", () => {
    expect(normalizeForWer("  Hello,   WORLD!  ")).toEqual(["hello", "world"]);
    expect(normalizeForWer("Don't stop 15 minutes.")).toEqual(["dont", "stop", "15", "minutes"]);
    expect(normalizeForWer("")).toEqual([]);
  });

  it("applies Unicode NFKC", () => {
    expect(normalizeForWer("ＡＢＣ")).toEqual(["abc"]);
  });

  it("identical text has 0 edits", () => {
    expect(wer("buka toko jam tujuh", "Buka toko, jam tujuh.")).toEqual({ edits: 0, words: 4 });
  });

  it("one substitution in four words is 1 edit of 4", () => {
    expect(wer("buka toko jam tujuh", "buka toko jam delapan")).toEqual({ edits: 1, words: 4 });
  });

  it("empty hypothesis is all deletions", () => {
    expect(wer("buka toko jam tujuh", "")).toEqual({ edits: 4, words: 4 });
  });

  it("counts insertions and deletions", () => {
    expect(wer("a b c", "a x b c d")).toEqual({ edits: 2, words: 3 });
  });
});

describe("percentile (nearest rank)", () => {
  const ONE_TO_TWENTY = Array.from({ length: 20 }, (_, i) => i + 1);
  it("p50 and p95 on 1..20", () => {
    expect(percentile(ONE_TO_TWENTY, 50)).toBe(10);
    expect(percentile(ONE_TO_TWENTY, 95)).toBe(19);
  });
  it("does not need sorted input and never mutates it", () => {
    const v = [5, 1, 3];
    expect(percentile(v, 50)).toBe(3);
    expect(v).toEqual([5, 1, 3]);
  });
  it("single value and empty set", () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("parseGoldCsv", () => {
  const HEADER = "episode,local_date,start_hm,lines,model_category,gold,gold_2,notes";

  it("parses rows, handles a quoted line with comma and quote, and counts empty/SKIP gold as skipped", () => {
    const text = [
      HEADER,
      'E0001,2026-10-05,09:05,"opened the shop, said ""ready""",ROUTINE_OPS,ROUTINE_OPS,,',
      "E0002,2026-10-05,12:10,line two,COMPLAINT,CUSTOMER_SERVICE,COMPLAINT,a note",
      "E0003,2026-10-05,13:00,line three,TRAINING,,,",
      "E0004,2026-10-05,14:00,line four,TRAINING,SKIP,,",
    ].join("\n");
    const { rows, skipped, errors } = parseGoldCsv(text);
    expect(errors).toEqual([]);
    expect(skipped).toBe(2);
    expect(rows).toEqual([
      { episode: "E0001", start_hm: "09:05", model_category: "ROUTINE_OPS", gold: "ROUTINE_OPS", gold_2: null },
      { episode: "E0002", start_hm: "12:10", model_category: "COMPLAINT", gold: "CUSTOMER_SERVICE", gold_2: "COMPLAINT" },
    ]);
  });

  it("an unknown gold category is an error naming the episode, and the row is not silently dropped", () => {
    const text = [HEADER, "E0007,2026-10-05,09:00,x,TRAINING,COMPLAIN,,"].join("\n");
    const { rows, errors } = parseGoldCsv(text);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("E0007");
    expect(errors[0]).toContain("COMPLAIN");
  });

  it("an unknown gold_2 or model_category is an error naming the episode", () => {
    const text = [
      HEADER,
      "E0001,2026-10-05,09:00,x,TRAINING,TRAINING,NOPE,",
      "E0002,2026-10-05,09:00,x,BOGUS,TRAINING,,",
    ].join("\n");
    const { errors } = parseGoldCsv(text);
    expect(errors.some((e) => e.includes("E0001"))).toBe(true);
    expect(errors.some((e) => e.includes("E0002"))).toBe(true);
  });

  it("trims and upper-cases category cells", () => {
    const text = [HEADER, "E0001,2026-10-05,09:00,x,training, routine_ops ,,"].join("\n");
    const { rows, errors } = parseGoldCsv(text);
    expect(errors).toEqual([]);
    expect(rows[0]?.gold).toBe("ROUTINE_OPS");
    expect(rows[0]?.model_category).toBe("TRAINING");
  });

  it("reports a missing required column and a duplicate episode alias and a bad start_hm", () => {
    expect(parseGoldCsv("episode,gold\nE0001,TRAINING").errors[0]).toMatch(/header/i);
    const dup = [HEADER, "E0001,d,09:00,x,TRAINING,TRAINING,,", "E0001,d,09:00,x,TRAINING,TRAINING,,"].join("\n");
    expect(parseGoldCsv(dup).errors.some((e) => e.includes("E0001") && /duplicate/i.test(e))).toBe(true);
    const bad = [HEADER, "E0002,d,9am,x,TRAINING,TRAINING,,"].join("\n");
    expect(parseGoldCsv(bad).errors.some((e) => e.includes("E0002"))).toBe(true);
  });

  it("accepts H:MM, HH:MM and HH:MM:SS start times and stores zero-padded HH:MM (Sheets reformats times)", () => {
    const text = [
      HEADER,
      "E0001,d,9:05,x,TRAINING,TRAINING,,",
      "E0002,d,09:05,x,TRAINING,TRAINING,,",
      "E0003,d,9:05:00,x,TRAINING,TRAINING,,",
      "E0004,d,13:59:59,x,TRAINING,TRAINING,,",
      "E0005,d,0:00,x,TRAINING,TRAINING,,",
      "E0006,d, 17:00:00 ,x,TRAINING,TRAINING,,",
    ].join("\n");
    const { rows, errors } = parseGoldCsv(text);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.start_hm)).toEqual(["09:05", "09:05", "09:05", "13:59", "00:00", "17:00"]);
  });

  it("rush-hour edge minutes survive the Sheets reformatting", () => {
    const text = [
      HEADER,
      "E0001,d,11:00:00,x,TRAINING,TRAINING,,",
      "E0002,d,13:59:00,x,TRAINING,TRAINING,,",
      "E0003,d,14:00:00,x,TRAINING,TRAINING,,",
      "E0004,d,10:59,x,TRAINING,TRAINING,,",
      "E0005,d,9:05,x,TRAINING,TRAINING,,",
    ].join("\n");
    const { rows } = parseGoldCsv(text);
    expect(rows.map((r) => inRushHour(r.start_hm))).toEqual([true, true, false, false, false]);
  });

  it.each(["25:00", "9", "9:5", "24:00", "12:60", "9:05:7", "09:05:60", "9am", "123:00", "09:05:00:00"])(
    "rejects start_hm %s",
    (hm) => {
      const { rows, errors } = parseGoldCsv([HEADER, `E0009,d,${hm},x,TRAINING,TRAINING,,`].join("\n"));
      expect(rows).toEqual([]);
      expect(errors.some((e) => e.includes("E0009") && e.includes(hm))).toBe(true);
    },
  );

  it("reports an empty file", () => {
    expect(parseGoldCsv("").errors.length).toBeGreaterThan(0);
  });

  it("reports malformed CSV instead of throwing", () => {
    expect(parseGoldCsv('episode\n"oops').errors.length).toBeGreaterThan(0);
  });
});
