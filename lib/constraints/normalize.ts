/**
 * Manual-constraint text normalization (R-08 Task 8.1; web spec §6.6 for
 * constraints). `maskDigitRuns` is the one implementation of the digit-run
 * mask: `lib/proposals/service.ts` (Task 5 step 8e) imports it instead of
 * inlining its own regex, so a phone number typed into a proposal's model
 * output and one typed into a manual constraint are masked identically.
 */

const DIGIT_RUN = /\d{6,}/g;

/**
 * Replaces every run of 6+ digits with "[NUMBER]" (hard rule #7: a phone
 * number must never reach storage). Short numeric quantities and times
 * ("2.5 kg", "3 trays", "07:00") have no run of 6+ consecutive digits, so
 * they pass through untouched.
 */
export function maskDigitRuns(text: string): string {
  return text.replace(DIGIT_RUN, "[NUMBER]");
}

/**
 * Dedupe key for constraint text: NFKC normalize, trim, collapse internal
 * whitespace runs to one space, then lower-case. Two constraints that differ
 * only in case or spacing normalize to the same key (E33).
 */
export function normalizeConstraintText(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
