import { describe, expect, it } from "vitest";
import { expandScrubNames, scrubReason } from "@/lib/debrief/scrub";

describe("expandScrubNames", () => {
  it("adds the full normalized name and every token >= 3 code points", () => {
    expect(expandScrubNames(["Dina Putri"])).toEqual(
      expect.arrayContaining(["dina putri", "dina", "putri"]),
    );
  });

  it("drops a token shorter than 3 code points but keeps the full name", () => {
    const result = expandScrubNames(["Al Bo"]);
    expect(result).toContain("al bo");
    expect(result).not.toContain("al");
    expect(result).not.toContain("bo");
  });

  it("dedupes and sorts by code-point length descending", () => {
    const result = expandScrubNames(["Dina Putri"]);
    for (let i = 1; i < result.length; i++) {
      expect(Array.from(result[i - 1]!).length).toBeGreaterThanOrEqual(Array.from(result[i]!).length);
    }
    expect(new Set(result).size).toBe(result.length);
  });

  it("returns an empty array for an empty names list", () => {
    expect(expandScrubNames([])).toEqual([]);
  });
});

describe("scrubReason", () => {
  it("scrubs a first-name token", () => {
    expect(scrubReason("dina lupa restock", ["Dina Putri"])).toBe("[STAFF] lupa restock");
  });

  it("scrubs the full name case-insensitively", () => {
    expect(scrubReason("DINA PUTRI telat", ["Dina Putri"])).toBe("[STAFF] telat");
  });

  it("does not match a longer word containing the name as a prefix", () => {
    expect(scrubReason("Dinamo rusak", ["Dina Putri"])).toBe("Dinamo rusak");
  });

  it("scrubs a last-name token", () => {
    expect(scrubReason("Putri bilang begitu", ["Dina Putri"])).toBe("[STAFF] bilang begitu");
  });

  it("only matches the full name when its tokens are each under 3 code points", () => {
    expect(scrubReason("al bo diskon", ["Al Bo"])).toBe("[STAFF] diskon");
    expect(scrubReason("al sendirian", ["Al Bo"])).toBe("al sendirian");
  });

  it("leaves text unchanged for an empty names list", () => {
    expect(scrubReason("dina lupa restock", [])).toBe("dina lupa restock");
  });

  it("accent-folds a name", () => {
    expect(scrubReason("dede datang", ["Dédé"])).toBe("[STAFF] datang");
  });
});
