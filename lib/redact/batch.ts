import { dlpRedactor } from "@/lib/redact/dlp";
import type { Redactor } from "@/lib/redact/types";

/**
 * One SDP call for many strings (R-08 Task 5.1) — the same join/split
 * pattern as `lib/pipeline/label/sanitize.ts`'s private `defaultRedactBatch`
 * helper (not refactored into one shared implementation here; R-08 needs
 * its own injectable seam for `generateProposal`'s and `createConstraint`'s
 * tests). Fails closed (hard rule #3's convention): a split-count mismatch
 * throws rather than guessing at a corrupted splice.
 */

const BATCH_DELIMITER = "\n␞␞␞\n";

export function redactBatch(redactor: Redactor = dlpRedactor()): (texts: readonly string[]) => Promise<string[]> {
  return async (texts: readonly string[]): Promise<string[]> => {
    if (texts.length === 0) return [];
    const joined = texts.join(BATCH_DELIMITER);
    const redactedJoined = await redactor.redact(joined);
    const parts = redactedJoined.split(BATCH_DELIMITER);
    if (parts.length !== texts.length) {
      throw new Error(
        `redactBatch: SDP batch result split mismatch (sent ${texts.length} strings, got ${parts.length} back)`,
      );
    }
    return parts;
  };
}
