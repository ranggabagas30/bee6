import { z } from "zod";
import { dateString, isRealDate } from "@/lib/day/contract";
import { WorkCategorySchema } from "@/lib/pipeline/categories";
import {
  MODEL_DECLINE_REASONS,
  PROPOSAL_RULES,
  ProposalContentSchema,
  ProposalFollowupSchema,
  SUPPRESSION_REASONS,
  PROPOSAL_STATUSES,
} from "@/lib/firestore/schema";

/**
 * The generate route's request/response contract (R-08 Task 5.5; web spec
 * §6.2). The response never carries a thread id, device id or question id
 * (hard rule #7 / review focus #1) — evidence is `{ date, start_hm,
 * category, summary }` only.
 */

export const GenerateBodySchema = z
  .object({
    from_date: dateString.refine(isRealDate),
    to_date: dateString.refine(isRealDate),
    /** R-19 §3.3 "Generate another": skip the reuse of an open proposal for the same range. */
    another: z.boolean().optional(),
  })
  .strict();
export type GenerateBody = z.infer<typeof GenerateBodySchema>;

const hm = z.string().regex(/^\d{2}:\d{2}$/);
const labelled = z.object({ id: z.string(), label_en: z.string(), label_id: z.string() }).strict();

export const ProposalViewSchema = z
  .object({
    proposal_id: z.string().uuid(),
    status: z.enum(PROPOSAL_STATUSES),
    created_at_ms: z.number().int(),
    range: z.object({ from_date: dateString, to_date: dateString }).strict(),
    /** R-19 §3.3: the one category this proposal is about; null on a suppressed doc or a pre-R-19 doc. Required since PR-12a. */
    focus_category: WorkCategorySchema.nullable(),
    suppression: z
      .object({
        reason: z.enum(SUPPRESSION_REASONS),
        model_reason: z.enum(MODEL_DECLINE_REASONS).nullable(),
        followup: ProposalFollowupSchema,
      })
      .strict()
      .nullable(),
    blocked_rule: z.enum(PROPOSAL_RULES).nullable(),
    content: z
      .object({
        intervention: labelled,
        rubric: z.array(labelled).min(1),
        /**
         * null = new step. `text` is the step's wording in the SOP version the proposal was generated against
         * (`generator.sop_version_id`; the review service falls back to the current version only when that one is
         * missing). The detail screen strikes it through next to `change_text` (R-19 §9.5); null only when the step id
         * is not in that version.
         */
        target_step: z.object({ step_id: z.string(), title: z.string(), text: z.string().nullable() }).strict().nullable(),
        change_title: z.string(),
        change_text: z.string(),
        rationale: z.string(),
        metric: ProposalContentSchema.shape.metric,
        failure_condition: z.string(),
        review_date: dateString,
        evidence: z
          .array(
            z
              .object({
                date: dateString,
                start_hm: hm,
                category: WorkCategorySchema,
                summary: z.string().nullable(), // null = thread expired (P4 TTL)
              })
              .strict(),
          )
          .min(2),
        censored_floor: z.literal(true),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ProposalView = z.infer<typeof ProposalViewSchema>;

export const GenerateResponseSchema = z.object({ proposal: ProposalViewSchema, reused: z.boolean() }).strict();
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
