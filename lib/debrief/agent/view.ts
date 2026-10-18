import { localHmOf } from "@/lib/capture/calendar";
import { DEBRIEF_QUESTION_MAX_CHARS, DEBRIEF_QUESTION_MIN_CHARS } from "@/lib/debrief/agent/constants";
import { QuestionAgentSchema } from "@/lib/firestore/schema";

/**
 * Read-side stale-text guard (docs/tasks/debrief-agent-18oct.md §5.5, D9). Pure. The stored agent wording is shown
 * only while the two inputs it was worded for still match the question: same category, same `HH:MM` start in the
 * outlet tz. Otherwise `undefined`, and the phone keeps the template. A stale sentence can never reach the phone.
 */
export interface AgentTextSource {
  kind: "gate" | "unlabelled_unit";
  category: string | null;
  window_start_ms: number;
  /** The read schema already drops a mismatching object; parsed strictly again here so this stays safe on any input. */
  agent?: unknown;
}

export function agentTextFor(q: AgentTextSource, tz: string): string | undefined {
  if (q.kind !== "gate" || q.category === null || q.agent === undefined || q.agent === null) return undefined;
  // Strict parse of the nested object: a malformed or future-version `agent` costs the wording only (risk review M5).
  const parsed = QuestionAgentSchema.safeParse(q.agent);
  if (!parsed.success) return undefined;
  const agent = parsed.data;
  if (agent.category !== q.category) return undefined;
  if (agent.start_hm !== localHmOf(q.window_start_ms, tz)) return undefined;
  const n = Array.from(agent.question_en).length;
  if (n < DEBRIEF_QUESTION_MIN_CHARS || n > DEBRIEF_QUESTION_MAX_CHARS) return undefined;
  return agent.question_en;
}
