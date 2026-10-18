import { describe, expect, it } from "vitest";
import { REVIEW_CAVEATS, ReviewAgentStoredSchema, ReviewDraftArgsSchema, ReviewCaveatSchema, ReviewDraftSchema } from "@/lib/reviews/agent/schema";

const ok = (n: number): string => "a".repeat(n);
const draft = (over: Record<string, unknown> = {}) => ({
  narrative_en: ok(80),
  suggested_verdict: "worked",
  quoted_numbers: [],
  caveats: ["category_count_not_problem_count"],
  ...over,
});

describe("ReviewDraftSchema", () => {
  it("counts the narrative in code points: 59 fails, 60 and 600 pass, 601 fails", () => {
    expect(ReviewDraftSchema.safeParse(draft({ narrative_en: ok(59) })).success).toBe(false);
    expect(ReviewDraftSchema.safeParse(draft({ narrative_en: ok(60) })).success).toBe(true);
    expect(ReviewDraftSchema.safeParse(draft({ narrative_en: ok(600) })).success).toBe(true);
    expect(ReviewDraftSchema.safeParse(draft({ narrative_en: ok(601) })).success).toBe(false);
  });

  it("counts an astral character as one code point", () => {
    expect(ReviewDraftSchema.safeParse(draft({ narrative_en: "\u{1F600}".repeat(60) })).success).toBe(true);
  });

  it("is strict", () => {
    expect(ReviewDraftSchema.safeParse(draft({ extra: 1 })).success).toBe(false);
  });

  it("accepts only the four verdict words", () => {
    for (const v of ["worked", "revise", "revert", "none"]) {
      expect(ReviewDraftSchema.safeParse(draft({ suggested_verdict: v })).success).toBe(true);
    }
    expect(ReviewDraftSchema.safeParse(draft({ suggested_verdict: "maybe" })).success).toBe(false);
  });

  it("limits quoted_numbers to 12 finite numbers", () => {
    expect(ReviewDraftSchema.safeParse(draft({ quoted_numbers: Array(12).fill(1) })).success).toBe(true);
    expect(ReviewDraftSchema.safeParse(draft({ quoted_numbers: Array(13).fill(1) })).success).toBe(false);
    expect(ReviewDraftSchema.safeParse(draft({ quoted_numbers: [Infinity] })).success).toBe(false);
  });

  it("caveats are an enum of the seven members, at most seven", () => {
    expect(REVIEW_CAVEATS).toHaveLength(7);
    expect(ReviewDraftSchema.safeParse(draft({ caveats: ["nonsense"] })).success).toBe(false);
    expect(ReviewDraftSchema.safeParse(draft({ caveats: [...REVIEW_CAVEATS] })).success).toBe(true);
    expect(ReviewDraftSchema.safeParse(draft({ caveats: [...REVIEW_CAVEATS, "short_window"] })).success).toBe(false);
    expect(ReviewCaveatSchema.safeParse("no_baseline").success).toBe(true);
  });
});

describe("ReviewAgentStoredSchema", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    version: "review-v1",
    model: "gemini-3.5-flash-lite",
    narrative_en: ok(80),
    suggested_verdict: "worked",
    caveats: ["short_window"],
    rounds: 1,
    model_calls: 5,
    generated_at_ms: 1,
    ...over,
  });
  it("parses a valid stored agent and is strict", () => {
    expect(ReviewAgentStoredSchema.safeParse(stored()).success).toBe(true);
    expect(ReviewAgentStoredSchema.safeParse(stored({ x: 1 })).success).toBe(false);
  });
  it("bounds narrative (1200), rounds (1..2) and model_calls (0..40)", () => {
    expect(ReviewAgentStoredSchema.safeParse(stored({ narrative_en: ok(1201) })).success).toBe(false);
    expect(ReviewAgentStoredSchema.safeParse(stored({ narrative_en: "" })).success).toBe(false);
    expect(ReviewAgentStoredSchema.safeParse(stored({ rounds: 3 })).success).toBe(false);
    expect(ReviewAgentStoredSchema.safeParse(stored({ rounds: 0 })).success).toBe(false);
    expect(ReviewAgentStoredSchema.safeParse(stored({ model_calls: 41 })).success).toBe(false);
  });
  it("pins the version literal and the model enum", () => {
    expect(ReviewAgentStoredSchema.safeParse(stored({ version: "review-v2" })).success).toBe(false);
    expect(ReviewAgentStoredSchema.safeParse(stored({ model: "gemini-3.5-flash" })).success).toBe(true);
    expect(ReviewAgentStoredSchema.safeParse(stored({ model: "other" })).success).toBe(false);
  });
});

describe("ReviewDraftArgsSchema (the tool's parameter schema)", () => {
  it("lets a too-short or too-long narrative through so the checker can name it", () => {
    expect(ReviewDraftArgsSchema.safeParse(draft({ narrative_en: ok(5) })).success).toBe(true);
    expect(ReviewDraftArgsSchema.safeParse(draft({ narrative_en: ok(900) })).success).toBe(true);
  });
  it("still bounds hostile input, stays strict and keeps the other fields", () => {
    expect(ReviewDraftArgsSchema.safeParse(draft({ narrative_en: ok(2001) })).success).toBe(false);
    expect(ReviewDraftArgsSchema.safeParse(draft({ extra: 1 })).success).toBe(false);
    expect(ReviewDraftArgsSchema.safeParse(draft({ suggested_verdict: "maybe" })).success).toBe(false);
    // An unknown caveat is no longer an opaque tool error: it reaches the checker (see the tolerance tests below).
    expect(ReviewDraftArgsSchema.safeParse(draft({ caveats: ["x".repeat(61)] })).success).toBe(false);
  });
});

describe("ReviewDraftArgsSchema field descriptions (what the model reads in the tool declaration)", () => {
  it("every field is described, and suggested_verdict is marked required (the eval saw it omitted)", () => {
    for (const k of ["narrative_en", "suggested_verdict", "quoted_numbers", "caveats"] as const) {
      expect(ReviewDraftArgsSchema.shape[k].description, k).toBeTruthy();
    }
    expect(ReviewDraftArgsSchema.shape.suggested_verdict.description).toMatch(/required/i);
    expect(ReviewDraftArgsSchema.shape.quoted_numbers.description).toMatch(/no minus sign/i);
  });
});

describe("ReviewDraftArgsSchema tolerates the argument slips flash-lite makes, so the checker (not an opaque error) answers", () => {
  const args = (over: Record<string, unknown>) => ReviewDraftArgsSchema.safeParse({ ...draft(), ...over });
  it("numbers sent as strings are read as numbers; a non-number is still invalid", () => {
    const r = args({ quoted_numbers: ["3", "2", "200"] });
    expect(r.success && r.data.quoted_numbers).toEqual([3, 2, 200]);
    expect(args({ quoted_numbers: ["abc"] }).success).toBe(false);
  });
  it("an unknown caveat string reaches the checker (it fails caveat_not_applicable there)", () => {
    expect(args({ caveats: ["short_window", "category_count_not_problem_icon"] }).success).toBe(true);
  });
  it("the stored draft schema stays strict: an unknown caveat or a string number is refused", () => {
    expect(ReviewDraftSchema.safeParse(draft({ caveats: ["category_count_not_problem_icon"] })).success).toBe(false);
    expect(ReviewDraftSchema.safeParse(draft({ quoted_numbers: ["3"] })).success).toBe(false);
  });
  it("a missing field is still invalid", () => {
    const { suggested_verdict: _omit, ...rest } = draft();
    expect(ReviewDraftArgsSchema.safeParse(rest).success).toBe(false);
  });
});
