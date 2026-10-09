import { NEEDS_SUPERVISOR_CONFIRM, type WorkCategory } from "@/lib/pipeline/categories";
import { localHmOf } from "@/lib/capture/calendar";

/**
 * Pure thread-row derivation for the day record (technical spec §4.3, §4.4).
 * No I/O. Declares its own narrow input types (`ThreadForStatus`,
 * `QuestionForStatus`) rather than importing `Thread`/`Question` from
 * `lib/firestore/schema.ts` directly: PR-2 (this file) ships before PR-5
 * (Task 10/15) widens `ThreadSchema.label_source` with
 * `"supervisor_confirmed"` / `"supervisor_rejected"`, and this file's own
 * type already includes both values so the enum and the `STATUS_KEY`/dict
 * maps built on it never have to be reopened later.
 */

export type DisplayStatus =
  | "fact"
  | "fact_staff_confirmed"
  | "fact_supervisor_confirmed"
  | "question_open"
  | "question_answered"
  | "awaiting_supervisor"
  | "rejected_by_staff"
  | "rejected_by_supervisor"
  | "unverified";

export interface ThreadForStatus {
  status: "fact" | "open" | "unverified";
  label_source?: "model" | "staff_confirmed" | "supervisor_confirmed" | "supervisor_rejected";
  excluded_from_evidence?: boolean;
}

export interface QuestionForStatus {
  status: "open" | "unverified" | "answered";
  answer?: "yes" | "no" | null;
}

/** Owner-visible statuses: a confirmed fact that was never rejected. */
export const FACT_STATUSES: ReadonlySet<DisplayStatus> = new Set([
  "fact",
  "fact_staff_confirmed",
  "fact_supervisor_confirmed",
]);

/**
 * First match wins (technical spec §4.3/§4.4, R-07 ux-notes §4.4, v4 Task 15.0):
 *  0. `label_source === "supervisor_rejected"` -> "rejected_by_supervisor"
 *     (checked before rule 1: a supervisor reject also sets
 *     `excluded_from_evidence`, and must not read as a staff reject).
 *  1. `excluded_from_evidence === true` -> "rejected_by_staff".
 *  2. `status === "fact"`: `label_source === "supervisor_confirmed"` ->
 *     "fact_supervisor_confirmed"; `"staff_confirmed"` ->
 *     "fact_staff_confirmed"; else -> "fact".
 *  3. `status === "unverified"` -> "unverified".
 *  4. (open) answered "yes": category needs supervisor confirm ->
 *     "awaiting_supervisor", else -> "question_answered".
 *  5. answered "no" -> "rejected_by_staff" (defensive; R-07 sets the flag).
 *  6. question `status === "unverified"` -> "unverified".
 *  7. otherwise (question open or missing) -> "question_open".
 */
export function deriveDisplayStatus(
  t: ThreadForStatus,
  effectiveCategory: WorkCategory,
  q: QuestionForStatus | undefined,
): DisplayStatus {
  if (t.label_source === "supervisor_rejected") return "rejected_by_supervisor";
  if (t.excluded_from_evidence === true) return "rejected_by_staff";

  if (t.status === "fact") {
    if (t.label_source === "supervisor_confirmed") return "fact_supervisor_confirmed";
    if (t.label_source === "staff_confirmed") return "fact_staff_confirmed";
    return "fact";
  }

  if (t.status === "unverified") return "unverified";

  // status === "open"
  if (q?.status === "answered" && q.answer === "yes") {
    return NEEDS_SUPERVISOR_CONFIRM.has(effectiveCategory) ? "awaiting_supervisor" : "question_answered";
  }
  if (q?.status === "answered" && q.answer === "no") return "rejected_by_staff";
  if (q?.status === "unverified") return "unverified";
  return "question_open";
}

/**
 * Owner visibility (Rangga, 9 Oct: facts only). Needs no question doc: a
 * confirmed fact that was never excluded (a supervisor reject always sets
 * `excluded_from_evidence`, so a rejected row is already excluded by this
 * check alone).
 */
export function isOwnerVisible(t: ThreadForStatus): boolean {
  return t.status === "fact" && t.excluded_from_evidence !== true;
}

/** `Math.round(clamp(c, 0, 1) * 100)`; NaN or non-finite -> 0. */
export function toConfidencePct(c: number): number {
  if (!Number.isFinite(c)) return 0;
  const clamped = Math.min(1, Math.max(0, c));
  return Math.round(clamped * 100);
}

export interface EvidenceLineInput {
  line_id: string;
  start_ms: number;
  text: string;
}

/**
 * Evidence lines in `start_ms` order: lines whose `line_id` is in
 * `evidenceLineIds` and whose text is non-empty after trimming. Ids with no
 * matching line are skipped. Returns the first `max` as `{ hm, text }`
 * (`hm = localHmOf(start_ms, tz)`) and `more` = the remaining count.
 */
export function evidenceFor(
  lines: readonly EvidenceLineInput[],
  evidenceLineIds: readonly string[],
  tz: string,
  max: number,
): { evidence: { hm: string; text: string }[]; more: number } {
  const ids = new Set(evidenceLineIds);
  const matched = lines
    .filter((l) => ids.has(l.line_id) && l.text.trim() !== "")
    .sort((a, b) => a.start_ms - b.start_ms);
  const evidence = matched.slice(0, max).map((l) => ({ hm: localHmOf(l.start_ms, tz), text: l.text }));
  const more = Math.max(0, matched.length - max);
  return { evidence, more };
}
