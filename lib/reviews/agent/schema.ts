import { z } from "zod";
import {
  REVIEW_AGENT_MODELS,
  REVIEW_AGENT_VERSION,
  REVIEW_NARRATIVE_MAX_CHARS,
  REVIEW_NARRATIVE_MIN_CHARS,
} from "@/lib/reviews/agent/constants";

/**
 * The ReviewAgent's structured output and its stored shape (docs/tasks/review-agent-18oct.md §5.4, §5.5). The
 * `check_review` tool's ARGUMENTS are the output (no `responseJsonSchema`). Dependency-free besides zod and the
 * constants, so `lib/firestore/schema.ts` can import it without a cycle.
 */

/** The fixed caveat vocabulary. The UI renders the COMPUTED list (`requiredCaveats`), never the model's. */
export const REVIEW_CAVEATS = [
  "short_window", // before or after has < 7 captured days (always true in the demo)
  "category_count_not_problem_count", // ALWAYS required: the count is moments of one category
  "staff_answers_affect_count", // metric category is ALWAYS_QUESTION or NEEDS_SUPERVISOR_CONFIRM
  "overlapping_change", // notices.overlapping_change
  "threads_truncated", // notices.threads_truncated
  "not_enough_days", // suggestion.reason === "not_enough_days"
  "no_baseline", // suggestion.reason === "no_baseline"
] as const;
export const ReviewCaveatSchema = z.enum(REVIEW_CAVEATS);
export type ReviewCaveat = z.infer<typeof ReviewCaveatSchema>;

/** The verdict words the agent may write: the three verdicts, or "none" when the rule gives no suggestion. */
export const REVIEW_AGENT_VERDICTS = ["worked", "revise", "revert", "none"] as const;
export type ReviewAgentVerdict = (typeof REVIEW_AGENT_VERDICTS)[number];

export const ReviewDraftSchema = z
  .object({
    narrative_en: z.string().refine(
      (s) => {
        const n = Array.from(s).length;
        return n >= REVIEW_NARRATIVE_MIN_CHARS && n <= REVIEW_NARRATIVE_MAX_CHARS;
      },
      { message: `narrative_en must be ${REVIEW_NARRATIVE_MIN_CHARS}..${REVIEW_NARRATIVE_MAX_CHARS} code points` },
    ),
    suggested_verdict: z
      .enum(REVIEW_AGENT_VERDICTS)
      .describe("Required. The verdict the rule in get_counts gives: worked, revise or revert; none when it gives no suggestion."),
    quoted_numbers: z
      .array(z.number().finite())
      .max(12)
      .describe("Required. Every number written in the narrative, as the digits appear, with no minus sign (25, not -25)."),
    caveats: z
      .array(ReviewCaveatSchema)
      .max(REVIEW_CAVEATS.length)
      .describe("Required. Exactly the caveats get_counts gave you."),
  })
  .strict();
export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;

/** Hostile-input bound for the raw tool argument; the 60..600 rule is the checker's NAMED `too_short`/`too_long`. */
export const REVIEW_ARGS_NARRATIVE_MAX_CHARS = 2000;

/**
 * The `check_review` tool's PARAMETER schema (what ADK validates at call time, and the checker's `schema_invalid`).
 * Deliberately looser than `ReviewDraftSchema` on the narrative length: a draft of 30 or 900 characters must reach
 * `checkReview` so the model is told `too_short` / `too_long` and can fix it, instead of an opaque zod error that
 * does not count as a round (same pattern as the DebriefAgent's `DebriefQuestionArgsSchema`). A draft that PASSES the
 * checker always satisfies `ReviewDraftSchema` on its trimmed narrative.
 */
export const ReviewDraftArgsSchema = ReviewDraftSchema.extend({
  // flash-lite sometimes sends numbers as strings or mistypes a caveat; either is an opaque tool error that never reaches
  // the checker. Read the numbers as numbers and let an unknown caveat reach `checkReview` (caveat_not_applicable), which
  // names the problem. The STORED shape (`ReviewDraftSchema`) stays strict: a draft is only stored after it passes the checker.
  quoted_numbers: z
    .array(z.coerce.number().finite())
    .max(12)
    .describe("Required. Every number written in the narrative, as the digits appear, with no minus sign (25, not -25)."),
  caveats: z
    .array(z.string().max(60))
    .max(REVIEW_CAVEATS.length)
    .describe(`Required. Exactly the caveats get_counts gave you (from: ${REVIEW_CAVEATS.join(", ")}).`),
  narrative_en: z
    .string()
    .refine((s) => Array.from(s).length <= REVIEW_ARGS_NARRATIVE_MAX_CHARS, { message: "narrative_en is too long" })
    .describe("Required. The review, 2 to 4 sentences, 60 to 600 characters, plain English."),
}).strict();
export type ReviewDraftArgs = z.infer<typeof ReviewDraftArgsSchema>;

/**
 * `reviews/{id}.agent` (optional; written once by the fast-forward). Never a name, id, date, time, line text or
 * model reasoning. Storage bound on the narrative is 2x the checked bound.
 */
export const ReviewAgentStoredSchema = z
  .object({
    version: z.literal(REVIEW_AGENT_VERSION),
    model: z.enum(REVIEW_AGENT_MODELS),
    narrative_en: z.string().min(1).max(REVIEW_NARRATIVE_MAX_CHARS * 2),
    suggested_verdict: z.enum(REVIEW_AGENT_VERDICTS),
    caveats: z.array(ReviewCaveatSchema).max(REVIEW_CAVEATS.length),
    rounds: z.number().int().min(1).max(2),
    model_calls: z.number().int().min(0).max(40),
    generated_at_ms: z.number().int().min(0),
  })
  .strict();
export type ReviewAgentStored = z.infer<typeof ReviewAgentStoredSchema>;
