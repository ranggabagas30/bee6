/**
 * i18n v2 slice `debrief`: copy for the debrief: preparing, waiting-more, done (PR-3).
 *
 * R-19 PR-0 scaffold. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`debriefEN` is typed from `debriefID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * PR-3 keys (`docs/tasks/R-19-demo-v2.md` §6.3, boards P2-08 Preparing, P2-09 Question, P2-10 Complete /
 * TimedOut). Sandbox judge devices only: a pilot phone never renders any of them. EN is final; ID PROVISIONAL.
 */

export const debriefID = {
  // P2-08 Preparing your questions (W7: keep the page open and the screen on)
  "C-d2-prep-h": "Menyiapkan pertanyaanmu", // PROVISIONAL
  "C-d2-prep-1": "Bee6 sedang membaca catatan hari ini untuk menentukan apa yang perlu ditanyakan. Pertanyaanmu muncul dalam sekitar 2 sampai 4 menit.", // PROVISIONAL
  "C-d2-prep-2": "Biarkan halaman ini terbuka dan layar tetap menyala. Jika ditutup, pertanyaan menunggu lebih lama, tetapi waktu debrief 60 menit terus berjalan.", // PROVISIONAL
  "C-d2-prep-3": "Mulai terkunci sampai debrief selesai.", // PROVISIONAL
  // waiting for more (every offered question answered, server still labelling)
  "C-d2-wait-h": "Memeriksa pertanyaan lain…", // PROVISIONAL
  "C-d2-wait-1": "Menjawab tidak mengakhiri debrief. Debrief berakhir saat semua pertanyaan terjawab atau 60 menit habis.", // PROVISIONAL
  // P2-10 Debrief complete (terminal on a sandbox: no Back)
  "C-d2-done-h": "Debrief selesai", // PROVISIONAL
  "C-d2-done-all": "Terima kasih. Semua {n} pertanyaan sudah dijawab dan hari ini ditutup.", // PROVISIONAL
  "C-d2-done-all-one": "Terima kasih. Satu-satunya pertanyaan hari ini sudah dijawab dan hari ini ditutup.", // PROVISIONAL
  "C-d2-done-some": "{k} dari {n} tidak dijawab dan dicatat sebagai belum terverifikasi.", // PROVISIONAL
  // P2-10b Timed out: one extra line under the unchanged timeout copy
  "C-d2-timeout-unv": "Pertanyaan yang tidak dijawab dicatat sebagai belum terverifikasi.", // PROVISIONAL
} as const satisfies Record<string, string>;

export const debriefEN: Record<keyof typeof debriefID, string> = {
  "C-d2-prep-h": "Preparing your questions",
  "C-d2-prep-1": "Bee6 is reading today's notes to decide what to ask. Your questions appear in about 2 to 4 minutes.",
  "C-d2-prep-2": "Keep this page open and the screen on. If you close it, the questions wait longer, but the 60-minute debrief clock keeps running.",
  "C-d2-prep-3": "Start is locked until the debrief is done.",
  "C-d2-wait-h": "Checking for more questions…",
  "C-d2-wait-1": "Answering does not end the debrief. It ends when every question is answered or the 60 minutes are over.",
  "C-d2-done-h": "Debrief complete",
  "C-d2-done-all": "Thank you. All {n} questions are answered and today is closed.",
  "C-d2-done-all-one": "Thank you. Today's only question is answered and today is closed.",
  "C-d2-done-some": "{k} of {n} were not answered and are recorded as unverified.",
  "C-d2-timeout-unv": "Questions left unanswered are recorded as unverified.",
};
