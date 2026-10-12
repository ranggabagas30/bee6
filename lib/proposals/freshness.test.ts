import { describe, expect, it } from "vitest";
import { evidenceStillHolds, isFreshFact, type FreshThread } from "@/lib/proposals/freshness";

describe("isFreshFact", () => {
  it("a missing thread is not fresh", () => {
    expect(isFreshFact(undefined)).toBe(false);
  });
  it("open and unverified threads are not fresh", () => {
    expect(isFreshFact({ status: "open" })).toBe(false);
    expect(isFreshFact({ status: "unverified" })).toBe(false);
  });
  it("a fact excluded from evidence is not fresh", () => {
    expect(isFreshFact({ status: "fact", excluded_from_evidence: true })).toBe(false);
  });
  it("a fact the supervisor rejected is not fresh", () => {
    expect(isFreshFact({ status: "fact", label_source: "supervisor_rejected" })).toBe(false);
  });
  it("a fact confirmed by staff or supervisor is fresh", () => {
    expect(isFreshFact({ status: "fact", label_source: "staff_confirmed" })).toBe(true);
    expect(isFreshFact({ status: "fact", label_source: "supervisor_confirmed" })).toBe(true);
  });
  it("a fact with no optional fields is fresh", () => {
    expect(isFreshFact({ status: "fact" })).toBe(true);
  });
});

describe("evidenceStillHolds", () => {
  const fact: FreshThread = { status: "fact" };
  const map = (entries: Array<[string, FreshThread]>) => new Map(entries);

  it("2 fresh threads on 2 dates holds", () => {
    const r = evidenceStillHolds(
      [
        { thread_id: "a", local_date: "2026-10-01" },
        { thread_id: "b", local_date: "2026-10-02" },
      ],
      map([["a", fact], ["b", fact]]),
    );
    expect(r).toEqual({ kept_threads: 2, kept_dates: 2, holds: true });
  });
  it("2 fresh threads on 1 date does not hold", () => {
    const r = evidenceStillHolds(
      [
        { thread_id: "a", local_date: "2026-10-01" },
        { thread_id: "b", local_date: "2026-10-01" },
      ],
      map([["a", fact], ["b", fact]]),
    );
    expect(r.holds).toBe(false);
    expect(r.kept_dates).toBe(1);
  });
  it("3 refs on 3 dates with one missing still holds (2/2)", () => {
    const r = evidenceStillHolds(
      [
        { thread_id: "a", local_date: "2026-10-01" },
        { thread_id: "b", local_date: "2026-10-02" },
        { thread_id: "c", local_date: "2026-10-03" },
      ],
      map([["a", fact], ["c", fact]]),
    );
    expect(r).toEqual({ kept_threads: 2, kept_dates: 2, holds: true });
  });
  it("counts a thread id shared by two refs once", () => {
    const r = evidenceStillHolds(
      [
        { thread_id: "a", local_date: "2026-10-01" },
        { thread_id: "a", local_date: "2026-10-02" },
      ],
      map([["a", fact]]),
    );
    expect(r.kept_threads).toBe(1);
    expect(r.holds).toBe(false);
  });
  it("empty refs do not hold", () => {
    expect(evidenceStillHolds([], new Map()).holds).toBe(false);
  });
});
