import { DEBRIEF_LIST_SERVER_CAP, INCIDENT_FIRST } from "@/lib/debrief/constants";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { Question } from "@/lib/firestore/schema";
import { EVIDENCE_EXCLUDED } from "@/lib/proposals/constants";

/**
 * Tier 0: an incident-category gate question (SAFETY_INCIDENT / SECURITY_INCIDENT / DISRUPTION).
 * Tier 1: any other gate question whose category can become proposal evidence.
 * Tier 2: the rest — a ROUTINE_OPS gate question (never evidence, R-19 D-3) and an unlabelled unit.
 */
function tierOf(q: Question): 0 | 1 | 2 {
  if (q.kind !== "gate" || q.category === null) return 2;
  const category = q.category as WorkCategory;
  if (INCIDENT_FIRST.has(category)) return 0;
  return EVIDENCE_EXCLUDED.has(category) ? 2 : 1;
}

/**
 * Orders a device's open debrief questions (R-07, technical spec §8.10; R-19
 * §3.1): by tier (incident first, then non-routine gate questions, then
 * routine and unlabelled), then oldest `window_start_ms` first, ties broken
 * by `question_id`. Capped at `DEBRIEF_LIST_SERVER_CAP` (the phone then
 * takes at most `DEBRIEF_SHOW_MAX`, filtering already-cached ids first).
 * With a phone cap of 5, a routine question therefore never pushes a
 * phone-call question out.
 */
export function rankQuestions(qs: readonly Question[]): Question[] {
  return [...qs]
    .sort((a, b) => {
      const aTier = tierOf(a);
      const bTier = tierOf(b);
      if (aTier !== bTier) return aTier - bTier;
      if (a.window_start_ms !== b.window_start_ms) return a.window_start_ms - b.window_start_ms;
      return a.question_id < b.question_id ? -1 : a.question_id > b.question_id ? 1 : 0;
    })
    .slice(0, DEBRIEF_LIST_SERVER_CAP);
}
