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

  it("carries the idle-helper key, shown only when Mulai is offered (UX-03 5.2)", () => {
    expect(ID["C-h-idle-help"]).toBe("Ketuk Mulai untuk memulai sesi hari ini.");
    expect(EN["C-h-idle-help"]).toBe("Tap Start to begin today's session.");
  });

  it("carries the Mulai/Selesai/Batalkan button and panel copy (UX-03 section 6, R-P1)", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-b-mulai", "Mulai", "Start"],
      ["C-b-mulai-busy", "Memulai…", "Starting…"],
      ["C-b-selesai", "Selesai", "End"],
      ["C-b-batalkan", "Batalkan sesi", "Cancel session"],
      ["C-b-belum-lanjut", "Belum, lanjut", "Not yet, keep going"],
      ["C-b-ya-selesai", "Ya, selesai", "Yes, end"],
      ["C-b-tetap-simpan", "Tetap simpan sesi", "Keep the session"],
      ["C-b-ya-hapus", "Ya, hapus sesi", "Yes, delete session"],
      ["C-c-autoclose", "Panel ditutup. Tidak ada yang berubah.", "The panel closed. Nothing has changed."],
      ["C-h-ended", "Selesai", "Ended"],
      ["C-h-discarded", "Sesi dibatalkan", "Session cancelled"],
      ["C-srv-pending", "Menghapus dari server…", "Removing from server…"],
      ["C-srv-offline", "Akan dihapus saat online", "Will be removed when online"],
      ["C-srv-done", "Sudah dihapus", "Removed"],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("carries the parameterised Mulai/Selesai/Batalkan copy (UX-03 section 6, R-P1)", () => {
    expect(ID["C-n-selesai-from"]).toBe("Selesai bisa ditekan mulai pukul {time}.");
    expect(EN["C-n-selesai-from"]).toBe("You can tap End from {time}.");

    expect(ID["C-c-selesai-h"]).toBe("Akhiri operasional hari ini?");
    expect(EN["C-c-selesai-h"]).toBe("End today's operations?");

    expect(ID["C-c-selesai-b"]).toBe(
      "Debrief 1 jam dimulai sekarang. Tidak bisa dikembalikan. Mulai baru bisa ditekan lagi {date} pukul {time}.",
    );
    expect(EN["C-c-selesai-b"]).toBe(
      "The 1-hour debrief starts now. This cannot be undone. You can tap Start again {date} at {time}.",
    );

    expect(ID["C-c-cancel-h"]).toBe("Batalkan sesi yang dimulai pukul {time}?");
    expect(EN["C-c-cancel-h"]).toBe("Cancel the session started at {time}?");

    expect(ID["C-c-cancel-b"]).toBe(
      "Suara dan catatan sesi ini akan dihapus. Tidak bisa dikembalikan. Hari ini tidak dihitung. Mulai baru bisa ditekan lagi {date} pukul 01:00.",
    );
    expect(EN["C-c-cancel-b"]).toBe(
      "Its audio and notes will be deleted. This cannot be undone. Today does not count. You can tap Start again {date} at 01:00.",
    );

    expect(ID["C-c-cancel-b-now"]).toBe(
      "Suara dan catatan sesi ini akan dihapus. Tidak bisa dikembalikan. Hari ini tidak dihitung. Mulai baru bisa ditekan segera.",
    );
    expect(EN["C-c-cancel-b-now"]).toBe(
      "Its audio and notes will be deleted. This cannot be undone. Today does not count. You can tap Start again straight away.",
    );

    expect(ID["C-m-day-ended"]).toBe(
      "Hari operasional {endedDate} sudah selesai. Mulai bisa ditekan lagi {date} pukul {time}.",
    );
    expect(EN["C-m-day-ended"]).toBe(
      "The business day {endedDate} has ended. You can tap Start again {date} at {time}.",
    );

    expect(ID["C-m-debrief"]).toBe(
      "Debrief berlangsung sampai pukul {debriefUntil}. Mulai bisa ditekan lagi {date} pukul {time}.",
    );
    expect(EN["C-m-debrief"]).toBe(
      "The debrief runs until {debriefUntil}. You can tap Start again {date} at {time}.",
    );
  });

  it("carries a provisional fallback for a session-route failure, never the server's raw message", () => {
    // Not in the UX-03 copy sheet (no approved row exists for a Mulai/Selesai
    // rejection or a Batalkan-after-ended race); flagged for UI/UX sign-off.
    expect(ID["C-sess-err"]).toBe("Tidak bisa memproses itu. Coba lagi.");
    expect(EN["C-sess-err"]).toBe("Could not process that. Try again.");
    expect(ID["C-c-discard-failed"]).toBe("Sesi ini sudah berakhir. Muat ulang halaman.");
    expect(EN["C-c-discard-failed"]).toBe("This session has already ended. Reload the page.");
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
