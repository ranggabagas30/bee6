import { z } from "zod";
import { WorkCategorySchema } from "@/lib/pipeline/categories";
import { assertNoForbiddenKeywords, cleanJsonSchemaNode } from "@/lib/pipeline/label/wire-schema";
import { MAX_CITED_EVIDENCE } from "@/lib/proposals/constants";
import { MODEL_DECLINE_REASONS } from "@/lib/firestore/schema";

/**
 * The ProposalAgent's actual output contract (R-08 Task 4.2) — a strict,
 * per-call schema built fresh from this generate call's own offered ids
 * (library entries, evidence aliases, SOP step ids, constraint aliases), so
 * Vertex's structured output can never return an id this call didn't offer
 * (defence in depth alongside the plain-code gate, `proposal-gate.ts`).
 */

export interface WireContext {
  interventionIds: string[];
  rubricIds: string[];
  evidenceAliases: string[];
  stepIds: string[];
  constraintAliases: string[];
}

export const WIRE_MAX = {
  change_title: 80,
  change_text: 400,
  rationale: 400,
  metric_description: 160,
  failure_condition: 240,
} as const;

function nonEmptyAfterTrim(s: string): boolean {
  return s.trim().length > 0;
}

export function buildProposalWireSchema(ctx: WireContext) {
  if (ctx.interventionIds.length === 0) {
    throw new Error("buildProposalWireSchema: interventionIds must not be empty");
  }
  if (ctx.rubricIds.length === 0) {
    throw new Error("buildProposalWireSchema: rubricIds must not be empty");
  }
  if (ctx.evidenceAliases.length === 0) {
    throw new Error("buildProposalWireSchema: evidenceAliases must not be empty");
  }
  if (ctx.stepIds.length === 0) {
    throw new Error("buildProposalWireSchema: stepIds must not be empty");
  }

  const stepIdsWithNew: [string, ...string[]] = [ctx.stepIds[0]!, ...ctx.stepIds.slice(1), "NEW"];

  return z
    .object({
      decision: z.enum(["propose", "no_proposal"]),
      no_proposal_reason: z.enum(MODEL_DECLINE_REASONS).nullable(),
      intervention_id: z.enum(ctx.interventionIds as [string, ...string[]]).nullable(),
      rubric_criterion_ids: z.array(z.enum(ctx.rubricIds as [string, ...string[]])).max(6),
      evidence: z.array(z.enum(ctx.evidenceAliases as [string, ...string[]])).max(MAX_CITED_EVIDENCE),
      target_step_id: z.enum(stepIdsWithNew).nullable(),
      change_title: z.string().max(WIRE_MAX.change_title),
      change_text: z.string().max(WIRE_MAX.change_text),
      rationale: z.string().max(WIRE_MAX.rationale),
      metric_category: WorkCategorySchema.nullable(),
      metric_direction: z.enum(["decrease", "increase"]).nullable(),
      metric_description: z.string().max(WIRE_MAX.metric_description),
      failure_condition: z.string().max(WIRE_MAX.failure_condition),
      review_after_days: z.number().int().min(7).max(28).nullable(),
      constraints_acknowledged:
        ctx.constraintAliases.length > 0
          ? z.array(z.enum(ctx.constraintAliases as [string, ...string[]])).max(ctx.constraintAliases.length)
          : z.array(z.string()).max(0),
    })
    .strict()
    .superRefine((w, c) => {
      if (w.decision === "no_proposal") {
        if (w.no_proposal_reason === null) {
          c.addIssue({
            code: "custom",
            path: ["no_proposal_reason"],
            message: 'no_proposal_reason is required when decision is "no_proposal"',
          });
        }
        return;
      }
      // decision === "propose"
      if (w.no_proposal_reason !== null) {
        c.addIssue({
          code: "custom",
          path: ["no_proposal_reason"],
          message: 'no_proposal_reason must be null when decision is "propose"',
        });
      }
      const requiredNonNull: Array<[keyof typeof w, unknown]> = [
        ["intervention_id", w.intervention_id],
        ["target_step_id", w.target_step_id],
        ["metric_category", w.metric_category],
        ["metric_direction", w.metric_direction],
        ["review_after_days", w.review_after_days],
      ];
      for (const [key, value] of requiredNonNull) {
        if (value === null) {
          c.addIssue({ code: "custom", path: [key], message: `${key} is required when decision is "propose"` });
        }
      }
      const requiredNonEmpty: Array<[keyof typeof w, string]> = [
        ["change_title", w.change_title],
        ["change_text", w.change_text],
        ["rationale", w.rationale],
        ["metric_description", w.metric_description],
        ["failure_condition", w.failure_condition],
      ];
      for (const [key, value] of requiredNonEmpty) {
        if (!nonEmptyAfterTrim(value)) {
          c.addIssue({ code: "custom", path: [key], message: `${key} must be non-empty when decision is "propose"` });
        }
      }
      if (w.rubric_criterion_ids.length === 0) {
        c.addIssue({ code: "custom", path: ["rubric_criterion_ids"], message: "at least one rubric criterion is required" });
      }
      if (w.evidence.length === 0) {
        c.addIssue({ code: "custom", path: ["evidence"], message: "at least one evidence alias is required" });
      }
    });
}
export type ProposalWire = z.infer<ReturnType<typeof buildProposalWireSchema>>;

/** `z.toJSONSchema(schema)` -> `cleanJsonSchemaNode` -> `assertNoForbiddenKeywords` (reused from label/wire-schema). */
export function generateProposalJsonSchema(ctx: WireContext): object {
  const schema = buildProposalWireSchema(ctx);
  const raw = z.toJSONSchema(schema);
  const cleaned = cleanJsonSchemaNode(raw);
  assertNoForbiddenKeywords(cleaned);
  return cleaned as object;
}
