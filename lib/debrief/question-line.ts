import { foldString } from "@/lib/pipeline/label/scrub";
import { expandScrubNames, scrubReason } from "@/lib/debrief/scrub";

/**
 * Read-time hygiene for the thread lines quoted on a sandbox question (demo-feedback-2 item 10). Used ONLY by that
 * feature: `scrubStaffNames` / `scrubReason` (the answer path) are deliberately left as they are.
 */

/** Indonesian clitics that glue onto a name: -nya, -ku, -mu, -lah, -kah ("Budinya", "Budiku", "Budilah"). */
const CLITICS = ["nya", "ku", "mu", "lah", "kah"] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Zero-width / bidi format characters (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069, U+FEFF).
const INVISIBLE_FORMAT = /[​-‏‪-‮⁦-⁩﻿]/g;
// Tab, line feed, carriage return: control characters that are word separators, so they become a space.
const WHITESPACE_CONTROL = /[\t\n\r]/g;
// Every other C0 control, DEL and the C1 controls.
const OTHER_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Removes characters that cannot be seen but can reorder, hide or split text (right-to-left override, zero-width
 * space, BOM, C0/C1 controls). Tab and line breaks become a space (so two words are not glued together); a normal
 * space is kept. Runs BEFORE the staff scrub (a zero-width space inside a name would otherwise hide it) and
 * before truncation.
 */
export function stripInvisibleChars(text: string): string {
  return text.replace(WHITESPACE_CONTROL, " ").replace(INVISIBLE_FORMAT, "").replace(OTHER_CONTROL, "");
}

/** Replaces `staff-name + clitic` (not followed by a letter, digit or "_") with `[STAFF]`, on text `scrubReason` already ran over. */
function scrubCliticForms(text: string, staffNames: readonly string[]): string {
  const names = expandScrubNames(staffNames);
  if (names.length === 0 || text.length === 0) return text;

  const foldedLower = foldString(text).toLowerCase();
  const suffixes = CLITICS.join("|");
  const ranges: Array<{ start: number; end: number }> = [];

  for (const name of names) {
    const foldedName = foldString(name).toLowerCase();
    if (!foldedName) continue;
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(foldedName)}(?:${suffixes})(?![\\p{L}\\p{N}_])`,
      "gu",
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(foldedLower)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  // `foldString` keeps one UTF-16 unit per code point (same as `scrubStaffNames`), so the match indexes are
  // code-point indexes into `text`.
  const chars = Array.from(text);
  let result = "";
  let cursor = 0;
  for (const range of merged) {
    result += chars.slice(cursor, range.start).join("");
    result += "[STAFF]";
    cursor = range.end;
  }
  return result + chars.slice(cursor).join("");
}

/**
 * Staff-name scrub for one quoted line: the regular `scrubReason`, then the clitic forms it misses ("Budinya",
 * "Budiku", "Budimu", "Budilah", "Budikah"), case- and diacritic-insensitive, same `[STAFF]` placeholder, same
 * tokens (full name + each token of >= 3 code points).
 *
 * KNOWN GAP (accepted): a nickname shorter than 3 code points, and a name that is not in `staff`, are not caught.
 */
export function scrubQuestionLine(text: string, staffNames: readonly string[]): string {
  return scrubCliticForms(scrubReason(text, staffNames), staffNames);
}
