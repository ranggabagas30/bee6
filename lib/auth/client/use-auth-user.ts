"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type Auth, type User } from "firebase/auth";

/**
 * R-06 Task 4.4. Subscribes to Firebase Auth's state in an effect (not
 * `authStateReady()`, so a screen can show a loading state rather than
 * blocking on the initial check). A `null` auth (misconfigured server) reads
 * as `signed_out` without subscribing.
 */
export type AuthUserState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; user: User };

export function useAuthUser(auth: Auth | null): AuthUserState {
  const [state, setState] = useState<AuthUserState>({ status: "loading" });

  useEffect(() => {
    // Nothing to subscribe to; the null-auth case is handled below without
    // ever touching state from inside the effect.
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setState(user ? { status: "signed_in", user } : { status: "signed_out" });
    });
    return unsubscribe;
  }, [auth]);

  if (!auth) return { status: "signed_out" };
  return state;
}
