import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import { maskDigitRuns, normalizeConstraintText } from "@/lib/constraints/normalize";
import type { ConstraintView } from "@/lib/constraints/contract";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/http/errors";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import { ConstraintSchema, type AuditLog, type Constraint, type Outlet } from "@/lib/firestore/schema";
import { CONSTRAINT_INPUT_MAX, CONSTRAINT_INPUT_MIN } from "@/lib/constraints/contract";
import { MAX_CONSTRAINTS } from "@/lib/proposals/constants";

/**
 * Manual constraints (R-08 Task 8.3; web spec §6.6). The owner and a
 * supervisor both add constraints (Q-11 b). SOP changes only ever go through
 * proposals (hard rule #9); a constraint only *limits* what a future
 * proposal may suggest — it never edits the SOP itself. Constraint text is
 * free text a user typed that will later sit inside a model prompt
 * (R-08 Task 4.3's constraint lines): it is digit-masked, staff-name
 * scrubbed and SDP-redacted here, exactly like any other text write (hard
 * rule #3), before it is ever stored.
 */

export interface ConstraintStore {
  getOutlet(): Promise<Outlet | null>;
  /** All constraints of the outlet, oldest first (created_at_ms, then constraint_id), at most MAX_CONSTRAINTS + 1.
   *  Malformed / foreign-outlet docs skipped and logged { doc_id, error_class }. */
  list(): Promise<Constraint[]>;
  listStaffScrubNames(): Promise<string[]>;
  /** One Firestore transaction: reads the outlet's constraints (same query as list()), calls decide(existing) once,
   *  and if it returns { kind: "create" } writes the constraint doc (create; fails if the id exists) + the audit
   *  entry. Returns decide's result. */
  createInTransaction(
    decide: (
      existing: Constraint[],
    ) =>
      | { kind: "create"; constraint: Constraint; audit: AuditLog }
      | { kind: "duplicate"; existing: Constraint }
      | { kind: "limit" },
  ): Promise<
    | { kind: "create"; constraint: Constraint }
    | { kind: "duplicate"; existing: Constraint }
    | { kind: "limit" }
  >;
}

export interface ConstraintDeps {
  redact: (texts: readonly string[]) => Promise<string[]>; // redactBatch()
  newId: () => string;
}

export type CreateConstraintInput =
  | { claims: CustomClaims; text: string; now_ms: number; source: "manual" }
  | {
      claims: CustomClaims;
      text: string;
      now_ms: number;
      source: "supervisor_rejection" | "owner_rejection";
      source_proposal_id: string;
    };

/** Explicit-key mapping to the read-only view; never a spread (the stored
 * `Constraint` carries `source_proposal_id` and `created_by_role`, neither
 * of which the view may leak). */
function view(c: Constraint): ConstraintView {
  return {
    constraint_id: c.constraint_id,
    text: c.text,
    source: c.source,
    created_at_ms: c.created_at_ms,
  };
}

export async function createConstraint(
  store: ConstraintStore,
  deps: ConstraintDeps,
  input: CreateConstraintInput,
): Promise<{ constraint: ConstraintView; duplicate: boolean }> {
  // 1. Permission, then narrow the role for typing — unreachable after
  // assertPermission (only owner/supervisor hold constraints:write), but
  // never a silent default to "supervisor".
  assertPermission(input.claims, "constraints:write");
  const actorRole = input.claims.role;
  if (actorRole !== "owner" && actorRole !== "supervisor") {
    throw new ForbiddenError(`Role "${actorRole}" may not perform "constraints:write".`);
  }

  // 2. Outlet.
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(input.claims, outlet.outlet_id);

  // 3. Length (defence in depth; the route already parsed it). Never echo
  // the text in an error.
  const text = input.text.trim();
  if (text.length < CONSTRAINT_INPUT_MIN || text.length > CONSTRAINT_INPUT_MAX) {
    throw new ValidationError("invalid_body", [{ field: "text", message: "length" }]);
  }

  // 4. Mask -> scrub -> redact, in that order, same pipeline as every other
  // model-facing text write (hard rule #3).
  const masked = maskDigitRuns(text);
  const names = await store.listStaffScrubNames();
  const scrubbed = scrubStaffNames(masked, names);
  let redacted: string;
  try {
    const [out] = await deps.redact([scrubbed]);
    redacted = out ?? "";
  } catch {
    throw new ServiceUnavailableError("Redaction unavailable", "redact");
  }

  // 5. Length after redaction (nothing written on failure).
  if (redacted.trim().length === 0 || redacted.length > 500) {
    throw new ValidationError("invalid_body", [{ field: "text", message: "too_long_after_redaction" }]);
  }

  // 6. One transaction: dedupe, limit, create.
  const result = await store.createInTransaction((existing) => {
    if (existing.length >= MAX_CONSTRAINTS) return { kind: "limit" };

    const normalizedNew = normalizeConstraintText(redacted);
    const duplicate = existing.find((c) => normalizeConstraintText(c.text) === normalizedNew);
    if (duplicate) return { kind: "duplicate", existing: duplicate };

    const constraintId = deps.newId();
    const constraint = ConstraintSchema.parse({
      outlet_id: outlet.outlet_id,
      constraint_id: constraintId,
      text: redacted,
      source: input.source,
      source_proposal_id: input.source === "manual" ? null : input.source_proposal_id,
      created_by_role: actorRole,
      created_at_ms: input.now_ms,
    });
    // The audit entry carries no text (it may still contain words a reader
    // should not see in an audit list; the constraint doc is the one place
    // the redacted text lives).
    const audit: AuditLog = {
      outlet_id: outlet.outlet_id,
      ts: new Date(input.now_ms).toISOString(),
      actor_role: actorRole,
      action: "constraint.created",
      target_type: "constraint",
      target_id: constraintId,
      details: { source: input.source },
    };
    return { kind: "create", constraint, audit };
  });

  if (result.kind === "limit") {
    // listConstraints reads at most MAX_CONSTRAINTS, so a 201st constraint
    // would be silently ignored by the prompt.
    throw new ConflictError("Constraint limit reached", "CONSTRAINT_LIMIT");
  }

  const outcomeConstraint = result.kind === "duplicate" ? result.existing : result.constraint;
  const duplicate = result.kind === "duplicate";

  // 7. Log once. Never the text, never the names.
  console.info("[constraint] created", {
    outlet_id: outlet.outlet_id,
    constraint_id: outcomeConstraint.constraint_id,
    source: input.source,
    duplicate,
  });

  return { constraint: view(outcomeConstraint), duplicate };
}

export async function listConstraintViews(
  store: ConstraintStore,
  claims: CustomClaims,
): Promise<ConstraintView[]> {
  assertPermission(claims, "constraints:read");
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(claims, outlet.outlet_id);

  const list = await store.list();
  return list.slice(0, MAX_CONSTRAINTS).map(view);
}
