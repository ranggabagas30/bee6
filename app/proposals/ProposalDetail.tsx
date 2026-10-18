"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CONSTRAINT_INPUT_MAX, CONSTRAINT_INPUT_MIN } from "@/lib/constraints/contract";
import {
  DecisionResponseSchema,
  type DecisionConflictCode,
  type ProposalListItem,
} from "@/lib/proposals/review-contract";
import type { ProposalView } from "@/lib/proposals/contract";
import { Button, Card, Chip, Glass, Pill } from "@/app/ui";
import { FeasibleHandover } from "@/app/proposals/FeasibleHandover";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * The supervisor's proposal detail (R-19 PR-12a, plan 9.5; boards D2-03e, D2-03f, D2-03g): step chip and status
 * pill, the change title, the rationale as one line under it, what changes in the SOP (the step's wording from the
 * proposal's generator SOP version in `<del>` with a visually hidden "Before:", as PR-9a's SOP book, the new wording
 * under it), the evidence (date · time — the dated summary from the view, never a quoted line), the metric to
 * watch, the review date and the feasible note. Actions on an `awaiting_supervisor` proposal: **Mark feasible**
 * (no confirm) and an inline **Reject… (reason required)** panel — no confirm dialog for either (plan 9.5; R-25 tech-lead
 * ruling on UI-078: the inline panel stays, restyled with the board's "Reject this proposal?" title and lead). Both go to the
 * existing review route; the server re-derives every rule (role, stage, freshness, late constraints), so this
 * screen only mirrors the notices: stale evidence / a changed SOP disable Mark feasible, late constraints need
 * the acknowledgement tick, a superseded proposal has no actions.
 *
 * Outcomes: ok feasible → `onFeasible` (the parent shows the hand-over); ok rejected and every 409 → `onSettled`
 * with the copy key (the parent returns to the list, shows it and reloads); 422 / 403 / network stay here with an
 * inline alert. The reason is user text sent as-is; the server redacts it before storing it.
 */

const STATUS_KEY: Record<ProposalView["status"], DictKey> = {
  suppressed: "C-prop-st-suppressed",
  blocked: "C-prop-st-blocked",
  awaiting_supervisor: "C-propd-st-yours",
  awaiting_owner: "C-prop-st-awaiting-owner",
  approved: "C-prop-st-approved",
  rejected: "C-prop-st-rejected",
};

const STATUS_TONE: Record<ProposalView["status"], "neutral" | "amber" | "green" | "red" | "teal"> = {
  suppressed: "neutral",
  blocked: "neutral",
  awaiting_supervisor: "amber",
  awaiting_owner: "teal",
  approved: "green",
  rejected: "red",
};

// Exhaustive on purpose: a new server conflict code that is not mapped here fails `tsc`.
const CONFLICT_KEY: Record<DecisionConflictCode | "CONSTRAINT_LIMIT", DictKey> = {
  ALREADY_DECIDED: "C-prop-err-decided",
  NOT_YET_REVIEWABLE: "C-prop-err-not-yet",
  NOT_REVIEWABLE: "C-prop-err-not-reviewable",
  SUPERSEDED: "C-prop-err-superseded",
  EVIDENCE_STALE: "C-prop-err-stale",
  SOP_CHANGED: "C-prop-err-sop-changed",
  CONSTRAINT_ADDED: "C-prop-err-constraint-added",
  SOP_STEP_LIMIT: "C-prop-err-sop-limit",
  LEGACY_PROPOSAL: "C-prop-err-legacy",
  STEP_TEXT_TOO_LONG: "C-prop-err-step-too-long",
  CONSTRAINT_LIMIT: "C-con-err-limit",
};

export interface ProposalDetailProps {
  auth: Auth;
  lang: Lang;
  item: ProposalListItem;
  /** The supervisor just marked this one feasible: show the hand-over instead of the actions. */
  feasible: boolean;
  onBack: () => void;
  onFeasible: () => void;
  /** A server answer that ends the review here (rejected, or any 409): the parent shows the message and reloads. */
  onSettled: (outcome: { messageKey: DictKey }) => void;
}

export function ProposalDetail({ auth, lang, item, feasible, onBack, onFeasible, onSettled }: ProposalDetailProps) {
  const router = useRouter();
  const { proposal, notices } = item;
  const content = proposal.content;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<DictKey | null>(null);
  const inFlight = useRef(false);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const returnToReject = useRef(false);
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const leadId = `${ids}-lead`;
  const countId = `${ids}-count`;
  const titleId = `${ids}-reject-h`;

  useEffect(() => {
    if (rejecting) textareaRef.current?.focus();
    else if (returnToReject.current) {
      returnToReject.current = false;
      rejectRef.current?.focus();
    }
  }, [rejecting]);

  if (!content) return null; // the list never offers a suppressed/blocked proposal to open

  const canAct = !feasible && !notices.superseded && proposal.status === "awaiting_supervisor";
  const lateIds = notices.late_constraints.map((c) => c.constraint_id);
  const needsAck = lateIds.length > 0;
  const positiveBlocked = notices.evidence_stale || notices.sop_changed || (needsAck && !acknowledged);
  const trimmed = reason.trim();
  const canSend = trimmed.length >= CONSTRAINT_INPUT_MIN;
  const days = new Set(content.evidence.map((e) => e.date)).size;
  const path = `/api/v1/proposals/${proposal.proposal_id}/review`;

  async function submit(body: { decision: "feasible"; acknowledged_constraint_ids: string[] } | { decision: "reject"; reason: string }) {
    if (inFlight.current) return; // double-tap guard
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const result = await authedPostJson(auth, path, body, DecisionResponseSchema);
    inFlight.current = false;
    setBusy(false);

    if (result.kind === "ok") {
      if (result.data.result === "feasible") {
        onFeasible();
      } else if (result.data.result === "rejected") {
        setReason("");
        onSettled({ messageKey: "C-propd-rejected" });
      } else {
        onSettled({ messageKey: "C-prop-done-unchanged" });
      }
      return;
    }
    if (result.kind === "conflict") {
      onSettled({
        messageKey: Object.hasOwn(CONFLICT_KEY, result.code) ? CONFLICT_KEY[result.code as keyof typeof CONFLICT_KEY] : "C-srv-generic",
      });
      return;
    }
    if (result.kind === "invalid") {
      setMessage(body.decision === "reject" ? "C-con-err-length" : "C-srv-generic");
      return;
    }
    if (result.kind === "forbidden") {
      setMessage("C-prop-err-forbidden-decide");
      return;
    }
    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    setMessage("C-srv-generic");
  }

  return (
    <div className={styles.detail}>
      <button type="button" className={styles.back} onClick={onBack} disabled={busy}>
        {t(lang, "C-propd-back")}
      </button>

      <div className={styles.detailHead}>
        <div className={styles.chips}>
          <Chip>{content.target_step ? content.target_step.title : t(lang, "C-propd-step-new")}</Chip>
          <Pill tone={STATUS_TONE[proposal.status]}>{t(lang, STATUS_KEY[proposal.status])}</Pill>
        </div>
        <h1 className={`b6-h1-web ${styles.detailTitle}`}>{content.change_title}</h1>
        <p className={`b6-sub ${styles.detailWhy}`}>{content.rationale}</p>
      </div>

      {feasible && <FeasibleHandover lang={lang} />}

      <Card as="section" aria-labelledby={`${ids}-changes`} className={styles.block}>
        <span id={`${ids}-changes`} className="b6-kick">
          {t(lang, "C-propd-changes")}
        </span>
        {content.target_step?.text && (
          <p className={styles.before}>
            <span className="b6-sr-only">{t(lang, "C-propd-before")} </span>
            <del>{content.target_step.text}</del>
          </p>
        )}
        <p className={styles.after}>
          {content.target_step?.text && <span className="b6-sr-only">{t(lang, "C-propd-after")} </span>}
          {content.change_text}
        </p>
      </Card>

      <Card as="section" aria-labelledby={`${ids}-evidence`} className={styles.block}>
        <span id={`${ids}-evidence`} className="b6-kick">
          {t(lang, "C-propd-evidence", { n: content.evidence.length, days })}
        </span>
        <ul className={styles.evidence}>
          {content.evidence.map((ref, index) => (
            <li key={index}>
              <span className={styles.evidenceWhen}>
                {dayLabel(ref.date, lang)} · {ref.start_hm}
              </span>
              {" — "}
              {ref.summary === null ? t(lang, "C-prop-evidence-expired") : ref.summary}
            </li>
          ))}
        </ul>
      </Card>

      <div className={styles.tiles}>
        <Glass className="b6-tile">
          <span className="b6-kick">{t(lang, "C-propd-metric")}</span>
          <span className={styles.tileText}>{content.metric.description}</span>
        </Glass>
        <Glass className="b6-tile">
          <span className="b6-kick">{t(lang, "C-propd-review")}</span>
          <span className={styles.tileText}>
            {proposal.status === "awaiting_supervisor" || proposal.status === "awaiting_owner"
              ? t(lang, "C-prop-review-draft", { date: dayLabel(content.review_date, lang) })
              : dayLabel(content.review_date, lang)}
          </span>
        </Glass>
      </div>

      {(notices.superseded || notices.evidence_stale || notices.sop_changed || needsAck) && (
        <div className={styles.notices}>
          {notices.superseded && <p>{t(lang, "C-prop-notice-superseded")}</p>}
          {notices.evidence_stale && <p>{t(lang, "C-prop-notice-stale")}</p>}
          {notices.sop_changed && <p>{t(lang, "C-prop-notice-sop")}</p>}
          {needsAck && (
            <>
              <p>{t(lang, "C-prop-notice-late")}</p>
              <ul>
                {notices.late_constraints.map((c) => (
                  <li key={c.constraint_id}>{c.text}</li>
                ))}
              </ul>
              {canAct && (
                <label className={styles.ack}>
                  <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />
                  {t(lang, "C-prop-ack-late")}
                </label>
              )}
            </>
          )}
        </div>
      )}

      {!feasible && <p className={styles.note}>{t(lang, "C-propd-note")}</p>}

      {canAct && !rejecting && (
        <div className={styles.actions}>
          <Button
            ref={rejectRef}
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setMessage(null);
              setRejecting(true);
            }}
          >
            {t(lang, "C-propd-reject")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || positiveBlocked}
            onClick={() => void submit({ decision: "feasible", acknowledged_constraint_ids: needsAck ? lateIds : [] })}
          >
            {t(lang, "C-propd-feasible")}
          </Button>
        </div>
      )}

      {canAct && rejecting && (
        <form
          className={`b6-card ${styles.rejectForm}`}
          aria-labelledby={titleId}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend && !busy) void submit({ decision: "reject", reason: trimmed });
          }}
        >
          <h2 id={titleId} className="b6-h2-card">
            {t(lang, "C-propd-reject-h")}
          </h2>
          <p id={leadId} className="b6-sub">
            {t(lang, "C-propd-reject-hint")}
          </p>
          <label className={styles.rejectLabel} htmlFor={reasonId}>
            {t(lang, "C-propd-reject-label")}
          </label>
          <textarea
            id={reasonId}
            ref={textareaRef}
            className={`b6-field ${styles.textarea}`}
            value={reason}
            maxLength={CONSTRAINT_INPUT_MAX}
            rows={4}
            disabled={busy}
            aria-describedby={`${leadId} ${countId}`}
            onChange={(event) => setReason(event.target.value)}
          />
          <span id={countId} className={styles.counter}>
            {t(lang, "C-con-count", { n: reason.length })}
          </span>
          <div className={styles.rejectActions}>
            <Button type="submit" variant="destructive" disabled={!canSend || busy}>
              {t(lang, "C-propd-reject-send")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                returnToReject.current = true;
                setMessage(null);
                setRejecting(false);
              }}
            >
              {t(lang, "C-act-cancel")}
            </Button>
          </div>
        </form>
      )}

      {message !== null && (
        <p role="alert" className={styles.alert}>
          {t(lang, message)}
        </p>
      )}
    </div>
  );
}
