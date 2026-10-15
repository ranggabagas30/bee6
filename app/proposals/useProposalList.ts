"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import type { DictKey } from "@/lib/i18n/dict";
import { ListProposalsResponseSchema, type ListProposalsResponse } from "@/lib/proposals/review-contract";

/**
 * The one read of GET /api/v1/proposals (hard rule #6), shared by the owner's `ProposalList` and the supervisor's
 * `SupervisorProposals` (R-19 PR-12a). Reloads whenever `reloadKey` changes; the previous data stays on screen
 * while the new read runs, so a card the user is reading never flashes away, and a stale response never
 * overwrites a newer one. A 401 that survives the client's own retry signs out and goes to /sign-in.
 */
export type ProposalListState =
  | { kind: "loading" }
  | { kind: "ready"; data: ListProposalsResponse }
  | { kind: "error"; messageKey: DictKey };

export function useProposalList(auth: Auth, reloadKey: number): ProposalListState {
  const router = useRouter();
  const [state, setState] = useState<ProposalListState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void authedGetJson(auth, "/api/v1/proposals", ListProposalsResponseSchema).then(async (result) => {
      if (!active) return;
      if (result.kind === "ok") {
        setState({ kind: "ready", data: result.data });
      } else if (result.kind === "signed_out") {
        await signOut(auth);
        router.replace("/sign-in");
      } else if (result.kind === "conflict" && result.code === "LIBRARY_NOT_READY") {
        setState({ kind: "error", messageKey: "C-prop-err-library" });
      } else {
        setState({ kind: "error", messageKey: "C-srv-generic" });
      }
    });
    return () => {
      active = false;
    };
    // Runs on mount and whenever `reloadKey` changes; `auth` and `router` are
    // stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return state;
}
