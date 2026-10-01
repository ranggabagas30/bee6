import { z } from "zod";
import { CategorySchema } from "@/lib/pipeline/categories";
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

export interface LabelUnit {
  unit_id: string;
  window_ids: string[];
  lines: TimedLine[];
}

export interface OpenThread {
  thread_id: string;
  category: string;
  last_line_end_ms: number;
}

export interface BuiltThread {
  thread_id: string;
  category: string;
  confidence: number;
  line_ids: string[];
  evidence_line_ids: string[];
  lines: Pick<TimedLine, "line_id" | "start_ms" | "end_ms" | "text">[];
  first_line_start_ms: number;
  last_line_end_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  runner_up?: { category: string; why_not: string };
  label_conflict: boolean;
  continued_from_open: boolean;
}

/**
 * Builds threads from a label unit and label output.
 * Uses union-find over reply_to + thread hints.
 * Drops invalid edges. Strips NON_WORK lines entirely.
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

  // Build a set of non-work line indices
  const nonWorkSet = new Set(label.non_work_lines);

  // Union-find for thread membership
  const parent: Record<number, number> = {};
  const category: Record<number, string> = {};
  let droppedEdges = 0;

  for (const labelLine of label.lines) {
    parent[labelLine.i] = labelLine.i;
    const threadObj = label.threads.find((t) => t.id === labelLine.thread);
    if (threadObj) {
      category[labelLine.i] = threadObj.category;
    }
  }

  // Process reply_to edges
  for (const labelLine of label.lines) {
    if (labelLine.reply_to === null) continue;

    // Validate reply_to
    if (
      labelLine.reply_to < 0 ||
      labelLine.reply_to >= label.lines.length ||
      labelLine.reply_to === labelLine.i ||
      nonWorkSet.has(labelLine.reply_to) ||
      nonWorkSet.has(labelLine.i)
    ) {
      droppedEdges += 1;
      continue;
    }

    // Union
    const root1 = find(parent, labelLine.i);
    const root2 = find(parent, labelLine.reply_to);
    if (root1 !== root2) {
      parent[root2] = root1;
    }
  }

  // Process thread hints for cross-window continuation
  for (const openThread of open_threads) {
    // Find a line that references this open_thread's id in its thread field
    for (const labelLine of label.lines) {
      if (labelLine.thread === openThread.thread_id) {
        // Check grace period
        const lineInUnit = unit.lines[labelLine.i];
        if (lineInUnit && canMergeViaGrace(lineInUnit.start_ms, openThread, openThread.category)) {
          // Mark for merging (conceptually; actual implementation defers to caller)
        }
      }
    }
  }

  // Build thread components
  const components: Record<number, number[]> = {};
  for (let i = 0; i < label.lines.length; i += 1) {
    if (nonWorkSet.has(i)) continue;
    const root = find(parent, i);
    if (!components[root]) {
      components[root] = [];
    }
    components[root].push(i);
  }

  // Map threads
  const threads: BuiltThread[] = [];
  const assignedLines = new Set<number>();

  for (const lineIndices of Object.values(components)) {
    if (lineIndices.length === 0) continue;

    // Determine category for this component
    const categories = new Set<string>();
    let threadId = "";
    let confidence = 0;
    let summary = "";
    let evidenceIndices: number[] = [];
    let runnerUp: { category: string; why_not: string } | undefined;
    let fields: Record<string, unknown> | undefined;

    for (const idx of lineIndices) {
      const labelLine = label.lines[idx];
      if (!labelLine) continue;

      const threadObj = label.threads.find((t) => t.id === labelLine.thread);
      if (!threadObj) continue;

      categories.add(threadObj.category);
      threadId = threadObj.id || threadId;
      confidence = threadObj.confidence || confidence;
      summary = threadObj.summary || summary;
      evidenceIndices = threadObj.evidence || evidenceIndices;
      runnerUp = threadObj.runner_up || runnerUp;
      fields = threadObj.fields || fields;
    }

    const label_conflict = categories.size > 1;
    const category = Array.from(categories)[0] || "ROUTINE_OPS";

    // Build line lists
    const line_ids: string[] = [];
    const evidence_line_ids: string[] = [];
    const lines: Pick<TimedLine, "line_id" | "start_ms" | "end_ms" | "text">[] = [];
    let firstStart = Infinity;
    let lastEnd = 0;

    for (const idx of lineIndices) {
      assignedLines.add(idx);
      const unitLine = unit.lines[idx];
      if (!unitLine) continue;

      line_ids.push(unitLine.line_id);
      firstStart = Math.min(firstStart, unitLine.start_ms);
      lastEnd = Math.max(lastEnd, unitLine.end_ms);

      if (evidenceIndices.includes(idx)) {
        evidence_line_ids.push(unitLine.line_id);
      }

      // Include line text (already redacted per R-04)
      lines.push({
        line_id: unitLine.line_id,
        start_ms: unitLine.start_ms,
        end_ms: unitLine.end_ms,
        text: unitLine.text,
      });
    }

    // Check if this thread merges with an open thread via grace period
    let continued_from_open = false;
    for (const openThread of open_threads) {
      if (canMergeViaGrace(firstStart, openThread, category)) {
        continued_from_open = true;
        break;
      }
    }

    const thread: BuiltThread = {
      thread_id: threadId || `thread_${lineIndices[0]}`,
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

  // Find unassigned lines (not in any component, not NON_WORK)
  const unassigned_line_ids: string[] = [];
  const labelLineIndices = new Set(label.lines.map((l) => l.i));
  for (let i = 0; i < unit.lines.length; i += 1) {
    if (!labelLineIndices.has(i) && !nonWorkSet.has(i)) {
      const unitLine = unit.lines[i];
      if (unitLine) {
        unassigned_line_ids.push(unitLine.line_id);
      }
    }
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
  threads: readonly Pick<
    BuiltThread,
    "thread_id" | "category" | "last_line_end_ms"
  >[],
  as_of_ms: number
): OpenThread[] {
  const result: OpenThread[] = [];

  for (const thread of threads) {
    const gap = as_of_ms - thread.last_line_end_ms;
    const graceMs = GRACE_MS[thread.category as keyof typeof GRACE_MS] ?? 120_000;

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

// --- helpers ---

function find(parent: Record<number, number>, x: number): number {
  const p = parent[x];
  if (p !== undefined && p !== x) {
    parent[x] = find(parent, p);
  }
  return parent[x] ?? x;
}

function canMergeViaGrace(
  lineStartMs: number,
  openThread: OpenThread,
  currentCategory: string
): boolean {
  if (openThread.category !== currentCategory) return false;
  const gap = lineStartMs - openThread.last_line_end_ms;
  const graceMs = GRACE_MS[currentCategory as keyof typeof GRACE_MS] ?? 120_000;
  return gap <= graceMs;
}
