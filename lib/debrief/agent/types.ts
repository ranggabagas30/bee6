import type { GateRule } from "@/lib/pipeline/gate";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * What the DebriefAgent is shown about ONE flagged moment (docs/tasks/debrief-agent-18oct.md §3.1). Everything is
 * the thread's own stored, already-redacted text, re-scrubbed (staff names incl. clitics, invisible characters) and
 * cut to size by `buildMoment`. No name, no role, no id, no SOP text (D4).
 */
export interface DebriefQuestionMoment {
  /** The question's category (never NON_WORK). */
  category: WorkCategory;
  /** `CATEGORY_LABELS.en[category]`. */
  category_label_en: string;
  /** "HH:MM" in the outlet tz: exactly what the phone shows. */
  start_hm: string;
  end_hm: string;
  /** From `thread.gate.fired_rule`: why the gate asked. */
  fired_rule: GateRule;
  /** 1..6 lines, each 1..160 code points. */
  lines: string[];
  /**
   * 0..300 code points. NOT shown to the model and NOT an allowed-word or number source for the checker (QA 18 Oct,
   * D-1); it only widens the negated-notes skip (`notesHaveNegation`), which can only keep the template.
   */
  summary: string;
}
