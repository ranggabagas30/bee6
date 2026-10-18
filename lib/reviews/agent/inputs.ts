import type { ProposalLibrary } from "@/config/proposal-library";
import { scrubQuestionLine, stripInvisibleChars } from "@/lib/debrief/question-line";
import type { ReviewWindow, SopVersion } from "@/lib/firestore/schema";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Candidate } from "@/lib/proposals/candidates";
import { REVIEW_SAMPLE_PER_WINDOW, REVIEW_SAMPLE_SUMMARY_MAX_CHARS } from "@/lib/reviews/agent/constants";
import type { EvidenceSample, ReviewAgentInputs } from "@/lib/reviews/agent/types";
import type { Suggestion } from "@/lib/reviews/verdict";

/**
 * Builds what the ReviewAgent may see (docs/tasks/review-agent-18oct.md §5.7, D14). Pure: no I/O, no clock.
 *
 * The ONLY shop text that is read at review time is a thread's stored `summary` (already staff-name scrubbed and
 * SDP-redacted when it was written). It is scrubbed once more here, invisible characters stripped, whitespace
 * flattened and cut at 200 code points. Never a line, a thread id, a device id or an answer: `EvidenceSample` has
 * no field for them, and `buildSample` copies four fields by name.
 */

/** One measured window: the counts plus the metric-category candidates it counted (any order). */
export interface MeasuredWindow {
  window: ReviewWindow;
  candidates: readonly Candidate[];
}

/** First `REVIEW_SAMPLE_PER_WINDOW` usable summaries, in time order. */
export function buildSample(candidates: readonly Candidate[], staffNames: readonly string[]): EvidenceSample[] {
  const sorted = [...candidates].sort((a, b) => a.first_line_start_ms - b.first_line_start_ms);
  const out: EvidenceSample[] = [];
  for (const c of sorted) {
    if (out.length >= REVIEW_SAMPLE_PER_WINDOW) break;
    // Invisible characters first (a zero-width space inside a name would hide it from the scrub), then the scrub,
    // then flatten and cut: a name is never cut in half before it is scrubbed.
    const scrubbed = scrubQuestionLine(stripInvisibleChars(c.summary), staffNames);
    const flat = scrubbed.replace(/\s+/g, " ").trim();
    const summary = Array.from(flat).slice(0, REVIEW_SAMPLE_SUMMARY_MAX_CHARS).join("").trim();
    if (summary === "") continue;
    out.push({ date: c.local_date, start_hm: c.start_hm, category: c.category, summary });
  }
  return out;
}

export function buildReviewAgentInputs(input: {
  sop: SopVersion;
  /** The source proposal's stored rationale (already redacted). */
  rationale: string;
  library: ProposalLibrary;
  before: MeasuredWindow;
  after: MeasuredWindow;
  notices: ReviewAgentInputs["notices"];
  suggestion: Suggestion;
  staffNames: readonly string[];
}): ReviewAgentInputs {
  const { sop, library, staffNames } = input;
  const change = sop.change;
  if (!change) throw new Error("buildReviewAgentInputs: not a shipped change");
  const entry = library.interventions.entries.find((e) => e.id === change.intervention_id);
  return {
    change: {
      version: sop.version,
      change_title: change.change_title,
      kind: change.kind,
      step_title: change.after.title,
      step_before: change.before === null ? null : change.before.text,
      step_after: change.after.text,
      intervention: entry
        ? { id: entry.id, label_en: entry.label_en, definition: entry.definition }
        : { id: change.intervention_id, label_en: change.intervention_id, definition: "" },
      rationale: input.rationale,
      metric: {
        category: change.metric.category,
        category_label_en: t("en", `C-cat-${change.metric.category}` as DictKey),
        direction: change.metric.direction,
        description: change.metric.description,
        baseline_count: change.metric.baseline_count,
        baseline_days: change.metric.baseline_days,
      },
      failure_condition: change.failure_condition,
    },
    counts: { before: { ...input.before.window }, after: { ...input.after.window }, rule: { min_days: 2, threshold_pct: 20 } },
    sample: { before: buildSample(input.before.candidates, staffNames), after: buildSample(input.after.candidates, staffNames) },
    notices: { ...input.notices },
    suggestion: input.suggestion,
    staffNames,
  };
}
