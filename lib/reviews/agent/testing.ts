import { suggestVerdict } from "@/lib/reviews/verdict";
import type { ReviewAgentInputs, ReviewAgentSession } from "@/lib/reviews/agent/types";
import { newReviewAgentSession } from "@/lib/reviews/agent/types";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Synthetic, fictional `ReviewAgentInputs` for tests and the eval (docs/tasks/review-agent-18oct.md §9). No Firestore,
 * no model, no real shop text ("Demo Bakery").
 */

export const FIXTURE_STAFF = ["Sari Demo"] as const;

export interface FixtureOptions {
  before?: { days: number; count: number };
  after?: { days: number; count: number };
  direction?: "decrease" | "increase";
  category?: WorkCategory;
  overlapping?: boolean;
  truncated?: boolean;
  baseline?: { count: number; days: number };
  beforeSummaries?: string[];
  afterSummaries?: string[];
}

export function makeInputs(opts: FixtureOptions = {}): ReviewAgentInputs {
  const before = opts.before ?? { days: 3, count: 2 };
  const after = opts.after ?? { days: 2, count: 0 };
  const direction = opts.direction ?? "decrease";
  const category = opts.category ?? "CUSTOMER_SERVICE";
  const baseline = opts.baseline ?? { count: before.count, days: before.days };
  const beforeWin = { from_date: "2026-10-10", to_date: "2026-10-12", days_captured: before.days, count: before.count };
  const afterWin = { from_date: "2026-10-13", to_date: "2026-10-19", days_captured: after.days, count: after.count };
  const sample = (items: string[] | undefined, date: string) =>
    (items ?? []).map((summary, i) => ({ date, start_hm: `0${8 + i}:15`, category, summary }));
  return {
    change: {
      version: 2,
      change_title: "Write the baking time on each tray label",
      kind: "modify",
      step_title: "Display check",
      step_before: "Check that the display is full.",
      step_after: "Check that the display is full and every tray label shows its baking time.",
      intervention: { id: "label_it", label_en: "Add a label", definition: "Put the key fact on the item itself." },
      rationale: "Customers asked staff when items were baked.",
      metric: {
        category,
        category_label_en: "Customer service",
        direction,
        description: "Customers asking when an item was baked",
        baseline_count: baseline.count,
        baseline_days: baseline.days,
      },
      failure_condition: "Customers still ask about baking times.",
    },
    counts: { before: beforeWin, after: afterWin, rule: { min_days: 2, threshold_pct: 20 } },
    sample: {
      before: sample(opts.beforeSummaries ?? ["A customer asked when the egg tarts were baked.", "A customer asked about baking time."], "2026-10-10"),
      after: sample(opts.afterSummaries ?? [], "2026-10-13"),
    },
    notices: { overlapping_change: opts.overlapping ?? false, threads_truncated: opts.truncated ?? false },
    suggestion: suggestVerdict({ before: beforeWin, after: afterWin, direction }),
    staffNames: [...FIXTURE_STAFF],
  };
}

export function allInspected(): ReviewAgentSession {
  const s = newReviewAgentSession();
  for (const w of ["change", "counts", "before", "after"] as const) s.inspected.add(w);
  return s;
}

/** A narrative that passes every rule for `makeInputs()` (A-worked: 2 in 3 days -> 0 in 2 days, -100 %). */
export const GOOD_NARRATIVE =
  "The change added baking times to the tray labels. Before it, 2 moments of this kind were noted over 3 captured days; after it, 0 over 2 captured days, a change of 100 percent. Fewer moments were noted, which suggests it worked.";

export function goodDraft() {
  return {
    narrative_en: GOOD_NARRATIVE,
    suggested_verdict: "worked" as const,
    quoted_numbers: [2, 3, 0, 2, 100],
    caveats: ["short_window", "category_count_not_problem_count"] as const,
  };
}
