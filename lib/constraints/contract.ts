import { z } from "zod";
import { CONSTRAINT_SOURCES } from "@/lib/firestore/schema";

/**
 * The manual-constraints routes' request/response contract (R-08 Task 8.2;
 * web spec §6.6). The view never carries `source_proposal_id` or
 * `created_by_role` (hard rule #7: an actor is recorded only where a role
 * must be — the audit log — never echoed back in a read-only view).
 */

/** Raw chars typed; the stored cap (500) is higher because redaction tokens
 * such as "[STAFF]" / "[NUMBER]" can grow the text. */
export const CONSTRAINT_INPUT_MAX = 300;
export const CONSTRAINT_INPUT_MIN = 3;

export const CreateConstraintBodySchema = z
  .object({
    text: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(CONSTRAINT_INPUT_MIN).max(CONSTRAINT_INPUT_MAX)),
  })
  .strict();
export type CreateConstraintBody = z.infer<typeof CreateConstraintBodySchema>;

export const ConstraintViewSchema = z
  .object({
    constraint_id: z.string().uuid(), // a random uuid; reveals no device or person
    text: z.string(),
    source: z.enum(CONSTRAINT_SOURCES),
    created_at_ms: z.number().int(),
  })
  .strict(); // NO source_proposal_id, NO created_by_role in the view
export type ConstraintView = z.infer<typeof ConstraintViewSchema>;

export const ListConstraintsResponseSchema = z
  .object({ constraints: z.array(ConstraintViewSchema) })
  .strict();
export type ListConstraintsResponse = z.infer<typeof ListConstraintsResponseSchema>;

export const CreateConstraintResponseSchema = z
  .object({ constraint: ConstraintViewSchema, duplicate: z.boolean() })
  .strict();
export type CreateConstraintResponse = z.infer<typeof CreateConstraintResponseSchema>;
