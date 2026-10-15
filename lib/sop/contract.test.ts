import { describe, expect, it } from "vitest";
import { SopChangeViewSchema, SopOverviewSchema } from "@/lib/sop/contract";

const step = { step_id: "a-01", title: "T", text: "X", role: "staff" as const };

describe("SopOverviewSchema", () => {
  it("accepts the empty state", () => {
    expect(
      SopOverviewSchema.safeParse({ today: "2026-10-15", latest: null, in_force_version: null, first_version_date: null, changes: [] })
        .success,
    ).toBe(true);
  });

  it("accepts a seed-only SOP", () => {
    const r = SopOverviewSchema.safeParse({
      today: "2026-10-15",
      latest: { version: 1, effective_from_date: null, steps: [step] },
      in_force_version: 1,
      first_version_date: "2026-10-05",
      changes: [],
    });
    expect(r.success).toBe(true);
  });

  it("is strict: an id key is refused", () => {
    const r = SopOverviewSchema.safeParse({
      today: "2026-10-15",
      latest: { version: 1, effective_from_date: null, steps: [{ ...step, sop_version_id: "o1:v1" }] },
      in_force_version: 1,
      first_version_date: "2026-10-05",
      changes: [],
    });
    expect(r.success).toBe(false);
  });

  it("refuses an empty latest step list", () => {
    expect(
      SopOverviewSchema.safeParse({
        today: "2026-10-15",
        latest: { version: 1, effective_from_date: null, steps: [] },
        in_force_version: 1,
        first_version_date: "2026-10-05",
        changes: [],
      }).success,
    ).toBe(false);
  });

  describe("first_version_date (R-19 PR-9a: the seed's date on the version switch)", () => {
    const base = { today: "2026-10-15", latest: { version: 1, effective_from_date: null, steps: [step] }, in_force_version: 1, changes: [] };

    it("is required: an overview without it is refused", () => {
      expect(SopOverviewSchema.safeParse(base).success).toBe(false);
    });

    it("is a business date or null, never anything else", () => {
      expect(SopOverviewSchema.safeParse({ ...base, first_version_date: "2026-10-05" }).success).toBe(true);
      expect(SopOverviewSchema.safeParse({ ...base, first_version_date: null }).success).toBe(true);
      expect(SopOverviewSchema.safeParse({ ...base, first_version_date: "05/10/26" }).success).toBe(false);
      expect(SopOverviewSchema.safeParse({ ...base, first_version_date: 1_700_000_000_000 }).success).toBe(false);
    });
  });
});

describe("SopChangeViewSchema outcome (R-11 Task 7)", () => {
  const change = {
    version: 2,
    previous_version: 1,
    effective_from_date: "2026-10-16",
    approved_date: "2026-10-15",
    kind: "modify" as const,
    before: step,
    after: step,
    change_title: "T",
    metric: { category: "CUSTOMER_SERVICE" as const, direction: "decrease" as const, description: "d", baseline_count: 3, baseline_days: 7 },
    failure_condition: "f",
    review_date: "2026-10-23",
  };

  it("accepts a null outcome and each outcome verdict", () => {
    expect(SopChangeViewSchema.safeParse({ ...change, outcome: null }).success).toBe(true);
    for (const verdict of ["worked", "revise", "revert", "unknown"]) {
      expect(SopChangeViewSchema.safeParse({ ...change, outcome: { verdict, simulated: false } }).success).toBe(true);
    }
  });

  it("requires the outcome key, refuses an unknown verdict and an extra key", () => {
    expect(SopChangeViewSchema.safeParse(change).success).toBe(false);
    expect(SopChangeViewSchema.safeParse({ ...change, outcome: { verdict: "maybe", simulated: false } }).success).toBe(false);
    expect(SopChangeViewSchema.safeParse({ ...change, outcome: { verdict: "worked", simulated: false, reason: "x" } }).success).toBe(false);
  });
});
