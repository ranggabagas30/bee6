/**
 * i18n v2 slice `session`: copy for the staff phone session: script drawer, closing, End, Start lock, sign-out (PR-4a, PR-4b).
 *
 * R-19 PR-0 scaffold: starts empty. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`sessionEN` is typed from `sessionID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 */

export const sessionID = {} as const satisfies Record<string, string>;

export const sessionEN: Record<keyof typeof sessionID, string> = {};
