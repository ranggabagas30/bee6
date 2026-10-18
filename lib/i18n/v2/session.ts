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
 *
 * Emphasis: a value may wrap a phrase in `**double asterisks**` (the sign-out sheets, boards P2-07a/b); the dialog renders
 * it as <strong>. Plain `t()` consumers must not show these keys.
 *
 * PR-4b keys (plan sections 5.7, 5.7a): the demo staff sign-out button and its two dialogs (P2-07a/b), and the
 * "session still open" view (P2-07c). Same rules; sandbox-only on screen.
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
  // Backstop: Batalkan refused with 409 closing_reached (the sandbox reached closing time; retrying cannot help).
  "C-sess-cancel-closed": "Hari ini sudah mencapai jam tutup, jadi sesi tidak bisa dibatalkan. Ketuk Akhiri hari ini.", // PROVISIONAL
  // 4.4: why "Jump to tomorrow" is locked (one line each; `unanswered_questions` is a confirm dialog in PR-2, not a lock line).
  "C-sess-next-day-proposal_exists":
    "Bee6 sudah membuat usulan dari hari-hari ini, jadi jam toko tidak bisa maju ke hari lain. Untuk mengulang, masuk sebagai Pemilik dan atur ulang demo.", // PROVISIONAL
  "C-sess-next-day-max_days": "Kelima hari demo sudah selesai. Keluar, lalu lanjut sebagai Supervisor.", // PROVISIONAL
  "C-sess-next-day-approve_first": "Days 4 and 5 open after the Owner approves a change. Sign out and continue as Supervisor.", // PROVISIONAL (= EN)
  "C-sess-next-day-review_exists": "A review already exists, so the demo days are finished. Sign out and open Reviews.", // PROVISIONAL (= EN)
  "C-sess-next-day-session_open": "Akhiri sesi hari ini dulu.", // PROVISIONAL
  "C-sess-next-day-day_not_ended": "Jalankan hari ini dulu: ketuk Mulai, bacakan kartu, lalu Selesai.", // PROVISIONAL
  "C-sess-next-day-preparing": "Bee6 masih menyiapkan pertanyaan hari ini. Coba lagi sebentar lagi.", // PROVISIONAL
  "C-sess-next-day-shift_incomplete": "Demo tidak bisa maju ke hari berikutnya. Masuk sebagai Pemilik dan atur ulang demo.", // PROVISIONAL
  "C-sess-next-day-busy": "Bee6 sedang memproses catatan hari ini. Coba lagi beberapa detik lagi.", // PROVISIONAL
  // 5.7: staff sign-out (demo only). Local: no session is deleted by it, apart from the cancel in the first dialog.
  "C-sess-signout": "Keluar", // PROVISIONAL
  "C-sess-signout-finishing": "Menyelesaikan unggahan…", // PROVISIONAL
  "C-sess-signout-running-h": "Keluar dan batalkan hari ini?", // PROVISIONAL
  "C-sess-signout-running-b":
    "Sesi hari ini masih berjalan. Jika Anda keluar sekarang, sesi dibatalkan: catatan hari ini dihapus dan hari ini tidak dihitung. **Ini juga memutuskan ponsel ini, jadi Anda perlu kode 6 digit baru untuk memakainya lagi.**", // PROVISIONAL
  "C-sess-signout-keep": "Tetap mendengarkan", // PROVISIONAL
  "C-sess-signout-cancel": "Keluar dan batalkan", // PROVISIONAL
  "C-sess-signout-closed-h": "Keluar?", // PROVISIONAL
  "C-sess-signout-closed-b":
    "Jam tutup sudah lewat, jadi sesi hari ini tidak bisa dibatalkan lagi. Sesi tetap terbuka sampai Anda kembali dan mengetuk Selesai, lalu debrief berjalan selama 60 menit. Pertanyaan yang tidak dijawab dicatat sebagai **belum terverifikasi**. Keluar akan memutuskan ponsel ini.", // PROVISIONAL
  "C-sess-signout-stay": "Tetap di sini", // PROVISIONAL
  "C-sess-signout-anyway": "Tetap keluar", // PROVISIONAL
  // 5.7a: the still-open session found again on return (the phone never resumes listening into it).
  "C-sess-open-reached-h": "Sesi hari ini masih terbuka", // PROVISIONAL
  "C-sess-open-reached-b": "Jam tutup sudah lewat. Ketuk Selesai untuk memulai debrief. Berjalan selama 60 menit.", // PROVISIONAL
  "C-sess-open-interrupted-h": "Sesi hari ini terputus", // PROVISIONAL
  "C-sess-open-interrupted-b": "Batalkan sesi ini dan mulai hari ini lagi.", // PROVISIONAL
  "C-sess-open-cancel": "Batalkan hari ini", // PROVISIONAL

  // R-25 T5 (boards P2-04..P2-06 / L2-02..L2-04): the page-2 staff screen on a sandbox. EN is final from the boards.
  "C-sess-ready-h": "Siap buka", // PROVISIONAL
  "C-sess-ready-sub": "Ketuk Mulai untuk mulai mendengarkan. Staf tetap melayani pelanggan seperti biasa.", // PROVISIONAL
  "C-sess-listening-sub-1": "Fokus pada pelanggan Anda.", // PROVISIONAL
  "C-sess-listening-sub-2": "Kami yang mencatat.", // PROVISIONAL
  "C-sess-closing-sub": "Jam tutup sudah lewat. Ketuk Akhiri saat operasional selesai.", // PROVISIONAL
  "C-sess-signout-running-link": "Keluar (membatalkan sesi hari ini)", // PROVISIONAL
  "C-sess-open-note": "Anda keluar sebelum mengakhiri. Tidak ada yang hilang.", // PROVISIONAL
} as const satisfies Record<string, string>;

export const sessionEN: Record<keyof typeof sessionID, string> = {
  "C-sess-day-of": "Day {n} of {total} · {date}",
  "C-sess-end-locked": "End · available at closing time ({time})",
  "C-sess-end-today": "End today",
  "C-sess-start-locked": "Start unlocks tomorrow from 01:00",
  "C-sess-start-jump-hint": "Use Jump to tomorrow in the judge guide",
  "C-sess-cancel-closed": "Today has reached closing time, so the session can't be cancelled. Tap End today.",
  "C-sess-closing-not-enough":
    "Bee6 has not heard enough yet ({have} of {need}). Wait a few seconds for the last card to upload, then try again.",
  "C-sess-next-day-proposal_exists":
    "Bee6 has already written a proposal from these days, so the shop clock can't move to another day. To run the days again, sign in as Owner and reset the demo.",
  "C-sess-next-day-max_days": "All 5 demo days are done. Sign out and continue as Supervisor.",
  "C-sess-next-day-approve_first": "Days 4 and 5 open after the Owner approves a change. Sign out and continue as Supervisor.",
  "C-sess-next-day-review_exists": "A review already exists, so the demo days are finished. Sign out and open Reviews.",
  "C-sess-next-day-session_open": "End today's session first.",
  "C-sess-next-day-day_not_ended": "Run today first: tap Start, speak the cards, then End.",
  "C-sess-next-day-preparing": "Bee6 is still preparing today's questions. Try again in a minute.",
  "C-sess-next-day-shift_incomplete": "The demo could not move to the next day. Sign in as Owner and reset the demo.",
  "C-sess-next-day-busy": "Bee6 is busy with today's notes. Try again in a few seconds.",
  "C-sess-signout": "Sign out",
  "C-sess-signout-finishing": "Finishing uploads…",
  "C-sess-signout-running-h": "Sign out and cancel today?",
  "C-sess-signout-running-b":
    "Today's session is still running. If you sign out now it is cancelled: the notes from today are deleted and today does not count. **This also unpairs the phone, so you need a new 6-digit code to use it again.**",
  "C-sess-signout-keep": "Keep listening",
  "C-sess-signout-cancel": "Sign out and cancel",
  "C-sess-signout-closed-h": "Sign out?",
  "C-sess-signout-closed-b":
    "Closing time has passed, so today's session can no longer be cancelled. It stays open until you come back and tap End, then the debrief runs for 60 minutes. Questions left unanswered are recorded as **unverified**. Signing out unpairs the phone.",
  "C-sess-signout-stay": "Stay",
  "C-sess-signout-anyway": "Sign out anyway",
  "C-sess-open-reached-h": "Today's session is still open",
  "C-sess-open-reached-b": "Closing time has passed. Tap End to start the debrief. It runs for 60 minutes.",
  "C-sess-open-interrupted-h": "Today's session was interrupted",
  "C-sess-open-interrupted-b": "Cancel it and start today again.",
  "C-sess-open-cancel": "Cancel today",

  "C-sess-ready-h": "Ready to open",
  "C-sess-ready-sub": "Tap Start to begin listening. Staff keep serving customers as normal.",
  "C-sess-listening-sub-1": "Focus on your customers.",
  "C-sess-listening-sub-2": "We'll keep the notes.",
  "C-sess-closing-sub": "Closing time has passed. Tap End when operations are done.",
  "C-sess-signout-running-link": "Sign out (cancels today's session)",
  "C-sess-open-note": "You signed out before ending. Nothing was lost.",
};
