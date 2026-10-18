import { GRACE_MS } from "@/lib/pipeline/categories";
import type { BuiltThread, LabelOutput, OpenThread } from "@/lib/pipeline/threads";
import type { LabelUnit } from "@/lib/pipeline/windowing";

/**
 * QA 18 Oct DEFECT 1. The label prompt lists a thread in `threads[]` only for a NEW alias, so a line that continues an
 * offered open thread (`O#`, already remapped to the real thread id) has no `threads[]` entry. `buildThreads` cannot
 * resolve its category and reports it in `unassigned_line_ids`. Before this, the tick ignored that list, so the line was
 * lost (its ledger row is `done`). This turns each group of such lines into a continuation of that open thread: the open
 * thread's id and category, confidence 1 (so `mergeThread`'s min keeps the stored confidence), the lines as evidence, and
 * an empty summary (so `mergeThread` keeps the stored one). Plain code, no model (hard rule #10). Unassigned lines whose
 * hint is not an offered open thread stay unassigned, as before.
 */
export function buildOpenContinuations(input: {
  unit: LabelUnit; // the SCRUBBED unit buildThreads saw
  label: LabelOutput; // the REMAPPED label buildThreads saw
  openThreads: readonly OpenThread[];
  unassignedLineIds: readonly string[];
  alreadyBuiltIds: ReadonlySet<string>;
}): BuiltThread[] {
  const unassigned = new Set(input.unassignedLineIds);
  const hintByIndex = new Map<number, string>();
  for (const l of input.label.lines) {
    if (l.i < 0 || l.i >= input.unit.lines.length) continue;
    if (!hintByIndex.has(l.i)) hintByIndex.set(l.i, l.thread); // first wins, same as buildThreads
  }
  const result: BuiltThread[] = [];
  for (const ot of input.openThreads) {
    if (input.alreadyBuiltIds.has(ot.thread_id)) continue; // defensive: buildThreads already continued it
    const members = input.unit.lines.filter(
      (line, i) => unassigned.has(line.line_id) && hintByIndex.get(i) === ot.thread_id,
    );
    if (members.length === 0) continue;
    const firstStart = Math.min(...members.map((m) => m.start_ms));
    const gap = firstStart - ot.last_line_end_ms;
    if (gap < 0 || gap > GRACE_MS[ot.category]) continue; // same join rule as buildThreads
    const lineIds = members.map((m) => m.line_id);
    result.push({
      thread_id: ot.thread_id,
      category: ot.category,
      confidence: 1,
      line_ids: lineIds,
      evidence_line_ids: lineIds,
      lines: members.map((m) => ({ line_id: m.line_id, start_ms: m.start_ms, end_ms: m.end_ms, text: m.text })),
      first_line_start_ms: firstStart,
      last_line_end_ms: Math.max(...members.map((m) => m.end_ms)),
      summary: "",
      label_conflict: false,
      continued_from_open: true,
    });
  }
  return result;
}
