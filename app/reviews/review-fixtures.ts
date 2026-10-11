import type { ReviewView } from "@/lib/reviews/contract";

/** Test-only fixture for the /reviews components (fictional demo data). */
export function reviewView(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    version: 2,
    change_title: "Check the display more often",
    metric: {
      category: "CUSTOMER_SERVICE",
      direction: "decrease",
      description: "Sold-out requests per day.",
      baseline_count: 6,
      baseline_days: 3,
    },
    failure_condition: "Sold-out requests do not fall.",
    effective_from_date: "2026-10-16",
    review_date: "2026-10-23",
    confirm_by_date: "2026-10-30",
    before: { from_date: "2026-10-06", to_date: "2026-10-12", days_captured: 3, count: 6 },
    after: { from_date: "2026-10-16", to_date: "2026-10-22", days_captured: 3, count: 3 },
    suggestion: { verdict: "worked", reason: "improved", change_ratio: -0.5 },
    notices: { overlapping_change: false, threads_truncated: false },
    simulated: false,
    status: "awaiting_supervisor",
    supervisor: null,
    owner: null,
    ...overrides,
  };
}
