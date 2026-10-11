import { z } from "zod";

/**
 * Roles and token claims (web spec §2, §3).
 *
 * - `UserRole` is what a `users`/`staff` document stores: a person is an owner,
 *   a supervisor, or staff.
 * - `PrincipalRole` is what a request's token claims carry: the three user roles
 *   plus `device` (the shop phone, which uploads segments/heartbeats). RBAC
 *   (lib/auth/rbac.ts) is expressed over principals.
 *
 * Claims are set by the backend as Firebase custom claims / custom-token claims.
 * They are never trusted from the browser without server verification.
 *
 * Staff PIN sign-in is dormant in MVP 1 (no staff sign-in is built; `staff_id`
 * claims aren't issued yet).
 */

export const UserRoleSchema = z.enum(["owner", "supervisor", "staff"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Roles for owner/supervisor `users` docs, which sign in with email + password
 * and are created by an admin provisioning script (no self sign-up). The schema
 * name is a historical leftover from an earlier Google-sign-in plan (superseded
 * 9 Oct). Staff PIN sign-in is dormant in MVP 1 (no staff sign-in is built).
 */
export const GoogleUserRoleSchema = z.enum(["owner", "supervisor"]);
export type GoogleUserRole = z.infer<typeof GoogleUserRoleSchema>;

export const PrincipalRoleSchema = z.enum([
  "owner",
  "supervisor",
  "staff",
  "device",
]);
export type PrincipalRole = z.infer<typeof PrincipalRoleSchema>;

/**
 * Token claims: `{ outlet_id, role, staff_id?, device_id? }` (web spec §3).
 * `staff_id` is present only for staff sessions; `device_id` for staff and device
 * principals. No name is ever carried in claims (hard rule #7).
 * Staff PIN sign-in is dormant in MVP 1 (no staff sign-in is built; `staff_id`
 * claims aren't issued yet).
 */
export const CustomClaimsSchema = z
  .object({
    outlet_id: z.string().min(1),
    role: PrincipalRoleSchema,
    staff_id: z.string().min(1).optional(),
    device_id: z.string().min(1).optional(),
  })
  .strict();
export type CustomClaims = z.infer<typeof CustomClaimsSchema>;
