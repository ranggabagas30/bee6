import { describe, expect, it } from "vitest";
import { scrubQuestionLine, stripInvisibleChars } from "@/lib/debrief/question-line";

/** demo-feedback-2 item 10, security review M1 + L3. All names fictional. */

describe("scrubQuestionLine: Indonesian clitics glued to a staff name (M1)", () => {
  const staff = ["Budi Santoso"];

  it.each(["Budinya", "Budiku", "Budimu", "Budilah", "Budikah"])("scrubs %s", (word) => {
    const out = scrubQuestionLine(`Kemarin ${word} datang telat.`, staff);
    expect(out).toBe("Kemarin [STAFF] datang telat.");
  });

  it("is case-insensitive", () => {
    expect(scrubQuestionLine("BUDINYA yang tutup toko", staff)).toBe("[STAFF] yang tutup toko");
    expect(scrubQuestionLine("budikah itu?", staff)).toBe("[STAFF] itu?");
  });

  it("is diacritic-insensitive", () => {
    expect(scrubQuestionLine("Dédénya sudah pulang", ["Dédé"])).toBe("[STAFF] sudah pulang");
    expect(scrubQuestionLine("dedenya sudah pulang", ["Dédé"])).toBe("[STAFF] sudah pulang");
  });

  it("still scrubs the plain name, an apostrophe form and the full name", () => {
    expect(scrubQuestionLine("Budi's bag", staff)).toBe("[STAFF]'s bag");
    expect(scrubQuestionLine("Budi bilang habis", staff)).toBe("[STAFF] bilang habis");
    expect(scrubQuestionLine("Budi Santoso bilang habis", staff)).toBe("[STAFF] bilang habis");
  });

  it("scrubs a clitic at the very end of the line and before punctuation", () => {
    expect(scrubQuestionLine("itu urusan Budinya", staff)).toBe("itu urusan [STAFF]");
    expect(scrubQuestionLine("Budinya, bukan saya", staff)).toBe("[STAFF], bukan saya");
  });

  it("handles a full name plus clitic without leaving a name fragment", () => {
    // the first-name token and last-name+clitic are each replaced; no part of the name survives
    expect(scrubQuestionLine("Budi Santosonya masuk", staff)).toBe("[STAFF] [STAFF] masuk");
  });

  it("does NOT scrub a different word that merely starts with a name prefix", () => {
    const ari = ["Ari"];
    expect(scrubQuestionLine("ikut arisan besok", ari)).toBe("ikut arisan besok");
    expect(scrubQuestionLine("pelajaran aritmetika", ari)).toBe("pelajaran aritmetika");
    expect(scrubQuestionLine("Arinya dan arisan", ari)).toBe("[STAFF] dan arisan");
  });

  it("does NOT scrub a clitic suffix followed by more letters, digits or underscore", () => {
    expect(scrubQuestionLine("Budinyalagi", staff)).toBe("Budinyalagi");
    expect(scrubQuestionLine("Budiku2", staff)).toBe("Budiku2");
    expect(scrubQuestionLine("Budi_nya", staff)).toBe("Budi_nya");
  });

  it("does NOT scrub a name glued onto the end of a longer word", () => {
    expect(scrubQuestionLine("xBudinya", staff)).toBe("xBudinya");
  });

  it("known gap: a nickname shorter than 3 code points is not matched", () => {
    expect(scrubQuestionLine("Bunya datang", ["Bu Ayu"])).toBe("Bunya datang");
  });

  it("returns the text untouched when there are no staff names or no text", () => {
    expect(scrubQuestionLine("Budinya", [])).toBe("Budinya");
    expect(scrubQuestionLine("", staff)).toBe("");
  });
});

describe("stripInvisibleChars (L3)", () => {
  it("removes a right-to-left override and its pop", () => {
    expect(stripInvisibleChars("roti \u202Ehabis\u202C ya")).toBe("roti habis ya");
  });

  it("removes zero-width space, joiners, marks, isolates and BOM", () => {
    expect(stripInvisibleChars("a\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff\u2066g\u2069h\uFEFFi")).toBe("abcdefghi");
  });

  it("removes C0 and C1 control characters but keeps normal spaces", () => {
    expect(stripInvisibleChars("a\u0000b\u0007c\u007fd\u0085e\u009ff g")).toBe("abcdef g");
  });

  it("turns tab and line breaks into a space so words are not glued together", () => {
    expect(stripInvisibleChars("roti\nhabis\tya\r\nbesok")).toBe("roti habis ya  besok");
  });

  it("leaves ordinary text, emoji and accents alone", () => {
    expect(stripInvisibleChars("Dédé 😀 roti habis.")).toBe("Dédé 😀 roti habis.");
  });
});

describe("scrubQuestionLine: astral characters before a name", () => {
  it("keeps the cut aligned when an emoji precedes the clitic form", () => {
    expect(scrubQuestionLine("😀😀 itu Budinya ya", ["Budi"])).toBe("😀😀 itu [STAFF] ya");
  });
});

describe("scrubQuestionLine: staff token that is also a word of the outlet name (D-1)", () => {
  const staff = ["Ari Demo", "Bella Demo"];

  it("keeps the shop name, scrubs the given names and the full name", () => {
    expect(scrubQuestionLine("Hello, Demo Bakery, thanks for calling", staff, "Demo Bakery")).toBe(
      "Hello, Demo Bakery, thanks for calling",
    );
    expect(scrubQuestionLine("Ari, Bella and Ari Demo at Demo Bakery", staff, "Demo Bakery")).toBe(
      "[STAFF], [STAFF] and [STAFF] at Demo Bakery",
    );
  });

  it("still scrubs clitic forms of the given names", () => {
    expect(scrubQuestionLine("Itu Arinya di Demo Bakery", staff, "Demo Bakery")).toBe("Itu [STAFF] di Demo Bakery");
  });

  it("compares case- and diacritic-insensitively", () => {
    expect(scrubQuestionLine("Welcome to DEMO Bakery", staff, "démo bakery")).toBe("Welcome to DEMO Bakery");
  });

  it("only exempts whole words of the outlet name (a longer outlet word does not exempt a shorter token)", () => {
    expect(scrubQuestionLine("Demo called", staff, "Demonstration Bakery")).toBe("[STAFF] called");
  });

  it("scrubs a surname that is not in the outlet name", () => {
    expect(scrubQuestionLine("Ask Santoso", ["Ari Santoso"], "Demo Bakery")).toBe("Ask [STAFF]");
  });

  it("without an outlet name behaves exactly as before", () => {
    expect(scrubQuestionLine("Hello, Demo Bakery", staff)).toBe("Hello, [STAFF] Bakery");
    expect(scrubQuestionLine("Hello, Demo Bakery", staff, undefined)).toBe("Hello, [STAFF] Bakery");
    expect(scrubQuestionLine("Hello, Demo Bakery", staff, "")).toBe("Hello, [STAFF] Bakery");
  });
});
