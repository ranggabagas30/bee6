"use client";

import type { CSSProperties } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { ProposalCard } from "@/app/proposals/ProposalCard";
import { ProposalDecisionPanel } from "@/app/proposals/ProposalDecisionPanel";
import { EmptyState } from "@/app/web/EmptyState";
import { useProposalList } from "@/app/proposals/useProposalList";

/**
 * The open and recently decided proposals (R-09 Task 8.1): one list, one card, role-aware buttons under each open
 * card. Since R-19 PR-12a this is the owner's list (the supervisor's screen is `SupervisorProposals`, which owns
 * the watch panel and the detail); PR-12b replaces it with the W8 review-in-order screen. The read is
 * `useProposalList` (GET /api/v1/proposals only, hard rule #6); the server decides what each role may see and
 * do, the panel only mirrors it.
 *
 * Empty states (R-19 PR-6 §8.3): the owner's "Nothing waiting for you" when nothing is open or decided. The
 * supervisor's "No proposal yet" lives in `SupervisorProposals`, where it also needs the watch panel to be empty.
 */

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
  const state = useProposalList(auth, reloadKey);

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
        {open.length === 0 && decided.length === 0 && role === "owner" ? (
          <EmptyState title={t(lang, "C-web-empty-appr-h")} detail={t(lang, "C-web-empty-appr-p")} />
        ) : open.length === 0 ? (
          <p>{t(lang, "C-prop-list-empty")}</p>
        ) : (
          open.map((item) => (
            <ProposalCard
              key={item.proposal.proposal_id}
              proposal={item.proposal}
              lang={lang}
              review={item.review}
              notices={item.notices}
              titleLevel={3}
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
            <ProposalCard
              key={item.proposal.proposal_id}
              proposal={item.proposal}
              lang={lang}
              review={item.review}
              titleLevel={3}
            />
          ))}
        </section>
      )}
    </>
  );
}
