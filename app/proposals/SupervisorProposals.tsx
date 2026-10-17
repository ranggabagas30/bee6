"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { MODEL_TIMEOUT_MS } from "@/lib/proposals/constants";
import { GenerateResponseSchema, type ProposalView } from "@/lib/proposals/contract";
import type { ProposalListItem } from "@/lib/proposals/review-contract";
import { Button, Card, Chip, Glass, Pill } from "@/app/ui";
import { PageHead } from "@/app/web/PageHead";
import { ConstraintsPanel } from "@/app/proposals/ConstraintsPanel";
import { GeneratingState } from "@/app/proposals/GeneratingState";
import type { AskEstimate } from "@/lib/proposals/v4/flag";
import { ProposalDetail } from "@/app/proposals/ProposalDetail";
import { WatchPanel } from "@/app/proposals/WatchPanel";
import { useProposalList } from "@/app/proposals/useProposalList";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * The supervisor's Proposals screen (R-19 PR-12a, plan 9.5; boards D2-03, D2-03a, D2-03b, D2-03d, D2-03e, D2-03f,
 * D2-03g). One client state machine, three screens:
 * - `list`: page head, the watch panel (plan 3.5 data from the same GET), the open proposals as rows, recently
 *   decided ones, and the constraints panel folded into a collapsed "Rules for Bee6 (optional)" (R-25 T10, R8: the
 *   feature stays, the board shows none); "Bee6 is writing a proposal" replaces the rows while a generate call runs;
 * - `detail`: one proposal, Mark feasible / inline reject;
 * - `feasible`: the same detail with the hand-over banner instead of the actions.
 *
 * Asking: the button sends the watch window as the range (no date form here: the window is the last 7 business
 * dates, the same as Generate's default) and `another: true` once a proposal exists (plan 3.3). A suppressed
 * answer to "another" reads "No other problem is ready yet", not the generic evidence line. A 409
 * GENERATION_IN_PROGRESS keeps the asking look and re-reads the list every 5 s until a proposal appears or
 * two model timeouts pass (plan 9.5): no second paid call is ever made for it.
 *
 * `onBridge` is the one hook the judge guide (PR-5) will later subscribe to: which screen is shown, and
 * "progress" after an ask, a feasible mark or a rejection. Nothing in this file publishes anywhere else.
 *
 * Every read/write goes through the authed API client (hard rule #6). The screen shows dated summaries and
 * counts only: never a thread, device or name (hard rule #7).
 */

export type ProposalsScreen = "list" | "generating" | "detail" | "feasible";
export type ProposalsBridgeEvent = { type: "screen"; screen: ProposalsScreen } | { type: "progress" };

type Screen = { kind: "list" } | { kind: "detail"; id: string } | { kind: "feasible"; id: string };
type Asking = "idle" | "calling" | "waiting";
type Notice =
  | { kind: "key"; key: DictKey; vars?: Record<string, string | number> }
  | { kind: "suppressed"; another: boolean; proposal: ProposalView };

const CONFLICT_KEY: Record<string, DictKey> = {
  LIBRARY_NOT_READY: "C-prop-err-library",
  NO_SOP: "C-prop-err-sop",
};

/** How often the list is re-read while another generation holds the lease, and when to give up. */
const WAIT_POLL_MS = 5_000;
const WAIT_MAX_MS = MODEL_TIMEOUT_MS * 2;

const STATUS_KEY: Record<ProposalView["status"], DictKey> = {
  suppressed: "C-prop-st-suppressed",
  blocked: "C-prop-st-blocked",
  awaiting_supervisor: "C-propd-st-yours",
  awaiting_owner: "C-prop-st-awaiting-owner",
  approved: "C-prop-st-approved",
  rejected: "C-prop-st-rejected",
};
/** The list row says "Waiting for you" (board D2-03); the detail keeps "Waiting for your check" (D2-03e). */
const LIST_STATUS_KEY: Record<ProposalView["status"], DictKey> = { ...STATUS_KEY, awaiting_supervisor: "C-propd-st-yours-list" };
const STATUS_TONE: Record<ProposalView["status"], "neutral" | "amber" | "teal" | "green" | "red"> = {
  suppressed: "neutral",
  blocked: "neutral",
  awaiting_supervisor: "amber",
  awaiting_owner: "teal",
  approved: "green",
  rejected: "red",
};

function ProposalRow({ item, lang, onOpen, decided }: { item: ProposalListItem; lang: Lang; onOpen: () => void; decided?: boolean }) {
  const { proposal } = item;
  const content = proposal.content;
  if (!content) return null;
  const dates = [...new Set(content.evidence.map((e) => e.date))].map((d) => dayLabel(d, lang)).join(", ");
  return (
    <Card as="li" className={styles.row}>
      <div className={styles.rowBody}>
        <div className={styles.rowTop}>
          <Chip>{content.target_step ? content.target_step.title : t(lang, "C-propd-step-new")}</Chip>
          <Pill tone={STATUS_TONE[proposal.status]}>{t(lang, LIST_STATUS_KEY[proposal.status])}</Pill>
        </div>
        <h3 className={styles.rowTitle}>{content.change_title}</h3>
        <p className={styles.rowWhy}>{content.rationale}</p>
        <span className={styles.rowMeta}>{t(lang, "C-propd-moments", { n: content.evidence.length, dates })}</span>
      </div>
      <div className={styles.rowActions}>
        <Button variant={decided ? "secondary" : "primary"} onClick={onOpen} aria-label={t(lang, "C-propd-open-aria", { title: content.change_title })}>
          {t(lang, "C-propd-open")}
        </Button>
      </div>
    </Card>
  );
}

function SuppressedLines({ notice, lang }: { notice: Extract<Notice, { kind: "suppressed" }>; lang: Lang }) {
  const s = notice.proposal.suppression;
  if (!s) return null;
  // After "Ask for another": the other problems are simply not ready, so no evidence arithmetic (it would read as
  // "waiting for evidence" for the problem that was just proposed). The first ask keeps the counts line.
  return (
    <>
      <span>
        {notice.another
          ? t(lang, "C-propg-none-other")
          : s.reason === "model_declined" && s.model_reason !== null
            ? t(lang, `C-prop-declined-${s.model_reason}` as DictKey)
            : t(lang, "C-prop-insufficient", {
                facts: s.followup.have_facts,
                dates: s.followup.have_dates,
                needFacts: s.followup.need_facts,
                needDates: s.followup.need_dates,
              })}
      </span>
      {s.followup.categories.length > 0 && (
        <span> {t(lang, "C-prop-watch", { categories: s.followup.categories.map((c) => t(lang, CATEGORY_KEY[c])).join(", ") })}</span>
      )}
    </>
  );
}

export function SupervisorProposals({
  auth,
  lang,
  onBridge,
  askEstimate = null,
  demo = false,
}: {
  auth: Auth;
  lang: Lang;
  onBridge?: (event: ProposalsBridgeEvent) => void;
  /** A demo sandbox principal (R-25 T10 / R14): the watch panel always shows the script's two problem rows. */
  demo?: boolean;
  /** R-24 D11: the estimated wait while THIS tab's Ask runs (v4 flag on); `null` = today's copy. Never shown while `waiting`. */
  askEstimate?: AskEstimate | null;
}) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  const [constraintsKey, setConstraintsKey] = useState(0);
  const list = useProposalList(auth, reloadKey);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [asking, setAsking] = useState<Asking>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const askingRef = useRef(false);
  const waitingSince = useRef<{ openIds: string[] } | null>(null);
  // Integration QA D2 (layout shift on a 360 px phone): the constraints panel under the list must not move through
  // an ask. (1) The asking block grows until the panel sits where it sat at the ask (`holdTop`, document px, read
  // back in a layout effect once the block is in). (2) The written line is held back until the reloaded list is on
  // screen, so the rows and the line land in ONE frame, not the old list plus the line first and the rows ~10 ms
  // later. (3) The line's focus, which scrolls it into view, runs one painted frame after that (see below).
  const listRef = useRef<HTMLDivElement>(null);
  const askingBlockRef = useRef<HTMLDivElement>(null);
  const holdTop = useRef<number | null>(null);
  const [reserveHeight, setReserveHeight] = useState<number | undefined>(undefined);
  const settleOnReload = useRef<Notice | null>(null);
  const bridge = useRef(onBridge);
  useEffect(() => {
    bridge.current = onBridge;
  });

  const data = list.kind === "ready" ? list.data : null;
  const open = data?.open ?? [];
  const decided = data?.decided ?? [];
  const current = screen.kind === "list" ? null : ([...open, ...decided].find((i) => i.proposal.proposal_id === screen.id) ?? null);
  const shown: ProposalsScreen = screen.kind === "list" ? (asking === "idle" ? "list" : "generating") : current ? screen.kind : "list";

  // The opened proposal left both lists (a reload after a decision elsewhere): fall back to the list. Adjusted
  // during render, the React-recommended way to derive state from a prop/data change (no effect, no extra frame).
  if (screen.kind !== "list" && data && current === null) setScreen({ kind: "list" });

  useEffect(() => {
    bridge.current?.({ type: "screen", screen: shown });
  }, [shown]);

  // While another generation holds the lease: re-read every WAIT_POLL_MS, stop when a new open proposal shows
  // up (the data effect below) or after WAIT_MAX_MS.
  useEffect(() => {
    if (asking !== "waiting") return;
    const poll = setInterval(() => setReloadKey((k) => k + 1), WAIT_POLL_MS);
    const giveUp = setTimeout(() => {
      setAsking("idle");
      setNotice({ kind: "key", key: "C-propg-timeout" });
    }, WAIT_MAX_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [asking]);

  useEffect(() => {
    if (asking !== "waiting" || !data || !waitingSince.current) return;
    const before = new Set(waitingSince.current.openIds);
    if (data.open.some((i) => !before.has(i.proposal.proposal_id))) {
      waitingSince.current = null;
      setAsking("idle");
      setNotice({ kind: "key", key: "C-propg-wrote" });
      bridge.current?.({ type: "progress" });
    }
  }, [asking, data]);

  // The reload after an answered ask has landed (`data` is the re-read list): leave the asking state and say so now.
  useEffect(() => {
    const settled = settleOnReload.current;
    if (!settled || !data) return;
    settleOnReload.current = null;
    setAsking("idle");
    setNotice(settled);
  }, [data]);

  // The asking block is in: if the panel under it moved up (the block is shorter than the list and the cleared
  // line), grow the block by that gap, before this frame paints.
  useLayoutEffect(() => {
    if (asking === "idle" || holdTop.current === null) return;
    const block = askingBlockRef.current;
    const panel = block?.nextElementSibling;
    if (!block || !panel) return;
    const gap = holdTop.current - (panel.getBoundingClientRect().top + window.scrollY);
    holdTop.current = null;
    if (gap > 0) setReserveHeight(Math.ceil(block.getBoundingClientRect().height + gap));
  }, [asking]);

  useEffect(() => {
    if (!notice) return;
    // Focus (and its scroll into view) one painted frame after the line landed: Chrome counts a scroll that lands in
    // the same frame as a layout change (the rows after an ask) as a layout shift of whatever the scroll uncovers.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => noticeRef.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [notice]);

  async function ask(another: boolean) {
    if (!data || askingRef.current) return;
    askingRef.current = true;
    setNotice(null);
    const panel = listRef.current?.nextElementSibling;
    holdTop.current = panel ? panel.getBoundingClientRect().top + window.scrollY : null;
    setReserveHeight(undefined);
    setAsking("calling");
    const body = another
      ? { from_date: data.watch.from_date, to_date: data.watch.to_date, another: true }
      : { from_date: data.watch.from_date, to_date: data.watch.to_date };
    const result = await authedPostJson(auth, "/api/v1/proposals/generate", body, GenerateResponseSchema);
    askingRef.current = false;

    if (result.kind === "ok") {
      const { proposal, reused } = result.data;
      if (proposal.content !== null) {
        // Still "Asking Bee6…" until the reloaded list is on screen (the data effect above settles it).
        settleOnReload.current = { kind: "key", key: reused ? "C-prop-reused" : "C-propg-wrote" };
        setReloadKey((k) => k + 1);
        bridge.current?.({ type: "progress" });
        return;
      }
      setAsking("idle");
      if (proposal.status === "blocked") {
        setNotice({ kind: "key", key: "C-prop-blocked", vars: { rule: proposal.blocked_rule ?? "" } });
      } else {
        setNotice({ kind: "suppressed", another, proposal });
      }
      return;
    }
    if (result.kind === "conflict" && result.code === "GENERATION_IN_PROGRESS") {
      waitingSince.current = { openIds: data.open.map((i) => i.proposal.proposal_id) };
      setAsking("waiting");
      return;
    }
    setAsking("idle");
    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    if (result.kind === "conflict") setNotice({ kind: "key", key: CONFLICT_KEY[result.code] ?? "C-srv-generic" });
    else if (result.kind === "invalid") setNotice({ kind: "key", key: "C-prop-err-range" });
    else if (result.kind === "forbidden") setNotice({ kind: "key", key: "C-prop-err-forbidden" });
    else setNotice({ kind: "key", key: "C-srv-generic" });
  }

  function handleSettled(outcome: { messageKey: DictKey }) {
    setScreen({ kind: "list" });
    setNotice({ kind: "key", key: outcome.messageKey });
    setReloadKey((k) => k + 1);
    if (outcome.messageKey === "C-propd-rejected") setConstraintsKey((k) => k + 1);
    bridge.current?.({ type: "progress" });
  }

  function handleFeasible(id: string) {
    setScreen({ kind: "feasible", id });
    setReloadKey((k) => k + 1);
    bridge.current?.({ type: "progress" });
  }

  // The page head is part of every list-level state: a loading or failed read still has its h1 (axe
  // page-has-heading-one, R-19 PR-5 round 4) and the page does not re-flow when the data lands.
  const head = <PageHead title={t(lang, "C-prop-title")} sub={t(lang, "C-propw-sub")} />;

  if (list.kind === "loading") {
    return (
      <>
        {head}
        <p role="status" aria-live="polite" className={styles.status}>
          {t(lang, "C-day-loading")}
        </p>
      </>
    );
  }
  if (list.kind === "error") {
    return (
      <>
        {head}
        <p role="status" aria-live="polite" className={styles.status}>
          {t(lang, list.messageKey)}
        </p>
      </>
    );
  }

  if (screen.kind !== "list" && current) {
    return (
      <ProposalDetail
        auth={auth}
        lang={lang}
        item={current}
        feasible={screen.kind === "feasible"}
        onBack={() => setScreen({ kind: "list" })}
        onFeasible={() => handleFeasible(current.proposal.proposal_id)}
        onSettled={handleSettled}
      />
    );
  }

  const { watch } = data!;
  const hasProposal = [...open, ...decided].some((i) => i.proposal.content !== null);
  const nothingYet = watch.categories.length === 0 && open.length === 0 && decided.length === 0;
  const generating = asking !== "idle";

  return (
    <>
      {head}

      <WatchPanel lang={lang} watch={watch} hasProposal={hasProposal} busy={generating} demo={demo} onAsk={(another) => void ask(another)} />

      {/* While Bee6 is asked the cleared line keeps one line of height (D2): the rows do not move when the answer fills it. */}
      <p
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={notice ? styles.status : generating ? `${styles.status} ${styles.statusHold}` : styles.statusEmpty}
      >
        {notice?.kind === "key" && t(lang, notice.key, notice.vars)}
        {notice?.kind === "suppressed" && <SuppressedLines notice={notice} lang={lang} />}
      </p>

      {generating ? (
        // A plain block around the asking state, so the hold can read the block's height and the panel right after it.
        <div ref={askingBlockRef}>
          <GeneratingState lang={lang} minHeight={reserveHeight} estimate={asking === "calling" ? askEstimate : null} />
        </div>
      ) : nothingYet ? (
        <Glass className={styles.noteCard}>
          <p className={styles.noteCardTitle}>{t(lang, "C-web-empty-prop-h")}</p>
          <p className={styles.noteCardBody}>{t(lang, "C-web-empty-prop-p")}</p>
        </Glass>
      ) : (
        // A plain block (only a column gap between the two sections), measured at the ask.
        <div ref={listRef} className={styles.lists}>
          <section aria-labelledby="prop-list-open">
            <h2 id="prop-list-open" className="b6-sr-only">
              {t(lang, "C-prop-list-open")}
            </h2>
            {open.length === 0 ? (
              <p className={styles.sub}>{t(lang, "C-prop-list-empty")}</p>
            ) : (
              <ul className={styles.rows}>
                {open.map((item) => (
                  <ProposalRow
                    key={item.proposal.proposal_id}
                    item={item}
                    lang={lang}
                    onOpen={() => {
                      setNotice(null);
                      setScreen({ kind: "detail", id: item.proposal.proposal_id });
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
          {decided.length > 0 && (
            <section aria-labelledby="prop-list-decided">
              <h2 id="prop-list-decided" className={`b6-kick ${styles.sectionTitle}`}>
                {t(lang, "C-prop-list-decided")}
              </h2>
              <ul className={styles.rows}>
                {decided.map((item) => (
                  <ProposalRow
                    key={item.proposal.proposal_id}
                    item={item}
                    lang={lang}
                    decided
                    onOpen={() => {
                      setNotice(null);
                      setScreen({ kind: "detail", id: item.proposal.proposal_id });
                    }}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Folded away (R8): the feature stays, the page-2 board shows none. Nothing here fetches until it is rendered open or shut:
          the panel loads its own list on mount, so the rejection reload (`constraintsKey`) keeps working while it is closed. */}
      <details className={`b6-card ${styles.rules}`}>
        <summary className={styles.rulesSummary}>{t(lang, "C-propd-rules")}</summary>
        <div className={styles.rulesBody}>
          <ConstraintsPanel auth={auth} role="supervisor" lang={lang} reloadKey={constraintsKey} />
        </div>
      </details>
    </>
  );
}
