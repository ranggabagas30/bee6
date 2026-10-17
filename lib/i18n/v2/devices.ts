/**
 * i18n v2 slice `devices`: copy for connected devices (PR-10).
 *
 * R-19 PR-0 scaffold: starts empty. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`devicesEN` is typed from `devicesID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 */

/*
 * R-25 T8 (decision R11, D2-05 OUT): /devices is a tidy "coming soon" placeholder in the page-2 look. No device row, no
 * device id and no pairing code on a supervisor screen (CLAUDE.md hard rule 7).
 */
export const devicesID = {
  "C-web-devices-sub": "HP yang mendengarkan toko ini.", // PROVISIONAL
  "C-web-devices-soon-kick": "SEGERA HADIR", // PROVISIONAL
  "C-web-devices-soon-p": "Kode pemasangan untuk HP baru akan dibuat di sini. Untuk demo ini, HP staf sudah disiapkan.", // PROVISIONAL
} as const satisfies Record<string, string>;

export const devicesEN: Record<keyof typeof devicesID, string> = {
  "C-web-devices-sub": "Phones that listen for this shop.",
  "C-web-devices-soon-kick": "COMING SOON",
  "C-web-devices-soon-p": "Pairing codes for a new phone will be made here. For this demo the staff phone is already set up.",
};
