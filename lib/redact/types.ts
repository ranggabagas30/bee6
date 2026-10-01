/**
 * Redactor interface (R-04, slice 0). Frozen first so the segment service and the
 * Sensitive Data Protection implementation share one contract.
 *
 * INVARIANT (hard rule #3): every transcript line passes through `redact` before
 * it is written anywhere. The implementation FAILS CLOSED — any error throws
 * `ServiceUnavailableError` (503) and returns nothing, so unredacted text can
 * never reach the store. Empty input short-circuits to "" without a call.
 */

export interface Redactor {
  /** Returns the input text with sensitive spans replaced by bracketed labels. */
  redact(text: string): Promise<string>;
}
