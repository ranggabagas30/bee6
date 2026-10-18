import { describe, expect, it } from "vitest";
import { buildOpenContinuations } from "@/lib/pipeline/tick/continuation";
import { GRACE_MS } from "@/lib/pipeline/categories";
import type { LabelOutput, OpenThread } from "@/lib/pipeline/threads";
import type { LabelUnit } from "@/lib/pipeline/windowing";

const OPEN: OpenThread = { thread_id: "u0:T1", category: "ROUTINE_OPS", last_line_end_ms: 10_000 };

function unitOf(lines: Array<{ id: string; start: number; end: number }>): LabelUnit {
  return {
    unit_id: "u1",
    window_ids: ["w1"],
    lines: lines.map((l) => ({ line_id: l.id, start_ms: l.start, end_ms: l.end, text: `text ${l.id}` })),
  } as unknown as LabelUnit;
}

function labelOf(lines: Array<{ i: number; thread: string }>): LabelOutput {
  return {
    lines: lines.map((l) => ({ i: l.i, reply_to: null, thread: l.thread })),
    threads: [],
    non_work_lines: [],
  };
}

describe("buildOpenContinuations (QA 18 Oct DEFECT 1)", () => {
  it("turns one unassigned line hinting an open thread within grace into a continuation", () => {
    const out = buildOpenContinuations({
      unit: unitOf([{ id: "s2#0", start: 15_000, end: 25_000 }]),
      label: labelOf([{ i: 0, thread: OPEN.thread_id }]),
      openThreads: [OPEN],
      unassignedLineIds: ["s2#0"],
      alreadyBuiltIds: new Set(),
    });
    expect(out).toHaveLength(1);
    const t = out[0]!;
    expect(t.thread_id).toBe("u0:T1");
    expect(t.category).toBe("ROUTINE_OPS");
    expect(t.confidence).toBe(1);
    expect(t.line_ids).toEqual(["s2#0"]);
    expect(t.evidence_line_ids).toEqual(["s2#0"]);
    expect(t.lines).toEqual([{ line_id: "s2#0", start_ms: 15_000, end_ms: 25_000, text: "text s2#0" }]);
    expect(t.first_line_start_ms).toBe(15_000);
    expect(t.last_line_end_ms).toBe(25_000);
    expect(t.summary).toBe("");
    expect(t.label_conflict).toBe(false);
    expect(t.continued_from_open).toBe(true);
  });

  it("ignores a hint that is not an offered open thread", () => {
    const out = buildOpenContinuations({
      unit: unitOf([{ id: "s2#0", start: 15_000, end: 25_000 }]),
      label: labelOf([{ i: 0, thread: "T2" }]),
      openThreads: [OPEN],
      unassignedLineIds: ["s2#0"],
      alreadyBuiltIds: new Set(),
    });
    expect(out).toEqual([]);
  });

  it("ignores a line that is not unassigned (already in a built thread)", () => {
    const out = buildOpenContinuations({
      unit: unitOf([{ id: "s2#0", start: 15_000, end: 25_000 }]),
      label: labelOf([{ i: 0, thread: OPEN.thread_id }]),
      openThreads: [OPEN],
      unassignedLineIds: [],
      alreadyBuiltIds: new Set(),
    });
    expect(out).toEqual([]);
  });

  it("skips an open thread buildThreads already continued", () => {
    const out = buildOpenContinuations({
      unit: unitOf([{ id: "s2#0", start: 15_000, end: 25_000 }]),
      label: labelOf([{ i: 0, thread: OPEN.thread_id }]),
      openThreads: [OPEN],
      unassignedLineIds: ["s2#0"],
      alreadyBuiltIds: new Set([OPEN.thread_id]),
    });
    expect(out).toEqual([]);
  });

  it("rejects a negative gap and a gap beyond grace; accepts the exact grace edge", () => {
    const base = {
      label: labelOf([{ i: 0, thread: OPEN.thread_id }]),
      openThreads: [OPEN],
      unassignedLineIds: ["s2#0"],
      alreadyBuiltIds: new Set<string>(),
    };
    const negative = buildOpenContinuations({ ...base, unit: unitOf([{ id: "s2#0", start: 9_999, end: 12_000 }]) });
    expect(negative).toEqual([]);
    const start = OPEN.last_line_end_ms + GRACE_MS.ROUTINE_OPS;
    const edge = buildOpenContinuations({ ...base, unit: unitOf([{ id: "s2#0", start, end: start + 1000 }]) });
    expect(edge).toHaveLength(1);
    const over = buildOpenContinuations({ ...base, unit: unitOf([{ id: "s2#0", start: start + 1, end: start + 1000 }]) });
    expect(over).toEqual([]);
  });

  it("groups lines per open thread and ignores the other group's lines", () => {
    const other: OpenThread = { thread_id: "u0:T9", category: "COMPLAINT", last_line_end_ms: 5_000 };
    const out = buildOpenContinuations({
      unit: unitOf([
        { id: "a#0", start: 12_000, end: 14_000 },
        { id: "b#0", start: 20_000, end: 22_000 },
        { id: "c#0", start: 30_000, end: 33_000 },
      ]),
      label: labelOf([
        { i: 0, thread: OPEN.thread_id },
        { i: 1, thread: other.thread_id },
        { i: 2, thread: OPEN.thread_id },
      ]),
      openThreads: [OPEN, other],
      unassignedLineIds: ["a#0", "b#0", "c#0"],
      alreadyBuiltIds: new Set(),
    });
    expect(out).toHaveLength(2);
    const t1 = out.find((t) => t.thread_id === OPEN.thread_id)!;
    expect(t1.line_ids).toEqual(["a#0", "c#0"]);
    expect(t1.first_line_start_ms).toBe(12_000);
    expect(t1.last_line_end_ms).toBe(33_000);
    const t9 = out.find((t) => t.thread_id === other.thread_id)!;
    expect(t9.line_ids).toEqual(["b#0"]);
    expect(t9.category).toBe("COMPLAINT");
  });

  it("uses the first label entry for a duplicate i, like buildThreads", () => {
    const out = buildOpenContinuations({
      unit: unitOf([{ id: "s2#0", start: 15_000, end: 25_000 }]),
      label: labelOf([
        { i: 0, thread: "T2" },
        { i: 0, thread: OPEN.thread_id },
      ]),
      openThreads: [OPEN],
      unassignedLineIds: ["s2#0"],
      alreadyBuiltIds: new Set(),
    });
    expect(out).toEqual([]);
  });

  it("ignores out-of-range label indices", () => {
    const out = buildOpenContinuations({
      unit: unitOf([{ id: "s2#0", start: 15_000, end: 25_000 }]),
      label: labelOf([{ i: 5, thread: OPEN.thread_id }]),
      openThreads: [OPEN],
      unassignedLineIds: ["s2#0"],
      alreadyBuiltIds: new Set(),
    });
    expect(out).toEqual([]);
  });
});
