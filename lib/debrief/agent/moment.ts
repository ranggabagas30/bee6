import { localHmOf } from "@/lib/capture/calendar";
import {
  DEBRIEF_AGENT_LINE_MAX_CHARS,
  DEBRIEF_AGENT_MAX_LINES,
  DEBRIEF_AGENT_SUMMARY_MAX_CHARS,
} from "@/lib/debrief/agent/constants";
import type { DebriefQuestionMoment } from "@/lib/debrief/agent/types";
import { scrubQuestionLine, stripInvisibleChars } from "@/lib/debrief/question-line";
import { CATEGORY_LABELS } from "@/lib/i18n/category-labels";
import type { Category } from "@/lib/pipeline/categories";
import type { GateRule } from "@/lib/pipeline/gate";

/**
 * Builds the `DebriefQuestionMoment` the agent is shown (docs/tasks/debrief-agent-18oct.md §3.1, D5). Pure.
 * Input is the thread's own stored, already-redacted text; it is re-hygiened here exactly as the read path does
 * for the quoted lines: invisible characters stripped FIRST (a zero-width space cannot hide a name), then the staff
 * scrub incl. clitics, THEN trimmed and cut (a name cut in half by the truncation would survive as a prefix).
 * Returns `null` when there is nothing to word (no label, NON_WORK, or no non-empty line after the scrub): the
 * caller then keeps the template and does not call the agent.
 */

export interface MomentInput {
  category: Category | null;
  window_start_ms: number;
  window_end_ms: number;
  thread: {
    lines: ReadonlyArray<{ line_id: string; start_ms: number; end_ms: number; text: string }>;
    evidence_line_ids: readonly string[];
    summary: string;
    gate: { fired_rule: GateRule };
  };
  staffNames: readonly string[];
  outletName?: string;
  /** The outlet tz: the SAME one the read path uses, so `start_hm` matches the phone byte for byte. */
  tz: string;
}

/** Cuts to `max` code points, the last one being "…" (same shape as the read path's quoted lines). */
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

export function buildMoment(input: MomentInput): DebriefQuestionMoment | null {
  const { category } = input;
  if (category === null || category === "NON_WORK") return null;
  const label = CATEGORY_LABELS.en[category];
  if (!label) return null;

  const clean = (text: string): string =>
    scrubQuestionLine(stripInvisibleChars(text), input.staffNames, input.outletName).trim();
  const byStart = (a: { start_ms: number }, b: { start_ms: number }) => a.start_ms - b.start_ms;

  const evidenceIds = new Set(input.thread.evidence_line_ids);
  const evidence = input.thread.lines.filter((l) => evidenceIds.has(l.line_id)).sort(byStart);
  const rest = input.thread.lines.filter((l) => !evidenceIds.has(l.line_id)).sort(byStart);
  const lines = [...evidence, ...rest]
    .map((l) => clean(l.text))
    .filter((text) => text.length > 0)
    .slice(0, DEBRIEF_AGENT_MAX_LINES)
    .map((text) => cut(text, DEBRIEF_AGENT_LINE_MAX_CHARS));
  if (lines.length === 0) return null;

  return {
    category,
    category_label_en: label,
    start_hm: localHmOf(input.window_start_ms, input.tz),
    end_hm: localHmOf(input.window_end_ms, input.tz),
    fired_rule: input.thread.gate.fired_rule,
    lines,
    summary: cut(clean(input.thread.summary), DEBRIEF_AGENT_SUMMARY_MAX_CHARS),
  };
}
