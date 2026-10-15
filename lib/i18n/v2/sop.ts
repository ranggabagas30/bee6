/**
 * i18n v2 slice `sop`: copy for the SOP book (PR-9a, PR-9b).
 *
 * R-19 PR-0 scaffold; PR-9a adds its keys HERE and nowhere else: `lib/i18n/dict.ts` spreads this slice once into
 * ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`sopEN` is typed from `sopID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 *
 * PR-9a keys (plan §9.1): the version switch by date, the improved badge, the struck old wording's screen-reader
 * label, the "why" link and the read-only footer. EN is final per the plan; every ID line is PROVISIONAL until
 * reviewed. `{date}` is always dd/mm/yy (`shortDate`). The base `C-sop-*` keys (R-10 header, changes, steps, roles)
 * stay in dict.ts; the book keys are `C-sop-book-*` so no spread replaces a base key.
 *
 * PR-9b keys (plan §9.1): the Book/Table view toggle, the five chapter names (`C-sop-book-ch-<ChapterId>` from
 * `lib/sop/chapters.ts`), the contents page and its legend, page navigation, and the table's column headers and
 * "where it came from" cells. Column headers are upper-case on the board, so the strings are upper-case.
 */

export const sopID = {
  "C-sop-book-switch": "Versi SOP", // PROVISIONAL
  "C-sop-book-current": "{date} · saat ini", // PROVISIONAL
  "C-sop-book-upcoming": "{date} · akan berlaku", // PROVISIONAL
  "C-sop-book-first": "Versi pertama", // PROVISIONAL
  "C-sop-book-first-current": "Versi pertama · saat ini", // PROVISIONAL
  "C-sop-book-improved": "DIPERBAIKI · BARU PADA {date}", // PROVISIONAL
  "C-sop-book-new": "BARU PADA {date}", // PROVISIONAL
  "C-sop-book-before": "Sebelumnya:", // PROVISIONAL
  "C-sop-book-why": "Lihat alasan perubahan dan hasilnya", // PROVISIONAL
  "C-sop-book-readonly": "Hanya-baca. Langkah berubah hanya lewat usulan yang disetujui.", // PROVISIONAL
  // PR-9b: Book/Table toggle, chapters, contents page, legend, page navigation, table columns.
  "C-sop-book-view": "Tampilan", // PROVISIONAL
  "C-sop-book-view-book": "Buku", // PROVISIONAL
  "C-sop-book-view-table": "Tabel", // PROVISIONAL
  "C-sop-book-ch-opening_closing": "Buka & tutup", // PROVISIONAL
  "C-sop-book-ch-production": "Produksi", // PROVISIONAL
  "C-sop-book-ch-stock": "Stok", // PROVISIONAL
  "C-sop-book-ch-customer": "Pelanggan", // PROVISIONAL
  "C-sop-book-ch-other": "Langkah lain", // PROVISIONAL
  "C-sop-book-contents": "Daftar isi", // PROVISIONAL
  "C-sop-book-steps-n": "{n} langkah", // PROVISIONAL
  "C-sop-book-steps-1": "1 langkah", // PROVISIONAL
  "C-sop-book-legend-from": "Dari SOP Anda", // PROVISIONAL
  "C-sop-book-legend-improved": "Diperbaiki dengan Bee6", // PROVISIONAL
  "C-sop-book-chapter-of": "Bab {n} dari {total}", // PROVISIONAL
  "C-sop-book-page-of": "Halaman {n} dari {total}", // PROVISIONAL
  "C-sop-book-prev": "Halaman sebelumnya", // PROVISIONAL
  "C-sop-book-next": "Halaman berikutnya", // PROVISIONAL
  "C-sop-book-table-caption": "Langkah di versi {version} sebagai tabel", // PROVISIONAL
  "C-sop-book-col-code": "KODE", // PROVISIONAL
  "C-sop-book-col-step": "LANGKAH", // PROVISIONAL
  "C-sop-book-col-chapter": "BAB", // PROVISIONAL
  "C-sop-book-col-who": "SIAPA", // PROVISIONAL
  "C-sop-book-col-when": "KAPAN", // PROVISIONAL
  "C-sop-book-col-from": "ASALNYA", // PROVISIONAL
  "C-sop-book-from-sop": "SOP Anda", // PROVISIONAL
  "C-sop-book-from-bee6": "Usulan Bee6, disetujui {date}", // PROVISIONAL
  "C-sop-book-when-unknown": "Tanpa tanggal", // PROVISIONAL
} as const satisfies Record<string, string>;

export const sopEN: Record<keyof typeof sopID, string> = {
  "C-sop-book-switch": "SOP version",
  "C-sop-book-current": "{date} · current",
  "C-sop-book-upcoming": "{date} · upcoming",
  "C-sop-book-first": "First version",
  "C-sop-book-first-current": "First version · current",
  "C-sop-book-improved": "IMPROVED · NEW ON {date}",
  "C-sop-book-new": "NEW ON {date}",
  "C-sop-book-before": "Before:",
  "C-sop-book-why": "See why it changed and the result",
  "C-sop-book-readonly": "Read-only. Steps change only through an approved proposal.",
  "C-sop-book-view": "View",
  "C-sop-book-view-book": "Book",
  "C-sop-book-view-table": "Table",
  "C-sop-book-ch-opening_closing": "Opening & closing",
  "C-sop-book-ch-production": "Production",
  "C-sop-book-ch-stock": "Stock",
  "C-sop-book-ch-customer": "Customer",
  "C-sop-book-ch-other": "Other steps",
  "C-sop-book-contents": "Contents",
  "C-sop-book-steps-n": "{n} steps",
  "C-sop-book-steps-1": "1 step",
  "C-sop-book-legend-from": "From your SOP",
  "C-sop-book-legend-improved": "Improved with Bee6",
  "C-sop-book-chapter-of": "Chapter {n} of {total}",
  "C-sop-book-page-of": "Page {n} of {total}",
  "C-sop-book-prev": "Previous page",
  "C-sop-book-next": "Next page",
  "C-sop-book-table-caption": "Steps in version {version} as a table",
  "C-sop-book-col-code": "CODE",
  "C-sop-book-col-step": "STEP",
  "C-sop-book-col-chapter": "CHAPTER",
  "C-sop-book-col-who": "WHO",
  "C-sop-book-col-when": "WHEN",
  "C-sop-book-col-from": "WHERE IT CAME FROM",
  "C-sop-book-from-sop": "Your SOP",
  "C-sop-book-from-bee6": "Bee6 proposal, approved {date}",
  "C-sop-book-when-unknown": "Not dated",
};
