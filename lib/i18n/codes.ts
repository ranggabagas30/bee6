import type { DictKey } from "@/lib/i18n/dict";

/**
 * Maps a pairing failure to a copy key. The server's own `error.message` is
 * never rendered: it is English and not translated, so the screen shows the
 * dictionary line for the error class instead.
 *
 * - `C-pair-net` is only for a failure with no HTTP response (network down).
 * - Any HTTP response that is not a mapped client error (every 5xx, and any
 *   other unmapped status) is a server-side failure: `C-pair-srv`.
 */
export function pairErrorKey(
  status: number | undefined,
  code: string | undefined,
): DictKey {
  if (code === "VALIDATION_ERROR" || status === 422) return "C-pair-need";
  if (code === "UNAUTHORIZED" || code === "CONFLICT" || status === 401 || status === 409) {
    return "C-pair-refused";
  }
  if (status === undefined) return "C-pair-net";
  return "C-pair-srv";
}

/**
 * Maps a Mulai/Selesai/Batalkan session-route failure to a copy key (web spec
 * §6.6.1, §6.6.5). The server's own `error.message` is never rendered. There is
 * no approved copy-sheet row for most of these failures (flagged for UI/UX
 * sign-off), so almost everything falls back to the generic `C-sess-err` line —
 * the one exception is the discard route's 409 `session_ended` (a Batalkan tap
 * racing an already-ended session), which gets its own, more honest line.
 */
export function sessionErrorKey(
  status: number | undefined,
  code: string | undefined,
): DictKey {
  if (status === 409 && code === "session_ended") return "C-c-discard-failed";
  return "C-sess-err";
}
