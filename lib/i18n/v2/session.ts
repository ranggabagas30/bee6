/**
 * i18n v2 slice `session`: copy for the staff phone session: script drawer, closing, End, Start lock, sign-out (PR-4a, PR-4b).
 *
 * R-19 PR-0 scaffold. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`sessionEN` is typed from `sessionID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * PR-4a keys (plan sections 4.4, 5.4, 5.5, 5.6; Q6). EN is final per the plan; every ID line is PROVISIONAL
 * until Tiffany reviews it. All of them are sandbox-only on screen (the pilot never renders them).
 */

export const sessionID = {
  // Q6: "Day n of 3 · date" header on the phone (sandbox only).
  "C-sess-day-of": "Hari {n} dari {total} · {date}", // PROVISIONAL
  // 5.5: End always rendered; disabled with the closing time until "Jump to closing time".
  "C-sess-end-locked": "Selesai · tersedia saat jam tutup ({time})", // PROVISIONAL
  "C-sess-end-today": "Akhiri hari ini", // PROVISIONAL
  // 5.6: Start hidden while locked.
  "C-sess-start-locked": "Mulai terbuka besok mulai pukul 01.00", // PROVISIONAL
  "C-sess-start-jump-hint": "Gunakan Lompat ke besok di panduan juri", // PROVISIONAL
  // 5.4: the closing route's 409 not_enough_speech ({have} of {need} heard lines).
  "C-sess-closing-not-enough":
    "Bee6 belum cukup mendengar ({have} dari {need}). Tunggu beberapa detik sampai kartu terakhir terunggah, lalu coba lagi.", // PROVISIONAL
  // 4.4: why "Jump to tomorrow" is locked (one line each; `unanswered_questions` is a confirm dialog in PR-2, not a lock line).
  "C-sess-next-day-proposal_exists":
    "Bee6 sudah membuat usulan dari hari-hari ini, jadi jam toko tidak bisa maju ke hari lain. Untuk mengulang, masuk sebagai Pemilik dan atur ulang demo.", // PROVISIONAL
  "C-sess-next-day-max_days": "Ketiga hari demo sudah selesai. Keluar, lalu lanjut sebagai Supervisor.", // PROVISIONAL
  "C-sess-next-day-session_open": "Akhiri sesi hari ini dulu.", // PROVISIONAL
  "C-sess-next-day-day_not_ended": "Jalankan hari ini dulu: ketuk Mulai, bacakan kartu, lalu Selesai.", // PROVISIONAL
  "C-sess-next-day-preparing": "Bee6 masih menyiapkan pertanyaan hari ini. Coba lagi sebentar lagi.", // PROVISIONAL
  "C-sess-next-day-shift_incomplete": "Demo tidak bisa maju ke hari berikutnya. Masuk sebagai Pemilik dan atur ulang demo.", // PROVISIONAL
  "C-sess-next-day-busy": "Bee6 sedang memproses catatan hari ini. Coba lagi beberapa detik lagi.", // PROVISIONAL
} as const satisfies Record<string, string>;

export const sessionEN: Record<keyof typeof sessionID, string> = {
  "C-sess-day-of": "Day {n} of {total} · {date}",
  "C-sess-end-locked": "End · available at closing time ({time})",
  "C-sess-end-today": "End today",
  "C-sess-start-locked": "Start unlocks tomorrow from 01:00",
  "C-sess-start-jump-hint": "Use Jump to tomorrow in the judge guide",
  "C-sess-closing-not-enough":
    "Bee6 has not heard enough yet ({have} of {need}). Wait a few seconds for the last card to upload, then try again.",
  "C-sess-next-day-proposal_exists":
    "Bee6 has already written a proposal from these days, so the shop clock can't move to another day. To run the days again, sign in as Owner and reset the demo.",
  "C-sess-next-day-max_days": "All 3 demo days are done. Sign out and continue as Supervisor.",
  "C-sess-next-day-session_open": "End today's session first.",
  "C-sess-next-day-day_not_ended": "Run today first: tap Start, speak the cards, then End.",
  "C-sess-next-day-preparing": "Bee6 is still preparing today's questions. Try again in a minute.",
  "C-sess-next-day-shift_incomplete": "The demo could not move to the next day. Sign in as Owner and reset the demo.",
  "C-sess-next-day-busy": "Bee6 is busy with today's notes. Try again in a few seconds.",
};
