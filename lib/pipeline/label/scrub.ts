import type { LabelUnit } from "@/lib/pipeline/windowing";

/**
 * Staff-name scrub (R-05b, Task 3, Decision 8). Word-boundary,
 * case/accent-insensitive replacement of any staff name with `[STAFF]`.
 * Over-redaction (a name that's also a common word) is accepted by design —
 * hard rule #7 ("staff names live only in the staff collection") wins over
 * a false positive here.
 *
 * `scrubUnitLines` runs on a `LabelUnit`'s lines BEFORE the prompt is built
 * (Task 1's `buildLabelPrompt`), and that same scrubbed unit is the only
 * unit passed to `buildThreads` (R-05a) for that call — `buildThreads`
 * copies a unit line's `text` verbatim into the stored thread, so scrubbing
 * only the model's output would still store a spoken staff name.
 */

/** Strips combining diacritical marks from one character, 1:1 by codepoint. */
function foldChar(ch: string): string {
  const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return base.length > 0 ? base[0]! : ch;
}

/** Accent-folds a string one codepoint at a time, preserving length/index alignment with `Array.from(text)`. */
function foldString(text: string): string {
  return Array.from(text).map(foldChar).join("");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces every word-boundary, case/accent-insensitive occurrence of any
 * `staffNames` entry in `text` with `[STAFF]`. Matching is done on an
 * accent-folded, lower-cased copy of `text` so a name like "Dédé" matches
 * "dede"; replacement positions are then applied to the original text so
 * the non-matched parts are returned byte-for-byte unchanged.
 */
export function scrubStaffNames(text: string, staffNames: readonly string[]): string {
  const names = staffNames.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length === 0 || text.length === 0) return text;

  const foldedLower = foldString(text).toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];

  for (const name of names) {
    const foldedName = foldString(name).toLowerCase();
    if (!foldedName) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(foldedName)}\\b`, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(foldedLower)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) pattern.lastIndex += 1; // safety: never spin on a zero-width match
    }
  }

  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const chars = Array.from(text);
  let result = "";
  let cursor = 0;
  for (const range of merged) {
    result += chars.slice(cursor, range.start).join("");
    result += "[STAFF]";
    cursor = range.end;
  }
  result += chars.slice(cursor).join("");
  return result;
}

/**
 * Returns a NEW `LabelUnit` whose every line's `text` has been passed
 * through `scrubStaffNames`. Every other property (`unit_id`, `window_ids`,
 * each line's `line_id`/`seg_id`/`start_ms`/`end_ms`, line order) is
 * unchanged. The input unit is never mutated.
 */
export function scrubUnitLines(unit: LabelUnit, staffNames: readonly string[]): LabelUnit {
  return {
    unit_id: unit.unit_id,
    window_ids: [...unit.window_ids],
    lines: unit.lines.map((line) => ({
      ...line,
      text: scrubStaffNames(line.text, staffNames),
    })),
  };
}
