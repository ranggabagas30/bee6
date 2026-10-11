import { maskDigitRuns } from "@/lib/constraints/normalize";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import { ServiceUnavailableError } from "@/lib/http/errors";

/**
 * The one pipeline for free text a signed-in user types that we store
 * (constraint text, rejection reasons): digit-run mask → staff-name scrub →
 * Sensitive Data Protection, in that order (hard rule #3). Throws
 * ServiceUnavailableError("Redaction unavailable", "redact") if SDP fails;
 * the caller writes nothing. Never logs the text.
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
  } catch {
    throw new ServiceUnavailableError("Redaction unavailable", "redact");
  }
  return out[0] ?? "";
}
