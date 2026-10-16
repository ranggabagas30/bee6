import { z } from "zod";
import { WorkCategorySchema } from "@/lib/pipeline/categories";
import {
  MAX_CITED_EVIDENCE,
  REVIEW_AFTER_DAYS_MAX,
  REVIEW_AFTER_DAYS_MIN,
  V4_QUOTE_MAX_CHARS,
  V4_QUOTE_MIN_CHARS,
} from "@/lib/proposals/constants";
import { WIRE_MAX, type ProposalWire, type WireContext } from "@/lib/proposals/wire-schema";

/**
 * R-24: the draft the v4 Proposal agent passes to `check_proposal`. A strict, per-call schema built from this Ask's
 * own offered ids (like `buildProposalWireSchema`), plus the section the change belongs to and the verbatim quotes
 * that back each cited fact. It is the tool's `parameters` (ADK enforces it with `parse()`), and `execute` validates
 * it a second time. Plain code; the model only picks among offered ids and writes text.
 */

export interface V4WireContext extends WireContext {
  sectionIds: string[];
}

export function buildProposalDraftV4Schema(ctx: V4WireContext) {
  if (ctx.interventionIds.length === 0) {
    throw new Error("buildProposalDraftV4Schema: interventionIds must not be empty");
  }
  if (ctx.rubricIds.length === 0) {
    throw new Error("buildProposalDraftV4Schema: rubricIds must not be empty");
  }
  if (ctx.evidenceAliases.length === 0) {
    throw new Error("buildProposalDraftV4Schema: evidenceAliases must not be empty");
  }
  if (ctx.stepIds.length === 0) {
    throw new Error("buildProposalDraftV4Schema: stepIds must not be empty");
  }
  if (ctx.sectionIds.length === 0) {
    throw new Error("buildProposalDraftV4Schema: sectionIds must not be empty");
  }

  const aliases = ctx.evidenceAliases as [string, ...string[]];
  const stepIdsWithNew: [string, ...string[]] = [ctx.stepIds[0]!, ...ctx.stepIds.slice(1), "NEW"];

  const base = {
    section_id: z.enum(ctx.sectionIds as [string, ...string[]]),
    target_step_id: z.enum(stepIdsWithNew),
    intervention_id: z.enum(ctx.interventionIds as [string, ...string[]]),
    rubric_criterion_ids: z.array(z.enum(ctx.rubricIds as [string, ...string[]])).min(1).max(6),
    evidence: z.array(z.enum(aliases)).min(1).max(MAX_CITED_EVIDENCE),
    evidence_quotes: z
      .array(
        z
          .object({
            alias: z.enum(aliases),
            quote: z.string().min(V4_QUOTE_MIN_CHARS).max(V4_QUOTE_MAX_CHARS),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_CITED_EVIDENCE),
    change_title: z.string().min(1).max(WIRE_MAX.change_title),
    change_text: z.string().min(1).max(WIRE_MAX.change_text),
    rationale: z.string().min(1).max(WIRE_MAX.rationale),
    metric_category: WorkCategorySchema,
    metric_direction: z.enum(["decrease", "increase"]),
    metric_description: z.string().min(1).max(WIRE_MAX.metric_description),
    failure_condition: z.string().min(1).max(WIRE_MAX.failure_condition),
    review_after_days: z.number().int().min(REVIEW_AFTER_DAYS_MIN).max(REVIEW_AFTER_DAYS_MAX),
  };

  // D16: the key EXISTS only when there are constraints. With none it is absent from the tool declaration, and
  // `.strict()` rejects it if the model sends it anyway (an `.max(0)` array made the model send a non-empty one).
  if (ctx.constraintAliases.length > 0) {
    return z
      .object({
        ...base,
        constraints_acknowledged: z
          .array(z.enum(ctx.constraintAliases as [string, ...string[]]))
          .max(ctx.constraintAliases.length),
      })
      .strict();
  }
  return z.object(base).strict();
}

/** Inferred draft; `constraints_acknowledged` is present only when this Ask had constraints. */
export type ProposalDraftV4 = Omit<
  z.infer<ReturnType<typeof buildProposalDraftV4Schema>>,
  "constraints_acknowledged"
> & { constraints_acknowledged?: string[] };

/** The v3 wire shape the rest of the service already consumes (gate, redact, commit). Pure. */
export function draftToWire(d: ProposalDraftV4): ProposalWire {
  return {
    decision: "propose",
    no_proposal_reason: null,
    intervention_id: d.intervention_id,
    rubric_criterion_ids: [...d.rubric_criterion_ids],
    evidence: [...d.evidence],
    target_step_id: d.target_step_id,
    change_title: d.change_title,
    change_text: d.change_text,
    rationale: d.rationale,
    metric_category: d.metric_category,
    metric_direction: d.metric_direction,
    metric_description: d.metric_description,
    failure_condition: d.failure_condition,
    review_after_days: d.review_after_days,
    constraints_acknowledged: d.constraints_acknowledged ? [...d.constraints_acknowledged] : [],
  };
}
