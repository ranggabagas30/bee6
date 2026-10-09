import { describe, expect, it } from "vitest";
import {
  FACT_STATUSES,
  deriveDisplayStatus,
  evidenceFor,
  isOwnerVisible,
  toConfidencePct,
  type QuestionForStatus,
  type ThreadForStatus,
} from "@/lib/day/derive";

const JKT = "Asia/Jakarta";

const fact: ThreadForStatus = { status: "fact" };
const openThread: ThreadForStatus = { status: "open" };
const unverifiedThread: ThreadForStatus = { status: "unverified" };

describe("deriveDisplayStatus", () => {
  it("rule 0: a supervisor rejection is rejected_by_supervisor", () => {
    const t: ThreadForStatus = { status: "open", label_source: "supervisor_rejected", excluded_from_evidence: true };
    expect(deriveDisplayStatus(t, "COMPLAINT", undefined)).toBe("rejected_by_supervisor");
  });

  it("rule 0 beats rules 1 and 4: supervisor_rejected + excluded + answered yes still reads as rejected_by_supervisor", () => {
    const t: ThreadForStatus = { status: "open", label_source: "supervisor_rejected", excluded_from_evidence: true };
    const q: QuestionForStatus = { status: "answered", answer: "yes" };
    expect(deriveDisplayStatus(t, "COMPLAINT", q)).toBe("rejected_by_supervisor");
  });

  it("rule 1: excluded_from_evidence is rejected_by_staff", () => {
    const t: ThreadForStatus = { status: "open", excluded_from_evidence: true };
    expect(deriveDisplayStatus(t, "ROUTINE_OPS", undefined)).toBe("rejected_by_staff");
  });

  it("rule 1 is defensive even against status fact (should not happen in practice)", () => {
    const t: ThreadForStatus = { status: "fact", excluded_from_evidence: true };
    expect(deriveDisplayStatus(t, "ROUTINE_OPS", undefined)).toBe("rejected_by_staff");
  });

  it("rule 2: a fact with no label_source is a plain fact", () => {
    expect(deriveDisplayStatus(fact, "ROUTINE_OPS", undefined)).toBe("fact");
  });

  it("rule 2: a fact with label_source model is a plain fact", () => {
    expect(deriveDisplayStatus({ ...fact, label_source: "model" }, "ROUTINE_OPS", undefined)).toBe("fact");
  });

  it("rule 2: a fact confirmed by staff is fact_staff_confirmed", () => {
    expect(deriveDisplayStatus({ ...fact, label_source: "staff_confirmed" }, "ROUTINE_OPS", undefined)).toBe(
      "fact_staff_confirmed",
    );
  });

  it("rule 2: a fact confirmed by a supervisor is fact_supervisor_confirmed", () => {
    expect(deriveDisplayStatus({ ...fact, label_source: "supervisor_confirmed" }, "COMPLAINT", undefined)).toBe(
      "fact_supervisor_confirmed",
    );
  });

  it("rule 3: an unverified thread is unverified", () => {
    expect(deriveDisplayStatus(unverifiedThread, "ROUTINE_OPS", undefined)).toBe("unverified");
  });

  it("rule 4: an open COMPLAINT answered yes needs supervisor confirmation", () => {
    const q: QuestionForStatus = { status: "answered", answer: "yes" };
    expect(deriveDisplayStatus(openThread, "COMPLAINT", q)).toBe("awaiting_supervisor");
  });

  it("rule 4: an open ROUTINE_OPS answered yes is question_answered (no supervisor step needed)", () => {
    const q: QuestionForStatus = { status: "answered", answer: "yes" };
    expect(deriveDisplayStatus(openThread, "ROUTINE_OPS", q)).toBe("question_answered");
  });

  it("rule 5: an open thread answered no is rejected_by_staff", () => {
    const q: QuestionForStatus = { status: "answered", answer: "no" };
    expect(deriveDisplayStatus(openThread, "ROUTINE_OPS", q)).toBe("rejected_by_staff");
  });

  it("rule 6: an open thread whose question expired unanswered is unverified", () => {
    const q: QuestionForStatus = { status: "unverified" };
    expect(deriveDisplayStatus(openThread, "ROUTINE_OPS", q)).toBe("unverified");
  });

  it("rule 7: an open COMPLAINT with an open question is question_open", () => {
    const q: QuestionForStatus = { status: "open" };
    expect(deriveDisplayStatus(openThread, "COMPLAINT", q)).toBe("question_open");
  });

  it("rule 7: an open thread with no question doc at all is question_open", () => {
    expect(deriveDisplayStatus(openThread, "ROUTINE_OPS", undefined)).toBe("question_open");
  });
});

describe("FACT_STATUSES", () => {
  it("contains exactly the three fact display statuses", () => {
    expect([...FACT_STATUSES].sort()).toEqual(
      ["fact", "fact_staff_confirmed", "fact_supervisor_confirmed"].sort(),
    );
  });
});

describe("isOwnerVisible", () => {
  it("a plain fact is visible", () => {
    expect(isOwnerVisible(fact)).toBe(true);
  });
  it("an excluded fact (defensive) is not visible", () => {
    expect(isOwnerVisible({ status: "fact", excluded_from_evidence: true })).toBe(false);
  });
  it("an open thread is not visible", () => {
    expect(isOwnerVisible(openThread)).toBe(false);
  });
  it("an unverified thread is not visible", () => {
    expect(isOwnerVisible(unverifiedThread)).toBe(false);
  });
});

describe("toConfidencePct", () => {
  it("rounds a normal fraction to a percentage", () => {
    expect(toConfidencePct(0.874)).toBe(87);
  });
  it("clamps above 1 to 100", () => {
    expect(toConfidencePct(1.2)).toBe(100);
  });
  it("clamps below 0 to 0", () => {
    expect(toConfidencePct(-1)).toBe(0);
  });
  it("maps NaN to 0", () => {
    expect(toConfidencePct(Number.NaN)).toBe(0);
  });
});

describe("evidenceFor", () => {
  it("orders by start_ms, skips blank text and unknown ids, caps at max with a more count", () => {
    const lines = Array.from({ length: 25 }, (_, i) => ({
      line_id: `l${i}`,
      start_ms: 25 - i, // intentionally reverse-ordered input
      text: `EVID-${i}`,
    }));
    const ids = lines.map((l) => l.line_id);
    const result = evidenceFor(lines, ids, JKT, 20);
    expect(result.evidence).toHaveLength(20);
    expect(result.more).toBe(5);
    // ascending by start_ms: the last line (l24, start_ms=1) comes first
    expect(result.evidence[0]!.text).toBe("EVID-24");
    expect(result.evidence[19]!.text).toBe("EVID-5");
  });

  it("skips lines with blank/whitespace-only text", () => {
    const lines = [
      { line_id: "a", start_ms: 1, text: "real text" },
      { line_id: "b", start_ms: 2, text: "   " },
      { line_id: "c", start_ms: 3, text: "" },
    ];
    const result = evidenceFor(lines, ["a", "b", "c"], JKT, 20);
    expect(result.evidence).toEqual([{ hm: expect.any(String), text: "real text" }]);
    expect(result.more).toBe(0);
  });

  it("skips evidence ids that have no matching line", () => {
    const lines = [{ line_id: "a", start_ms: 1, text: "only this one" }];
    const result = evidenceFor(lines, ["a", "missing-id"], JKT, 20);
    expect(result.evidence).toHaveLength(1);
    expect(result.more).toBe(0);
  });
});
