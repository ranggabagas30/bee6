"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { ListProposalsResponse, ProposalListItem } from "@/lib/proposals/review-contract";
import { SopOverviewSchema, type SopOverview } from "@/lib/sop/contract";
import { buttonClassName, Card, Glass, Kicker, Pill } from "@/app/ui";
import { EmptyState } from "@/app/web/EmptyState";
import { ApprovalCard, datesLine, OWNER_STATUS_KEY, OWNER_STATUS_TONE } from "@/app/proposals/ApprovalCard";
import { ApprovalDecision } from "@/app/proposals/ApprovalDecision";
import { approvalsQueue, firstUndecided, isOwnerDecided, shippedChangeFor } from "@/app/proposals/approvals";
import { useProposalList } from "@/app/proposals/useProposalList";
import styles from "@/app/proposals/approvals.module.css";

/**
 * The owner's Approvals screen = page-1 W8 "Review in order" (R-19 PR-12b, plan 9.5, decision V6; boards D2-08,
 * D2-08c, D2-08d, D2-08e). One proposal at a time in the recommended order (oldest first, `approvalsQueue`), the
 * progress segments on top, "‹ Back to home", the recommended-order list (#1, #2 … with status; tapping one shows
 * it), the proposal card and the decision card. After a decision the screen shows the answer, reloads and moves to
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

function Progress({ lang, done, total }: { lang: Lang; done: number; total: number }) {
  const label = t(lang, "C-propa-progress", { done, total });
  return (
    <div className={styles.progress}>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label} className={styles.segments}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} aria-hidden="true" className={i < done ? `${styles.segment} ${styles.segmentDone}` : styles.segment} />
        ))}
      </div>
      <span aria-hidden="true" className={styles.progressText}>
        {label}
      </span>
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
      <Kicker id={id}>{t(lang, "C-propa-order")}</Kicker>
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
                <span className={styles.orderTitle}>{content.change_title}</span>{" "}
                <Pill tone={decided ? OWNER_STATUS_TONE[item.proposal.status] : current ? "teal" : "amber"}>
                  {decided ? t(lang, OWNER_STATUS_KEY[item.proposal.status]) : t(lang, current ? "C-propa-now" : "C-propa-st-waiting")}
                </Pill>
                {shipped && (
                  <>
                    {" "}
                    <span className={styles.orderShipped}>{t(lang, "C-propa-shipped", { version: shipped.version })}</span>
                  </>
                )}
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
  return (
    <>
      <Card as="section" aria-labelledby={`${ids}-h`} className={styles.summary}>
        <h2 id={`${ids}-h`} className={styles.summaryTitle}>
          {t(lang, queue.length === 2 ? "C-propa-all-both" : "C-propa-all")}
        </h2>
        <ol className={styles.summaryList}>
          {queue.map((item) => {
            const content = item.proposal.content!;
            const owner = item.review.owner;
            const shipped = shippedChangeFor(item, sop);
            return (
              <li key={item.proposal.proposal_id} className={styles.summaryRow}>
                <div className={styles.summaryHead}>
                  <h3 className={styles.summaryRowTitle}>{content.change_title}</h3>
                  <Pill tone={OWNER_STATUS_TONE[item.proposal.status]}>{t(lang, OWNER_STATUS_KEY[item.proposal.status])}</Pill>
                </div>
                {item.proposal.status === "approved" ? (
                  <>
                    {shipped && <p className={styles.summaryLine}>{t(lang, "C-propa-shipped", { version: shipped.version })}</p>}
                    <p className={styles.summaryLine}>{datesLine(lang, content, shipped)}</p>
                  </>
                ) : (
                  <p className={styles.summaryLine}>{owner?.reason ? t(lang, "C-propa-rule", { reason: owner.reason }) : t(lang, "C-propa-rule-none")}</p>
                )}
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
        <Link href="/home" className={buttonClassName({ variant: "secondary" })}>
          {t(lang, "C-propa-home")}
        </Link>
        <Link href="/sop" className={buttonClassName({ variant: "primary" })}>
          {t(lang, "C-propa-see-sop")}
        </Link>
      </div>
    </>
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

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <Link href="/home" className={styles.backLink}>
          {t(lang, "C-propa-back-home")}
        </Link>
        <h1 className={styles.h1}>{t(lang, "C-web-nav-approvals")}</h1>
        <p className={styles.sub}>{t(lang, "C-propa-sub")}</p>
      </header>

      {list.kind === "loading" && (
        <p role="status" aria-live="polite" className={styles.statusPlain}>
          {t(lang, "C-day-loading")}
        </p>
      )}
      {list.kind === "error" && (
        <p role="status" aria-live="polite" className={styles.statusPlain}>
          {t(lang, list.messageKey)}
        </p>
      )}

      {shown === "empty" && <EmptyState title={t(lang, "C-web-empty-appr-h")} detail={t(lang, "C-web-empty-appr-p")} />}

      {(shown === "review" || shown === "all_decided") && (
        <>
          <Progress lang={lang} done={done} total={queue.length} />
          {notice && (
            <p ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className={styles.status}>
              {t(lang, notice)}
            </p>
          )}
          {shown === "all_decided" ? (
            <AllDecided lang={lang} queue={queue} sop={sop} />
          ) : (
            <div className={styles.body}>
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
              <div className={styles.main}>
                <ApprovalCard lang={lang} item={current!} shipped={shippedChangeFor(current!, sop)} />
                <ApprovalDecision key={current!.proposal.proposal_id} auth={auth} lang={lang} item={current!} pending={pending} onSettled={handleSettled} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
