import { describe, expect, it } from "vitest";
import { buildFailedUnitQuestion, mapToUnitOutcome } from "@/lib/pipeline/label/failure";
import type { LabelClientResult } from "@/lib/pipeline/label/client";
import type { LabelUnit } from "@/lib/pipeline/windowing";

const OK_RESULT: LabelClientResult = {
  kind: "ok",
  wire: {
    lines: [{ i: 0, reply_to: null, thread: "T1" }],
    threads: [
      { id: "T1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "Checked the oven" },
    ],
    non_work_lines: [],
  },
};

const RETRYABLE_RESULT: LabelClientResult = {
  kind: "retryable_error",
  error: { class: "timeout" },
};

const PARSE_ERROR_RESULT: LabelClientResult = {
  kind: "parse_error",
  issues: [{ code: "custom", path: [], message: "a secret raw model response leaked here" } as never],
};

describe("mapToUnitOutcome", () => {
  it("passes through an ok result unchanged", () => {
    const outcome = mapToUnitOutcome({ result: OK_RESULT, attempt: 1, maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "ok", wire: OK_RESULT.kind === "ok" ? OK_RESULT.wire : undefined });
  });

  it("a network timeout on attempt 1 of 3 maps to retry", () => {
    const outcome = mapToUnitOutcome({ result: RETRYABLE_RESULT, attempt: 1, maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "retry" });
  });

  it("a retryable error on the final attempt maps to failed", () => {
    const outcome = mapToUnitOutcome({ result: RETRYABLE_RESULT, attempt: 3, maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "failed", reason: "retryable_error" });
  });

  it("a zod parse failure on attempt 1 maps to retry (one immediate re-ask)", () => {
    const outcome = mapToUnitOutcome({ result: PARSE_ERROR_RESULT, attempt: 1, maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "retry" });
  });

  it("the SAME parse failure on attempt 2 maps to failed — never a second retry, even with maxAttempts left", () => {
    const outcome = mapToUnitOutcome({ result: PARSE_ERROR_RESULT, attempt: 2, maxAttempts: 3 });
    expect(outcome).toEqual({ kind: "failed", reason: "invalid_response" });
  });

  it("never leaks the raw issue data into the outcome", () => {
    const outcome = mapToUnitOutcome({ result: PARSE_ERROR_RESULT, attempt: 2, maxAttempts: 3 });
    expect(JSON.stringify(outcome)).not.toMatch(/secret raw model response/);
  });
});

describe("buildFailedUnitQuestion", () => {
  function makeUnit(): LabelUnit {
    return {
      unit_id: "unit_dev1_w1",
      window_ids: ["w1"],
      lines: [
        { line_id: "s1#0", seg_id: "s1", text: "line a", start_ms: 1000, end_ms: 2000 },
        { line_id: "s1#1", seg_id: "s1", text: "line b", start_ms: 2000, end_ms: 4500 },
      ],
    };
  }

  it("contains only the unit's own window timestamps and a fixed kind — nothing from an error or response", () => {
    const question = buildFailedUnitQuestion(makeUnit());

    expect(Object.keys(question).sort()).toEqual(
      ["kind", "question_id", "status", "window_end_ms", "window_start_ms"].sort(),
    );
    expect(question.kind).toBe("unlabelled_unit");
    expect(question.status).toBe("open");
    expect(question.window_start_ms).toBe(1000);
    expect(question.window_end_ms).toBe(4500);
    expect(typeof question.question_id).toBe("string");
    expect(question.question_id.length).toBeGreaterThan(0);
  });

  it("is deterministic — the same unit always produces the same question_id", () => {
    const a = buildFailedUnitQuestion(makeUnit());
    const b = buildFailedUnitQuestion(makeUnit());
    expect(a.question_id).toBe(b.question_id);
  });
});
