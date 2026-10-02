import type { LabelClientResult } from "@/lib/pipeline/label/client";
import type { LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import type { LabelUnit } from "@/lib/pipeline/windowing";

/**
 * Failure-to-question mapping (R-05b, Task 4). Every label-call outcome
 * becomes exactly one of: ok, retry, or failed — never a crash, never a
 * silently-dropped unit (review focus #4). `buildFailedUnitQuestion` never
 * carries a raw error message or raw model response into a stored
 * question — only the unit's own window timestamps and a fixed `kind`
 * string, same discipline as Task 3's fallback summary template.
 */

export type UnitOutcome =
  | { kind: "retry" }
  | { kind: "ok"; wire: LabelWireOutput }
  | { kind: "failed"; reason: string };

/**
 * `retryable_error` (network/upstream failures) gets up to `maxAttempts`
 * tries. `parse_error` (malformed JSON or a wire-shape zod failure) gets
 * exactly ONE retry regardless of `maxAttempts` — a model that returns
 * invalid output twice in a row with the same prompt is unlikely to
 * self-correct with a third try (review focus #4: "one retry, then
 * failed").
 */
export function mapToUnitOutcome(input: {
  result: LabelClientResult;
  attempt: number;
  maxAttempts: number;
}): UnitOutcome {
  const { result, attempt, maxAttempts } = input;

  if (result.kind === "ok") {
    return { kind: "ok", wire: result.wire };
  }

  if (result.kind === "retryable_error") {
    return attempt < maxAttempts ? { kind: "retry" } : { kind: "failed", reason: "retryable_error" };
  }

  // parse_error
  return attempt <= 1 ? { kind: "retry" } : { kind: "failed", reason: "invalid_response" };
}

/**
 * Builds the single debrief question for a unit whose label call ultimately
 * failed. Deterministic (same unit -> same `question_id`) and carries only
 * the unit's own window timestamps — never the raw error or raw model
 * response that caused the failure.
 */
export function buildFailedUnitQuestion(unit: LabelUnit): {
  question_id: string;
  kind: "unlabelled_unit";
  status: "open";
  window_start_ms: number;
  window_end_ms: number;
} {
  const starts = unit.lines.map((line) => line.start_ms);
  const ends = unit.lines.map((line) => line.end_ms);

  return {
    question_id: `q_${unit.unit_id}`,
    kind: "unlabelled_unit",
    status: "open",
    window_start_ms: starts.length > 0 ? Math.min(...starts) : 0,
    window_end_ms: ends.length > 0 ? Math.max(...ends) : 0,
  };
}
