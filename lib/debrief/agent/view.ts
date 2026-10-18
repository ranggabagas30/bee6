import { localHmOf } from "@/lib/capture/calendar";
import { DEBRIEF_QUESTION_MAX_CHARS, DEBRIEF_QUESTION_MIN_CHARS } from "@/lib/debrief/agent/constants";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Read-side stale-text guard (docs/tasks/debrief-agent-18oct.md §5.5, D9). Pure. The stored agent wording is shown
 * only while the two inputs it was worded for still match the question: same category, same `HH:MM` start in the
 * outlet tz. Otherwise `undefined`, and the phone keeps the template. A stale sentence can never reach the phone.
 */
export interface AgentTextSource {
  kind: "gate" | "unlabelled_unit";
  category: string | null;
  window_start_ms: number;
  agent?: { category: WorkCategory; start_hm: string; question_en: string } | undefined;
}

export function agentTextFor(q: AgentTextSource, tz: string): string | undefined {
  if (q.kind !== "gate" || q.category === null || !q.agent) return undefined;
  if (q.agent.category !== q.category) return undefined;
  if (q.agent.start_hm !== localHmOf(q.window_start_ms, tz)) return undefined;
  const n = Array.from(q.agent.question_en).length;
  if (n < DEBRIEF_QUESTION_MIN_CHARS || n > DEBRIEF_QUESTION_MAX_CHARS) return undefined;
  return q.agent.question_en;
}
