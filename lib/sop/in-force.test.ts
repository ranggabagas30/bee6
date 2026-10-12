import { describe, expect, it } from "vitest";
import { latestSop, sopInForce } from "@/lib/sop/in-force";
import { seedV1 } from "@/lib/sop/testing/fixtures";
import type { SopVersion } from "@/lib/firestore/schema";

function withVersion(version: number, eff: string | null): SopVersion {
  // Shape-only fixture for the pure helpers (no schema parse needed).
  return { ...seedV1(), sop_version_id: `o1:v${version}`, version, effective_from_date: eff } as SopVersion;
}

describe("latestSop", () => {
  it("3.T1 returns null for an empty list and the highest version otherwise", () => {
    expect(latestSop([])).toBeNull();
    const v1 = withVersion(1, null);
    const v2 = withVersion(2, "2026-10-16");
    const v3 = withVersion(3, "2026-10-20");
    expect(latestSop([v1, v3, v2])).toBe(v3);
  });
});

describe("sopInForce", () => {
  const v1 = withVersion(1, null);
  const v2 = withVersion(2, "2026-10-16");

  it("3.T2 switches to v2 on its effective date, not before", () => {
    expect(sopInForce([v1, v2], "2026-10-15")).toBe(v1);
    expect(sopInForce([v2, v1], "2026-10-16")).toBe(v2);
    expect(sopInForce([v1, v2], "2026-10-30")).toBe(v2);
  });

  it("3.T2 returns null when nothing is in force yet, or the list is empty", () => {
    expect(sopInForce([v2], "2026-10-15")).toBeNull();
    expect(sopInForce([], "2026-10-15")).toBeNull();
  });

  it("treats a missing effective_from_date as in force from the start", () => {
    const { effective_from_date: _omit, ...rest } = v1;
    expect(sopInForce([rest as SopVersion], "2000-01-01")).not.toBeNull();
  });
});
