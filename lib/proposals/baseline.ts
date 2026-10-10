import { addDays } from "@/lib/capture/calendar";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { Candidate } from "@/lib/proposals/candidates";

/**
 * `baseline_count` = candidates matching `metricCategory` (the uncapped
 * candidate list, not the 80 offered to the model); `baseline_days` =
 * distinct `local_date` across ALL candidates (>= 2 whenever the evidence
 * floor passed, since the floor itself requires 2 distinct dates).
 */
export function metricBaseline(
  all: readonly Candidate[],
  metricCategory: WorkCategory,
): { baseline_count: number; baseline_days: number } {
  const baseline_count = all.filter((c) => c.category === metricCategory).length;
  const baseline_days = new Set(all.map((c) => c.local_date)).size;
  return { baseline_count, baseline_days };
}

/** `review_date = addDays(today, days)` (the model picks `days` between 7 and 28). */
export function reviewDate(today: string, days: number): string {
  return addDays(today, days);
}
