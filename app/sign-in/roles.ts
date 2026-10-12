/** The three roles of the official sign-in (R-18 P1). A plain module: the server pages and the client component both use it. */
export const SIGN_IN_ROLES = ["staff", "supervisor", "owner"] as const;
export type SignInRole = (typeof SIGN_IN_ROLES)[number];

/** `?as=` from the URL: one of the three roles exactly, anything else (unknown, repeated, wrong case) is ignored. */
export function parseSignInRole(value: unknown): SignInRole | null {
  return typeof value === "string" && (SIGN_IN_ROLES as readonly string[]).includes(value) ? (value as SignInRole) : null;
}
