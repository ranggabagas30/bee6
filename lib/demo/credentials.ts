import type { DemoRole } from "@/lib/demo/contract";

/**
 * The published demo credentials (R-18 P1, Rangga 11 Oct). They are PUBLIC: the demo deployment prints them on its sign-in page.
 * They open nothing by themselves. On a demo deployment the browser matches them and then asks the existing
 * `POST /api/v1/demo/session` for a fresh private sandbox; DEMO_MODE, the per-IP and daily caps and the 2 h expiry are the
 * security boundary (the server contract is unchanged). No Firebase account with these emails exists, and
 * `scripts/provision-web-user.ts` refuses to create one.
 *
 * Imported only by demo-only client code (`app/demo/**`, loaded lazily) and by scripts and tests. The pilot's pages must never
 * import this module: the production build is checked for these strings.
 */

/** Also a member of `RESERVED_PAIRING_CODES` (lib/auth/pairing.ts), so a real shop can never be paired with it. */
export const DEMO_STAFF_CODE = "000000";
export const DEMO_PASSWORD = "bee6-demo";
/** `example.com` is reserved (RFC 2606): no mailbox exists and nobody can register it. */
export const DEMO_EMAILS = {
  supervisor: "supervisor.judge@example.com",
  owner: "owner.judge@example.com",
} as const;

const RESERVED_SUFFIX = ".judge@example.com";

export type DemoCredentialInput =
  | { kind: "code"; code: string }
  | { kind: "email"; email: string; password: string };

/**
 * The role a typed credential opens, or null when it is not a demo credential (the visitor then takes the real path).
 * The credential decides the role, not the panel it was typed into. A demo email with a wrong password is also null, so a
 * wrong password gets the normal "wrong email or password" answer and there is no oracle.
 */
export function matchDemoCredential(input: DemoCredentialInput): DemoRole | null {
  if (input.kind === "code") return input.code.trim() === DEMO_STAFF_CODE ? "staff" : null;
  if (input.password !== DEMO_PASSWORD) return null;
  const email = input.email.trim().toLowerCase();
  if (email === DEMO_EMAILS.supervisor) return "supervisor";
  if (email === DEMO_EMAILS.owner) return "owner";
  return null;
}

/** True for the two demo emails and any other `*.judge@example.com`; the provisioning script refuses these. */
export function isReservedDemoEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e === DEMO_EMAILS.supervisor || e === DEMO_EMAILS.owner || e.endsWith(RESERVED_SUFFIX);
}
