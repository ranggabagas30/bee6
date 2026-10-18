import { z } from "zod";
import { dateString } from "@/lib/day/contract";
import { REVIEW_STATUSES, REVIEW_VERDICTS, SUGGESTION_REASONS, SopChangeMetricSchema } from "@/lib/firestore/schema";
import { REVIEW_NARRATIVE_MAX_CHARS } from "@/lib/reviews/agent/constants";
import { ReviewCaveatSchema } from "@/lib/reviews/agent/schema";
import { LIST_DECIDED_MAX, LIST_OPEN_MAX } from "@/lib/reviews/constants";

/**
 * Wire contract for the review routes (R-11 Task 3). Views carry dates,
 * counts and text copied from the SOP change; never a thread id, device id,
 * source_proposal_id or sop_version_id (hard rule #7, R-11 §2).
 */

/** Optional reason: trimmed 3..300 characters when given (T-510). Redacted server-side before storage. */
const ReasonSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(3).max(300));

export const VerdictBodySchema = z.object({ verdict: z.enum(REVIEW_VERDICTS), reason: ReasonSchema.optional() }).strict();
export type VerdictBody = z.infer<typeof VerdictBodySchema>;

/** A review is addressed by version number; the id is built from the caller's outlet, never from the URL. */
export const VersionParamSchema = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().min(2));
export const FastForwardBodySchema = z.object({}).strict();

export const REVIEW_CONFLICT_CODES = ["ALREADY_DECIDED", "NOT_YET_REVIEWABLE", "EXPIRED", "NOTHING_TO_REVIEW"] as const;
export type ReviewConflictCode = (typeof REVIEW_CONFLICT_CODES)[number];

const WindowView = z
  .object({ from_date: dateString, to_date: dateString, days_captured: z.number().int(), count: z.number().int() })
  .strict();
const DecidedView = z
  .object({ verdict: z.enum(REVIEW_VERDICTS), reason: z.string().nullable(), decided_date: dateString })
  .strict();

export const ReviewViewSchema = z
  .object({
    version: z.number().int().min(2),
    change_title: z.string(),
    metric: SopChangeMetricSchema,
    failure_condition: z.string(),
    effective_from_date: dateString,
    review_date: dateString,
    confirm_by_date: dateString,
    before: WindowView,
    after: WindowView,
    suggestion: z
      .object({
        verdict: z.enum(REVIEW_VERDICTS).nullable(),
        reason: z.enum(SUGGESTION_REASONS),
        change_ratio: z.number().nullable(),
      })
      .strict(),
    notices: z.object({ overlapping_change: z.boolean(), threads_truncated: z.boolean() }).strict(),
    simulated: z.boolean(),
    status: z.enum(REVIEW_STATUSES),
    supervisor: DecidedView.nullable(),
    owner: DecidedView.nullable(),
    /**
     * ReviewAgent panel (docs/tasks/review-agent-18oct.md §5.6): the checked narrative and the caveats the code
     * COMPUTED (never the model's list). Present only on a review the agent explained. Nothing else of the run
     * (rounds, calls, model, verdict) reaches the wire. Render the narrative as a text node, never as HTML.
     */
    agent: z
      .object({
        narrative_en: z.string().min(1).max(REVIEW_NARRATIVE_MAX_CHARS * 2),
        caveats: z.array(ReviewCaveatSchema),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ReviewView = z.infer<typeof ReviewViewSchema>;

export const ListReviewsResponseSchema = z
  .object({
    fast_forward_available: z.boolean(), // DEMO_MODE && project_kind demo && a change is still unreviewed
    open: z.array(ReviewViewSchema).max(LIST_OPEN_MAX),
    decided: z.array(ReviewViewSchema).max(LIST_DECIDED_MAX),
  })
  .strict();
export type ListReviewsResponse = z.infer<typeof ListReviewsResponseSchema>;

export const VerdictResponseSchema = z
  .object({ result: z.enum(["recorded", "unchanged"]), status: z.enum(REVIEW_STATUSES) })
  .strict();
export type VerdictResponse = z.infer<typeof VerdictResponseSchema>;

export const FastForwardResponseSchema = z.object({ version: z.number().int().min(2) }).strict();
export type FastForwardResponse = z.infer<typeof FastForwardResponseSchema>;

export const RunResponseSchema = z
  .object({ outlets: z.number().int(), created: z.number().int(), expired: z.number().int(), errors: z.number().int() })
  .strict();
export type RunResponse = z.infer<typeof RunResponseSchema>;
