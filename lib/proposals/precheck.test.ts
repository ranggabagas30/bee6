import { describe, expect, it } from "vitest";
import { checkEvidenceFloor, followupFor } from "@/lib/proposals/precheck";
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

describe("checkEvidenceFloor", () => {
  it("0 candidates -> fail (0, 0)", () => {
    expect(checkEvidenceFloor([])).toEqual({ passed: false, facts: 0, dates: 0 });
  });

  it("1 fact -> fail (1, 1) (the done-when case)", () => {
    expect(checkEvidenceFloor([candidate()])).toEqual({ passed: false, facts: 1, dates: 1 });
  });

  it("2 facts same date -> fail (2, 1)", () => {
    const all = [candidate({ thread_id: "t1" }), candidate({ thread_id: "t2" })];
    expect(checkEvidenceFloor(all)).toEqual({ passed: false, facts: 2, dates: 1 });
  });

  it("2 facts on 2 dates -> pass", () => {
    const all = [candidate({ thread_id: "t1" }), candidate({ thread_id: "t2", local_date: "2026-10-08" })];
    expect(checkEvidenceFloor(all)).toEqual({ passed: true, facts: 2, dates: 2 });
  });

  it("5 facts on 1 date -> fail", () => {
    const all = Array.from({ length: 5 }, (_, i) => candidate({ thread_id: `t${i}` }));
    const result = checkEvidenceFloor(all);
    expect(result.passed).toBe(false);
    expect(result.facts).toBe(5);
    expect(result.dates).toBe(1);
  });
});

describe("followupFor", () => {
  it("zero candidates -> categories []", () => {
    const f = followupFor([]);
    expect(f).toEqual({ categories: [], have_facts: 0, have_dates: 0, need_facts: 2, need_dates: 2 });
  });

  it("orders categories by count desc, tie broken by CATEGORIES order, capped at 3", () => {
    const all = [
      candidate({ thread_id: "a", category: "DISRUPTION" }),
      candidate({ thread_id: "b", category: "COMPLAINT" }), // COMPLAINT before DISRUPTION in CATEGORIES
      candidate({ thread_id: "c", category: "ROUTINE_OPS" }),
      candidate({ thread_id: "d", category: "ROUTINE_OPS" }),
      candidate({ thread_id: "e", category: "TRAINING" }),
      candidate({ thread_id: "f", category: "STAFF_CONSULT" }),
    ];
    const f = followupFor(all);
    // ROUTINE_OPS: 2; the rest tie at 1, broken by CATEGORIES order
    // (TRAINING=2, STAFF_CONSULT=3, COMPLAINT=7, DISRUPTION=10), capped at 3.
    expect(f.categories).toEqual(["ROUTINE_OPS", "TRAINING", "STAFF_CONSULT"]);
    expect(f.have_facts).toBe(6);
    expect(f.have_dates).toBe(1);
  });
});
