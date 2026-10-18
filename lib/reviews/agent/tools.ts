import { z } from "zod";
import {
  caveatContextOfInputs,
  changePct,
  checkReview,
  extractNumbers,
  perDay,
  requiredCaveats,
  type ReviewCheckRule,
} from "@/lib/reviews/agent/check";
import { REVIEW_AGENT_MAX_ROUNDS } from "@/lib/reviews/agent/constants";
import { ReviewDraftArgsSchema, ReviewDraftSchema } from "@/lib/reviews/agent/schema";
import type { ReviewAgentInputs, ReviewAgentSession, ReviewToolSpec } from "@/lib/reviews/agent/types";

/**
 * ReviewAgent tools (docs/tasks/review-agent-18oct.md §5.8): the five tools the agent works with. Read-only (hard
 * rule 9: no write tool) and pure of I/O (no Firestore, no model call, no `@google/adk`).
 *
 * Every tool is a CLOSURE over this review's already-loaded, already-outlet-scoped, already-scrubbed data. No tool
 * takes an outlet id or names anything outside the closure; the only value the model chooses is an enum member
 * (`window`, `reason`). No output carries a thread id, device id, question id, answer, or the rule's verdict (D13:
 * the model derives the verdict, `check_review` verifies it). Error strings are fixed literals; nothing the shop
 * wrote is ever put into one.
 */

const RUN_DECIDED_ERROR = "run already decided";

/** The rule in words (what `suggestVerdict` does), so the model can derive the verdict without being handed it. */
const RULE_IN_WORDS =
  "A suggestion needs at least 2 captured days in both windows and a before count above 0; with 0 or 1 captured " +
  "days in either window, or when the before count is 0, there is no suggestion. Otherwise compare per-day counts: a " +
  "change of 20 percent or more in the metric's direction suggests worked, 20 percent or more against it suggests " +
  "revert, less than 20 percent either way suggests revise.";

const CHECK_REVIEW_DESCRIPTION =
  "Submit the review to the plain-code checker. All four fields are required: narrative_en, suggested_verdict, quoted_numbers, caveats. It answers accepted, or a list of failed rule codes to fix: " +
  "change_not_inspected, counts_not_inspected, sample_not_inspected (call get_change, get_counts and " +
  "get_evidence_sample for before and after first), verdict_mismatch (apply the rule in get_counts exactly; " +
  "none when it gives no suggestion), number_not_allowed (only numbers from get_counts, written as digits: 2, not two), " +
  "quoted_numbers_mismatch (quoted_numbers must list exactly the digit numbers in the narrative, with no minus sign: 25, not -25; the answer lists them as numbers_in_narrative), caveat_missing and " +
  "caveat_not_applicable (list exactly the caveats get_counts gave you), too_short and too_long (60 to 600 characters), " +
  "control_chars, placeholder (no brackets or braces), url_or_handle, date_or_time, staff_name, role_or_person " +
  "(say staff or a customer), instruction_word, causal_claim (say fewer moments were noted, never that the change " +
  "caused it). Fix exactly those reasons and submit again. At most " +
  REVIEW_AGENT_MAX_ROUNDS +
  " submissions count.";

function movedOf(ratio: number | null): "more" | "fewer" | "same" | null {
  if (ratio === null) return null;
  return ratio > 0 ? "more" : ratio < 0 ? "fewer" : "same";
}

export function buildReviewTools(
  inputs: ReviewAgentInputs,
  session: ReviewAgentSession,
): ReviewToolSpec<z.ZodObject<z.ZodRawShape>>[] {
  /** Records every call (and whether it answered with an error) on the run session. */
  function tool<P extends z.ZodObject<z.ZodRawShape>>(
    name: string,
    description: string,
    parameters: P,
    run: (input: z.infer<P>) => unknown,
  ): ReviewToolSpec<P> {
    return {
      name,
      description,
      parameters,
      execute: (input) => {
        const out = run(input);
        const ok = !(typeof out === "object" && out !== null && "error" in out);
        session.toolCalls.push({ name, ok });
        return out;
      },
    };
  }

  const getChange = tool(
    "get_change",
    "Read the SOP change being reviewed: the step before and after, the intervention, the rationale, the metric and the failure condition. Call this first.",
    z.object({}).strict(),
    () => {
      session.inspected.add("change");
      return inputs.change;
    },
  );

  const getCounts = tool(
    "get_counts",
    "Read the counted moments before and after the change (captured days, count, per day, percent change), the rule that turns them into a suggestion, and the caveats to list.",
    z.object({}).strict(),
    () => {
      session.inspected.add("counts");
      const win = (w: { days_captured: number; count: number }) => ({
        days_captured: w.days_captured,
        count: w.count,
        per_day: perDay(w),
      });
      return {
        before: win(inputs.counts.before),
        after: win(inputs.counts.after),
        change_pct: changePct(inputs.suggestion.change_ratio),
        // Which way the metric should move and which way the per-day count did: plain facts that stop the model reading
        // a rise in a "decrease" metric as "no change" (found in the PR-5 eval). Never the verdict itself.
        metric_should: inputs.change.metric.direction,
        per_day_moved: movedOf(inputs.suggestion.change_ratio),
        rule: RULE_IN_WORDS,
        // The caveats the code computed (a fixed vocabulary, never shop text). Without this the model can only guess
        // them, and `check_review` names a missing caveat by rule code, not by member (found in the PR-4 spike).
        caveats: requiredCaveats(caveatContextOfInputs(inputs)),
      };
    },
  );

  const getEvidenceSample = tool(
    "get_evidence_sample",
    "Read a few of the short notes counted in one window (category and summary). Call it for before and for after.",
    z.object({ window: z.enum(["before", "after"]).describe("Which window to read.") }).strict(),
    ({ window }) => {
      session.inspected.add(window);
      return {
        window,
        items: inputs.sample[window].map((s) => ({ date: s.date, time: s.start_hm, category: s.category, summary: s.summary })),
        total_in_window: inputs.counts[window].count,
      };
    },
  );

  const checkReviewTool = tool(
    "check_review",
    CHECK_REVIEW_DESCRIPTION,
    ReviewDraftArgsSchema as unknown as z.ZodObject<z.ZodRawShape>,
    (input) => {
      if (session.outcome) return { error: RUN_DECIDED_ERROR };
      // Defence in depth: ADK already parsed `input` with the same schema.
      const parsed = ReviewDraftArgsSchema.safeParse(input);
      if (!parsed.success) {
        // A malformed draft is not a check round. Paths only, never values.
        const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))];
        return {
          accepted: false,
          final: false,
          round: session.checkRounds,
          rounds_left: REVIEW_AGENT_MAX_ROUNDS - session.checkRounds,
          reasons: paths.map((p) => `schema_invalid:${p}`),
        };
      }
      const result = checkReview(parsed.data, { inputs, session });
      session.checkRounds += 1;
      if (result.passed) {
        // A passing draft satisfies the 60..600 draft schema on its trimmed narrative by construction of the checker.
        const draft = ReviewDraftSchema.safeParse({ ...parsed.data, narrative_en: parsed.data.narrative_en.trim() });
        if (draft.success) {
          session.outcome = { kind: "accepted", draft: draft.data };
          return { accepted: true };
        }
        // Unreachable while the checker enforces the same bounds; fail closed rather than trust it.
        session.outcome = { kind: "rejected", reasons: ["schema_invalid"] };
        return { accepted: false, final: true, round: session.checkRounds, rounds_left: 0, reasons: ["schema_invalid"] satisfies ReviewCheckRule[] };
      }
      const final = session.checkRounds >= REVIEW_AGENT_MAX_ROUNDS;
      if (final) session.outcome = { kind: "rejected", reasons: result.reasons };
      return {
        accepted: false,
        final,
        round: session.checkRounds,
        rounds_left: Math.max(0, REVIEW_AGENT_MAX_ROUNDS - session.checkRounds),
        reasons: result.reasons,
        // The numbers the model's own narrative contains (never shop text), so it can make quoted_numbers match.
        // The caveats the code computed (a fixed vocabulary, never shop text): the same list get_counts gave.
        ...(result.reasons.includes("caveat_missing") || result.reasons.includes("caveat_not_applicable")
          ? { caveats_to_list: requiredCaveats(caveatContextOfInputs(inputs)) }
          : {}),
        ...(result.reasons.includes("quoted_numbers_mismatch")
          ? { numbers_in_narrative: [...new Set(extractNumbers(parsed.data.narrative_en.trim()))].sort((a, b) => a - b) }
          : {}),
      };
    },
  );

  const decline = tool(
    "decline",
    "Decline when you cannot write an honest review of these counts. Use instead of check_review.",
    z.object({ reason: z.enum(["cannot_explain", "insufficient_evidence"]) }).strict(),
    ({ reason }) => {
      if (session.outcome) return { error: RUN_DECIDED_ERROR };
      session.outcome = { kind: "declined", reason };
      return { accepted: true };
    },
  );

  return [getChange, getCounts, getEvidenceSample, checkReviewTool, decline] as unknown as ReviewToolSpec<z.ZodObject<z.ZodRawShape>>[];
}
