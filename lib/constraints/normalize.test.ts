import { describe, expect, it } from "vitest";
import { maskDigitRuns, normalizeConstraintText } from "@/lib/constraints/normalize";

describe("maskDigitRuns", () => {
  it("replaces a run of 6+ digits with [NUMBER]", () => {
    expect(maskDigitRuns("call 0812345678")).toBe("call [NUMBER]");
  });

  it("leaves a 5-digit run unchanged", () => {
    expect(maskDigitRuns("12345")).toBe("12345");
  });

  it("leaves small numeric quantities and times unchanged", () => {
    expect(maskDigitRuns("oven holds 2.5 kg")).toBe("oven holds 2.5 kg");
    expect(maskDigitRuns("make 3 trays")).toBe("make 3 trays");
    expect(maskDigitRuns("open at 07:00")).toBe("open at 07:00");
  });

  it("masks every run independently in the same string", () => {
    expect(maskDigitRuns("0812345678 and 0898765432")).toBe("[NUMBER] and [NUMBER]");
  });

  it("leaves text with no digit run unchanged", () => {
    expect(maskDigitRuns("no numbers here")).toBe("no numbers here");
  });
});

describe("normalizeConstraintText", () => {
  it("normalizes case and spacing to the same key", () => {
    const a = normalizeConstraintText("  The  Oven\tholds 2.5 KG ");
    const b = normalizeConstraintText("the oven holds 2.5 kg");
    expect(a).toBe(b);
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeConstraintText("  hello  ")).toBe("hello");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeConstraintText("a   b\t\tc")).toBe("a b c");
  });

  it("lower-cases the text", () => {
    expect(normalizeConstraintText("ABC")).toBe("abc");
  });

  it("applies NFKC normalization (full-width digit folds to ASCII)", () => {
    // U+FF11 (fullwidth "1") NFKC-normalizes to ASCII "1".
    expect(normalizeConstraintText("１")).toBe("1");
  });
});
