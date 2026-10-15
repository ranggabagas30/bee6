"use client";

import { useEffect, useState } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";

export type NavRole = "owner" | "supervisor" | "other";

export interface RoleClaim {
  /** null while unknown (loading, signed out, or the token not read yet); "other" when the claim is not a web role. */
  role: NavRole | null;
  /** True when the token carries `demo_exp_ms`: a demo sandbox principal (R-12). Absent for every real principal. */
  demo: boolean;
}

const UNKNOWN: RoleClaim = { role: null, demo: false };

/**
 * The signed-in user's `role` claim and whether it is a demo sandbox principal, read from the fresh ID token (the
 * R-06/R-08 pattern of `ProposalsApp`). Navigation and labels only, never the security boundary: every route still
 * checks role + outlet on the server. A claim that cannot be read fails closed (`"other"`: no nav is drawn).
 *
 * The read result is remembered with the uid it belongs to, so a sign-out or a user change reads as unknown at once
 * (no state write inside the effect for that case) and a late answer for an old user is ignored.
 */
export function useRoleClaim(auth: Auth | null): RoleClaim {
  const authUser = useAuthUser(auth);
  const [read, setRead] = useState<{ uid: string } & RoleClaim | null>(null);
  const uid = authUser.status === "signed_in" ? authUser.user.uid : null;

  useEffect(() => {
    if (authUser.status !== "signed_in" || uid === null) return;
    let active = true;
    const user = authUser.user;
    const settle = (claim: RoleClaim) => {
      if (active) setRead({ uid, ...claim });
    };
    const token = typeof user.getIdTokenResult === "function" ? user.getIdTokenResult() : Promise.reject(new Error("no token"));
    void token.then(
      (result) => {
        const claimed = result.claims.role;
        settle({
          role: claimed === "owner" || claimed === "supervisor" ? claimed : "other",
          demo: typeof result.claims.demo_exp_ms === "number",
        });
      },
      () => settle({ role: "other", demo: false }),
    );
    return () => {
      active = false;
    };
  }, [authUser, uid]);

  return read && read.uid === uid ? { role: read.role, demo: read.demo } : UNKNOWN;
}
