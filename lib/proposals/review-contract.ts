import { z } from "zod";
import { dateString } from "@/lib/day/contract";
import { CONSTRAINT_INPUT_MAX, CONSTRAINT_INPUT_MIN } from "@/lib/constraints/contract";
import { MAX_CONSTRAINTS } from "@/lib/proposals/constants";
import { OWNER_DECISIONS, PROPOSAL_STATUSES, SUPERVISOR_DECISIONS } from "@/lib/firestore/schema";
import { ProposalViewSchema } from "@/lib/proposals/contract";

/** Reject reasons share the constraint bounds: a rejection reason becomes a constraint (createConstraint enforces 3..300). */
const ReasonSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(CONSTRAINT_INPUT_MIN).max(CONSTRAINT_INPUT_MAX));
const AckSchema = z.array(z.string().uuid()).max(MAX_CONSTRAINTS).default([]);

export const ReviewBodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("feasible"), acknowledged_constraint_ids: AckSchema }).strict(),
  z.object({ decision: z.literal("reject"), reason: ReasonSchema }).strict(),
]);
export type ReviewBody = z.infer<typeof ReviewBodySchema>;

export const ApproveBodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), acknowledged_constraint_ids: AckSchema }).strict(),
  z.object({ decision: z.literal("reject"), reason: ReasonSchema }).strict(),
]);
export type ApproveBody = z.infer<typeof ApproveBodySchema>;

export const ProposalIdSchema = z.string().uuid();

export const DECISION_CONFLICT_CODES = [
  "NOT_REVIEWABLE",
  "ALREADY_DECIDED",
  "NOT_YET_REVIEWABLE",
  "SUPERSEDED",
  "EVIDENCE_STALE",
  "SOP_CHANGED",
  "CONSTRAINT_ADDED",
  "SOP_STEP_LIMIT", // R-10: a new step cannot be added to a full SOP
  "LEGACY_PROPOSAL", // R-10: made by proposal-v1, whose change_text may be a description, not the full step text
  "STEP_TEXT_TOO_LONG", // R-10: the step's current text is longer than the model can rewrite
] as const; // plus CONSTRAINT_LIMIT, which createConstraint throws on a reject
export type DecisionConflictCode = (typeof DECISION_CONFLICT_CODES)[number];

export const DecisionResponseSchema = z
  .object({
    result: z.enum(["feasible", "rejected", "approved", "unchanged"]),
    status: z.enum(PROPOSAL_STATUSES),
  })
  .strict();
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

const decidedView = {
  reason: z.string().nullable(), // redacted; render as plain text
  decided_date: dateString, // outlet-local calendar date of decided_at_ms
};
export const ReviewViewSchema = z
  .object({
    supervisor: z.object({ decision: z.enum(SUPERVISOR_DECISIONS), ...decidedView }).strict().nullable(),
    owner: z.object({ decision: z.enum(OWNER_DECISIONS), ...decidedView }).strict().nullable(),
  })
  .strict();
export type ReviewView = z.infer<typeof ReviewViewSchema>;

export const NoticesSchema = z
  .object({
    late_constraints: z.array(z.object({ constraint_id: z.string().uuid(), text: z.string() }).strict()),
    evidence_stale: z.boolean(),
    sop_changed: z.boolean(),
    superseded: z.boolean(),
  })
  .strict(); // all empty/false for decided proposals
export type Notices = z.infer<typeof NoticesSchema>;

export const ProposalListItemSchema = z
  .object({ proposal: ProposalViewSchema, review: ReviewViewSchema, notices: NoticesSchema })
  .strict();
export type ProposalListItem = z.infer<typeof ProposalListItemSchema>;

export const LIST_OPEN_MAX = 20;
export const LIST_DECIDED_MAX = 10;
export const ListProposalsResponseSchema = z
  .object({
    open: z.array(ProposalListItemSchema).max(LIST_OPEN_MAX),
    decided: z.array(ProposalListItemSchema).max(LIST_DECIDED_MAX),
  })
  .strict();
export type ListProposalsResponse = z.infer<typeof ListProposalsResponseSchema>;
