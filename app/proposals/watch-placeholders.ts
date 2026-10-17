import type { WatchRow } from "@/lib/proposals/review-contract";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * R-25 T10 / R14: the two problems of the demo script, so the watch panel can show both rows ("Not seen yet") before
 * day 1 has been processed. Display only: the server's `watch.categories` lists just the categories the plain code has
 * seen, and the evidence gate still alone decides what is evidence (hard rule #10). Used on a demo sandbox only.
 *
 * Problem A = the egg-tart freshness question (CUSTOMER_SERVICE, script cards d1-c3 and d2-c2); problem B = the phone
 * order that was not read back (PHONE_CALL, cards d2-c3 and d3-c2): R-19 plan section 5.1.
 */
export const DEMO_WATCH_PLACEHOLDERS: ReadonlyArray<{ category: WorkCategory; need_dates: 2 }> = [
  { category: "CUSTOMER_SERVICE", need_dates: 2 },
  { category: "PHONE_CALL", need_dates: 2 },
];

/** A watch row as the panel shows it: the server's states plus "not seen yet" (a placeholder, 0 days). */
export type WatchDisplayRow = Omit<WatchRow, "state"> & { state: WatchRow["state"] | "not_seen" };

/**
 * The rows to draw. Pilot (`demo` false): the server's rows, untouched. Demo: the two problem rows first, in the board's
 * order (the server's row when the category was seen, a "not seen yet" placeholder when not), then every other seen
 * category as the server sent it.
 */
export function watchDisplayRows(rows: readonly WatchRow[], demo: boolean): WatchDisplayRow[] {
  if (!demo) return [...rows];
  const problems = new Set<WorkCategory>(DEMO_WATCH_PLACEHOLDERS.map((p) => p.category));
  const head: WatchDisplayRow[] = DEMO_WATCH_PLACEHOLDERS.map(
    (p) => rows.find((r) => r.category === p.category) ?? { category: p.category, facts: 0, dates: 0, need_dates: p.need_dates, state: "not_seen" },
  );
  return [...head, ...rows.filter((r) => !problems.has(r.category))];
}
