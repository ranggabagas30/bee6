"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { CONSTRAINT_INPUT_MAX, CONSTRAINT_INPUT_MIN } from "@/lib/constraints/contract";
import { DecisionResponseSchema, type DecisionConflictCode, type ProposalListItem } from "@/lib/proposals/review-contract";
import { Button, Card, Kicker } from "@/app/ui";
import styles from "@/app/proposals/approvals.module.css";

/**
 * "Your decision" (R-19 PR-12b, plan 9.5; boards D2-08, D2-08c): **Approve** at the top, and under it the inline
 * required **"Reject — why?"** field with "Reject with reason". No confirm dialogs. Both go to the existing owner
 * route (`POST /api/v1/proposals/{id}/approve`, `decision: approve | reject`); the server re-derives every rule
 * (role, stage, freshness, SOP version, late constraints), so this card only mirrors the notices it already got:
 * - the SOP changed after this was drafted (`notices.sop_changed`, the SOP_CHANGED rule kept): Approve reads
 *   "Approve · not available" and is disabled, the reject field stays (board D2-08d);
 * - stale evidence disables Approve with the stale notice; late constraints need the acknowledgement tick;
 * - a superseded proposal has no actions.
 *
 * Outcomes: every server answer that ends the decision here (approved, rejected, unchanged, any 409) goes to
 * `onSettled` with the copy key; 422 / 403 / network stay here as an inline alert so the owner can retry. The reason
 * is user text sent as-is (3..300, the constraint bounds); the server redacts it before storing it.
 */

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

export interface ApprovalDecisionProps {
  auth: Auth;
  lang: Lang;
  item: ProposalListItem;
  /** A server answer that ends the decision here: the parent shows the message, reloads and moves on. */
  onSettled: (outcome: { messageKey: DictKey; approved: boolean }) => void;
}

export function ApprovalDecision({ auth, lang, item, onSettled }: ApprovalDecisionProps) {
  const router = useRouter();
  const { proposal, notices } = item;
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<DictKey | null>(null);
  const inFlight = useRef(false);
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const hintId = `${ids}-hint`;
  const sopChangedId = `${ids}-sop`;

  if (notices.superseded || proposal.status !== "awaiting_owner") return null;

  const lateIds = notices.late_constraints.map((c) => c.constraint_id);
  const needsAck = lateIds.length > 0;
  const approveBlocked = notices.sop_changed || notices.evidence_stale || (needsAck && !acknowledged);
  const trimmed = reason.trim();
  const canSend = trimmed.length >= CONSTRAINT_INPUT_MIN;
  const path = `/api/v1/proposals/${proposal.proposal_id}/approve`;

  async function submit(body: { decision: "approve"; acknowledged_constraint_ids: string[] } | { decision: "reject"; reason: string }) {
    if (inFlight.current) return; // double-tap guard
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const result = await authedPostJson(auth, path, body, DecisionResponseSchema);
    inFlight.current = false;
    setBusy(false);

    if (result.kind === "ok") {
      if (result.data.result === "approved") {
        onSettled({ messageKey: "C-propa-done-approved", approved: true });
      } else if (result.data.result === "rejected") {
        setReason("");
        onSettled({ messageKey: "C-propa-done-rejected", approved: false });
      } else {
        onSettled({ messageKey: "C-prop-done-unchanged", approved: false });
      }
      return;
    }
    if (result.kind === "conflict") {
      onSettled({
        messageKey: Object.hasOwn(CONFLICT_KEY, result.code) ? CONFLICT_KEY[result.code as keyof typeof CONFLICT_KEY] : "C-srv-generic",
        approved: false,
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
    <Card as="section" aria-labelledby={`${ids}-decision`} className={styles.decision}>
      <Kicker id={`${ids}-decision`}>{t(lang, "C-propa-decision")}</Kicker>

      {(notices.evidence_stale || needsAck) && (
        <div className={styles.notices}>
          {notices.evidence_stale && <p>{t(lang, "C-prop-notice-stale")}</p>}
          {needsAck && (
            <>
              <p>{t(lang, "C-prop-notice-late")}</p>
              <ul>
                {notices.late_constraints.map((c) => (
                  <li key={c.constraint_id}>{c.text}</li>
                ))}
              </ul>
              <label className={styles.ack}>
                <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />
                {t(lang, "C-prop-ack-late")}
              </label>
            </>
          )}
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        block
        disabled={busy || approveBlocked}
        aria-describedby={notices.sop_changed ? sopChangedId : undefined}
        onClick={() => void submit({ decision: "approve", acknowledged_constraint_ids: needsAck ? lateIds : [] })}
      >
        {t(lang, notices.sop_changed ? "C-propa-approve-na" : "C-propa-approve")}
      </Button>
      {notices.sop_changed && (
        <p id={sopChangedId} className={styles.sopChanged}>
          {t(lang, "C-propa-sop-changed")}
        </p>
      )}

      <form
        className={styles.rejectForm}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend && !busy) void submit({ decision: "reject", reason: trimmed });
        }}
      >
        <label className={styles.rejectLabel} htmlFor={reasonId}>
          {t(lang, "C-propa-reject-label")}
        </label>
        <textarea
          id={reasonId}
          className={styles.textarea}
          value={reason}
          maxLength={CONSTRAINT_INPUT_MAX}
          rows={3}
          disabled={busy}
          aria-describedby={hintId}
          onChange={(event) => setReason(event.target.value)}
        />
        <p id={hintId} className={styles.hint}>
          {t(lang, "C-propa-reject-hint")} {t(lang, "C-con-count", { n: reason.length })}
        </p>
        <Button type="submit" variant="destructive" block disabled={!canSend || busy}>
          {t(lang, "C-propa-reject-send")}
        </Button>
      </form>

      {message !== null && (
        <p role="alert" className={styles.alert}>
          {t(lang, message)}
        </p>
      )}
    </Card>
  );
}
