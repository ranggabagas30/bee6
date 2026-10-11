"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { ListProposalsResponseSchema, type ListProposalsResponse } from "@/lib/proposals/review-contract";
import { ProposalCard } from "@/app/proposals/ProposalCard";
import { ProposalDecisionPanel } from "@/app/proposals/ProposalDecisionPanel";

/**
 * The open and recently decided proposals (R-09 Task 8.1), for owner AND
 * supervisor: one list, one card, role-aware buttons under each open card.
 * Reads only `GET /api/v1/proposals` (hard rule #6); the server decides what
 * each role may see and do, the panel only mirrors it.
 *
 * Reloads whenever `reloadKey` changes (a generate or a decision happened).
 * The previous list stays on screen while the new one loads, so a card the
 * user is reading never flashes away, and a stale response never overwrites
 * a newer one.
 */

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: ListProposalsResponse }
  | { kind: "error"; messageKey: DictKey };

const SECTION_STYLE: CSSProperties = { marginTop: 24, overflowWrap: "anywhere" };
const STATUS_STYLE: CSSProperties = { margin: "8px 0", overflowWrap: "anywhere" };

export function ProposalList({
  auth,
  role,
  lang,
  reloadKey,
  onSettled,
}: {
  auth: Auth;
  role: "owner" | "supervisor";
  lang: Lang;
  reloadKey: number;
  onSettled: (outcome: { messageKey: DictKey; range?: { from_date: string; to_date: string } }) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

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

  if (state.kind === "loading") {
    return (
      <section style={SECTION_STYLE}>
        <p role="status" aria-live="polite" style={STATUS_STYLE}>
          {t(lang, "C-day-loading")}
        </p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section style={SECTION_STYLE}>
        <p role="status" aria-live="polite" style={STATUS_STYLE}>
          {t(lang, state.messageKey)}
        </p>
      </section>
    );
  }

  const { open, decided } = state.data;

  return (
    <>
      <section style={SECTION_STYLE} aria-labelledby="prop-list-open">
        <h2 id="prop-list-open">{t(lang, "C-prop-list-open")}</h2>
        {open.length === 0 ? (
          <p>{t(lang, "C-prop-list-empty")}</p>
        ) : (
          open.map((item) => (
            <ProposalCard
              key={item.proposal.proposal_id}
              proposal={item.proposal}
              lang={lang}
              review={item.review}
              notices={item.notices}
            >
              <ProposalDecisionPanel auth={auth} role={role} item={item} lang={lang} onSettled={onSettled} />
            </ProposalCard>
          ))
        )}
      </section>

      {decided.length > 0 && (
        <section style={SECTION_STYLE} aria-labelledby="prop-list-decided">
          <h2 id="prop-list-decided">{t(lang, "C-prop-list-decided")}</h2>
          {decided.map((item) => (
            <ProposalCard key={item.proposal.proposal_id} proposal={item.proposal} lang={lang} review={item.review} />
          ))}
        </section>
      )}
    </>
  );
}
