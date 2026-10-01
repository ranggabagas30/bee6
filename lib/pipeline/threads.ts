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
 * Uses union-find over reply_to + thread hints.
 * Drops invalid edges. Strips NON_WORK lines entirely (both explicit and by category).
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

  // Build a map of label lines by index
  const labelLinesByI = new Map<number, (typeof label.lines)[number]>();
  const nonWorkSet = new Set<number>(label.non_work_lines);
  let droppedEdges = 0;

  for (const labelLine of label.lines) {
    labelLinesByI.set(labelLine.i, labelLine);
  }

  // Find all NON_WORK thread IDs and add their lines to nonWorkSet
  const nonWorkThreadIds = new Set<string>();
  for (const thread of label.threads) {
    if (thread.category === "NON_WORK") {
      nonWorkThreadIds.add(thread.id);
    }
  }

  for (const labelLine of label.lines) {
    if (nonWorkThreadIds.has(labelLine.thread)) {
      nonWorkSet.add(labelLine.i);
    }
  }

  // Union-find for thread membership
  const parent = new Map<number, number>();
  for (const labelLine of label.lines) {
    if (!nonWorkSet.has(labelLine.i)) {
      parent.set(labelLine.i, labelLine.i);
    }
  }

  // Process reply_to edges
  for (const labelLine of label.lines) {
    if (nonWorkSet.has(labelLine.i) || labelLine.reply_to === null) continue;

    // Validate reply_to: 0 <= reply_to < i (not >= label.lines.length, not self, not NON_WORK)
    if (
      labelLine.reply_to < 0 ||
      labelLine.reply_to >= labelLine.i ||
      nonWorkSet.has(labelLine.reply_to)
    ) {
      droppedEdges += 1;
      continue;
    }

    // Union
    const root1 = find(parent, labelLine.i);
    const root2 = find(parent, labelLine.reply_to);
    if (root1 !== root2 && parent.has(root1) && parent.has(root2)) {
      parent.set(root2, root1);
    }
  }

  // Process thread hints for cross-window continuation and union
  for (const labelLine of label.lines) {
    if (nonWorkSet.has(labelLine.i)) continue;

    // Find all other lines with the same thread hint
    for (const otherLine of label.lines) {
      if (nonWorkSet.has(otherLine.i) || otherLine.i === labelLine.i) continue;

      if (otherLine.thread === labelLine.thread) {
        // Union these lines
        const root1 = find(parent, labelLine.i);
        const root2 = find(parent, otherLine.i);
        if (root1 !== root2 && parent.has(root1) && parent.has(root2)) {
          parent.set(root2, root1);
        }
      }
    }

    // Check for cross-window join via open threads
    const unitLine = unit.lines[labelLine.i];
    if (!unitLine) continue;

    for (const openThread of open_threads) {
      if (labelLine.thread === openThread.thread_id &&
          canMergeViaGrace(unitLine.start_ms, openThread, openThread.category)) {
        // This line can merge with an open thread
        // Mark it for continuation (the caller knows to check continued_from_open)
      }
    }
  }

  // Build thread components
  const components = new Map<number, number[]>();
  for (const i of parent.keys()) {
    const root = find(parent, i);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root)!.push(i);
  }

  // Map threads
  const threads: BuiltThread[] = [];
  const assignedLines = new Set<number>();

  for (const lineIndices of components.values()) {
    if (lineIndices.length === 0) continue;

    // Determine category and properties for this component
    const categories = new Set<Category>();
    let threadId = "";
    let minConfidence = Infinity;
    let summary = "";
    const allEvidenceIndices = new Set<number>();
    let runnerUp: { category: Category; why_not: string } | undefined;
    let fields: Record<string, unknown> | undefined;
    let lowestI = Infinity;

    for (const idx of lineIndices) {
      assignedLines.add(idx);
      const labelLine = labelLinesByI.get(idx);
      if (!labelLine) continue;

      const threadObj = label.threads.find((t) => t.id === labelLine.thread);
      if (!threadObj) continue;

      categories.add(threadObj.category as Category);
      lowestI = Math.min(lowestI, idx);

      // Union confidence (take minimum)
      if (!isNaN(threadObj.confidence)) {
        minConfidence = Math.min(minConfidence, threadObj.confidence);
      }

      // Keep first summary
      if (!summary && threadObj.summary) {
        summary = threadObj.summary;
      }

      // Union evidence indices
      for (const evidenceIdx of threadObj.evidence) {
        allEvidenceIndices.add(evidenceIdx);
      }

      // Keep first runner_up and fields found
      if (!runnerUp && threadObj.runner_up) {
        runnerUp = threadObj.runner_up as { category: Category; why_not: string };
      }
      if (!fields && threadObj.fields) {
        fields = threadObj.fields;
      }

      // Use the first thread ID found, or fallback to first line's thread ID
      if (!threadId && threadObj.id) {
        threadId = threadObj.id;
      }
    }

    // Validate category (no NON_WORK should reach here, but be defensive)
    const workCategories = Array.from(categories).filter((c) => c !== "NON_WORK") as WorkCategory[];
    if (workCategories.length === 0) continue; // Skip if all NON_WORK

    const label_conflict = workCategories.length > 1 || categories.size > workCategories.length;
    const category = workCategories[0] || "ROUTINE_OPS";

    // Build line lists
    const line_ids: string[] = [];
    const evidence_line_ids: string[] = [];
    const lines: Pick<TimedLine, "line_id" | "start_ms" | "end_ms" | "text">[] = [];
    let firstStart = Infinity;
    let lastEnd = 0;

    for (const idx of lineIndices) {
      const unitLine = unit.lines[idx];
      if (!unitLine) continue;

      line_ids.push(unitLine.line_id);
      firstStart = Math.min(firstStart, unitLine.start_ms);
      lastEnd = Math.max(lastEnd, unitLine.end_ms);

      if (allEvidenceIndices.has(idx)) {
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

    const confidence = isFinite(minConfidence) ? minConfidence : 0;

    const thread: BuiltThread = {
      thread_id: threadId || `thread_${lowestI === Infinity ? 0 : lowestI}`,
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
  for (let i = 0; i < unit.lines.length; i += 1) {
    if (!assignedLines.has(i) && !nonWorkSet.has(i) && !labelLinesByI.has(i)) {
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

function find(parent: Map<number, number>, x: number): number {
  const p = parent.get(x);
  if (p !== undefined && p !== x) {
    parent.set(x, find(parent, p));
  }
  return parent.get(x) ?? x;
}

function canMergeViaGrace(
  lineStartMs: number,
  openThread: OpenThread,
  currentCategory: WorkCategory
): boolean {
  if (openThread.category !== currentCategory) return false;
  const gap = lineStartMs - openThread.last_line_end_ms;
  const graceMs = GRACE_MS[currentCategory];
  return gap <= graceMs;
}
