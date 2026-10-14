/**
 * i18n v2 slice `journey`: copy for the 3-day judge journey: judge guide, entry page, script cards (PR-5, PR-6, PR-7).
 *
 * R-19 PR-0 scaffold: starts empty. The owning PR adds its keys HERE and nowhere else; `lib/i18n/dict.ts`
 * spreads this slice once into ID and EN, so a key added here reaches `DictKey` and `t()` with no edit to
 * dict.ts. Rules (checked by v2.test.ts):
 * - the same keys in both objects (`journeyEN` is typed from `journeyID`, so a missing or extra EN key is a type error);
 * - a key is unique across ALL slices and the existing dictionary (name it `C-<area>-...` like the base table);
 * - values are trimmed and non-empty, with the same {placeholders} in both languages;
 * - no machine translation; mark unreviewed Bahasa with a trailing `// PROVISIONAL` comment as the base table does.
 */

export const journeyID = {} as const satisfies Record<string, string>;

export const journeyEN: Record<keyof typeof journeyID, string> = {};
