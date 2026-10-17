import type { CSSProperties } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { CATEGORY_KEY, RUNNER_UP_KEY, STATUS_KEY } from "@/lib/day/view-model";
import type { OwnerThread, SupervisorThread } from "@/lib/day/contract";
import { ThreadActions } from "@/app/day/ThreadActions";

/**
 * R-25 T9: the pre-restyle thread card, kept verbatim for the legacy `/questions` queue (`QueueView`), which has no
 * page-2 board. The day record uses the restyled `ThreadCard`. Only change from the original: the Change button keeps
 * its "Change category" label (`changeLabelKey`).
 *
 * One thread row (R-06 Task 7.5). The owner/supervisor split is a TypeScript
 * narrow on `view`, not a client-side role check — the security boundary is
 * the response shape `getDayRecord` already enforces server-side (CLAUDE.md
 * hard rule #7): a `SupervisorThread` is never constructed for an owner
 * caller in the first place.
 *
 * `onReload`/`auth` feed `ThreadActions` (R-06 Task 10), rendered below only
 * when the server says the row is reviewable (`can_review && handle !==
 * null`) — this component never re-derives eligibility itself.
 */

const CARD_STYLE: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  overflowWrap: "anywhere",
};

const LINE_STYLE: CSSProperties = { margin: "0 0 4px 0" };

const BADGE_STYLE: CSSProperties = {
  display: "inline-block",
  border: "1px solid #374151",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 14,
};

const EVIDENCE_HEADING_STYLE: CSSProperties = { fontWeight: 600, margin: "8px 0 4px 0" };

const QUOTE_STYLE: CSSProperties = { margin: "0 0 4px 0", overflowWrap: "anywhere" };

const RUNNER_UP_SUMMARY_STYLE: CSSProperties = { minHeight: 48, cursor: "pointer", display: "flex", alignItems: "center" };

const RUNNER_UP_BODY_STYLE: CSSProperties = { overflowWrap: "anywhere", margin: "4px 0 0 0" };

export type LegacyThreadCardProps =
  | { view: "owner"; thread: OwnerThread }
  | { view: "supervisor"; thread: SupervisorThread; onReload: () => void; auth: Auth };

export function LegacyThreadCard(props: LegacyThreadCardProps) {
  const { lang } = useLang();
  const { view, thread } = props;

  return (
    <article style={CARD_STYLE}>
      <p style={LINE_STYLE}>
        {t(lang, "C-day-time", { start: thread.start_hm, end: thread.end_hm })}
        {" · "}
        {t(lang, CATEGORY_KEY[thread.category])}
      </p>
      <p style={LINE_STYLE}>
        <span style={BADGE_STYLE}>{t(lang, STATUS_KEY[thread.display_status])}</span>
        {" "}
        {t(lang, "C-day-confidence", { pct: thread.confidence_pct })}
      </p>
      <p style={{ overflowWrap: "anywhere", margin: 0 }}>
        {thread.summary.trim() === "" ? t(lang, "C-day-no-summary") : thread.summary}
      </p>

      {view === "supervisor" && (
        <>
          {thread.evidence.length > 0 && (
            <>
              <p style={EVIDENCE_HEADING_STYLE}>{t(lang, "C-day-evidence")}</p>
              {thread.evidence.map((line, index) => (
                <blockquote key={index} style={QUOTE_STYLE}>
                  {line.hm} «{line.text}»
                </blockquote>
              ))}
              {thread.evidence_more > 0 && (
                <p style={LINE_STYLE}>{t(lang, "C-day-evidence-more", { N: thread.evidence_more })}</p>
              )}
            </>
          )}
          {thread.staff_answer && (
            <p style={{ overflowWrap: "anywhere", margin: "8px 0 0 0" }}>
              {t(lang, thread.staff_answer.answer === "yes" ? "C-day-ans-yes" : "C-day-ans-no")}
              {thread.staff_answer.reason !== null && (
                <>
                  {" "}
                  <q>{thread.staff_answer.reason}</q>
                </>
              )}
            </p>
          )}
          {thread.runner_up !== null && (
            <details>
              <summary style={RUNNER_UP_SUMMARY_STYLE}>
                {t(lang, "C-day-runnerup", { label: t(lang, RUNNER_UP_KEY[thread.runner_up.category]) })}
              </summary>
              <p style={RUNNER_UP_BODY_STYLE}>
                {thread.runner_up.why_not === null ? t(lang, "C-day-runnerup-none") : thread.runner_up.why_not}
              </p>
            </details>
          )}
          {thread.can_review && thread.handle !== null && (
            <ThreadActions thread={thread} auth={props.auth} onDone={props.onReload} changeLabelKey="C-act-change" />
          )}
        </>
      )}
    </article>
  );
}
