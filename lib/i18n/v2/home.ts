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
 */

export const homeID = {
  "C-home-reset-open": "Atur ulang demo", // PROVISIONAL
  "C-home-reset-title": "Atur ulang demo ini?", // PROVISIONAL
  "C-home-reset-body":
    "Ini mengembalikan salinan demo ini ke hari 1, dengan SOP asli dan tanpa usulan. Pastikan tidak ada ponsel staf yang sedang merekam.", // PROVISIONAL
  "C-home-reset-cancel": "Batal", // PROVISIONAL
  "C-home-reset-confirm": "Atur ulang", // PROVISIONAL
  "C-home-reset-working": "Mengatur ulang…", // PROVISIONAL
  "C-home-reset-failed": "Pengaturan ulang tidak selesai. Buka halaman awal dan mulai demo baru.", // PROVISIONAL
  "C-home-reset-busy": "Bee6 sedang sibuk. Coba lagi beberapa detik lagi.", // PROVISIONAL
  "C-home-reset-done": "Demo diatur ulang ke hari 1", // PROVISIONAL
  "C-home-greeting-morning": "Selamat pagi", // PROVISIONAL
  "C-home-greeting-afternoon": "Selamat siang", // PROVISIONAL
  "C-home-greeting-evening": "Selamat malam", // PROVISIONAL
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
} as const satisfies Record<string, string>;

export const homeEN: Record<keyof typeof homeID, string> = {
  "C-home-reset-open": "Reset the demo",
  "C-home-reset-title": "Reset this demo?",
  "C-home-reset-body": "This sets this demo copy back to day 1, with the original SOP and no proposals. Make sure no staff phone is listening.",
  "C-home-reset-cancel": "Cancel",
  "C-home-reset-confirm": "Reset",
  "C-home-reset-working": "Resetting…",
  "C-home-reset-failed": "The reset did not finish. Go to the entry page and start a new demo.",
  "C-home-reset-busy": "Bee6 is busy right now. Try again in a few seconds.",
  "C-home-reset-done": "Demo reset to day 1",
  "C-home-greeting-morning": "Good morning",
  "C-home-greeting-afternoon": "Good afternoon",
  "C-home-greeting-evening": "Good evening",
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
};
