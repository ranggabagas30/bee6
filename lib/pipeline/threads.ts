import { z } from "zod";
import { CategorySchema, type Category, type WorkCategory } from "@/lib/pipeline/categories";
import { GRACE_MS } from "@/lib/pipeline/categories";
import type { TimedLine } from "@/lib/pipeline/windowing";

/**
 * Thread builder (E3 in pipeline spec). Turns labeled lines into threads
 * using union-find over reply_to + thread hints. NON_WORK text never
 * persists. Pure functions, no I/O.
 */

export const LabelOutputSchema = z.object({
  lines: z.array(
    z.object({
      i: z.number().int().min(0),
      reply_to: z.number().int().min(0).nullable(),
      thread: z.string().min(1),
    })
  ),
  threads: z.array(
    z.object({
      id: z.string().min(1),
      category: CategorySchema,
      confidence: z.number(),
      evidence: z.array(z.number().int().min(0)),
      runner_up: z
        .object({ category: CategorySchema, why_not: z.string() })
        .optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
      summary: z.string(),
    })
  ),
  non_work_lines: z.array(z.number().int().min(0)),
});

export type LabelOutput = z.infer<typeof LabelOutputSchema>;
type LabelLine = LabelOutput["lines"][number];

export interface LabelUnit {
  unit_id: string;
  window_ids: string[];
  lines: TimedLine[];
}

export interface OpenThread {
  thread_id: string;
  category: WorkCategory;
  last_line_end_ms: number;
}

export interface BuiltThread {
  thread_id: string;
  category: WorkCategory;
  confidence: number;
  line_ids: string[];
  evidence_line_ids: string[];
  lines: Pick<TimedLine, "line_id" | "start_ms" | "end_ms" | "text">[];
  first_line_start_ms: number;
  last_line_end_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  runner_up?: { category: Category; why_not: string };
  label_conflict: boolean;
  continued_from_open: boolean;
}

/**
 * Builds threads from a label unit and label output.
 * Uses union-find over reply_to + thread hints. Drops invalid edges.
 * Strips NON_WORK lines entirely (both explicit and by category).
 *
 * Cross-window join: a component continues an `open_threads` entry only if
 * (a) some member line's `thread` hint equals that open thread's `thread_id`,
 * (b) the component's resolved category equals the open thread's category
 *     (never checked when the component itself has a label_conflict), and
 * (c) the gap from the open thread's `last_line_end_ms` to the component's
 *     EARLIEST member line start is in [0, grace] inclusive (negative gaps
 *     are rejected, never clamped). Otherwise the component gets a fresh
 *     id namespaced to this unit — a bare model-assigned thread id is never
 *     used as the final thread_id, because those ids repeat across units.
 */
export function buildThreads(input: {
  unit: LabelUnit;
  label: LabelOutput;
  open_threads: readonly OpenThread[];
}): {
  threads: BuiltThread[];
  non_work_line_count: number;
  dropped_edge_count: number;
  unassigned_line_ids: string[];
} {
  const { unit, label, open_threads } = input;
  const numLines = unit.lines.length;
  const openThreadsById = new Map(open_threads.map((ot) => [ot.thread_id, ot]));

  // Validate & index label lines by i; out-of-range i is dropped entirely
  // (it doesn't refer to a real line in this unit, so it can never be
  // "unassigned" either — it simply never existed as far as this unit goes).
  const labelLinesByI = new Map<number, LabelLine>();
  for (const ll of label.lines) {
    if (ll.i < 0 || ll.i >= numLines) continue;
    if (!labelLinesByI.has(ll.i)) {
      labelLinesByI.set(ll.i, ll);
    }
  }

  // NON_WORK set: explicit non_work_lines (range-validated) plus any line
  // whose thread hint points at a thread the model itself labeled NON_WORK.
  const nonWorkSet = new Set<number>();
  for (const idx of label.non_work_lines) {
    if (idx >= 0 && idx < numLines) nonWorkSet.add(idx);
  }
  const nonWorkThreadIds = new Set(
    label.threads.filter((t) => t.category === "NON_WORK").map((t) => t.id)
  );
  for (const [i, ll] of labelLinesByI) {
    if (nonWorkThreadIds.has(ll.thread)) nonWorkSet.add(i);
  }

  // Union-find over valid, non-NON_WORK line indices only.
  const parent = new Map<number, number>();
  for (const i of labelLinesByI.keys()) {
    if (!nonWorkSet.has(i)) parent.set(i, i);
  }

  const find = (x: number): number => {
    const p = parent.get(x);
    if (p === undefined) return x;
    if (p !== x) {
      const root = find(p);
      parent.set(x, root);
      return root;
    }
    return x;
  };

  const union = (a: number, b: number): void => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // reply_to edges: 0 <= reply_to < i, target must be a known valid line,
  // and neither endpoint may be NON_WORK. Every skip is counted.
  let droppedEdges = 0;
  for (const [i, ll] of labelLinesByI) {
    if (ll.reply_to === null) continue;
    const target = ll.reply_to;
    const targetKnownValid = target >= 0 && target < i && labelLinesByI.has(target);
    const sourceIsNonWork = nonWorkSet.has(i);
    const targetIsNonWork = targetKnownValid && nonWorkSet.has(target);
    if (!targetKnownValid || sourceIsNonWork || targetIsNonWork) {
      droppedEdges += 1;
      continue;
    }
    union(i, target);
  }

  // Shared thread-hint union, within this unit only (non-NON_WORK lines).
  const byHint = new Map<string, number[]>();
  for (const [i, ll] of labelLinesByI) {
    if (nonWorkSet.has(i)) continue;
    const arr = byHint.get(ll.thread);
    if (arr) arr.push(i);
    else byHint.set(ll.thread, [i]);
  }
  for (const idxs of byHint.values()) {
    for (let k = 1; k < idxs.length; k += 1) {
      const a = idxs[0];
      const b = idxs[k];
      if (a !== undefined && b !== undefined) union(a, b);
    }
  }

  // Build connected components.
  const components = new Map<number, number[]>();
  for (const i of parent.keys()) {
    const root = find(i);
    const arr = components.get(root);
    if (arr) arr.push(i);
    else components.set(root, [i]);
  }

  const threads: BuiltThread[] = [];
  const assignedLines = new Set<number>(); // lines actually emitted in a built thread

  for (const memberIdxs of components.values()) {
    memberIdxs.sort((a, b) => a - b);

    const categories = new Set<WorkCategory>();
    let minConfidence = Infinity;
    let anyInvalidConfidence = false;
    let summary = "";
    const evidenceIdxSet = new Set<number>();
    let runnerUp: { category: Category; why_not: string } | undefined;
    let fields: Record<string, unknown> | undefined;
    let modelThreadId: string | undefined;
    const resolved: number[] = [];

    for (const idx of memberIdxs) {
      const ll = labelLinesByI.get(idx);
      if (!ll) continue;

      const threadObj = label.threads.find((t) => t.id === ll.thread);
      let cat: WorkCategory | undefined;

      if (threadObj) {
        cat = threadObj.category as WorkCategory; // NON_WORK already excluded above
        if (!modelThreadId) modelThreadId = threadObj.id;
        if (
          Number.isFinite(threadObj.confidence) &&
          threadObj.confidence >= 0 &&
          threadObj.confidence <= 1
        ) {
          minConfidence = Math.min(minConfidence, threadObj.confidence);
        } else {
          anyInvalidConfidence = true;
        }
        if (!summary && threadObj.summary) summary = threadObj.summary;
        for (const e of threadObj.evidence) {
          if (e >= 0 && e < numLines) evidenceIdxSet.add(e);
        }
        if (!runnerUp && threadObj.runner_up) {
          runnerUp = threadObj.runner_up as { category: Category; why_not: string };
        }
        if (!fields && threadObj.fields) fields = threadObj.fields;
      } else {
        // Hint doesn't resolve via this call's label.threads[] — fall back
        // to an open thread's category if the hint matches one, so the line
        // is never silently lost.
        const ot = openThreadsById.get(ll.thread);
        if (!ot) continue; // genuinely unresolved; handled by the unassigned pass below
        cat = ot.category;
      }

      categories.add(cat);
      resolved.push(idx);
    }

    if (resolved.length === 0) continue; // nothing in this component could be resolved

    const label_conflict = categories.size > 1;
    let category: WorkCategory = Array.from(categories)[0] as WorkCategory;

    let continued_from_open = false;
    let threadId = modelThreadId ? `${unit.unit_id}:${modelThreadId}` : `${unit.unit_id}:${resolved[0]}`;

    if (!label_conflict) {
      const earliestStartMs = Math.min(
        ...resolved.map((i) => unit.lines[i]?.start_ms ?? Infinity)
      );
      for (const idx of resolved) {
        const ll = labelLinesByI.get(idx);
        if (!ll) continue;
        const ot = openThreadsById.get(ll.thread);
        if (!ot) continue;
        if (ot.category !== category) continue;
        const gap = earliestStartMs - ot.last_line_end_ms;
        const grace = GRACE_MS[ot.category];
        if (gap >= 0 && gap <= grace) {
          threadId = ot.thread_id;
          category = ot.category;
          continued_from_open = true;
          break;
        }
      }
    }

    const line_ids: string[] = [];
    const evidence_line_ids: string[] = [];
    const lines: Pick<TimedLine, "line_id" | "start_ms" | "end_ms" | "text">[] = [];
    let firstStart = Infinity;
    let lastEnd = 0;

    for (const idx of resolved) {
      const unitLine = unit.lines[idx];
      if (!unitLine) continue;

      assignedLines.add(idx);
      line_ids.push(unitLine.line_id);
      firstStart = Math.min(firstStart, unitLine.start_ms);
      lastEnd = Math.max(lastEnd, unitLine.end_ms);

      if (evidenceIdxSet.has(idx)) {
        evidence_line_ids.push(unitLine.line_id);
      }

      lines.push({
        line_id: unitLine.line_id,
        start_ms: unitLine.start_ms,
        end_ms: unitLine.end_ms,
        text: unitLine.text,
      });
    }

    if (line_ids.length === 0) continue;

    const confidence = anyInvalidConfidence ? NaN : isFinite(minConfidence) ? minConfidence : 0;

    const thread: BuiltThread = {
      thread_id: threadId,
      category,
      confidence,
      line_ids,
      evidence_line_ids,
      lines,
      first_line_start_ms: firstStart === Infinity ? 0 : firstStart,
      last_line_end_ms: lastEnd,
      summary,
      label_conflict,
      continued_from_open,
    };

    if (runnerUp) thread.runner_up = runnerUp;
    if (fields) thread.fields = fields;

    threads.push(thread);
  }

  // Unassigned: any non-NON_WORK line never actually emitted in a built
  // thread — whether the model never mentioned it at all, or its hint never
  // resolved to a category. Never computed from labelLinesByI membership
  // alone, so a resolved-but-unemitted line can't silently vanish.
  const unassigned_line_ids: string[] = [];
  for (let i = 0; i < numLines; i += 1) {
    if (nonWorkSet.has(i) || assignedLines.has(i)) continue;
    const unitLine = unit.lines[i];
    if (unitLine) unassigned_line_ids.push(unitLine.line_id);
  }

  return {
    threads,
    non_work_line_count: nonWorkSet.size,
    dropped_edge_count: droppedEdges,
    unassigned_line_ids,
  };
}

/**
 * Returns open threads that can still accept new lines via grace period.
 * Gap from last_line_end to as_of_ms must be <= GRACE_MS[category].
 */
export function openThreadsAt(
  threads: readonly Pick<BuiltThread, "thread_id" | "category" | "last_line_end_ms">[],
  as_of_ms: number
): OpenThread[] {
  const result: OpenThread[] = [];

  for (const thread of threads) {
    const gap = as_of_ms - thread.last_line_end_ms;
    const graceMs = GRACE_MS[thread.category];

    if (gap <= graceMs) {
      result.push({
        thread_id: thread.thread_id,
        category: thread.category,
        last_line_end_ms: thread.last_line_end_ms,
      });
    }
  }

  return result;
}
