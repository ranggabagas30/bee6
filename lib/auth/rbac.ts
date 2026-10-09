import { ForbiddenError } from "@/lib/http/errors";
import type { CustomClaims, PrincipalRole } from "@/lib/auth/roles";

/**
 * Role-based access control (web spec §2). This is the single server-side
 * authority for "can this principal do this?" — the UI may hide things, but the
 * server rejects them here (hard rule #6/§2: enforced by the backend, not just
 * the UI).
 *
 * Two independent checks, both required for a request to proceed:
 *   1. `assertPermission` — the principal's role grants the action.
 *   2. `assertOutlet` — the target document belongs to the principal's outlet.
 * `authorize` runs both.
 */

/** Every action the API gates, named `resource:action`. */
export type Permission =
  | "segments:upload"
  | "heartbeat:write"
  | "day:read:summary"
  | "day:read:evidence"
  | "debrief:answer"
  | "labels:confirm"
  | "proposals:review"
  | "proposals:approve"
  | "proposals:generate"
  | "reviews:verdict"
  | "sop:read"
  | "sop:diff"
  | "questions:read"
  | "home:read";

/**
 * The permission table from web spec §2, as a set per principal role.
 * `staff` and `supervisor` both answer debrief questions (staff their own,
 * supervisor any — that own-vs-any narrowing is enforced at the data layer in
 * R-07; here they simply both hold `debrief:answer`).
 */
const ROLE_PERMISSIONS: Record<PrincipalRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    "day:read:summary",
    "proposals:approve",
    "reviews:verdict",
    "sop:read",
    "sop:diff",
    "home:read", // owner home, web spec §4.4
  ]),
  supervisor: new Set<Permission>([
    "day:read:summary",
    "day:read:evidence",
    "debrief:answer",
    "labels:confirm",
    "proposals:review",
    "proposals:generate",
    "reviews:verdict",
    "sop:read",
    "sop:diff",
    "questions:read",
  ]),
  staff: new Set<Permission>([
    "debrief:answer",
    "questions:read",
    "sop:read", // staff read the current SOP steps for their role
  ]),
  device: new Set<Permission>(["segments:upload", "heartbeat:write"]),
};

/** Pure predicate: does this role hold this permission? */
export function can(role: PrincipalRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Throws ForbiddenError if the caller's role does not grant `permission`. */
export function assertPermission(
  claims: Pick<CustomClaims, "role">,
  permission: Permission,
): void {
  if (!can(claims.role, permission)) {
    throw new ForbiddenError(
      `Role "${claims.role}" may not perform "${permission}".`,
    );
  }
}

/**
 * Throws ForbiddenError if `targetOutletId` is not the caller's outlet. Every
 * read and write must pass its target outlet through here — a wrong `outlet_id`
 * is rejected by the server, never silently served.
 */
export function assertOutlet(
  claims: Pick<CustomClaims, "outlet_id">,
  targetOutletId: string,
): void {
  if (claims.outlet_id !== targetOutletId) {
    throw new ForbiddenError("Cross-outlet access is not allowed.");
  }
}

/** Runs both checks. Returns the claims for convenient chaining. */
export function authorize(
  claims: CustomClaims,
  params: { permission: Permission; outletId: string },
): CustomClaims {
  assertPermission(claims, params.permission);
  assertOutlet(claims, params.outletId);
  return claims;
}

/** Test/introspection helper: the full permission set for a role. */
export function permissionsFor(role: PrincipalRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}
