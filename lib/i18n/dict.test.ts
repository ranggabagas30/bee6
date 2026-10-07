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

  it("carries the approved upload-status and idle copy (UX-03 section 6)", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-u-up", "Mengunggah", "Uploading"],
      ["C-u-retry", "Belum terkirim · mencoba lagi", "Not sent yet · retrying"],
      ["C-u-count", "({N}x)", "({N}x)"],
      ["C-u-server", "Server sibuk", "Server busy"],
      ["C-u-ok", "Unggah berhasil", "Upload succeeded"],
      ["C-u-lost", "Sebagian suara tidak tercatat", "Some speech was not captured"],
      ["C-u-toast", "Unggah berhasil lagi", "Upload working again"],
      ["C-h-idle", "Belum mulai", "Not started"],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("has no idle-helper key: it has no approved row in UX-03 section 5.2 and no defined condition", () => {
    expect(Object.keys(ID)).not.toContain("C-h-idle-help");
    expect(Object.keys(EN)).not.toContain("C-h-idle-help");
  });

  it("carries the copy keys added 7 Oct (UX-03 copy sheet, section 6)", () => {
    const cases: Array<[DictKey, string, string]> = [
      [
        "C-u-inet",
        "Tidak ada internet. Sambungkan agar antrean terkirim.",
        "No internet. Connect so the queued items can send.",
      ],
      [
        "C-notice-pilot",
        "Suara diubah jadi catatan kerja singkat. Rekaman suara tidak disimpan.",
        "Speech becomes short work notes. Audio is not kept.",
      ],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });
});

describe("copy for the status banner after the planned close (UX-03 sections 5.2, 5.4, 6)", () => {
  it("carries the ended-automatically headline and the two Mulai notes", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-h-ended-auto", "Selesai otomatis pukul {time}", "Ended automatically at {time}"],
      [
        "C-m-closed",
        "Hari ini tutup. Mulai berikutnya {date} pukul 01:00.",
        "Closed today. Next Start {date} at 01:00.",
      ],
      [
        "C-m-window-passed",
        "Batas Mulai hari ini sudah lewat pukul {time}. Hari ini dicatat libur. Mulai lagi {date} pukul 01:00.",
        "The Start cut-off today passed at {time}. Today is recorded as a day off. Next Start {date} at 01:00.",
      ],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });
});
