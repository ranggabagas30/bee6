import { describe, expect, it } from "vitest";
import { DICT, ID, EN, type DictKey, t } from "@/lib/i18n/dict";

const placeholders = (text: string) =>
  [...text.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]).sort().join(",");

describe("copy dictionary", () => {
  it("has exactly the same keys in Bahasa Indonesia and English", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ID).sort());
  });

  it("has a non-empty, trimmed value for every key in both languages", () => {
    for (const key of Object.keys(ID) as DictKey[]) {
      expect(ID[key].trim().length, `ID ${key}`).toBeGreaterThan(0);
      expect(EN[key].trim(), `EN ${key}`).toBe(EN[key]);
      expect(ID[key].trim(), `ID ${key}`).toBe(ID[key]);
      expect(EN[key].trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  it("uses the same placeholders in both languages for every key", () => {
    for (const key of Object.keys(ID) as DictKey[]) {
      expect(placeholders(EN[key]), key).toBe(placeholders(ID[key]));
    }
  });

  it("maps each language to its own table", () => {
    expect(DICT.id).toBe(ID);
    expect(DICT.en).toBe(EN);
  });

  it("returns the table value for the chosen language", () => {
    expect(t("en", "C-lang-group")).toBe("Choose language");
    expect(t("id", "C-lang-group")).toBe("Pilih bahasa");
    expect(t("id", "C-lang-en")).toBe("English");
    expect(t("en", "C-lang-id")).toBe("Bahasa Indonesia");
  });

  it("fills placeholders from vars and never leaves a token behind", () => {
    expect(t("en", "C-pair-ok-line", { outlet_id: "outlet-7" })).toBe(
      "For outlet outlet-7",
    );
    expect(t("id", "C-pair-ok-line", { outlet_id: "outlet-7" })).toBe(
      "Untuk outlet outlet-7",
    );
  });

  it("throws when a placeholder has no value, rather than showing a raw token", () => {
    expect(() => t("en", "C-pair-ok-line")).toThrow(/outlet_id/);
  });
});
