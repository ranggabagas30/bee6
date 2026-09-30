import { describe, expect, it } from "vitest";
import {
  PHONE_LABEL,
  redactIndonesianPhones,
} from "@/lib/redact/indonesian-phone";

describe("redactIndonesianPhones", () => {
  it("redacts a local 08 mobile number", () => {
    expect(redactIndonesianPhones("Hubungi 081234567890 ya")).toBe(
      `Hubungi ${PHONE_LABEL} ya`,
    );
  });

  it("redacts an international +62 number with separators", () => {
    expect(redactIndonesianPhones("Call +62 812-3456-7890 now")).toBe(
      `Call ${PHONE_LABEL} now`,
    );
  });

  it("redacts multiple numbers in one line", () => {
    expect(
      redactIndonesianPhones("a 08123456789 b 087812345678 c"),
    ).toBe(`a ${PHONE_LABEL} b ${PHONE_LABEL} c`);
  });

  it("does not touch ordinary quantities or prices", () => {
    expect(redactIndonesianPhones("Table 8 needs 4 flat whites")).toBe(
      "Table 8 needs 4 flat whites",
    );
    expect(redactIndonesianPhones("Rp 85000 total")).toBe("Rp 85000 total");
    expect(redactIndonesianPhones("Order 250 croissants")).toBe(
      "Order 250 croissants",
    );
  });

  it("returns empty string unchanged", () => {
    expect(redactIndonesianPhones("")).toBe("");
  });

  it("does not match a digit run that merely contains 08 mid-number", () => {
    // A long id like an invoice number should not be caught by the 0-prefix rule.
    expect(redactIndonesianPhones("INV 99081234567890")).toBe(
      "INV 99081234567890",
    );
  });
});
