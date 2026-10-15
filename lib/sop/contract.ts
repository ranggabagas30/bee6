import { z } from "zod";
import { dateString } from "@/lib/day/contract";
import { UserRoleSchema } from "@/lib/auth/roles";
import { OUTCOME_VERDICTS, SOP_CHANGE_KINDS, SopChangeMetricSchema } from "@/lib/firestore/schema";

/**
 * Wire contract for GET /api/v1/sop (R-10 Task 4.1). Views carry no
 * sop_version_id, source_proposal_id, outlet_id or intervention_id: the screen
 * does not need them and none may leak. Step text is plain text.
 */

export const SopStepViewSchema = z
  .object({ step_id: z.string(), title: z.string(), text: z.string(), role: UserRoleSchema })
  .strict();
export type SopStepView = z.infer<typeof SopStepViewSchema>;

export const SopChangeViewSchema = z
  .object({
    version: z.number().int().min(2),
    previous_version: z.number().int().min(1),
    effective_from_date: dateString,
    approved_date: dateString, // outlet-local date of change.approved_at_ms
    kind: z.enum(SOP_CHANGE_KINDS),
    before: SopStepViewSchema.nullable(),
    after: SopStepViewSchema,
    change_title: z.string(),
    metric: SopChangeMetricSchema,
    failure_condition: z.string(),
    review_date: dateString,
    // R-11 Task 7: the remembered review result, if any. Verdict and the simulated flag only; never text or ids.
    outcome: z.object({ verdict: z.enum(OUTCOME_VERDICTS), simulated: z.boolean() }).strict().nullable(),
  })
  .strict();
export type SopChangeView = z.infer<typeof SopChangeViewSchema>;

export const SOP_CHANGES_MAX = 50;
export const SopOverviewSchema = z
  .object({
    today: dateString, // outlet-local
    latest: z
      .object({
        version: z.number().int().min(1),
        effective_from_date: dateString.nullable(), // null = seed version
        steps: z.array(SopStepViewSchema).min(1).max(200),
      })
      .strict()
      .nullable(), // null = no SOP set up yet
    in_force_version: z.number().int().min(1).nullable(),
    // R-19 PR-9a §9.1: outlet-local date of the version-1 seed doc's created_at_ms (the seed's label on the
    // version switch). null only when the v1 doc is not in the read set. A date, never an id.
    first_version_date: dateString.nullable(),
    changes: z.array(SopChangeViewSchema).max(SOP_CHANGES_MAX), // newest version first
  })
  .strict();
export type SopOverview = z.infer<typeof SopOverviewSchema>;
