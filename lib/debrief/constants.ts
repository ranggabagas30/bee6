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
/**
 * R-19 §6.3 (sandbox only): the debrief list is re-fetched this often while `preparing`, `waiting_more` or a
 * question is on screen, until the debrief's end. Replaces R-18's 20 s / 10-minute poll.
 */
export const REFRESH_POLL_MS_DEMO = 10_000;
/** R-18 (sandbox only): a manual "Check for new questions" tap closer than this to the last check does nothing. */
export const REFRESH_MIN_INTERVAL_MS = 5_000;
/**
 * R-19 §6.3 (sandbox only): localStorage key of the completion flag, `String(endsAtMs)` of the debrief whose
 * done screen was reached, so a reload inside the hour shows the done summary instead of the entry card.
 */
export const DEBRIEF_DONE_FLAG_KEY = "bee6.debrief.done";
/**
 * R-19 PR-5 (sandbox only): the window event `writeDoneFlag` dispatches right after writing the flag, so the
 * same document (the capture page's judge-guide bridge) re-reads it at once instead of on its next clock tick.
 * Other tabs get the browser's own `storage` event. A plain Event: it carries no counts, ids or text.
 */
export const DEBRIEF_DONE_EVENT = "bee6:debrief-done";
/** Beside the flag: `{"answered":n,"skipped":k}` so the restored done summary can state its counts. */
export const DEBRIEF_DONE_SUMMARY_KEY = "bee6.debrief.done.summary";
/**
 * Beside the flag, but NOT terminal: `{"ends_at_ms":n,"answered":n,"skipped":k}` written on every answer or skip of a
 * sandbox debrief, so a reload before `done` resumes with the right counts. Only the done flag marks terminal.
 */
export const DEBRIEF_PROGRESS_KEY = "bee6.debrief.progress";
