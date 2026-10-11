import type { User } from "@/lib/auth/client/firebase-client";

/**
 * Owner start page (R-06 Task 14a, Rangga v4 Q-G): `/home`; every other role lands on `/day`. Reads the fresh ID
 * token's own `role` claim — navigation only, since every route still enforces role + outlet on the server — and falls
 * back to `/day` if the token result cannot be read. The claim decides, never the panel the visitor picked (R-18 P1).
 */
export async function redirectTarget(user: User): Promise<"/home" | "/day"> {
  try {
    const r = await user.getIdTokenResult();
    return r.claims.role === "owner" ? "/home" : "/day";
  } catch {
    return "/day";
  }
}
