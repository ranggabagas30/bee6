import { AppError, DemoCapError, LockedError } from "@/lib/http/errors";
import type { Redactor } from "@/lib/redact/types";

/**
 * Where the demo's text-entry cap is charged (R-12, QA D2): immediately before the Sensitive Data Protection
 * call, not at the route. A route hands the service a redaction function wrapped with these helpers; the
 * service only calls it once the request has passed every refusal that needs no spend (answer replay, unknown
 * question, a decided or missing proposal, a missing review), so a request the service turns away costs no
 * slot, while one that reaches SDP is counted first and a refused one never reaches it (cap before spend).
 *
 * `before` is the cap check (it throws a LockedError at the cap). Nothing is charged by wrapping.
 *
 * A check that cannot answer fails closed with a typed DemoCapError (503), never a bare error that a caller
 * might mistake for an SDP outage: `demo_not_ready` for an unready sandbox outlet, `demo_cap_unavailable` for
 * anything untyped (counter transaction, outlet read). A LockedError (the cap itself) passes through unchanged.
 */
async function runCheck(before: () => Promise<void>): Promise<void> {
  try {
    await before();
  } catch (error) {
    if (error instanceof LockedError || error instanceof DemoCapError) throw error;
    if (error instanceof AppError && error.code === "demo_not_ready") {
      throw new DemoCapError("The demo is not ready", "demo_not_ready");
    }
    // Untyped (or any other AppError): fail closed. Only the class name is logged, never the message.
    console.error("[demo] cap check failed", { error_class: error instanceof Error ? error.name : "unknown" });
    throw new DemoCapError("The demo is temporarily unavailable", "demo_cap_unavailable");
  }
}

export function capBeforeRedact(
  redact: (texts: readonly string[]) => Promise<string[]>,
  before: () => Promise<void>,
): (texts: readonly string[]) => Promise<string[]> {
  return async (texts) => {
    await runCheck(before);
    return redact(texts);
  };
}

/** The same for the single-string `Redactor` the debrief answer uses. */
export function capBeforeRedactor(redactor: Redactor, before: () => Promise<void>): Redactor {
  return {
    redact: async (text) => {
      await runCheck(before);
      return redactor.redact(text);
    },
  };
}
