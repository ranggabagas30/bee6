"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { ListProposalsResponse, ProposalListItem } from "@/lib/proposals/review-contract";
import { SopOverviewSchema, type SopOverview } from "@/lib/sop/contract";
import { dayLabel } from "@/lib/i18n/format";
import { buttonClassName, Card, Glass, Kicker, Pill } from "@/app/ui";
import { PageHead } from "@/app/web/PageHead";
import { EmptyState } from "@/app/web/EmptyState";
import { ApprovalCard, datesLine, OWNER_STATUS_KEY, OWNER_STATUS_TONE } from "@/app/proposals/ApprovalCard";
import { ApprovalDecision } from "@/app/proposals/ApprovalDecision";
import { approvalsQueue, firstUndecided, isOwnerDecided, shippedChangeFor } from "@/app/proposals/approvals";
import { useProposalList } from "@/app/proposals/useProposalList";
import styles from "@/app/proposals/approvals.module.css";

/**
 * The owner's Approvals screen = page-1 W8 "Review in order" (R-19 PR-12b, plan 9.5, decision V6; boards D2-08,
 * D2-08c, D2-08d, D2-08e; page-2 look in R-25 T11). One proposal at a time in the recommended order (oldest first,
 * `approvalsQueue`): "‹ Back to home" and the kicker, the progress bars, the proposal on the left (its title is the
 * page's `h1`), and on the right the decision card and the recommended-order list (#1, #2 … with status; tapping one
 * shows it). After a decision the screen shows the answer, reloads and moves to
 * the next undecided proposal; once every proposal is decided it shows the "Both decided." summary with "What
 * happens next" and the Back to home / See the SOP links. Nothing waiting and nothing decided = the PR-6 empty state.
 *
 * The shipped SOP version of an approved proposal comes from GET /api/v1/sop (read only once an approved proposal is
 * in the queue): the decision answer carries no version. `onBridge` is the one hook the judge guide (PR-5) can
 * subscribe to — the same shape as PR-12a's: which screen is shown, and "progress" after a decision. Nothing here
 * publishes anywhere else, and no wiring to PR-5 happens in this file.
 *
 * Every read/write goes through the authed API client (hard rule #6). The owner sees summaries, counts and roles
 * only: never a quoted line, a thread, a device or a name (hard rule #7).
 */

export type ApprovalsScreen = "empty" | "review" | "all_decided";
export type ApprovalsBridgeEvent = { type: "screen"; screen: ApprovalsScreen } | { type: "progress" };

function useSopOverview(auth: Auth, enabled: boolean, reloadKey: number): SopOverview | null {
  const [sop, setSop] = useState<SopOverview | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void authedGetJson(auth, "/api/v1/sop", SopOverviewSchema).then((result) => {
      if (active && result.kind === "ok") setSop(result.data);
    });
    return () => {
      active = false;
    };
    // `auth` is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reloadKey]);
  return sop;
}

/** One bar per proposal (board D2-08): approved and rejected are tinted, the open one is dark, the rest wait. */
function Progress({ lang, queue, currentId }: { lang: Lang; queue: ProposalListItem[]; currentId: string | null }) {
  const done = queue.filter(isOwnerDecided).length;
  const label = t(lang, "C-propa-progress", { done, total: queue.length });
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={done} aria-label={label} className={styles.segments}>
      {queue.map((item) => {
        const state = isOwnerDecided(item)
          ? item.proposal.status === "approved"
            ? styles.segmentApproved
            : styles.segmentRejected
          : item.proposal.proposal_id === currentId
            ? styles.segmentNow
            : "";
        return <span key={item.proposal.proposal_id} aria-hidden="true" className={`${styles.segment} ${state}`} />;
      })}
    </div>
  );
}

function OrderList({
  lang,
  queue,
  currentId,
  sop,
  onPick,
}: {
  lang: Lang;
  queue: ProposalListItem[];
  currentId: string | null;
  sop: SopOverview | null;
  onPick: (id: string) => void;
}) {
  const id = useId();
  return (
    <Glass as="aside" aria-labelledby={id} className={styles.order}>
      <Kicker id={id} className={styles.orderKicker}>
        {t(lang, "C-propa-order")}
      </Kicker>
      <ol aria-labelledby={id} className={styles.orderList}>
        {queue.map((item, index) => {
          const content = item.proposal.content!;
          const current = item.proposal.proposal_id === currentId;
          const decided = isOwnerDecided(item);
          const shipped = shippedChangeFor(item, sop);
          return (
            <li key={item.proposal.proposal_id}>
              {/* Named by its visible content (#n, title, status) so the accessible name matches what is on screen (WCAG 2.5.3). */}
              <button type="button" className={styles.orderBtn} aria-current={current ? "true" : undefined} onClick={() => onPick(item.proposal.proposal_id)}>
                <span className={styles.orderNum}>#{index + 1}</span>{" "}
                <span className={styles.orderText}>
                  <span className={styles.orderTitle}>{content.change_title}</span>{" "}
                  <Pill
                    className={!decided && current ? styles.pillNow : undefined}
                    tone={decided ? OWNER_STATUS_TONE[item.proposal.status] : current ? "teal" : "amber"}
                  >
                    {decided ? t(lang, OWNER_STATUS_KEY[item.proposal.status]) : t(lang, current ? "C-propa-now" : "C-propa-st-waiting")}
                  </Pill>
                  {shipped && (
                    <>
                      {" "}
                      <span className={styles.orderShipped}>{t(lang, "C-propa-shipped", { version: shipped.version })}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Glass>
  );
}

function AllDecided({ lang, queue, sop }: { lang: Lang; queue: ProposalListItem[]; sop: SopOverview | null }) {
  const ids = useId();
  const approved = queue.filter((i) => i.proposal.status === "approved").length;
  const rejected = queue.length - approved;
  // Item 20: two approvals are two SOP versions, each with its own dates (shown on its row), so the one-change
  // sentence ("The approved change starts on ...") is only used when exactly one proposal was approved.
  const firstShipped = approved === 1 ? (queue.map((i) => shippedChangeFor(i, sop)).find((c) => c !== null) ?? null) : null;
  const summary = [
    t(lang, "C-propa-all-counts", { approved, rejected }),
    firstShipped
      ? t(lang, "C-propa-all-starts", { starts: dayLabel(firstShipped.effective_from_date, lang), review: dayLabel(firstShipped.review_date, lang) })
      : null,
  ]
    .filter((line) => line !== null)
    .join(" ");
  return (
    <div className={styles.allDecided}>
      <div className={styles.head}>
        <h1 id={`${ids}-h`} className="b6-h1-web">
          {t(lang, queue.length === 2 ? "C-propa-all-both" : "C-propa-all")}
        </h1>
        <p className="b6-sub">{summary}</p>
      </div>
      <Card className={styles.summary}>
        <ol aria-labelledby={`${ids}-h`} className={styles.summaryList}>
          {queue.map((item, index) => {
            const content = item.proposal.content!;
            const owner = item.review.owner;
            const isApproved = item.proposal.status === "approved";
            const shipped = shippedChangeFor(item, sop);
            return (
              <li key={item.proposal.proposal_id} className={styles.summaryRow}>
                <span className={styles.summaryNum}>#{index + 1}</span>
                <div className={styles.summaryBody}>
                  <h2 className={styles.summaryRowTitle}>{content.change_title}</h2>
                  {isApproved ? (
                    <>
                      {shipped && <p className={styles.summaryLine}>{t(lang, "C-propa-shipped", { version: shipped.version })}</p>}
                      <p className={styles.summaryLine}>{datesLine(lang, content, shipped)}</p>
                    </>
                  ) : (
                    <p className={styles.summaryLine}>{owner?.reason ? t(lang, "C-propa-rule", { reason: owner.reason }) : t(lang, "C-propa-rule-none")}</p>
                  )}
                </div>
                <Pill tone={OWNER_STATUS_TONE[item.proposal.status]} className={styles.summaryPill}>
                  {isApproved
                    ? shipped
                      ? t(lang, "C-propa-st-approved-starts", { date: dayLabel(shipped.effective_from_date, lang) })
                      : t(lang, OWNER_STATUS_KEY[item.proposal.status])
                    : t(lang, "C-propa-st-rejected-rule")}
                </Pill>
              </li>
            );
          })}
        </ol>
      </Card>
      <Glass as="section" aria-labelledby={`${ids}-next`} className={styles.next}>
        <Kicker id={`${ids}-next`}>{t(lang, "C-propa-next-h")}</Kicker>
        <p className={styles.nextText}>{t(lang, "C-propa-next-p")}</p>
      </Glass>
      <div className={styles.links}>
        <Link href="/home" className={buttonClassName({ variant: "primary" })}>
          {t(lang, "C-propa-home")}
        </Link>
        <Link href="/sop" className={buttonClassName({ variant: "secondary" })}>
          {t(lang, "C-propa-see-sop")}
        </Link>
      </div>
    </div>
  );
}

export function ApprovalsReview({
  auth,
  lang,
  onBridge,
  initialId,
}: {
  auth: Auth;
  lang: Lang;
  onBridge?: (event: ApprovalsBridgeEvent) => void;
  /** The proposal to open first (`/proposals?id=…` from the owner's Home); unknown or decided ids fall back to the order. */
  initialId?: string | null;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const list = useProposalList(auth, reloadKey);
  // `from_url`: the pick came from `?id=` (opens only a still-undecided proposal); a tap in the order may open a
  // decided one read-only.
  const [pick, setPick] = useState<{ id: string; from_url: boolean } | null>(initialId ? { id: initialId, from_url: true } : null);
  const [notice, setNotice] = useState<DictKey | null>(null);
  // Bumped on every settled decision so the answer takes focus again even when the message key repeats
  // (reject → reject, or two 409s): keying the effect on `notice` alone would not re-run it.
  const [settledCount, setSettledCount] = useState(0);
  // The list object the last decision was taken on. `useProposalList` keeps that object on screen while the reload
  // runs, so "the reload has not landed yet" is exactly `data === settledData`; the decision card stays locked until
  // a fresh list arrives (a fast second tap would otherwise get a 409 that overwrites the "Approved." answer).
  const [settledData, setSettledData] = useState<ListProposalsResponse | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const bridge = useRef(onBridge);
  useEffect(() => {
    bridge.current = onBridge;
  });

  const data = list.kind === "ready" ? list.data : null;
  const queue = data ? approvalsQueue(data) : [];
  const hasApproved = queue.some((i) => i.proposal.status === "approved");
  const sop = useSopOverview(auth, hasApproved, reloadKey);

  const picked = pick === null ? null : (queue.find((i) => i.proposal.proposal_id === pick.id && !(pick.from_url && isOwnerDecided(i))) ?? null);
  // The picked proposal left the queue (a reload after a decision elsewhere), or `?id=` named an unknown or already
  // decided proposal: back to the recommended order. Adjusted during render, the React-recommended way to derive
  // state from a data change (no effect, no extra frame).
  if (pick !== null && data && picked === null) setPick(null);
  const current = picked ?? firstUndecided(queue);
  const done = queue.filter(isOwnerDecided).length;

  const shown: ApprovalsScreen | null = !data ? null : queue.length === 0 ? "empty" : current ? "review" : "all_decided";

  useEffect(() => {
    if (shown) bridge.current?.({ type: "screen", screen: shown });
  }, [shown]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice, settledCount]);

  const pending = data !== null && data === settledData;

  function handleSettled(outcome: { messageKey: DictKey }) {
    setPick(null);
    setNotice(outcome.messageKey);
    setSettledCount((n) => n + 1);
    setSettledData(data);
    setReloadKey((k) => k + 1);
    bridge.current?.({ type: "progress" });
  }

  const left = queue.length - done;
  const position = current ? queue.findIndex((i) => i.proposal.proposal_id === current.proposal.proposal_id) + 1 : 0;
  const kicker = shown === "all_decided" ? t(lang, "C-propa-kicker-done") : shown === "review" ? t(lang, "C-propa-kicker", { n: position, total: queue.length, left }) : null;

  return (
    <div className={styles.screen}>
      <div className={styles.topRow}>
        <Link href="/home" className={styles.backLink}>
          {t(lang, "C-propa-back-home")}
        </Link>
        {kicker && <span className="b6-kick">{kicker}</span>}
      </div>

      {list.kind === "loading" && (
        <>
          <PageHead title={t(lang, "C-web-nav-approvals")} sub={t(lang, "C-propa-sub")} />
          <p role="status" aria-live="polite" className="b6-sub">
            {t(lang, "C-day-loading")}
          </p>
        </>
      )}
      {list.kind === "error" && (
        <>
          <PageHead title={t(lang, "C-web-nav-approvals")} sub={t(lang, "C-propa-sub")} />
          <p role="status" aria-live="polite" className="b6-sub">
            {t(lang, list.messageKey)}
          </p>
        </>
      )}

      {shown === "empty" && (
        <>
          <PageHead title={t(lang, "C-web-nav-approvals")} sub={t(lang, "C-propa-sub")} />
          <EmptyState title={t(lang, "C-web-empty-appr-h")} detail={t(lang, "C-web-empty-appr-p")} />
        </>
      )}

      {(shown === "review" || shown === "all_decided") && (
        <>
          <Progress lang={lang} queue={queue} currentId={current?.proposal.proposal_id ?? null} />
          {notice && (
            <p ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className={styles.status}>
              {t(lang, notice)}
            </p>
          )}
          {shown === "all_decided" ? (
            <AllDecided lang={lang} queue={queue} sop={sop} />
          ) : (
            <div className={styles.body}>
              <ApprovalCard
                lang={lang}
                item={current!}
                shipped={shippedChangeFor(current!, sop)}
                position={position}
                othersWaiting={queue.some((i) => !isOwnerDecided(i) && i.proposal.proposal_id !== current!.proposal.proposal_id)}
              />
              <div className={styles.side}>
                <ApprovalDecision key={current!.proposal.proposal_id} auth={auth} lang={lang} item={current!} pending={pending} onSettled={handleSettled} />
                <OrderList
                  lang={lang}
                  queue={queue}
                  currentId={current!.proposal.proposal_id}
                  sop={sop}
                  onPick={(id) => {
                    setNotice(null);
                    setPick({ id, from_url: false });
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
