import { maskDigitRuns } from "@/lib/constraints/normalize";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import { DemoCapError, LockedError, ServiceUnavailableError } from "@/lib/http/errors";

/**
 * The one pipeline for free text a signed-in user types that we store
 * (constraint text, rejection reasons): digit-run mask → staff-name scrub →
 * Sensitive Data Protection, in that order (hard rule #3). Throws
 * ServiceUnavailableError("Redaction unavailable", "redact") if SDP fails;
 * the caller writes nothing. A LockedError (429) or a DemoCapError (503 demo_not_ready / demo_cap_unavailable)
 * from the redaction function is the public demo's spend-cap check (R-12), not an SDP failure: it passes through
 * unchanged. Any other failure, including a typed SDP one, is "Redaction unavailable". Never logs the text.
 */
export async function redactUserText(
  text: string,
  staffNames: readonly string[],
  redact: (texts: readonly string[]) => Promise<string[]>,
): Promise<string> {
  const scrubbed = scrubStaffNames(maskDigitRuns(text), staffNames);
  let out: string[];
  try {
    out = await redact([scrubbed]);
  } catch (error) {
    if (error instanceof LockedError || error instanceof DemoCapError) throw error;
    throw new ServiceUnavailableError("Redaction unavailable", "redact");
  }
  return out[0] ?? "";
}
