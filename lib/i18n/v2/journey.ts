/**
 * i18n v2 slice `journey`: copy for the 3-day judge journey: judge guide, entry page, script cards (PR-5, PR-6, PR-7).
 *
 * R-19 PR-0 scaffold. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`journeyEN` is typed from `journeyID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * PR-2 (plan section 4.4): the "Jump to tomorrow" refusals. One key per `NextDayRefusal` code
 * (`C-journey-next-day-<code>`; for `unanswered_questions` it is the confirm dialog's title) plus the dialog's
 * body and two buttons. EN is final; ID is PROVISIONAL until reviewed.
 */

export const journeyID = {
  "C-journey-next-day-proposal_exists":
    "Bee6 sudah membuat usulan dari hari-hari ini, jadi jam toko tidak bisa maju ke hari lain. Untuk mengulang, masuk sebagai Pemilik dan atur ulang demo.", // PROVISIONAL
  "C-journey-next-day-max_days": "Ketiga hari demo sudah selesai. Keluar, lalu lanjut sebagai Supervisor.", // PROVISIONAL
  "C-journey-next-day-session_open": "Akhiri sesi hari ini dulu.", // PROVISIONAL
  "C-journey-next-day-day_not_ended": "Jalankan hari ini dulu: ketuk Mulai, bacakan kartu, lalu Selesai.", // PROVISIONAL
  "C-journey-next-day-preparing": "Bee6 masih menyiapkan pertanyaan hari ini. Coba lagi sebentar lagi.", // PROVISIONAL
  "C-journey-next-day-unanswered_questions": "Biarkan {n} pertanyaan tidak dijawab?", // PROVISIONAL
  "C-journey-next-day-unanswered-body":
    "Jika Anda lompat ke besok sekarang, debrief hari ini berakhir dan pertanyaan ini dicatat sebagai belum terverifikasi.", // PROVISIONAL
  "C-journey-next-day-unanswered-answer-first": "Jawab dulu", // PROVISIONAL
  "C-journey-next-day-unanswered-jump-anyway": "Tetap lompat", // PROVISIONAL
  "C-journey-next-day-shift_incomplete": "Demo tidak bisa maju ke hari berikutnya. Masuk sebagai Pemilik dan atur ulang demo.", // PROVISIONAL
  "C-journey-next-day-busy": "Bee6 sedang memproses catatan hari ini. Coba lagi beberapa detik lagi.", // PROVISIONAL
} as const satisfies Record<string, string>;

export const journeyEN: Record<keyof typeof journeyID, string> = {
  "C-journey-next-day-proposal_exists":
    "Bee6 has already written a proposal from these days, so the shop clock can't move to another day. To run the days again, sign in as Owner and reset the demo.",
  "C-journey-next-day-max_days": "All 3 demo days are done. Sign out and continue as Supervisor.",
  "C-journey-next-day-session_open": "End today's session first.",
  "C-journey-next-day-day_not_ended": "Run today first: tap Start, speak the cards, then End.",
  "C-journey-next-day-preparing": "Bee6 is still preparing today's questions. Try again in a minute.",
  "C-journey-next-day-unanswered_questions": "Leave {n} questions unanswered?",
  "C-journey-next-day-unanswered-body": "If you jump to tomorrow now, today's debrief ends and these questions are recorded as unverified.",
  "C-journey-next-day-unanswered-answer-first": "Answer them first",
  "C-journey-next-day-unanswered-jump-anyway": "Jump anyway",
  "C-journey-next-day-shift_incomplete": "The demo could not move to the next day. Sign in as Owner and reset the demo.",
  "C-journey-next-day-busy": "Bee6 is busy with today's notes. Try again in a few seconds.",
};
