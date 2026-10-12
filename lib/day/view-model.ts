import { CATEGORIES, type Category, type WorkCategory } from "@/lib/pipeline/categories";
import type { DisplayStatus } from "@/lib/day/derive";
import type { SupervisorUnlabelled } from "@/lib/day/contract";
import type { DictKey } from "@/lib/i18n/dict";

/**
 * Pure view-model helpers for the day record screen (R-06 Task 7.1). No I/O,
 * no React: the category filter's options/order and the status/category
 * copy-key maps live here so `ThreadCard`/`DayRecordView`/`CategoryFilter` stay
 * thin renderers, and so the maps and the copy keys they point at (Task 6) are
 * each tested in exactly one place. Task 11 adds `RUNNER_UP_KEY` here too.
 */

/** `DisplayStatus` -> the copy key for its status badge (Task 6 table). */
export const STATUS_KEY: Record<DisplayStatus, DictKey> = {
  fact: "C-day-st-fact",
  fact_staff_confirmed: "C-day-st-fact-staff",
  fact_supervisor_confirmed: "C-day-st-fact-supervisor",
  question_open: "C-day-st-open",
  question_answered: "C-day-st-answered",
  awaiting_supervisor: "C-day-st-supervisor",
  rejected_by_staff: "C-day-st-rejected",
  rejected_by_supervisor: "C-day-st-rejected-supervisor",
  unverified: "C-day-st-unverified",
};

const WORK_CATEGORIES: readonly WorkCategory[] = CATEGORIES.filter(
  (c): c is WorkCategory => c !== "NON_WORK",
);

/** `WorkCategory` -> the copy key for its category chip/label (Task 6 table). */
export const CATEGORY_KEY: Record<WorkCategory, DictKey> = {
  ROUTINE_OPS: "C-cat-ROUTINE_OPS",
  CUSTOMER_SERVICE: "C-cat-CUSTOMER_SERVICE",
  TRAINING: "C-cat-TRAINING",
  STAFF_CONSULT: "C-cat-STAFF_CONSULT",
  CORRECTION: "C-cat-CORRECTION",
  PHONE_CALL: "C-cat-PHONE_CALL",
  EVENT: "C-cat-EVENT",
  COMPLAINT: "C-cat-COMPLAINT",
  SAFETY_INCIDENT: "C-cat-SAFETY_INCIDENT",
  SECURITY_INCIDENT: "C-cat-SECURITY_INCIDENT",
  DISRUPTION: "C-cat-DISRUPTION",
};

/** `Category` (incl. `NON_WORK`) -> the copy key for a runner-up label (Task 11.4). */
export const RUNNER_UP_KEY: Record<Category, DictKey> = {
  ...CATEGORY_KEY,
  NON_WORK: "C-cat-NON_WORK",
};

/** Task 12: `"UNLABELLED"` narrows to the unlabelled rows only (no category). */
export type CategoryFilterValue = "ALL" | "UNLABELLED" | WorkCategory;

/**
 * Categories present in `threads`, in `CATEGORIES` order, each with its count.
 * A category with zero matching threads is never returned (the filter row
 * only ever shows chips a tap can actually narrow to).
 */
export function categoryOptions(
  threads: readonly { category: WorkCategory }[],
): { category: WorkCategory; count: number }[] {
  const counts = new Map<WorkCategory, number>();
  for (const t of threads) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);

  const options: { category: WorkCategory; count: number }[] = [];
  for (const category of WORK_CATEGORIES) {
    const count = counts.get(category) ?? 0;
    if (count > 0) options.push({ category, count });
  }
  return options;
}

/** `"ALL"` returns every thread unchanged; a category value narrows to it. */
export function filterThreads<T extends { category: WorkCategory }>(
  threads: readonly T[],
  filter: CategoryFilterValue,
): T[] {
  if (filter === "ALL") return [...threads];
  if (filter === "UNLABELLED") return []; // no thread is ever "unlabelled" — see buildTimeline
  return threads.filter((t) => t.category === filter);
}

/**
 * Task 12: one item on the day's timeline — a thread row or an unlabelled
 * row. `DayRecordView` renders the union with a card per `kind` (never a
 * device/question id; the union carries only what the response already
 * validated).
 */
export type TimelineItem<T> = { kind: "thread"; thread: T } | { kind: "unlabelled"; item: SupervisorUnlabelled };

/**
 * Interleaves `threads` and `unlabelled` for the day record screen (Task
 * 12.4). `threads` must already be in `row` order (the server's own order —
 * `0..n-1`, ascending), and `unlabelled` in `key` order (ditto) — neither is
 * re-sorted here.
 *
 * - `"ALL"`: unlabelled rows with `after_row === null` first (key order),
 *   then each thread followed by the unlabelled rows whose `after_row`
 *   equals that thread's `row` (key order). An unlabelled row whose
 *   `after_row` names no thread in `threads` (defensive — e.g. a category
 *   filter already removed that thread) goes last instead of being dropped.
 * - `"UNLABELLED"`: unlabelled rows only, key order; no threads.
 * - a category: threads of that category only; no unlabelled rows.
 */
export function buildTimeline<T extends { row: number; category: WorkCategory }>(
  threads: readonly T[],
  unlabelled: readonly SupervisorUnlabelled[],
  f: CategoryFilterValue,
): TimelineItem<T>[] {
  if (f === "UNLABELLED") {
    return unlabelled.map((item) => ({ kind: "unlabelled", item }));
  }
  if (f !== "ALL") {
    return threads.filter((t) => t.category === f).map((thread) => ({ kind: "thread", thread }));
  }

  const knownRows = new Set(threads.map((t) => t.row));
  const beforeEvery: SupervisorUnlabelled[] = [];
  const afterRowOf = new Map<number, SupervisorUnlabelled[]>();
  const orphaned: SupervisorUnlabelled[] = [];
  for (const item of unlabelled) {
    if (item.after_row === null) {
      beforeEvery.push(item);
    } else if (knownRows.has(item.after_row)) {
      const bucket = afterRowOf.get(item.after_row);
      if (bucket) bucket.push(item);
      else afterRowOf.set(item.after_row, [item]);
    } else {
      orphaned.push(item);
    }
  }

  const out: TimelineItem<T>[] = beforeEvery.map((item) => ({ kind: "unlabelled", item }));
  for (const thread of threads) {
    out.push({ kind: "thread", thread });
    for (const item of afterRowOf.get(thread.row) ?? []) out.push({ kind: "unlabelled", item });
  }
  for (const item of orphaned) out.push({ kind: "unlabelled", item });
  return out;
}
