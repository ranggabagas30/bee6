import { createHash } from "node:crypto";
import type { LabelUnit } from "@/lib/pipeline/windowing";

/**
 * Per-line ledger (R-05b, Task 5). A naive "has this unit been processed"
 * check would miss lines that arrive late into an ALREADY-processed unit
 * (the TSD's own G-1 finding, review focus #3) — a line that arrives after
 * its unit was already labelled must still get labelled exactly once,
 * never skipped, never duplicated.
 *
 * `filterUnlabelledLines` is the single function that decides, per tick,
 * which lines in a unit actually still need labelling.
 */

/** Deterministic short hash over a (sorted) set of line ids, so a retried tick never produces a different `~late~` unit_id for the same slice. */
function shortHash(lineIds: readonly string[]): string {
  const sorted = [...lineIds].sort();
  return createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 8);
}

/**
 * Returns:
 *  - `null` when every line in `unit` is already in `labelledLineIds`
 *    (nothing to do this tick);
 *  - the exact same `unit` object (reference-stable, no copy) when NO line
 *    is already labelled;
 *  - a NEW `LabelUnit` containing only the still-unlabelled lines, same
 *    `window_ids`, and a `unit_id` of
 *    `` `${unit.unit_id}~late~${shortHash(unlabelledLineIds)}` `` — derived
 *    deterministically from the unlabelled line ids, so a retried tick
 *    never creates a duplicate ledger entry for the same late slice.
 */
export function filterUnlabelledLines(
  unit: LabelUnit,
  labelledLineIds: ReadonlySet<string>,
): LabelUnit | null {
  const unlabelled = unit.lines.filter((line) => !labelledLineIds.has(line.line_id));

  if (unlabelled.length === 0) return null;
  if (unlabelled.length === unit.lines.length) return unit;

  const lineIds = unlabelled.map((line) => line.line_id);
  return {
    unit_id: `${unit.unit_id}~late~${shortHash(lineIds)}`,
    window_ids: unit.window_ids,
    lines: unlabelled,
  };
}
