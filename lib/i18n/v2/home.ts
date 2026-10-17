/**
 * i18n v2 slice `home`: copy for the owner Home (PR-8).
 *
 * R-19 PR-0 scaffold: starts empty. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`homeEN` is typed from `homeID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * PR-7 (plan section 8.4; board D2-07b): the owner's "Reset the demo" control, its confirm dialog and the notice shown
 * on the owner Home after a reset. EN is final (the dialog and failure text are the plan's); ID is PROVISIONAL.
 *
 * PR-8 (plan section 9.2; page-1 W4; boards D2-07, D2-07c): the greeting, the "Waiting for your approval" list, the
 * Progress card (Week / Month / Since start; Approved · started, waiting for review / Rejected), the "Today in five
 * lines" heading, Next review and "Cost per outlet · coming soon". EN is the plan's; ID is PROVISIONAL. The base keys
 * `C-home-title`, `C-home-more` and `C-home-to-day` stay in dict.ts; the empty states reuse the `web` slice
 * (`C-web-empty-appr-*`, `C-web-empty-tile*`). Kicker labels are passed already upper-cased.
 *
 * R-25 T13 (R15; boards D2-07, D2-07b, D2-07c): greeting with a full stop and the `hello` line, progress as one
 * sentence, the waiting card (sub, rows, "One change at a time" box, after-decisions state), the five-lines link,
 * Next review and cost as the board words them, and the reset dialog's final copy. Append-only: no key is renamed or
 * removed (the tile keys stay, unused). New Bahasa is PROVISIONAL.
 */

export const homeID = {
  "C-home-reset-open": "Atur ulang demo", // PROVISIONAL
  "C-home-reset-title": "Atur ulang demo ini?", // PROVISIONAL
  "C-home-reset-body":
    "Ini mengembalikan salinan demo ini ke hari 1: SOP asli, tanpa usulan, dan tanpa catatan dari hari-hari Anda. Hanya data fiktif. Tindakan ini tidak bisa dibatalkan.", // PROVISIONAL
  "C-home-reset-cancel": "Batal", // PROVISIONAL
  "C-home-reset-confirm": "Atur ulang demo", // PROVISIONAL
  "C-home-reset-working": "Mengatur ulang…", // PROVISIONAL
  "C-home-reset-failed": "Pengaturan ulang tidak selesai. Buka halaman awal dan mulai demo baru.", // PROVISIONAL
  "C-home-reset-busy": "Bee6 sedang sibuk. Coba lagi beberapa detik lagi.", // PROVISIONAL
  "C-home-reset-done": "Demo diatur ulang ke hari 1", // PROVISIONAL
  "C-home-greeting-morning": "Selamat pagi.", // PROVISIONAL
  "C-home-greeting-afternoon": "Selamat siang.", // PROVISIONAL
  "C-home-greeting-evening": "Selamat malam.", // PROVISIONAL
  "C-home-waiting-h": "Menunggu persetujuan Anda · {n}", // PROVISIONAL
  "C-home-waiting-row": "Supervisor menandainya layak", // PROVISIONAL
  "C-home-waiting-review": "Tinjau", // PROVISIONAL
  "C-home-waiting-review-a11y": "Tinjau: {title}", // PROVISIONAL
  "C-home-waiting-more": "+{n} lagi di Persetujuan", // PROVISIONAL
  "C-home-progress-h": "Kemajuan", // PROVISIONAL
  "C-home-progress-window": "Rentang kemajuan", // PROVISIONAL
  "C-home-progress-week": "Minggu", // PROVISIONAL
  "C-home-progress-month": "Bulan", // PROVISIONAL
  "C-home-progress-since": "Sejak awal", // PROVISIONAL
  "C-home-progress-approved": "DISETUJUI", // PROVISIONAL
  "C-home-progress-approved-detail": "dimulai, menunggu tinjauan", // PROVISIONAL
  "C-home-progress-rejected": "DITOLAK", // PROVISIONAL
  "C-home-lines-h": "Hari ini dalam lima baris", // PROVISIONAL
  "C-home-review-h": "TINJAUAN BERIKUTNYA", // PROVISIONAL
  "C-home-cost-h": "BIAYA PER OUTLET", // PROVISIONAL
  "C-home-cost-soon": "Segera hadir", // PROVISIONAL
  "C-home-hello": "{date} · begini keadaannya sekarang.", // PROVISIONAL
  "C-home-progress-kick-week": "KEMAJUAN · MINGGU INI", // PROVISIONAL
  "C-home-progress-kick-month": "KEMAJUAN · BULAN INI", // PROVISIONAL
  "C-home-progress-kick-since": "KEMAJUAN · SEJAK AWAL", // PROVISIONAL
  "C-home-progress-in-week": "minggu ini", // PROVISIONAL
  "C-home-progress-in-month": "bulan ini", // PROVISIONAL
  "C-home-progress-in-since": "sejak awal", // PROVISIONAL
  "C-home-progress-line": "{approved} disetujui dan {rejected} ditolak {window}.", // PROVISIONAL
  "C-home-progress-sub": "Perubahan yang disetujui ditinjau pada tanggal yang ditetapkan. Perubahan yang ditolak menjadi aturan yang dihormati Bee6.", // PROVISIONAL
  "C-home-waiting-sub-2": "Keduanya ditandai layak oleh supervisor. Dalam urutan yang disarankan Bee6.", // PROVISIONAL
  "C-home-waiting-sub-1": "Ditandai layak oleh supervisor.", // PROVISIONAL
  "C-home-waiting-sub-n": "{n} ditandai layak oleh supervisor. Dalam urutan yang disarankan Bee6.", // PROVISIONAL
  "C-home-waiting-in-order": "Tinjau berurutan", // PROVISIONAL
  "C-home-waiting-one-lead": "Satu perubahan sekali waktu.", // PROVISIONAL
  "C-home-waiting-one-body": "Setelah Anda menyetujui satu, SOP berubah, jadi yang lain hanya bisa ditolak dengan alasan. Bee6 menentukan tanggal mulai.", // PROVISIONAL
  "C-home-waiting-done": "Tidak ada yang menunggu. Semua usulan yang masuk sudah Anda putuskan.", // PROVISIONAL
  "C-home-waiting-sop": "Lihat versi SOP yang baru", // PROVISIONAL
  "C-home-to-day-full": "Lihat hari penuh (tampilan supervisor)", // PROVISIONAL
  "C-home-review-title": "Tinjauan berikutnya", // PROVISIONAL
  "C-home-nr-empty-v": "Belum ada tinjauan terjadwal", // PROVISIONAL
  "C-home-nr-empty-d": "Muncul setelah Anda menyetujui perubahan", // PROVISIONAL
  "C-home-cost-day": "BIAYA PER OUTLET-HARI", // PROVISIONAL
} as const satisfies Record<string, string>;

export const homeEN: Record<keyof typeof homeID, string> = {
  "C-home-reset-open": "Reset the demo",
  "C-home-reset-title": "Reset this demo?",
  "C-home-reset-body":
    "This sets this demo copy back to day 1: the original SOP, no proposals and none of the notes from your days. Fictional data only. This cannot be undone.",
  "C-home-reset-cancel": "Cancel",
  "C-home-reset-confirm": "Reset the demo",
  "C-home-reset-working": "Resetting…",
  "C-home-reset-failed": "The reset did not finish. Go to the entry page and start a new demo.",
  "C-home-reset-busy": "Bee6 is busy right now. Try again in a few seconds.",
  "C-home-reset-done": "Demo reset to day 1",
  "C-home-greeting-morning": "Good morning.",
  "C-home-greeting-afternoon": "Good afternoon.",
  "C-home-greeting-evening": "Good evening.",
  "C-home-waiting-h": "Waiting for your approval · {n}",
  "C-home-waiting-row": "Supervisor marked it feasible",
  "C-home-waiting-review": "Review",
  "C-home-waiting-review-a11y": "Review: {title}",
  "C-home-waiting-more": "+{n} more in Approvals",
  "C-home-progress-h": "Progress",
  "C-home-progress-window": "Progress window",
  "C-home-progress-week": "Week",
  "C-home-progress-month": "Month",
  "C-home-progress-since": "Since start",
  "C-home-progress-approved": "APPROVED",
  "C-home-progress-approved-detail": "started, waiting for review",
  "C-home-progress-rejected": "REJECTED",
  "C-home-lines-h": "Today in five lines",
  "C-home-review-h": "NEXT REVIEW",
  "C-home-cost-h": "COST PER OUTLET",
  "C-home-cost-soon": "Coming soon",
  "C-home-hello": "{date} · here is where things stand.",
  "C-home-progress-kick-week": "PROGRESS · THIS WEEK",
  "C-home-progress-kick-month": "PROGRESS · THIS MONTH",
  "C-home-progress-kick-since": "PROGRESS · SINCE START",
  "C-home-progress-in-week": "this week",
  "C-home-progress-in-month": "this month",
  "C-home-progress-in-since": "since the start",
  "C-home-progress-line": "{approved} approved and {rejected} rejected {window}.",
  "C-home-progress-sub": "Approved changes are reviewed on a set date. A rejected change becomes a rule Bee6 respects.",
  "C-home-waiting-sub-2": "Both marked feasible by the supervisor. In Bee6's recommended order.",
  "C-home-waiting-sub-1": "Marked feasible by the supervisor.",
  "C-home-waiting-sub-n": "{n} marked feasible by the supervisor. In Bee6's recommended order.",
  "C-home-waiting-in-order": "Review in order",
  "C-home-waiting-one-lead": "One change at a time.",
  "C-home-waiting-one-body": "Once you approve one, the SOP changes, so the other can only be rejected with a reason. Bee6 sets the start date.",
  "C-home-waiting-done": "Nothing is waiting. You have decided every proposal sent to you.",
  "C-home-waiting-sop": "See the new SOP version",
  "C-home-to-day-full": "See the full day (supervisor view)",
  "C-home-review-title": "Next review",
  "C-home-nr-empty-v": "No review scheduled yet",
  "C-home-nr-empty-d": "Appears after you approve a change",
  "C-home-cost-day": "COST PER OUTLET-DAY",
};
