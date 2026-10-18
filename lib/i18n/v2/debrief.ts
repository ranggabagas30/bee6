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
  "C-d2-prep-1": "Bee6 sedang membaca catatan hari ini dan menyusun pertanyaanmu. Pertanyaanmu muncul dalam sekitar 2 sampai 4 menit, kadang sedikit lebih lama.", // PROVISIONAL
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
  // ---- R-25 T7 (boards P2-08..P2-10b, L2-07..L2-09b): page-2 debrief screens. Append-only. EN from the boards, ID PROVISIONAL. ----
  // P2-08 Preparing
  "C-d2-prep-sub": "Bee6 sedang membaca catatan hari ini dan menyusun pertanyaanmu. Ini bisa memakan waktu sedikit lebih lama.", // PROVISIONAL
  "C-d2-prep-window": "Hari {n} · jendela debrief 60 menit", // PROVISIONAL
  "C-d2-prep-window-plain": "Jendela debrief 60 menit", // PROVISIONAL
  "C-d2-prep-lead": "Biarkan halaman ini terbuka dan layar tetap menyala.", // PROVISIONAL
  "C-d2-prep-body": "Pertanyaanmu muncul di sini dalam sekitar 2 sampai 4 menit. Jika halaman ditutup, pertanyaan menunggumu, tetapi waktu debrief 60 menit terus berjalan.", // PROVISIONAL
  "C-d2-prep-locked": "Mulai terkunci sampai debrief selesai", // PROVISIONAL
  // P2-09 Question
  "C-d2-q-when": "Hari ini · {hm}", // PROVISIONAL
  "C-d2-q-left": "sisa {k} mnt", // PROVISIONAL
  "C-d2-q-progress": "Kemajuan", // PROVISIONAL
  "C-d2-q-ph": "Kenapa? Tulis alasan singkat (wajib)", // PROVISIONAL
  "C-d2-q-reason": "Alasanmu. Wajib diisi, tanpa nama.", // PROVISIONAL
  "C-d2-next": "Pertanyaan berikutnya", // PROVISIONAL
  "C-d2-why-ROUTINE_OPS": "Bee6 mendengar pekerjaan rutin di toko. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-CUSTOMER_SERVICE": "Bee6 mendengar pelanggan sedang dilayani. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-TRAINING": "Bee6 mendengar yang terdengar seperti pelatihan. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-STAFF_CONSULT": "Bee6 mendengar pertanyaan staf tentang suatu situasi. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-CORRECTION": "Bee6 mendengar yang terdengar seperti koreksi. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-PHONE_CALL": "Bee6 mendengar yang terdengar seperti telepon. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-EVENT": "Bee6 mendengar pekerjaan untuk acara terencana. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-COMPLAINT": "Bee6 mendengar yang terdengar seperti keluhan pelanggan. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-SAFETY_INCIDENT": "Bee6 mendengar yang terdengar seperti insiden keselamatan. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-SECURITY_INCIDENT": "Bee6 mendengar yang terdengar seperti insiden keamanan. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-DISRUPTION": "Bee6 mendengar yang terdengar seperti gangguan operasional. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  "C-d2-why-unlabelled": "Bee6 mendengar pekerjaan di sini tetapi belum tahu apa. Bee6 butuh jawabanmu untuk memastikan.", // PROVISIONAL
  // P2-10 Complete / P2-10b Timed out (sandbox)
  "C-d2-next-start": "Mulai berikutnya · {day} pukul {hm}", // PROVISIONAL
  "C-d2-timeout-h": "Debrief ditutup", // PROVISIONAL
  "C-d2-timeout-sub": "Waktu 60 menit habis. {k} dari {n} pertanyaan tidak dijawab dan dicatat sebagai belum terverifikasi.", // PROVISIONAL
  "C-d2-timeout-sub-one": "Waktu 60 menit habis. Pertanyaan tidak dijawab dan dicatat sebagai belum terverifikasi.", // PROVISIONAL
  "C-d2-timeout-sub-plain": "Waktu 60 menit habis. Pertanyaan yang tidak dijawab dicatat sebagai belum terverifikasi.", // PROVISIONAL
  "C-d2-unverified-word": "belum terverifikasi", // PROVISIONAL
  // demo-feedback-2 item 10 (sandbox only): lead-in above the quoted line(s) of the device's own thread; replaces the generic why sentence
  "C-d2-heard": "Bee6 mendengar:", // PROVISIONAL
} as const satisfies Record<string, string>;

export const debriefEN: Record<keyof typeof debriefID, string> = {
  "C-d2-prep-h": "Preparing your questions",
  "C-d2-prep-1": "Bee6 is reading today's notes and writing your questions. Your questions appear in about 2 to 4 minutes, sometimes a little longer.",
  "C-d2-prep-2": "Keep this page open and the screen on. If you close it, the questions wait longer, but the 60-minute debrief clock keeps running.",
  "C-d2-prep-3": "Start is locked until the debrief is done.",
  "C-d2-wait-h": "Checking for more questions…",
  "C-d2-wait-1": "Answering does not end the debrief. It ends when every question is answered or the 60 minutes are over.",
  "C-d2-done-h": "Debrief complete",
  "C-d2-done-all": "Thank you. All {n} questions are answered and today is closed.",
  "C-d2-done-all-one": "Thank you. Today's only question is answered and today is closed.",
  "C-d2-done-some": "{k} of {n} were not answered and are recorded as unverified.",
  "C-d2-timeout-unv": "Questions left unanswered are recorded as unverified.",
  "C-d2-prep-sub": "Bee6 is reading today's notes and writing your questions. This can take a little longer.",
  "C-d2-prep-window": "Day {n} · debrief window 60 min",
  "C-d2-prep-window-plain": "Debrief window 60 min",
  "C-d2-prep-lead": "Please keep this page open and the screen on.",
  "C-d2-prep-body": "Your questions appear here in about 2 to 4 minutes. If you close the page they will wait for you, but the 60-minute debrief clock keeps running.",
  "C-d2-prep-locked": "Start is locked until the debrief is done",
  "C-d2-q-when": "Today · {hm}",
  "C-d2-q-left": "{k} min left",
  "C-d2-q-progress": "Progress",
  "C-d2-q-ph": "Why? Add a short reason (required)",
  "C-d2-q-reason": "Your reason. Required, no names.",
  "C-d2-next": "Next question",
  "C-d2-why-ROUTINE_OPS": "Bee6 heard routine work in the shop. It needs your answer to be sure.",
  "C-d2-why-CUSTOMER_SERVICE": "Bee6 heard a customer being served. It needs your answer to be sure.",
  "C-d2-why-TRAINING": "Bee6 heard what sounded like training. It needs your answer to be sure.",
  "C-d2-why-STAFF_CONSULT": "Bee6 heard a staff question about a situation. It needs your answer to be sure.",
  "C-d2-why-CORRECTION": "Bee6 heard what sounded like a correction. It needs your answer to be sure.",
  "C-d2-why-PHONE_CALL": "Bee6 heard what sounded like a phone call. It needs your answer to be sure.",
  "C-d2-why-EVENT": "Bee6 heard work for a planned event. It needs your answer to be sure.",
  "C-d2-why-COMPLAINT": "Bee6 heard what sounded like a customer complaint. It needs your answer to be sure.",
  "C-d2-why-SAFETY_INCIDENT": "Bee6 heard what sounded like a safety incident. It needs your answer to be sure.",
  "C-d2-why-SECURITY_INCIDENT": "Bee6 heard what sounded like a security incident. It needs your answer to be sure.",
  "C-d2-why-DISRUPTION": "Bee6 heard what sounded like a disruption to operations. It needs your answer to be sure.",
  "C-d2-why-unlabelled": "Bee6 heard work here but could not tell what. It needs your answer to be sure.",
  "C-d2-next-start": "Next Start · {day} from {hm}",
  "C-d2-timeout-h": "Debrief closed",
  "C-d2-timeout-sub": "The 60 minutes are over. {k} of {n} questions were not answered and are recorded as unverified.",
  "C-d2-timeout-sub-one": "The 60 minutes are over. The question was not answered and is recorded as unverified.",
  "C-d2-timeout-sub-plain": "The 60 minutes are over. Questions left unanswered are recorded as unverified.",
  "C-d2-unverified-word": "unverified",
  "C-d2-heard": "Bee6 heard:",
};
