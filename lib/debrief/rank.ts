import { DEBRIEF_LIST_SERVER_CAP, INCIDENT_FIRST } from "@/lib/debrief/constants";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { Question } from "@/lib/firestore/schema";

function isIncidentFirst(q: Question): boolean {
  return q.kind === "gate" && q.category !== null && INCIDENT_FIRST.has(q.category as WorkCategory);
}

/**
 * Orders a device's open debrief questions (R-07, technical spec §8.10):
 * an incident-category gate question (SAFETY_INCIDENT/SECURITY_INCIDENT/
 * DISRUPTION) first, then oldest `window_start_ms` first, ties broken by
 * `question_id`. Capped at `DEBRIEF_LIST_SERVER_CAP` (the phone then takes
 * at most `DEBRIEF_SHOW_MAX`, filtering already-cached ids first).
 */
export function rankQuestions(qs: readonly Question[]): Question[] {
  return [...qs]
    .sort((a, b) => {
      const aFirst = isIncidentFirst(a);
      const bFirst = isIncidentFirst(b);
      if (aFirst !== bFirst) return aFirst ? -1 : 1;
      if (a.window_start_ms !== b.window_start_ms) return a.window_start_ms - b.window_start_ms;
      return a.question_id < b.question_id ? -1 : a.question_id > b.question_id ? 1 : 0;
    })
    .slice(0, DEBRIEF_LIST_SERVER_CAP);
}
