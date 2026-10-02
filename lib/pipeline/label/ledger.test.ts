import { describe, expect, it } from "vitest";
import { filterUnlabelledLines } from "@/lib/pipeline/label/ledger";
import type { LabelUnit } from "@/lib/pipeline/windowing";

function makeUnit(n: number): LabelUnit {
  return {
    unit_id: "unit_dev1_w1",
    window_ids: ["w1"],
    lines: Array.from({ length: n }, (_, i) => ({
      line_id: `s1#${i}`,
      seg_id: "s1",
      text: `line ${i}`,
      start_ms: i * 1000,
      end_ms: i * 1000 + 900,
    })),
  };
}

describe("filterUnlabelledLines", () => {
  it("returns null when every line is already labelled — nothing to do", () => {
    const unit = makeUnit(3);
    const labelled = new Set(unit.lines.map((l) => l.line_id));
    expect(filterUnlabelledLines(unit, labelled)).toBeNull();
  });

  it("returns the exact same unit object when no line is labelled (reference-stable, no copy)", () => {
    const unit = makeUnit(3);
    const result = filterUnlabelledLines(unit, new Set());
    expect(result).toBe(unit);
  });

  it("returns a new unit with only the unlabelled lines when some are already labelled", () => {
    const unit = makeUnit(5);
    const labelled = new Set([unit.lines[0]!.line_id, unit.lines[2]!.line_id]);

    const result = filterUnlabelledLines(unit, labelled);

    expect(result).not.toBeNull();
    expect(result!.lines.map((l) => l.line_id)).toEqual(["s1#1", "s1#3", "s1#4"]);
    expect(result!.window_ids).toEqual(unit.window_ids);
    expect(result!.unit_id).not.toBe(unit.unit_id);
    expect(result!.unit_id.startsWith(`${unit.unit_id}~late~`)).toBe(true);
  });

  it("derives the same ~late~ unit_id deterministically for the same unlabelled slice", () => {
    const unit = makeUnit(5);
    const labelled = new Set([unit.lines[0]!.line_id, unit.lines[2]!.line_id]);

    const first = filterUnlabelledLines(unit, labelled);
    const second = filterUnlabelledLines(unit, labelled);

    expect(first!.unit_id).toBe(second!.unit_id);
  });

  it("derives a different unit_id for a different unlabelled slice of the same unit", () => {
    const unit = makeUnit(5);
    const resultA = filterUnlabelledLines(unit, new Set([unit.lines[0]!.line_id]));
    const resultB = filterUnlabelledLines(unit, new Set([unit.lines[1]!.line_id]));

    expect(resultA!.unit_id).not.toBe(resultB!.unit_id);
  });
});
