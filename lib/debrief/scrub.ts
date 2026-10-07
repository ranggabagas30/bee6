import { normalizeStaffName } from "@/lib/auth/staff-name";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";

/** A whitespace token shorter than this is never scrubbed on its own (too likely a common word). */
const MIN_TOKEN_LENGTH = 3;

/**
 * Expands raw staff names into every string `scrubStaffNames` should match in
 * a debrief reason: the full normalized name, plus every whitespace token of
 * it that is at least 3 code points long (so "Budi" alone still matches
 * staff named "Budi Santoso", same nickname rule as the tick's
 * `listStaffScrubNames`). Deduped; sorted longest-first (cosmetic — overlap
 * is otherwise resolved by `scrubStaffNames`' own range merge).
 */
export function expandScrubNames(rawNames: readonly string[]): string[] {
  const set = new Set<string>();
  for (const raw of rawNames) {
    const full = normalizeStaffName(raw);
    if (!full) continue;
    set.add(full);
    for (const token of full.split(/\s+/)) {
      if (Array.from(token).length >= MIN_TOKEN_LENGTH) set.add(token);
    }
  }
  return Array.from(set).sort((a, b) => Array.from(b).length - Array.from(a).length);
}

/**
 * Staff-name scrub for a debrief answer's reason (R-07, hard rule #7). Runs
 * BEFORE redaction, on the trimmed-but-unredacted text; reuses
 * `scrubStaffNames` (R-05b) rather than copying it.
 */
export function scrubReason(text: string, rawNames: readonly string[]): string {
  return scrubStaffNames(text, expandScrubNames(rawNames));
}
