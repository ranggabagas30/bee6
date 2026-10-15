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
 */

export const sopID = {
  "C-sop-book-switch": "Versi SOP", // PROVISIONAL
  "C-sop-book-current": "{date} · saat ini", // PROVISIONAL
  "C-sop-book-first": "Versi pertama", // PROVISIONAL
  "C-sop-book-first-current": "Versi pertama · saat ini", // PROVISIONAL
  "C-sop-book-improved": "DIPERBAIKI · BARU PADA {date}", // PROVISIONAL
  "C-sop-book-new": "BARU PADA {date}", // PROVISIONAL
  "C-sop-book-before": "Sebelumnya:", // PROVISIONAL
  "C-sop-book-why": "Lihat alasan perubahan dan hasilnya", // PROVISIONAL
  "C-sop-book-readonly": "Hanya-baca. Langkah berubah hanya lewat usulan yang disetujui.", // PROVISIONAL
} as const satisfies Record<string, string>;

export const sopEN: Record<keyof typeof sopID, string> = {
  "C-sop-book-switch": "SOP version",
  "C-sop-book-current": "{date} · current",
  "C-sop-book-first": "First version",
  "C-sop-book-first-current": "First version · current",
  "C-sop-book-improved": "IMPROVED · NEW ON {date}",
  "C-sop-book-new": "NEW ON {date}",
  "C-sop-book-before": "Before:",
  "C-sop-book-why": "See why it changed and the result",
  "C-sop-book-readonly": "Read-only. Steps change only through an approved proposal.",
};
