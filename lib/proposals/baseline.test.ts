import { describe, expect, it } from "vitest";
import { metricBaseline, reviewDate } from "@/lib/proposals/baseline";
import type { Candidate } from "@/lib/proposals/candidates";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    thread_id: "t1",
    local_date: "2026-10-07",
    start_hm: "10:00",
    category: "CUSTOMER_SERVICE",
    first_line_start_ms: 1,
    summary: "s",
    ...overrides,
  };
}

describe("metricBaseline", () => {
  it("counts only candidates in the metric category, across all categories for days", () => {
    const all = [
      candidate({ thread_id: "a", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "b", category: "CUSTOMER_SERVICE", local_date: "2026-10-08" }),
      candidate({ thread_id: "c", category: "ROUTINE_OPS", local_date: "2026-10-08" }),
    ];
    const result = metricBaseline(all, "CUSTOMER_SERVICE");
    expect(result).toEqual({ baseline_count: 2, baseline_days: 2 });
  });

  it("baseline_days counts distinct dates across ALL candidates, not only the metric category", () => {
    const all = [
      candidate({ thread_id: "a", category: "ROUTINE_OPS", local_date: "2026-10-07" }),
      candidate({ thread_id: "b", category: "CUSTOMER_SERVICE", local_date: "2026-10-08" }),
    ];
    const result = metricBaseline(all, "CUSTOMER_SERVICE");
    expect(result).toEqual({ baseline_count: 1, baseline_days: 2 });
  });
});

describe("reviewDate", () => {
  it('reviewDate("2026-10-10", 7) -> "2026-10-17"', () => {
    expect(reviewDate("2026-10-10", 7)).toBe("2026-10-17");
  });

  it("crosses a month end correctly", () => {
    expect(reviewDate("2026-10-25", 10)).toBe("2026-11-04");
  });
});
