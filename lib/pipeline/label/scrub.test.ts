import { describe, expect, it } from "vitest";
import { scrubStaffNames, scrubUnitLines } from "@/lib/pipeline/label/scrub";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { buildLabelPrompt } from "@/lib/pipeline/label/prompt";
import { buildThreads, type LabelOutput } from "@/lib/pipeline/threads";
import type { LabelUnit } from "@/lib/pipeline/windowing";

describe("scrubStaffNames", () => {
  it("replaces a staff name at word boundaries, case-insensitively", () => {
    expect(scrubStaffNames("Budi checked the oven", ["Budi"])).toBe(
      "[STAFF] checked the oven",
    );
    expect(scrubStaffNames("budi checked the oven", ["Budi"])).toBe(
      "[STAFF] checked the oven",
    );
    expect(scrubStaffNames("BUDI checked the oven", ["Budi"])).toBe(
      "[STAFF] checked the oven",
    );
  });

  it("does not mangle a longer word containing the name as a substring", () => {
    expect(scrubStaffNames("Budiman checked the oven", ["Budi"])).toBe(
      "Budiman checked the oven",
    );
  });

  it("returns the text unchanged when there is no staff name list", () => {
    expect(scrubStaffNames("Dina checked the oven", [])).toBe("Dina checked the oven");
  });

  it("replaces every occurrence and every name in a multi-name list", () => {
    expect(scrubStaffNames("Budi and Dina checked the oven", ["Budi", "Dina"])).toBe(
      "[STAFF] and [STAFF] checked the oven",
    );
  });
});

describe("scrubUnitLines", () => {
  function makeUnit(): LabelUnit {
    return {
      unit_id: "unit_dev1_w1",
      window_ids: ["w1"],
      lines: [
        { line_id: "s1#0", seg_id: "s1", text: "Tolong ambil egg tart", start_ms: 0, end_ms: 1000 },
        { line_id: "s1#1", seg_id: "s1", text: "Dina, tolong cek oven", start_ms: 1000, end_ms: 2000 },
        { line_id: "s1#2", seg_id: "s1", text: "Baik, sebentar", start_ms: 2000, end_ms: 3000 },
      ],
    };
  }

  it("scrubs only the matching line's text, leaves everything else untouched, and does not mutate the input", () => {
    const unit = makeUnit();
    const snapshot = structuredClone(unit);

    const scrubbed = scrubUnitLines(unit, ["Dina"]);

    expect(scrubbed).not.toBe(unit);
    expect(scrubbed.unit_id).toBe(unit.unit_id);
    expect(scrubbed.window_ids).toEqual(unit.window_ids);
    expect(scrubbed.lines[0]?.text).toBe("Tolong ambil egg tart");
    expect(scrubbed.lines[1]?.text).toBe("[STAFF], tolong cek oven");
    expect(scrubbed.lines[2]?.text).toBe("Baik, sebentar");

    for (let i = 0; i < unit.lines.length; i += 1) {
      expect(scrubbed.lines[i]?.line_id).toBe(unit.lines[i]?.line_id);
      expect(scrubbed.lines[i]?.start_ms).toBe(unit.lines[i]?.start_ms);
      expect(scrubbed.lines[i]?.end_ms).toBe(unit.lines[i]?.end_ms);
    }

    // The input unit is never mutated.
    expect(unit).toEqual(snapshot);
  });
});

describe("scrubUnitLines is load-bearing for buildThreads (R-05a, no mocks)", () => {
  function makeUnit(): LabelUnit {
    return {
      unit_id: "unit_dev1_w1",
      window_ids: ["w1"],
      lines: [
        { line_id: "s1#0", seg_id: "s1", text: "Dina, tolong cek oven", start_ms: 0, end_ms: 1000 },
        { line_id: "s1#1", seg_id: "s1", text: "Baik, sebentar", start_ms: 1000, end_ms: 2000 },
        { line_id: "s1#2", seg_id: "s1", text: "Sudah dicek, Dina", start_ms: 2000, end_ms: 3000 },
      ],
    };
  }

  const label: LabelOutput = {
    lines: [
      { i: 0, reply_to: null, thread: "T1" },
      { i: 1, reply_to: 0, thread: "T1" },
      { i: 2, reply_to: 1, thread: "T1" },
    ],
    threads: [
      {
        id: "T1",
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence: [0],
        summary: "Checked the oven",
      },
    ],
    non_work_lines: [],
  };

  it("(a) keeps the staff name out of buildThreads's stored text when the unit was scrubbed first", () => {
    const scrubbedUnit = scrubUnitLines(makeUnit(), ["Dina"]);
    const built = buildThreads({ unit: scrubbedUnit, label, open_threads: [] });
    expect(JSON.stringify(built)).not.toMatch(/dina/i);
  });

  it("(b) proves the scrub is load-bearing: the UNSCRUBBED unit leaks the name through buildThreads", () => {
    const built = buildThreads({ unit: makeUnit(), label, open_threads: [] });
    expect(JSON.stringify(built)).toMatch(/dina/i);
  });
});

describe("scrubUnitLines feeding buildLabelPrompt", () => {
  const config = loadCategoriesConfig("config/categories.draft.yaml");

  it("keeps the staff name out of the prompt's userContent", () => {
    const unit: LabelUnit = {
      unit_id: "unit_dev1_w1",
      window_ids: ["w1"],
      lines: [
        { line_id: "s1#0", seg_id: "s1", text: "Dina, tolong cek oven", start_ms: 0, end_ms: 1000 },
      ],
    };
    const scrubbedUnit = scrubUnitLines(unit, ["Dina"]);
    const prompt = buildLabelPrompt({ config, unit: scrubbedUnit, open_threads: [] });
    expect(prompt.userContent).not.toMatch(/dina/i);
  });
});
