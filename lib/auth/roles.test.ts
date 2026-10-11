import { describe, expect, it } from "vitest";
import { CustomClaimsSchema } from "@/lib/auth/roles";

describe("CustomClaimsSchema demo_exp_ms (R-12)", () => {
  it("parses claims without demo_exp_ms exactly as before", () => {
    const claims = { outlet_id: "o1", role: "owner" as const };
    expect(CustomClaimsSchema.parse(claims)).toEqual(claims);
  });

  it("parses claims with a positive integer demo_exp_ms", () => {
    const claims = { outlet_id: "sbx-1", role: "supervisor" as const, demo_exp_ms: 1_700_000_000_000 };
    expect(CustomClaimsSchema.parse(claims)).toEqual(claims);
  });

  it("rejects a non-positive, fractional or string demo_exp_ms", () => {
    const base = { outlet_id: "sbx-1", role: "owner" as const };
    expect(CustomClaimsSchema.safeParse({ ...base, demo_exp_ms: 0 }).success).toBe(false);
    expect(CustomClaimsSchema.safeParse({ ...base, demo_exp_ms: 1.5 }).success).toBe(false);
    expect(CustomClaimsSchema.safeParse({ ...base, demo_exp_ms: "1700000000000" }).success).toBe(false);
  });
});
