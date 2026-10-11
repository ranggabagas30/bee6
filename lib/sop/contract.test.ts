import { describe, expect, it } from "vitest";
import { SopOverviewSchema } from "@/lib/sop/contract";

const step = { step_id: "a-01", title: "T", text: "X", role: "staff" as const };

describe("SopOverviewSchema", () => {
  it("accepts the empty state", () => {
    expect(SopOverviewSchema.safeParse({ today: "2026-10-15", latest: null, in_force_version: null, changes: [] }).success).toBe(true);
  });

  it("accepts a seed-only SOP", () => {
    const r = SopOverviewSchema.safeParse({
      today: "2026-10-15",
      latest: { version: 1, effective_from_date: null, steps: [step] },
      in_force_version: 1,
      changes: [],
    });
    expect(r.success).toBe(true);
  });

  it("is strict: an id key is refused", () => {
    const r = SopOverviewSchema.safeParse({
      today: "2026-10-15",
      latest: { version: 1, effective_from_date: null, steps: [{ ...step, sop_version_id: "o1:v1" }] },
      in_force_version: 1,
      changes: [],
    });
    expect(r.success).toBe(false);
  });

  it("refuses an empty latest step list", () => {
    expect(
      SopOverviewSchema.safeParse({ today: "2026-10-15", latest: { version: 1, effective_from_date: null, steps: [] }, in_force_version: 1, changes: [] }).success,
    ).toBe(false);
  });
});
