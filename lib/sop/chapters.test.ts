import { describe, expect, it } from "vitest";
import type { SopStepView } from "@/lib/sop/contract";
import { CHAPTER_IDS, chapterOf, groupByChapter, legendCounts } from "@/lib/sop/chapters";

/**
 * R-19 PR-9b (§9.1): chapters are plain code keyed on the step id prefix. The pilot's SOP has none of the demo
 * prefixes and falls back to "Other steps" with no data change.
 */

const step = (id: string): SopStepView => ({ step_id: id, title: `Title ${id}`, text: `Text ${id}`, role: "staff" });

describe("chapterOf", () => {
  it.each([
    ["open-01", "opening_closing"],
    ["close-01", "opening_closing"],
    ["opening-02", "opening_closing"],
    ["bake-01", "production"],
    ["stock-01", "stock"],
    ["serve-01", "customer"],
    ["serve_02", "customer"],
    ["clean-01", "other"],
    ["pilot-step-7", "other"],
    ["", "other"],
    ["OPEN-01", "other"], // the prefix match is exact and lower-case, like the ids the seeds write
  ] as const)("%s → %s", (id, chapter) => {
    expect(chapterOf(id)).toBe(chapter);
  });

  it("lists the chapters in book order", () => {
    expect(CHAPTER_IDS).toEqual(["opening_closing", "production", "stock", "customer", "other"]);
  });
});

describe("groupByChapter", () => {
  it("groups steps in book order, keeping each chapter's steps in SOP order, and skips empty chapters", () => {
    const groups = groupByChapter([step("stock-02"), step("close-01"), step("stock-01"), step("open-01"), step("x-01")]);
    expect(groups.map((g) => g.chapter)).toEqual(["opening_closing", "stock", "other"]);
    expect(groups.map((g) => g.steps.map((s) => s.step_id))).toEqual([["close-01", "open-01"], ["stock-02", "stock-01"], ["x-01"]]);
  });

  it("an empty SOP has no chapters", () => {
    expect(groupByChapter([])).toEqual([]);
  });
});

describe("legendCounts", () => {
  const steps = [step("open-01"), step("bake-01"), step("stock-01"), step("serve-01"), step("close-01")];

  it("counts the steps never changed as 'from your SOP' and the distinct changed ids as 'improved'", () => {
    expect(legendCounts(steps, ["stock-01", "serve-01", "stock-01"])).toEqual({ fromSop: 3, improved: 2 });
  });

  it("no changes: every step is from the SOP", () => {
    expect(legendCounts(steps, [])).toEqual({ fromSop: 5, improved: 0 });
  });

  it("a changed id that is not among the shown steps still counts as improved but never as from the SOP", () => {
    expect(legendCounts([step("open-01")], ["gone-01"])).toEqual({ fromSop: 1, improved: 1 });
  });
});
