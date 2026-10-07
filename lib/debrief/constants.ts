import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Debrief constants (R-07; `docs/tasks/R-07-plan.md` Task 1). Shared by the
 * reason check, the answer service/route and (later tasks, not this slice)
 * the phone cache and screens — defined once here so no file redefines a
 * magic number.
 *
 * The per-device answer rate limit constants are DEFERRED (Rangga, 7 Oct) to
 * a follow-up that must land before the Sun 11 Oct sign-off (reason: budget).
 * Do not add `ANSWER_RATE_WINDOW_MS` / `ANSWER_RATE_MAX` here until that task.
 */

/** A reason over this many code points (after trim) is refused, never truncated. */
export const REASON_MAX_CHARS = 500;
/** An unanswered entry in the phone cache is purged 14 days after `answered_at_ms`. */
export const ANSWER_CACHE_MAX_AGE_MS = 14 * 86_400_000;
/** Storage bound on a correction's `reason_text` AFTER redaction placeholders may have lengthened it. */
export const CORRECTION_TEXT_MAX_CHARS = 1000;
/** The phone shows at most 5 questions per debrief. */
export const DEBRIEF_SHOW_MAX = 5;
/** The server returns at most 10 (the phone filters cached ids, then takes 5). */
export const DEBRIEF_LIST_SERVER_CAP = 10;
/** `answered_at_ms` more than this far in the future is refused (400). */
export const ANSWER_FUTURE_TOLERANCE_MS = 5 * 60_000;
// DEFERRED (Rangga, 7 Oct) to the rate-limit follow-up due before Sun 11 sign-off: do NOT add now.
// export const ANSWER_RATE_WINDOW_MS = 10 * 60_000;
// export const ANSWER_RATE_MAX = 60;
/** Phone uploader retry cadence (Task 6, not built in this slice). */
export const ANSWER_RETRY_MS = 60_000;
/** Phone cache purge cadence while the page is open (Task 6, not built in this slice). */
export const ANSWER_PURGE_INTERVAL_MS = 5 * 60_000;
/** Incident categories ranked first in the debrief question list (rank.ts). */
export const INCIDENT_FIRST: ReadonlySet<WorkCategory> = new Set([
  "SAFETY_INCIDENT",
  "SECURITY_INCIDENT",
  "DISRUPTION",
]);
