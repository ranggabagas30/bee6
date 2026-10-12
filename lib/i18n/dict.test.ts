import { describe, expect, it } from "vitest";
import { DICT, ID, EN, type DictKey, t } from "@/lib/i18n/dict";

const placeholders = (text: string) =>
  [...text.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]).sort().join(",");

describe("copy dictionary", () => {
  it("has exactly the same keys in Bahasa Indonesia and English", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ID).sort());
  });

  // C-d-q-block-2 is the only key allowed an empty ID line: the ID debrief
  // headline (C-d-q-block) is one line, the EN one is two (section 7.4 of
  // docs/tasks/R-07-plan.md); the question screen skips an empty line.
  const EMPTY_ID_ALLOWED: ReadonlySet<DictKey> = new Set(["C-d-q-block-2"] as DictKey[]);

  it("has a non-empty, trimmed value for every key in both languages", () => {
    for (const key of Object.keys(ID) as DictKey[]) {
      if (!EMPTY_ID_ALLOWED.has(key)) {
        expect(ID[key].trim().length, `ID ${key}`).toBeGreaterThan(0);
      }
      expect(EN[key].trim(), `EN ${key}`).toBe(EN[key]);
      expect(ID[key].trim(), `ID ${key}`).toBe(ID[key]);
      expect(EN[key].trim().length, `EN ${key}`).toBeGreaterThan(0);
    }
  });

  // The EN singular ("count = 1") rows hardcode the literal 1 instead of a
  // placeholder (section 5.12.4: the value is always exactly 1 when these
  // keys are chosen), while the unchanged ID row keeps its template
  // placeholder — same key, deliberately different placeholder sets. A
  // caller always passes the same vars regardless of which key it picked.
  const EN_SINGULAR_HARDCODED: ReadonlySet<DictKey> = new Set([
    "C-d-entry-left-one",
    "C-d-entry-n-one",
    "C-d-over-one",
    "C-d-done-unsent-one",
    "C-d-done-skip-one",
  ] as DictKey[]);

  it("uses the same placeholders in both languages for every key", () => {
    for (const key of Object.keys(ID) as DictKey[]) {
      if (EN_SINGULAR_HARDCODED.has(key)) continue;
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

describe("debrief copy keys (R-07 Task 7.4, UX-03 section 6)", () => {
  it("carries the entry card, loading, error and empty-state copy", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-d-entry-h", "Debrief berjalan", "Debrief running"],
      ["C-d-entry-left", "Sisa {mm} menit.", "{mm} minutes left."],
      ["C-d-entry-n", "{N} pertanyaan.", "{N} questions."],
      ["C-d-btn", "Jawab pertanyaan", "Answer questions"],
      ["C-d-takes", "Butuh sekitar 5 menit.", "Takes about 5 minutes."],
      ["C-d-next", "Mulai bisa ditekan lagi {day} pukul {hm}.", "You can tap Start again {day} at {hm}."],
      ["C-d-load", "Memuat pertanyaan…", "Loading questions…"],
      ["C-d-load-2", "Biasanya beberapa detik.", "Usually takes a few seconds."],
      ["C-d-err", "Pertanyaan belum bisa dimuat.", "Questions could not load yet."],
      ["C-d-err-2", "Cek koneksi, lalu coba lagi.", "Check the connection, then try again."],
      ["C-d-empty-h", "Tidak ada pertanyaan hari ini.", "There are no questions today."],
      ["C-d-empty-h-2", "Terima kasih.", "Thank you."],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("carries the question-screen copy (progress, template, choice, reason, counter)", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-d-prog", "Pertanyaan {N} dari {M}", "Question {N} of {M}"],
      ["C-d-q-step", "Sekitar pukul {hm} ada {step}. Benar?", "Around {hm} there was {step}. Is that right?"],
      [
        "C-d-q-block",
        "Sekitar pukul {hm}–{hm_end} ada kegiatan kerja. Benar?",
        "Between {hm} and {hm_end} there was work.",
      ],
      ["C-d-q-block-2", "", "Is that right?"],
      ["C-d-yes", "Ya", "Yes"],
      ["C-d-no", "Tidak", "No"],
      ["C-d-r-yes", "Sudah sesuai SOP? Kalau belum, kenapa?", "Did it follow the SOP? If not, why?"],
      ["C-d-r-yes-2", "Wajib diisi, tanpa nama.", "Required. No names."],
      ["C-d-r-no", "Kenapa tidak? Ceritakan singkat.", "Why not? Tell us briefly."],
      ["C-d-r-no-2", "Wajib diisi, tanpa nama.", "Required. No names."],
      ["C-d-count", "{N}/500", "{N}/500"],
      ["C-d-count-warn", "{N}/500 · {M} lagi", "{N}/500 · {M} left"],
      ["C-d-over", "Terlalu panjang. Kurangi {N} karakter.", "Too long. Remove {N} characters."],
      ["C-d-help-dis", "Pilih Ya atau Tidak, lalu isi alasan.", "Choose Yes or No, then give a reason."],
      ["C-d-locked", "Jawaban yang sudah Lanjut tidak bisa diubah.", "An answer sent with Next cannot be changed."],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("carries the save-fail, refused and offline copy", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-d-save-fail", "Jawaban belum tersimpan di HP ini.", "The answer is not saved on this phone yet."],
      [
        "C-d-save-fail-2",
        "HP tidak bisa menyimpan. Teks kamu masih ada.",
        "The phone could not save it. Your text is still here.",
      ],
      ["C-d-save-fail-3", "Coba Lanjut lagi.", "Try Next again."],
      ["C-d-refused", "Belum terkirim. Akan dicoba lagi otomatis.", "Not sent yet. It will be retried automatically."],
      ["C-d-refused-2", "Jawaban tetap tersimpan di HP ini.", "The answer stays saved on this phone."],
      ["C-d-offline", "Tersimpan di HP. Akan dikirim saat online.", "Saved on the phone. Will be sent when online."],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("carries the done screen and timeout copy", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-d-done-h", "Debrief selesai. Terima kasih.", "Debrief complete. Thank you."],
      ["C-d-done-l", "Jawabanmu sudah tersimpan.", "Your answers are saved."],
      ["C-d-done-unsent", "Masih ada {N} jawaban belum terkirim.", "{N} answers are not sent yet."],
      ["C-d-done-unsent-2", "Akan dikirim saat online.", "They will be sent when online."],
      ["C-d-done-skip", "{N} pertanyaan dilewati.", "{N} questions skipped."],
      ["C-d-done-skip-2", "Bisa dijawab sampai pukul {hm}.", "You can answer them until {hm}."],
      ["C-d-done-mulai", "Mulai bisa ditekan lagi {day} pukul {hm}.", "You can tap Start again {day} at {hm}."],
      ["C-d-timeout", "Waktu debrief habis pukul {hm}.", "The debrief time ran out at {hm}."],
      ["C-d-timeout-2", "Jawaban yang sudah Lanjut tetap tersimpan.", "Answers sent with Next are kept."],
      ["C-d-timeout-3", "Teks yang belum Lanjut tidak tersimpan.", "Text not sent with Next is not saved."],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("carries the shared Back/Skip/Next/Try-again buttons (new keys, not yet in the dict)", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-b-kembali", "Kembali", "Back"],
      ["C-b-lewati", "Lewati", "Skip"],
      ["C-b-lanjut", "Lanjut", "Next"],
      ["C-b-coba", "Coba lagi", "Try again"],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("carries the EN singular forms (count = 1); the ID column is unchanged", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-d-entry-left-one", "Sisa {mm} menit.", "1 minute left."],
      ["C-d-entry-n-one", "{N} pertanyaan.", "1 question."],
      ["C-d-over-one", "Terlalu panjang. Kurangi {N} karakter.", "Too long. Remove 1 character."],
      ["C-d-done-unsent-one", "Masih ada {N} jawaban belum terkirim.", "1 answer is not sent yet."],
      ["C-d-done-skip-one", "{N} pertanyaan dilewati.", "1 question skipped."],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("fills the debrief count/time/step placeholders without leaving a raw token", () => {
    expect(t("en", "C-d-prog", { N: 2, M: 4 })).toBe("Question 2 of 4");
    expect(t("id", "C-d-prog", { N: 2, M: 4 })).toBe("Pertanyaan 2 dari 4");
    expect(t("en", "C-d-q-step", { hm: "15:00", step: "a restock" })).toBe(
      "Around 15:00 there was a restock. Is that right?",
    );
    expect(t("en", "C-d-count-warn", { N: 450, M: 50 })).toBe("450/500 · 50 left");
  });
});

describe("approval screen copy (R-09 Task 6)", () => {
  it("carries the status, list, review-line and notice copy", () => {
    const cases: Array<[DictKey, string, string]> = [
      ["C-prop-st-awaiting-owner", "Menunggu persetujuan pemilik", "Waiting for owner approval"],
      ["C-prop-st-approved", "Disetujui", "Approved"],
      ["C-prop-st-rejected", "Ditolak", "Rejected"],
      ["C-prop-list-open", "Usulan terbuka", "Open proposals"],
      ["C-prop-list-decided", "Baru diputuskan", "Recently decided"],
      ["C-prop-list-empty", "Belum ada usulan terbuka.", "No open proposals."],
      ["C-prop-rev-feasible", "Supervisor menandai layak pada {date}.", "The supervisor marked this feasible on {date}."],
      ["C-prop-rev-approved", "Pemilik menyetujui pada {date}.", "The owner approved this on {date}."],
      ["C-prop-use-dates", "Pakai tanggal ini", "Use these dates"],
      ["C-con-src-owner-rejection", "Dari usulan yang ditolak pemilik", "From a proposal the owner rejected"],
    ];
    for (const [key, id, en] of cases) {
      expect(ID[key], `ID ${key}`).toBe(id);
      expect(EN[key], `EN ${key}`).toBe(en);
    }
  });

  it("keeps the supervisor and owner reject copy symmetric (Q-1 = yes)", () => {
    expect(EN["C-prop-reason-hint-owner"]).toBe(EN["C-prop-reason-hint-sup"]);
    expect(ID["C-prop-reason-hint-owner"]).toBe(ID["C-prop-reason-hint-sup"]);
    expect(EN["C-prop-confirm-reject-owner"]).toBe(EN["C-prop-confirm-reject-sup"]);
    expect(EN["C-prop-done-rejected-owner"]).toBe(EN["C-prop-done-rejected-sup"]);
  });

  it("fills the date placeholders of the review lines", () => {
    expect(t("en", "C-prop-rev-sup-rejected", { date: "Mon 5 Oct" })).toBe(
      "The supervisor rejected this on Mon 5 Oct. Reason:",
    );
  });
});
