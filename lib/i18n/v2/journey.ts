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

  // PR-5 (plan sections 5.3, 5.4, 7.2): the judge guide's chrome. Card bodies live in lib/demo/guide.ts and the
  // script text in lib/demo/script.ts (both bilingual data, zod-validated); these are the strings around them.
  "C-journey-guide-label": "Panduan juri", // PROVISIONAL
  "C-journey-guide-open": "Buka panduan juri", // PROVISIONAL
  "C-journey-guide-close": "Tutup panduan juri", // PROVISIONAL
  "C-journey-guide-handle": "PANDUAN JURI · TAHAP {n} DARI {total}", // PROVISIONAL
  "C-journey-guide-pill": "Panduan juri · Tahap {n} dari {total}", // PROVISIONAL
  "C-journey-guide-day": "Hari {n} dari {total}", // PROVISIONAL
  "C-journey-guide-stages": "Perjalanan Anda", // PROVISIONAL
  "C-journey-stage-done": "selesai", // PROVISIONAL
  "C-journey-stage-now": "tahap saat ini", // PROVISIONAL
  "C-journey-stage-todo": "belum", // PROVISIONAL
  "C-journey-id-soon": "Bahasa segera hadir; kartu ditampilkan dalam bahasa Inggris.", // PROVISIONAL
  "C-journey-card-of": "Kartu {n} dari {total}", // PROVISIONAL
  "C-journey-speaker-staff": "Staf", // PROVISIONAL
  "C-journey-speaker-customer": "Pelanggan", // PROVISIONAL
  "C-journey-speaker-caller": "Penelepon", // PROVISIONAL
  "C-journey-spoken": "Saya sudah mengucapkan ini", // PROVISIONAL
  "C-journey-waiting-hear": "Menunggu Bee6 mendengar kartu ini…", // PROVISIONAL
  "C-journey-catching-up": "Bee6 sedang menyusul: layanan transkripsi sedang sibuk. Lanjutkan membaca; kartu ini terbuka setelah terdengar.", // PROVISIONAL
  "C-journey-reread-stalled": "Masih menyusul. Bacakan kartu ini sekali lagi sekarang; tombol terbuka setelah salah satu bacaan terdengar.", // PROVISIONAL
  "C-journey-reread-lost": "Bacaan tadi tidak tertangkap. Bacakan kartu ini sekali lagi.", // PROVISIONAL
  "C-journey-not-picking-up": "Suara Anda tidak tertangkap?", // PROVISIONAL
  "C-journey-check-mic": "Pastikan mikrofon diizinkan.", // PROVISIONAL
  "C-journey-check-tab": "Biarkan tab ini terbuka.", // PROVISIONAL
  "C-journey-check-closer": "Bicara lebih dekat ke HP.", // PROVISIONAL
  "C-journey-previous-card": "‹ Kartu sebelumnya (hanya baca ulang)", // PROVISIONAL
  "C-journey-back-to-card": "Kembali ke kartu {n}", // PROVISIONAL
  "C-journey-jump-closing": "Lompat ke jam tutup", // PROVISIONAL
  "C-journey-jump-closing-busy": "Melompat…", // PROVISIONAL
  "C-journey-jump-locked": "Terkunci sampai semua {total} kartu diucapkan ({k} dari {total} selesai).", // PROVISIONAL
  "C-journey-jump-tomorrow": "Lompat ke besok", // PROVISIONAL
  "C-journey-jump-tomorrow-busy": "Melompat…", // PROVISIONAL
  "C-journey-jump-tomorrow-finishing": "Menyelesaikan unggahan…", // PROVISIONAL
  "C-journey-jumped": "Sekarang hari {n} dari {total}. Ketuk Mulai.", // PROVISIONAL
  "C-journey-fill-code": "Isi {code}", // PROVISIONAL
  "C-journey-filled": "Sudah terisi. Ketuk Pasang.", // PROVISIONAL
  "C-journey-fill-credentials": "Isi formulirnya", // PROVISIONAL
  "C-journey-filled-signin": "Sudah terisi. Ketuk Masuk.", // PROVISIONAL
  "C-journey-err-generic": "Tidak bisa diproses. Coba lagi.", // PROVISIONAL

  // R-25 T3 (page-2 boards P2-01 / D2-01): the entry page's role cards. The step kicker, the h1, the kicker line, the
  // strip chip and the footer keep their existing `C-web-entry-*` keys.
  "C-journey-outlet-demo": "Demo Bakery · Outlet 1", // PROVISIONAL (a fictional shop name; not translated)
  "C-journey-entry-title-staff": "Coba sebagai Staf", // PROVISIONAL
  "C-journey-entry-title-supervisor": "Coba sebagai Supervisor", // PROVISIONAL
  "C-journey-entry-title-owner": "Coba sebagai Pemilik", // PROVISIONAL
  "C-journey-entry-line-staff": "Mulai mendengarkan di perangkat yang terhubung, jalankan harinya, lalu jawab pertanyaan penutup.", // PROVISIONAL
  "C-journey-entry-line-supervisor": "Lihat harinya beserta buktinya, lalu tandai usulan sebagai layak atau tolak dengan alasan.", // PROVISIONAL
  "C-journey-entry-line-owner": "Setujui atau tolak perubahan itu, lalu lihat versi SOP yang baru.", // PROVISIONAL
  "C-journey-entry-open-staff": "Buka layar staf", // PROVISIONAL
  "C-journey-entry-open-supervisor": "Buka tampilan supervisor", // PROVISIONAL
  "C-journey-entry-open-owner": "Buka tampilan pemilik", // PROVISIONAL

  // R-25 T6 (G2-A): the guide's page-2 chrome. Append-only; ID is PROVISIONAL.
  "C-journey-guide-kicker": "PANDUAN JURI", // PROVISIONAL
  "C-journey-guide-stage-chip": "TAHAP {n} DARI {total}", // PROVISIONAL
  "C-journey-guide-demo-chip": "DEMO", // PROVISIONAL
  "C-journey-welcome": "Selamat datang", // PROVISIONAL
  "C-journey-do-now": "Lakukan sekarang", // PROVISIONAL
  "C-journey-spoken-next": "Saya sudah mengucapkan ini · kartu berikutnya", // PROVISIONAL
  "C-journey-spoken-finish": "Saya sudah mengucapkan ini · selesai", // PROVISIONAL
  "C-journey-jump-closing-at": "Lompat ke jam tutup · {time}", // PROVISIONAL
  "C-journey-jump-tomorrow-on": "Lompat ke besok · {date}", // PROVISIONAL
  "C-journey-filled-short": "Sudah terisi", // PROVISIONAL
  "C-journey-script-text": "Teks kartu naskah", // PROVISIONAL
  "C-journey-reread-hide": "Sembunyikan kartu", // PROVISIONAL
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

  "C-journey-guide-label": "Judge guide",
  "C-journey-guide-open": "Open the judge guide",
  "C-journey-guide-close": "Close the judge guide",
  "C-journey-guide-handle": "JUDGE GUIDE · STAGE {n} OF {total}",
  "C-journey-guide-pill": "Judge guide · Stage {n} of {total}",
  "C-journey-guide-day": "Day {n} of {total}",
  "C-journey-guide-stages": "Your journey",
  "C-journey-stage-done": "done",
  "C-journey-stage-now": "current step",
  "C-journey-stage-todo": "not yet",
  "C-journey-id-soon": "Bahasa coming soon; the cards are shown in English.",
  "C-journey-card-of": "Card {n} of {total}",
  "C-journey-speaker-staff": "Staff",
  "C-journey-speaker-customer": "Customer",
  "C-journey-speaker-caller": "Caller",
  "C-journey-spoken": "I have spoken this",
  "C-journey-waiting-hear": "Waiting for Bee6 to hear this card…",
  "C-journey-catching-up": "Bee6 is catching up: the transcription service is busy. Keep reading; this card unlocks when it has been heard.",
  "C-journey-reread-stalled": "Still catching up. Read this card again now; the button unlocks when either reading is heard.",
  "C-journey-reread-lost": "That reading was not captured. Read this card again.",
  "C-journey-not-picking-up": "Not picking up your voice?",
  "C-journey-check-mic": "Check the microphone is allowed.",
  "C-journey-check-tab": "Keep this tab open.",
  "C-journey-check-closer": "Speak closer to the phone.",
  "C-journey-previous-card": "‹ Previous card (re-read only)",
  "C-journey-back-to-card": "Back to card {n}",
  "C-journey-jump-closing": "Jump to closing time",
  "C-journey-jump-closing-busy": "Jumping…",
  "C-journey-jump-locked": "Locked until all {total} cards are spoken ({k} of {total} done).",
  "C-journey-jump-tomorrow": "Jump to tomorrow",
  "C-journey-jump-tomorrow-busy": "Jumping…",
  "C-journey-jump-tomorrow-finishing": "Finishing uploads…",
  "C-journey-jumped": "It is now day {n} of {total}. Tap Start.",
  "C-journey-fill-code": "Fill in {code}",
  "C-journey-filled": "Filled in. Tap Set up.",
  "C-journey-fill-credentials": "Fill in the form",
  "C-journey-filled-signin": "Filled in. Tap Sign in.",
  "C-journey-err-generic": "Could not process that. Try again.",

  "C-journey-outlet-demo": "Demo Bakery · Outlet 1",
  "C-journey-entry-title-staff": "Try as Staff",
  "C-journey-entry-title-supervisor": "Try as Supervisor",
  "C-journey-entry-title-owner": "Try as Owner",
  "C-journey-entry-line-staff": "Start listening on the connected device, run the day, answer the closing questions.",
  "C-journey-entry-line-supervisor": "See the day with evidence, then mark a proposal feasible or reject it with a reason.",
  "C-journey-entry-line-owner": "Approve or reject the change and see the new SOP version.",
  "C-journey-entry-open-staff": "Open staff screen",
  "C-journey-entry-open-supervisor": "Open supervisor view",
  "C-journey-entry-open-owner": "Open owner view",

  "C-journey-guide-kicker": "JUDGE GUIDE",
  "C-journey-guide-stage-chip": "STAGE {n} OF {total}",
  "C-journey-guide-demo-chip": "DEMO",
  "C-journey-welcome": "Welcome",
  "C-journey-do-now": "Do this now",
  "C-journey-spoken-next": "I have spoken this · next card",
  "C-journey-spoken-finish": "I have spoken this · finish",
  "C-journey-jump-closing-at": "Jump to closing time · {time}",
  "C-journey-jump-tomorrow-on": "Jump to tomorrow · {date}",
  "C-journey-filled-short": "Filled in",
  "C-journey-script-text": "Script card text",
  "C-journey-reread-hide": "Hide the card",
};
