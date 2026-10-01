/**
 * Deterministic supplementary redaction for Indonesian phone numbers (R-04,
 * slice 2). Runs IN ADDITION to Sensitive Data Protection (hard rule #3), as a
 * cheap, offline safety net for the local `+62.../08...` formats that matter most
 * for the pilot shop. Pure and separately tested so its false-positive/negative
 * behaviour is auditable without a DLP call.
 */

export const PHONE_LABEL = "[PHONE_NUMBER]";

/**
 * Matches Indonesian mobile numbers: a `+62` or `0` prefix, then `8`, then a
 * subscriber run of 8–12 further digits with optional space/dot/hyphen
 * separators. Lookbehind/lookahead keep it from firing inside a longer digit run
 * (e.g. an invoice number), so ordinary quantities and prices are left alone.
 */
const ID_PHONE =
  /(?<![\d+])(?:\+62|0)[ .-]?8\d(?:[ .-]?\d){7,11}(?!\d)/g;

/** Replaces every Indonesian phone number in `text` with {@link PHONE_LABEL}. */
export function redactIndonesianPhones(text: string): string {
  return text.replace(ID_PHONE, PHONE_LABEL);
}
