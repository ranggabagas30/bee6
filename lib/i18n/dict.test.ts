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

  it("carries the UX-03 upload-help keys in both languages, with the approved text", () => {
    expect(ID["C-u-retry-help"]).toBe(
      "Terkirim sendiri saat HP bisa menjangkau server.",
    );
    expect(EN["C-u-retry-help"]).toBe(
      "It sends by itself once the phone can reach the server.",
    );
    expect(ID["C-u-server-help"]).toBe(
      "Akan dicoba lagi sendiri. Tidak perlu tindakan.",
    );
    expect(EN["C-u-server-help"]).toBe(
      "It will try again on its own. No action needed.",
    );
  });

  it("keeps each new upload-help line within 59 characters in both languages", () => {
    const newKeys: DictKey[] = ["C-u-retry-help", "C-u-server-help"];
    for (const key of newKeys) {
      expect(ID[key].length, `ID ${key}`).toBeLessThanOrEqual(59);
      expect(EN[key].length, `EN ${key}`).toBeLessThanOrEqual(59);
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

describe("copy cleanup (6 Oct decisions)", () => {
  it("has no consent copy in either language (CLAUDE.md 7b: no consent gate in MVP 1)", () => {
    for (const key of ["C-cap-noconsent-h", "C-cap-noconsent-b"]) {
      expect(ID, `ID ${key}`).not.toHaveProperty(key);
      expect(EN, `EN ${key}`).not.toHaveProperty(key);
    }
  });

  it("uses the copy sheet's not-started headline in place of the paused-hours headline", () => {
    expect(ID).not.toHaveProperty("C-cap-hours-h");
    expect(EN).not.toHaveProperty("C-cap-hours-h");
    expect(ID["C-h-idle"]).toBe("Belum mulai");
    expect(EN["C-h-idle"]).toBe("Not started");
  });

  it("carries no debrief category labels: category codes are shown as the enum code", () => {
    const keys = [...Object.keys(ID), ...Object.keys(EN)];
    expect(keys.filter((k) => /categor|kategori/i.test(k))).toEqual([]);
  });
});
