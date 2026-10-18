import { localHmOf } from "@/lib/capture/calendar";
import type { ProposalLibrary, LibraryEntry } from "@/config/proposal-library";
import type { Proposal, SopVersion } from "@/lib/firestore/schema";
import { ProposalViewSchema, type ProposalView } from "@/lib/proposals/contract";

/**
 * Builds the API-facing `ProposalView` from a stored `Proposal` (R-08 Task
 * 5.5). Every field is built with explicit keys — never a spread of the
 * stored doc, so a future schema addition can never leak into the response
 * by accident (hard rule #7: no thread id, device id or question id ever
 * reaches the response).
 */

function labelFor(id: string, entries: readonly LibraryEntry[]): { id: string; label_en: string; label_id: string } {
  const entry = entries.find((e) => e.id === id);
  // An id no longer in the library (a later version dropped it) still
  // renders — the id itself, in both languages, rather than erroring.
  return entry ? { id, label_en: entry.label_en, label_id: entry.label_id } : { id, label_en: id, label_id: id };
}

/**
 * CHK-1: counts and enums read from `gate.checks` and the generator (never a rule, tool or fact name). A suppressed doc ran
 * no check (`checks` is empty), so it reads `null`. A v4 run that fell back produced a v3 doc: it reads as v3.
 */
function checkedOf(stored: Proposal): ProposalView["checked"] {
  const { checks } = stored.gate;
  if (checks.length === 0) return null;
  const { generator } = stored;
  const v4 = generator.v4 && !generator.v4.fell_back ? generator.v4 : null;
  const agent = v4 ? generator.agent_version : generator.agent_version === "proposal-v4" ? "proposal-v3" : generator.agent_version;
  return {
    checks_total: checks.length,
    checks_passed: checks.filter((c) => c.passed).length,
    rule_set: v4 && generator.check_version === "pcheck-v4" ? "pcheck-v4" : "pgate-v1",
    agent: agent === "proposal-v4" ? "proposal-v4" : agent === "proposal-v3" ? "proposal-v3" : "other",
    revisions: v4 ? Math.max(0, v4.check_rounds - 1) : Math.min(2, Math.max(0, generator.attempts - 1)),
    read_sections: v4 ? v4.tool_calls.filter((t) => t.name === "get_sop_section" && t.ok).length : null,
    read_facts: v4 ? v4.tool_calls.filter((t) => t.name === "get_evidence" && t.ok).length : null,
  };
}

export function toProposalView(
  stored: Proposal,
  summariesByThreadId: ReadonlyMap<string, string | null>,
  library: ProposalLibrary,
  sop: SopVersion,
  tz: string,
): ProposalView {
  const view: ProposalView = {
    proposal_id: stored.proposal_id,
    status: stored.status,
    created_at_ms: stored.created_at_ms,
    range: { from_date: stored.range.from_date, to_date: stored.range.to_date },
    focus_category: stored.focus_category ?? null, // R-19 §3.3; absent on a pre-R-19 doc reads null
    suppression: stored.suppression
      ? {
          reason: stored.suppression.reason,
          model_reason: stored.suppression.model_reason,
          followup: {
            categories: [...stored.suppression.followup.categories],
            have_facts: stored.suppression.followup.have_facts,
            have_dates: stored.suppression.followup.have_dates,
            need_facts: stored.suppression.followup.need_facts,
            need_dates: stored.suppression.followup.need_dates,
          },
        }
      : null,
    blocked_rule: stored.status === "blocked" ? stored.gate.fired_rule : null,
    checked: checkedOf(stored),
    content: stored.content
      ? {
          intervention: labelFor(stored.content.intervention_id, library.interventions.entries),
          rubric: stored.content.rubric_criterion_ids.map((id) => labelFor(id, library.rubric.entries)),
          target_step:
            stored.content.target_step_id === null
              ? null
              : (() => {
                  const step = sop.steps.find((s) => s.step_id === stored.content!.target_step_id);
                  return step
                    ? { step_id: step.step_id, title: step.title, text: step.text }
                    : { step_id: stored.content!.target_step_id!, title: stored.content!.target_step_id!, text: null };
                })(),
          change_title: stored.content.change_title,
          change_text: stored.content.change_text,
          rationale: stored.content.rationale,
          metric: {
            category: stored.content.metric.category,
            direction: stored.content.metric.direction,
            description: stored.content.metric.description,
            baseline_count: stored.content.metric.baseline_count,
            baseline_days: stored.content.metric.baseline_days,
          },
          failure_condition: stored.content.failure_condition,
          review_date: stored.content.review_date,
          evidence: stored.content.evidence.map((ref) => ({
            date: ref.local_date,
            start_hm: localHmOf(ref.first_line_start_ms, tz),
            category: ref.category,
            summary: summariesByThreadId.get(ref.thread_id) ?? null,
          })),
          censored_floor: true,
        }
      : null,
  };
  return ProposalViewSchema.parse(view);
}
