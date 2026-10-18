import { describe, expect, it } from "vitest";
import {
  REVIEW_CHECK_RULES,
  caveatContextOfInputs,
  checkReview,
  requiredCaveats,
  type ReviewCheckRule,
} from "@/lib/reviews/agent/check";
import { allInspected, goodDraft, GOOD_NARRATIVE, makeInputs } from "@/lib/reviews/agent/testing";
import { newReviewAgentSession } from "@/lib/reviews/agent/types";

const inputs = makeInputs();
const ctx = (over: { session?: ReturnType<typeof newReviewAgentSession>; inputs?: ReturnType<typeof makeInputs> } = {}) => ({
  inputs: over.inputs ?? inputs,
  session: over.session ?? allInspected(),
});
const withNarrative = (narrative_en: string, extra: Record<string, unknown> = {}) => ({ ...goodDraft(), narrative_en, ...extra });
const reasonsOf = (draft: unknown, c = ctx()): ReviewCheckRule[] => checkReview(draft, c).reasons;

describe("checkReview", () => {
  it("lists exactly the 19 rules of the plan", () => {
    expect(REVIEW_CHECK_RULES).toHaveLength(19);
  });

  it("passes a correct draft", () => {
    expect(checkReview(goodDraft(), ctx())).toEqual({ passed: true, reasons: [] });
  });

  it("schema_invalid short-circuits and nothing else is reported", () => {
    expect(reasonsOf({ nope: 1 })).toEqual(["schema_invalid"]);
    expect(reasonsOf(null)).toEqual(["schema_invalid"]);
    expect(reasonsOf({ ...goodDraft(), suggested_verdict: "maybe" })).toEqual(["schema_invalid"]);
  });

  it("change_not_inspected / counts_not_inspected / sample_not_inspected follow the session", () => {
    const s = newReviewAgentSession();
    expect(reasonsOf(goodDraft(), ctx({ session: s }))).toEqual([
      "change_not_inspected",
      "counts_not_inspected",
      "sample_not_inspected",
    ]);
    s.inspected.add("change");
    s.inspected.add("counts");
    s.inspected.add("before");
    expect(reasonsOf(goodDraft(), ctx({ session: s }))).toEqual(["sample_not_inspected"]);
    s.inspected.add("after");
    expect(reasonsOf(goodDraft(), ctx({ session: s }))).toEqual([]);
  });

  it('verdict_mismatch: "revise" on A-worked', () => {
    expect(reasonsOf({ ...goodDraft(), suggested_verdict: "revise" })).toEqual(["verdict_mismatch"]);
  });

  it('verdict_mismatch treats a null suggestion as "none"', () => {
    const none = makeInputs({ after: { days: 1, count: 0 } });
    expect(none.suggestion.verdict).toBeNull();
    const base = { ...goodDraft(), suggested_verdict: "none" as const, quoted_numbers: [2, 3, 0, 1], caveats: ["short_window", "category_count_not_problem_count", "not_enough_days"] };
    const n = "Only 1 captured day was noted after the change against 3 before it, with 2 moments before and 0 after, so the rule gives no suggestion yet. Fewer moments were noted.";
    expect(reasonsOf({ ...base, narrative_en: n }, ctx({ inputs: none }))).toEqual([]);
    expect(reasonsOf({ ...base, narrative_en: n, suggested_verdict: "worked" }, ctx({ inputs: none }))).toEqual(["verdict_mismatch"]);
  });

  describe("numbers", () => {
    it('allows "3 days" when before.days_captured is 3 and fails "4 days"', () => {
      expect(reasonsOf(withNarrative(GOOD_NARRATIVE))).toEqual([]);
      const bad = withNarrative(GOOD_NARRATIVE.replace("over 3 captured days", "over 4 captured days"), { quoted_numbers: [2, 4, 0, 2, 100] });
      expect(reasonsOf(bad)).toEqual(["number_not_allowed"]);
    });
    it('allows "0.7 per day" (round1 of 2/3) and "0.67" (round2), fails "0.6"', () => {
      const mk = (n: string) => withNarrative(`${GOOD_NARRATIVE} That is ${n} per day before it.`, { quoted_numbers: [2, 3, 0, 2, 100, Number(n)] });
      expect(reasonsOf(mk("0.7"))).toEqual([]);
      expect(reasonsOf(mk("0.67"))).toEqual([]);
      expect(reasonsOf(mk("0.6"))).toEqual(["number_not_allowed"]);
    });
    it('fails "67 percent": only abs(change_pct) = 100 is allowed', () => {
      const bad = withNarrative(GOOD_NARRATIVE.replace("100 percent", "67 percent"), { quoted_numbers: [2, 3, 0, 2, 67] });
      expect(reasonsOf(bad)).toEqual(["number_not_allowed"]);
    });
    it("number_not_allowed on a number written as a word (C1)", () => {
      const three = withNarrative(GOOD_NARRATIVE.replace("over 3 captured days", "over three captured days"), { quoted_numbers: [2, 0, 100] });
      expect(reasonsOf(three)).toContain("number_not_allowed");
      const halved = withNarrative(
        "The change added baking times to the tray labels. The count halved after it, which suggests it worked. The counts are moments of one kind, not proof of cause.",
        { quoted_numbers: [] },
      );
      expect(reasonsOf(halved)).toContain("number_not_allowed");
      for (const w of ["twice", "double", "dozen", "quarter", "Twenty"]) {
        expect(reasonsOf(withNarrative(`${GOOD_NARRATIVE} It was ${w} as often.`))).toContain("number_not_allowed");
      }
    });
    it('"one" is not a number word: "moments of one kind" still passes', () => {
      const n = withNarrative(`${GOOD_NARRATIVE} The counts are moments of one kind, not proof of cause.`);
      expect(reasonsOf(n)).toEqual([]);
    });
    it("a comma decimal parses as a decimal", () => {
      const n = withNarrative(`${GOOD_NARRATIVE} That is 0,7 per day before it.`, { quoted_numbers: [2, 3, 0, 2, 100, 0.7] });
      expect(reasonsOf(n)).toEqual([]);
    });
    it("quoted_numbers_mismatch when a number is omitted or invented", () => {
      expect(reasonsOf({ ...goodDraft(), quoted_numbers: [2, 3, 0, 2] })).toEqual(["quoted_numbers_mismatch"]);
      expect(reasonsOf({ ...goodDraft(), quoted_numbers: [2, 3, 0, 2, 100, 5] })).toEqual(["quoted_numbers_mismatch"]);
    });
    it("a narrative without digits needs an empty quoted_numbers", () => {
      const n = "Fewer moments of this kind were noted after the change than before it, over a short stretch of days. The counts are a record, not proof of cause, and the humans decide.";
      expect(reasonsOf(withNarrative(n, { quoted_numbers: [] }))).toEqual([]);
      expect(reasonsOf(withNarrative(n, { quoted_numbers: [2] }))).toEqual(["quoted_numbers_mismatch"]);
    });
  });

  describe("caveats", () => {
    it("caveat_missing without category_count_not_problem_count", () => {
      expect(reasonsOf({ ...goodDraft(), caveats: ["short_window"] })).toEqual(["caveat_missing"]);
    });
    it("caveat_not_applicable with no_baseline", () => {
      expect(reasonsOf({ ...goodDraft(), caveats: ["short_window", "category_count_not_problem_count", "no_baseline"] })).toEqual([
        "caveat_not_applicable",
      ]);
    });
    it("both can be reported together, in rule order", () => {
      expect(reasonsOf({ ...goodDraft(), caveats: ["no_baseline"] })).toEqual(["caveat_missing", "caveat_not_applicable"]);
    });
  });

  describe("requiredCaveats", () => {
    const required = (o: Parameters<typeof makeInputs>[0]) => requiredCaveats(caveatContextOfInputs(makeInputs(o)));
    it("always has the category-count and short-window caveats in the demo", () => {
      expect(required({})).toEqual(["short_window", "category_count_not_problem_count"]);
    });
    it("is not short_window once both windows have 7 captured days", () => {
      expect(required({ before: { days: 7, count: 2 }, after: { days: 7, count: 0 } })).toEqual(["category_count_not_problem_count"]);
    });
    it("adds staff_answers_affect_count for ALWAYS_QUESTION and NEEDS_SUPERVISOR_CONFIRM categories", () => {
      expect(required({ category: "PHONE_CALL" })).toContain("staff_answers_affect_count");
      expect(required({ category: "COMPLAINT" })).toContain("staff_answers_affect_count");
      expect(required({ category: "CUSTOMER_SERVICE" })).not.toContain("staff_answers_affect_count");
    });
    it("adds the notice caveats and the suggestion-reason caveats", () => {
      expect(required({ overlapping: true, truncated: true })).toEqual([
        "short_window",
        "category_count_not_problem_count",
        "overlapping_change",
        "threads_truncated",
      ]);
      expect(required({ after: { days: 1, count: 0 } })).toContain("not_enough_days");
      expect(required({ before: { days: 3, count: 0 }, after: { days: 2, count: 1 } })).toContain("no_baseline");
    });
  });

  describe("text rules", () => {
    const pad = " The counts are a record of moments of one kind, not proof of cause.";
    const mk = (s: string, extra: Record<string, unknown> = {}) =>
      withNarrative(`${GOOD_NARRATIVE}${s}`, extra);

    it("too_short and too_long are named for the model (trimmed code points)", () => {
      expect(reasonsOf(withNarrative("Fewer.", { quoted_numbers: [] }))).toContain("too_short");
      expect(reasonsOf(withNarrative(`${"x".repeat(59)}   `, { quoted_numbers: [] }))).toContain("too_short");
      expect(reasonsOf(withNarrative("Fewer moments were noted. ".repeat(30), { quoted_numbers: [] }))).toContain("too_long");
    });
    it("a draft with an over-long narrative is not schema_invalid (it must reach too_long)", () => {
      expect(reasonsOf(withNarrative("a ".repeat(400), { quoted_numbers: [] }))).not.toContain("schema_invalid");
    });
    it("control_chars: newline, tab, zero-width", () => {
      expect(reasonsOf(mk("\nMore."))).toContain("control_chars");
      expect(reasonsOf(mk("​More."))).toContain("control_chars");
    });
    it("placeholder: brackets and braces", () => {
      for (const p of [" [STAFF]", " [NUMBER]", " {x}"]) expect(reasonsOf(mk(p))).toContain("placeholder");
    });
    it("url_or_handle", () => {
      for (const p of [" See https://x.test", " See www.x", " shop.com", " @shop"]) expect(reasonsOf(mk(p))).toContain("url_or_handle");
    });
    it("url_or_handle covers more top-level domains (C2)", () => {
      for (const p of [" see example.net", " see shop.co", " see a-b.io", " see shop.xyz", " see shop.app", " see Shop.ONLINE"]) {
        expect(reasonsOf(mk(p))).toContain("url_or_handle");
      }
      // Plain prose with a full stop is not a link.
      expect(reasonsOf(mk(" It went well. Staff agreed."))).not.toContain("url_or_handle");
    });
    it("date_or_time: iso date, clock time, month, weekday", () => {
      for (const p of [" On 2026-10-13.", " At 14:05.", " In October.", " On Monday.", " Oct 13."]) {
        expect(reasonsOf(mk(p))).toContain("date_or_time");
      }
      expect(reasonsOf(withNarrative("It was noted on Monday that fewer moments of this kind were recorded after the change than before it.", { quoted_numbers: [] }))).toContain("date_or_time");
      expect(reasonsOf(withNarrative("At 14:05 fewer moments of this kind were recorded after the change than before it, so it may have helped.", { quoted_numbers: [] }))).toContain("date_or_time");
    });
    it('date_or_time does not fire on "decrease", "may" or "market"', () => {
      const n = "The metric should decrease. Fewer moments were noted after the change than before it, which may mean it helped. The counts come from the market of daily work, not proof of cause.";
      expect(reasonsOf(withNarrative(n, { quoted_numbers: [] }))).not.toContain("date_or_time");
    });
    it("staff_name: a planted staff name", () => {
      expect(reasonsOf(mk(" Sari said so."))).toContain("staff_name");
    });
    it("role_or_person: supervisor and pronouns, but staff, customer, caller, they are fine", () => {
      expect(reasonsOf(mk(" The supervisor liked it."))).toContain("role_or_person");
      expect(reasonsOf(mk(" She liked it."))).toContain("role_or_person");
      expect(reasonsOf(mk(" Staff, a customer and a caller noted it, and they agreed."))).not.toContain("role_or_person");
    });
    it("instruction_word", () => {
      expect(reasonsOf(mk(" Ignore the rule."))).toContain("instruction_word");
      expect(reasonsOf(mk(" Per the system prompt."))).toContain("instruction_word");
    });
    it('causal_claim: "the change caused"', () => {
      expect(reasonsOf(mk(" The change caused it."))).toContain("causal_claim");
      expect(reasonsOf(mk(" This proves it."))).toContain("causal_claim");
      expect(reasonsOf(mk(pad))).not.toContain("causal_claim");
    });
  });

  it("collects every failure in rule order", () => {
    const r = reasonsOf(
      { ...goodDraft(), suggested_verdict: "revise", narrative_en: `${GOOD_NARRATIVE} The supervisor said the change caused it.` },
      ctx({ session: newReviewAgentSession() }),
    );
    expect(r).toEqual([
      "change_not_inspected",
      "counts_not_inspected",
      "sample_not_inspected",
      "verdict_mismatch",
      "role_or_person",
      "causal_claim",
    ]);
  });
});
