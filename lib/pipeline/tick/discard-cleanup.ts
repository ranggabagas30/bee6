import { threadQuestionId } from "@/lib/pipeline/question-ids";
import type { DiscardCleanupPlan, DiscardTombstone, GhostCandidates } from "@/lib/pipeline/tick/types";

/**
 * Cancel-B (R-20): which derived docs a discarded capture session left behind.
 * Pure: no I/O, no clock. The tick (`lib/pipeline/tick/service.ts`) feeds it the
 * tombstone and the device's thread/question ids, then hands the plan to
 * `TickStore.applyDiscardCleanup`.
 *
 * Interval rule = `lib/day/attribution.ts` `sessionInterval`: a thread belongs to
 * the session iff its FIRST line starts in `[started_at_ms, ended_at_ms)` (end
 * exclusive). A thread whose first line is before `started_at_ms` is kept even if
 * it later absorbed lines of the cancelled session: attribution gives it to the
 * earlier session, so cleanup does too (documented gap, R-20 plan §2.3).
 */
export function selectDiscardGhosts(t: DiscardTombstone, c: GhostCandidates): DiscardCleanupPlan {
  const inInterval = (ms: number): boolean => ms >= t.started_at_ms && ms < t.ended_at_ms;

  const threadIds = c.threads.filter((x) => inInterval(x.first_line_start_ms)).map((x) => x.thread_id);
  const ghostThreads = new Set(threadIds);

  const questionIds = new Set<string>();
  for (const id of threadIds) questionIds.add(threadQuestionId(id));
  for (const q of c.questions) {
    if (q.kind === "unlabelled_unit" && inInterval(q.window_start_ms)) questionIds.add(q.question_id);
    // A stored gate question that points at a ghost thread goes with it, whatever its id.
    if (q.kind === "gate" && q.thread_id !== null && ghostThreads.has(q.thread_id)) questionIds.add(q.question_id);
  }

  const question_ids = Array.from(questionIds);
  return {
    session_id: t.session_id,
    thread_ids: threadIds,
    question_ids,
    // corrections/{question_id}: the correction's doc id IS its question's id.
    correction_ids: [...question_ids],
  };
}

/** True for a segment of a tombstoned session; a segment with no `session_id` (pre-P1) is never discarded. */
export function isSegmentDiscarded(seg: { session_id: string | null }, discarded: ReadonlySet<string>): boolean {
  return seg.session_id !== null && discarded.has(seg.session_id);
}
