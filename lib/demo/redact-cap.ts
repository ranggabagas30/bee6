import type { Redactor } from "@/lib/redact/types";

/**
 * Where the demo's text-entry cap is charged (R-12, QA D2): immediately before the Sensitive Data Protection
 * call, not at the route. A route hands the service a redaction function wrapped with these helpers; the
 * service only calls it once the request has passed every refusal that needs no spend (answer replay, unknown
 * question, a decided or missing proposal, a missing review), so a request the service turns away costs no
 * slot, while one that reaches SDP is counted first and a refused one never reaches it (cap before spend).
 *
 * `before` is the cap check (it throws a LockedError at the cap). Nothing is charged by wrapping.
 */
export function capBeforeRedact(
  redact: (texts: readonly string[]) => Promise<string[]>,
  before: () => Promise<void>,
): (texts: readonly string[]) => Promise<string[]> {
  return async (texts) => {
    await before();
    return redact(texts);
  };
}

/** The same for the single-string `Redactor` the debrief answer uses. */
export function capBeforeRedactor(redactor: Redactor, before: () => Promise<void>): Redactor {
  return {
    redact: async (text) => {
      await before();
      return redactor.redact(text);
    },
  };
}
