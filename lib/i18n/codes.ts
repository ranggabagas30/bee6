import type { DictKey } from "@/lib/i18n/dict";

/**
 * Maps a pairing failure to a copy key. The server's own `error.message` is
 * never rendered: it is English and not translated, so the screen shows the
 * dictionary line for the error class instead.
 */
export function pairErrorKey(
  status: number | undefined,
  code: string | undefined,
): DictKey {
  if (code === "VALIDATION_ERROR" || status === 422) return "C-pair-need";
  if (code === "UNAUTHORIZED" || code === "CONFLICT" || status === 401 || status === 409) {
    return "C-pair-refused";
  }
  return "C-pair-net";
}
