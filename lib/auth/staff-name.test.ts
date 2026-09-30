import { describe, expect, it } from "vitest";
import { normalizeStaffName } from "@/lib/auth/staff-name";

describe("normalizeStaffName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeStaffName("  Ari Demo  ")).toBe("ari demo");
  });

  it("casefolds", () => {
    expect(normalizeStaffName("ARI Demo")).toBe("ari demo");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeStaffName("Ari   Demo")).toBe("ari demo");
    expect(normalizeStaffName("Ari\tDemo")).toBe("ari demo");
  });

  it("maps casing/spacing variants to the same key", () => {
    const variants = ["Ari Demo", "ari demo", "  ARI   demo ", "Ari\tDemo"];
    const keys = new Set(variants.map(normalizeStaffName));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("ari demo");
  });
});
