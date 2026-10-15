import { describe, expect, it } from "vitest";
import { checkEvidenceFloor, evidenceByCategory, followupFor } from "@/lib/proposals/precheck";
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

  describe("R-19 3.2 floor-v2: the floor holds inside ONE category", () => {
    it("1 CUSTOMER_SERVICE + 1 PHONE_CALL on 2 dates -> NOT passed (the old any-mix rule would have passed)", () => {
      const all = [
        candidate({ thread_id: "t1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
        candidate({ thread_id: "t2", category: "PHONE_CALL", local_date: "2026-10-08" }),
      ];
      expect(checkEvidenceFloor(all)).toEqual({ passed: false, facts: 1, dates: 1 });
    });

    it("2 CUSTOMER_SERVICE on 2 dates next to 1 PHONE_CALL -> passed; facts/dates are the ready row's", () => {
      const all = [
        candidate({ thread_id: "t1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
        candidate({ thread_id: "t2", category: "PHONE_CALL", local_date: "2026-10-08" }),
        candidate({ thread_id: "t3", category: "CUSTOMER_SERVICE", local_date: "2026-10-08" }),
      ];
      expect(checkEvidenceFloor(all)).toEqual({ passed: true, facts: 2, dates: 2 });
    });

    it("3 PHONE_CALL on 1 date + 2 CUSTOMER_SERVICE on 2 dates -> passed with the READY row's numbers, not the biggest", () => {
      const all = [
        candidate({ thread_id: "p1", category: "PHONE_CALL", local_date: "2026-10-07" }),
        candidate({ thread_id: "p2", category: "PHONE_CALL", local_date: "2026-10-07" }),
        candidate({ thread_id: "p3", category: "PHONE_CALL", local_date: "2026-10-07" }),
        candidate({ thread_id: "c1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
        candidate({ thread_id: "c2", category: "CUSTOMER_SERVICE", local_date: "2026-10-08" }),
      ];
      expect(checkEvidenceFloor(all)).toEqual({ passed: true, facts: 2, dates: 2 });
    });
  });
});

describe("evidenceByCategory (R-19 3.2)", () => {
  it("empty -> []", () => {
    expect(evidenceByCategory([])).toEqual([]);
  });

  it("one row per category present, with its own facts and distinct dates", () => {
    const rows = evidenceByCategory([
      candidate({ thread_id: "c1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "c2", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "c3", category: "CUSTOMER_SERVICE", local_date: "2026-10-08" }),
      candidate({ thread_id: "p1", category: "PHONE_CALL", local_date: "2026-10-08" }),
    ]);
    expect(rows).toEqual([
      { category: "CUSTOMER_SERVICE", facts: 3, dates: 2, ready: true },
      { category: "PHONE_CALL", facts: 1, dates: 1, ready: false },
    ]);
  });

  it("orders ready first, then facts desc, then dates desc, then CATEGORIES order", () => {
    const rows = evidenceByCategory([
      // EVENT: 2 facts on 2 dates -> ready (listed first even though PHONE_CALL has more facts)
      candidate({ thread_id: "e1", category: "EVENT", local_date: "2026-10-07" }),
      candidate({ thread_id: "e2", category: "EVENT", local_date: "2026-10-08" }),
      // PHONE_CALL: 3 facts on 1 date -> not ready, most facts
      candidate({ thread_id: "p1", category: "PHONE_CALL", local_date: "2026-10-07" }),
      candidate({ thread_id: "p2", category: "PHONE_CALL", local_date: "2026-10-07" }),
      candidate({ thread_id: "p3", category: "PHONE_CALL", local_date: "2026-10-07" }),
      // STAFF_CONSULT and TRAINING: 1 fact on 1 date each -> tie broken by CATEGORIES order (TRAINING before STAFF_CONSULT)
      candidate({ thread_id: "s1", category: "STAFF_CONSULT", local_date: "2026-10-07" }),
      candidate({ thread_id: "t1", category: "TRAINING", local_date: "2026-10-07" }),
      // COMPLAINT: 2 facts on 1 date vs DISRUPTION: 2 facts on 2 dates? no: DISRUPTION 1 fact -> COMPLAINT (2,1) before the 1-fact rows
      candidate({ thread_id: "k1", category: "COMPLAINT", local_date: "2026-10-07" }),
      candidate({ thread_id: "k2", category: "COMPLAINT", local_date: "2026-10-07" }),
    ]);
    expect(rows.map((r) => [r.category, r.facts, r.dates, r.ready])).toEqual([
      ["EVENT", 2, 2, true],
      ["PHONE_CALL", 3, 1, false],
      ["COMPLAINT", 2, 1, false],
      ["TRAINING", 1, 1, false],
      ["STAFF_CONSULT", 1, 1, false],
    ]);
  });

  it("same facts, more dates sorts first", () => {
    const rows = evidenceByCategory([
      candidate({ thread_id: "c1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "c2", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "c3", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "p1", category: "PHONE_CALL", local_date: "2026-10-07" }),
      candidate({ thread_id: "p2", category: "PHONE_CALL", local_date: "2026-10-08" }),
      candidate({ thread_id: "p3", category: "PHONE_CALL", local_date: "2026-10-09" }),
    ]);
    expect(rows.map((r) => r.category)).toEqual(["PHONE_CALL", "CUSTOMER_SERVICE"]);
  });

  it("does not mutate its input", () => {
    const all = [candidate({ thread_id: "p1", category: "PHONE_CALL" }), candidate({ thread_id: "c1" })];
    const copy = all.map((c) => ({ ...c }));
    evidenceByCategory(all);
    expect(all).toEqual(copy);
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
      candidate({ thread_id: "c", category: "PHONE_CALL" }),
      candidate({ thread_id: "d", category: "PHONE_CALL" }),
      candidate({ thread_id: "e", category: "TRAINING" }),
      candidate({ thread_id: "f", category: "STAFF_CONSULT" }),
    ];
    const f = followupFor(all);
    // PHONE_CALL: 2; the rest tie at 1, broken by CATEGORIES order
    // (TRAINING=2, STAFF_CONSULT=3, COMPLAINT=7, DISRUPTION=10), capped at 3.
    expect(f.categories).toEqual(["PHONE_CALL", "TRAINING", "STAFF_CONSULT"]);
    // R-19 3.2: have_* are the FIRST row's numbers (the closest problem), not the total across categories.
    expect(f.have_facts).toBe(2);
    expect(f.have_dates).toBe(1);
  });

  it("R-19 3.2: the card reads the closest problem: 1 CS on 1 date next to 1 PHONE_CALL on 1 date -> 1 of 2 days", () => {
    const f = followupFor([
      candidate({ thread_id: "c1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "p1", category: "PHONE_CALL", local_date: "2026-10-08" }),
    ]);
    expect(f).toEqual({ categories: ["CUSTOMER_SERVICE", "PHONE_CALL"], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 });
  });

  it("R-19 3.2: a ready row leads the follow-up categories and its numbers", () => {
    const f = followupFor([
      candidate({ thread_id: "p1", category: "PHONE_CALL", local_date: "2026-10-07" }),
      candidate({ thread_id: "p2", category: "PHONE_CALL", local_date: "2026-10-07" }),
      candidate({ thread_id: "p3", category: "PHONE_CALL", local_date: "2026-10-07" }),
      candidate({ thread_id: "c1", category: "CUSTOMER_SERVICE", local_date: "2026-10-07" }),
      candidate({ thread_id: "c2", category: "CUSTOMER_SERVICE", local_date: "2026-10-08" }),
    ]);
    expect(f.categories).toEqual(["CUSTOMER_SERVICE", "PHONE_CALL"]);
    expect(f.have_facts).toBe(2);
    expect(f.have_dates).toBe(2);
  });
});
