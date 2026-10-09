import type { CSSProperties } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { CATEGORY_KEY, STATUS_KEY } from "@/lib/day/view-model";
import type { OwnerThread, SupervisorThread } from "@/lib/day/contract";

/**
 * One thread row (R-06 Task 7.5). The owner/supervisor split is a TypeScript
 * narrow on `view`, not a client-side role check — the security boundary is
 * the response shape `getDayRecord` already enforces server-side (CLAUDE.md
 * hard rule #7): a `SupervisorThread` is never constructed for an owner
 * caller in the first place.
 *
 * `onReload` and `auth` on the supervisor variant are not used by this task
 * (Task 10's `ThreadActions`, rendered here only once `can_review` exists,
 * is the first consumer) — kept on the type now so PR-5 slots in without a
 * signature change.
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

export type ThreadCardProps =
  | { view: "owner"; thread: OwnerThread }
  | { view: "supervisor"; thread: SupervisorThread; onReload: () => void; auth: Auth };

export function ThreadCard(props: ThreadCardProps) {
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
        </>
      )}
    </article>
  );
}
