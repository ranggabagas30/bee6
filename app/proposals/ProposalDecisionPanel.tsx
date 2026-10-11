"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { CONSTRAINT_INPUT_MAX, CONSTRAINT_INPUT_MIN } from "@/lib/constraints/contract";
import { DecisionResponseSchema, type ProposalListItem } from "@/lib/proposals/review-contract";

/**
 * The decision buttons under a proposal card (R-09 Task 7.2). One panel for
 * both roles: a supervisor sees Feasible / Reject on an `awaiting_supervisor`
 * proposal, the owner sees Approve / Reject on an `awaiting_owner` one. This
 * is a UI mirror only; the review/approve routes re-derive every rule on the
 * server (role, stage, freshness, late constraints) and the answer decides
 * what the panel reports.
 *
 * Nothing posts on the first tap. Every decision goes through an inline
 * confirm region (never a modal, same as `ConstraintsPanel`); a rejection
 * first asks for a reason (3..300 characters) because that reason becomes a
 * permanent outlet constraint. Every control is disabled while a request is
 * in flight, so a double tap sends one request.
 *
 * Every read/write goes through `authedPostJson` (hard rule #6). The reason
 * is user text sent as-is; the server redacts it before storing it.
 */

type Step = "idle" | "confirm-positive" | "reason" | "confirm-reject";

const CONFLICT_KEY: Record<string, DictKey> = {
  ALREADY_DECIDED: "C-prop-err-decided",
  NOT_YET_REVIEWABLE: "C-prop-err-not-yet",
  NOT_REVIEWABLE: "C-prop-err-not-reviewable",
  SUPERSEDED: "C-prop-err-superseded",
  EVIDENCE_STALE: "C-prop-err-stale",
  SOP_CHANGED: "C-prop-err-sop-changed",
  CONSTRAINT_ADDED: "C-prop-err-constraint-added",
  CONSTRAINT_LIMIT: "C-con-err-limit",
};

const WRAPPER_STYLE: CSSProperties = { marginTop: 12, overflowWrap: "anywhere" };
const LABEL_STYLE: CSSProperties = { display: "block", fontSize: 16, marginBottom: 4 };
const TEXTAREA_STYLE: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  fontSize: 16,
  padding: 8,
};
const HINT_STYLE: CSSProperties = { fontSize: 14, color: "#6b7280", margin: "4px 0 8px 0" };
const BUTTON_STYLE: CSSProperties = { minHeight: 48, width: "100%", fontSize: 16, padding: "0 16px", boxSizing: "border-box" };
const ROW_STYLE: CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
const ROW_BUTTON_STYLE: CSSProperties = { minHeight: 48, flex: 1, fontSize: 16, padding: "0 16px", boxSizing: "border-box" };
const CHECK_LABEL_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 48,
  fontSize: 16,
};
const CHECKBOX_STYLE: CSSProperties = { width: 24, height: 24, flexShrink: 0 };
const MESSAGE_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere" };

export function ProposalDecisionPanel({
  auth,
  role,
  item,
  lang,
  onSettled,
}: {
  auth: Auth;
  role: "owner" | "supervisor";
  item: ProposalListItem;
  lang: Lang;
  /** Called after any server answer that changed or may have changed state (ok, conflict). */
  onSettled: (outcome: { messageKey: DictKey; range?: { from_date: string; to_date: string } }) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<DictKey | null>(null);
  const inFlight = useRef(false);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const positiveRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<"positive" | "reject" | null>(null);
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const hintId = `${ids}-hint`;
  const countId = `${ids}-count`;

  const { proposal, notices } = item;
  const status = proposal.status;
  const canAct =
    !notices.superseded &&
    ((role === "supervisor" && status === "awaiting_supervisor") || (role === "owner" && status === "awaiting_owner"));

  useEffect(() => {
    if (step === "confirm-positive" || step === "confirm-reject") {
      confirmRef.current?.focus();
    } else if (step === "reason") {
      textareaRef.current?.focus();
    } else if (returnFocusTo.current !== null) {
      (returnFocusTo.current === "positive" ? positiveRef : rejectRef).current?.focus();
      returnFocusTo.current = null;
    }
  }, [step]);

  if (!canAct) return null;

  const trimmed = reason.trim();
  const canContinue = trimmed.length >= CONSTRAINT_INPUT_MIN;
  const positiveBlocked = notices.evidence_stale || notices.sop_changed;
  const lateIds = notices.late_constraints.map((c) => c.constraint_id);
  const needsAck = lateIds.length > 0;
  const positiveKey: DictKey = role === "supervisor" ? "C-prop-act-feasible" : "C-prop-act-approve";
  const confirmPositiveKey: DictKey = role === "supervisor" ? "C-prop-confirm-feasible" : "C-prop-confirm-approve";
  const confirmRejectKey: DictKey =
    role === "supervisor" ? "C-prop-confirm-reject-sup" : "C-prop-confirm-reject-owner";
  const hintKey: DictKey = role === "supervisor" ? "C-prop-reason-hint-sup" : "C-prop-reason-hint-owner";
  const path = `/api/v1/proposals/${proposal.proposal_id}/${role === "supervisor" ? "review" : "approve"}`;

  function toIdle(focus: "positive" | "reject" | null) {
    returnFocusTo.current = focus;
    setAcknowledged(false);
    setStep("idle");
  }

  async function submit(kind: "positive" | "reject") {
    if (inFlight.current) return; // double-tap guard: ignore once already in flight
    inFlight.current = true;
    setBusy(true);
    setMessage(null);

    const body =
      kind === "reject"
        ? { decision: "reject", reason: trimmed }
        : {
            decision: role === "supervisor" ? "feasible" : "approve",
            acknowledged_constraint_ids: needsAck ? lateIds : [],
          };
    const result = await authedPostJson(auth, path, body, DecisionResponseSchema);
    inFlight.current = false;
    setBusy(false);

    if (result.kind === "ok") {
      const outcome = result.data.result;
      setReason("");
      toIdle(null);
      if (outcome === "feasible") {
        onSettled({ messageKey: "C-prop-done-feasible" });
      } else if (outcome === "approved") {
        onSettled({ messageKey: "C-prop-done-approved" });
      } else if (outcome === "rejected") {
        onSettled({
          messageKey: role === "supervisor" ? "C-prop-done-rejected-sup" : "C-prop-done-rejected-owner",
          range: proposal.range,
        });
      } else {
        onSettled({ messageKey: "C-prop-done-unchanged" });
      }
      return;
    }
    if (result.kind === "conflict") {
      toIdle(null);
      onSettled({ messageKey: CONFLICT_KEY[result.code] ?? "C-srv-generic" });
      return;
    }
    if (result.kind === "invalid") {
      setStep("reason");
      setMessage("C-con-err-length");
      return;
    }
    if (result.kind === "forbidden") {
      toIdle(null);
      setMessage("C-prop-err-forbidden-decide");
      return;
    }
    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    // "error": stay in the confirm step the user was in, so Yes retries.
    setMessage("C-srv-generic");
  }

  return (
    <div style={WRAPPER_STYLE}>
      {step === "idle" && (
        <>
          <button
            ref={positiveRef}
            type="button"
            disabled={positiveBlocked || busy}
            onClick={() => {
              setMessage(null);
              setStep("confirm-positive");
            }}
            style={BUTTON_STYLE}
          >
            {t(lang, positiveKey)}
          </button>
          <div style={{ height: 8 }} />
          <button
            ref={rejectRef}
            type="button"
            disabled={busy}
            onClick={() => {
              setMessage(null);
              setStep("reason");
            }}
            style={BUTTON_STYLE}
          >
            {t(lang, "C-prop-act-reject")}
          </button>
        </>
      )}

      {step === "reason" && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (canContinue && !busy) {
              setMessage(null);
              setStep("confirm-reject");
            }
          }}
        >
          <label style={LABEL_STYLE} htmlFor={reasonId}>
            {t(lang, "C-prop-reason-label")}
          </label>
          <textarea
            id={reasonId}
            ref={textareaRef}
            value={reason}
            maxLength={CONSTRAINT_INPUT_MAX}
            rows={3}
            disabled={busy}
            aria-describedby={`${hintId} ${countId}`}
            onChange={(event) => setReason(event.target.value)}
            style={TEXTAREA_STYLE}
          />
          <p id={hintId} style={HINT_STYLE}>
            {t(lang, hintKey)}
          </p>
          <p id={countId} style={HINT_STYLE}>
            {t(lang, "C-con-count", { n: reason.length })}
          </p>
          <div style={ROW_STYLE}>
            <button type="submit" disabled={!canContinue || busy} style={ROW_BUTTON_STYLE}>
              {t(lang, "C-prop-continue")}
            </button>
            <button type="button" disabled={busy} onClick={() => toIdle("reject")} style={ROW_BUTTON_STYLE}>
              {t(lang, "C-prop-confirm-no")}
            </button>
          </div>
        </form>
      )}

      {step === "confirm-positive" && (
        <div role="group" aria-label={t(lang, confirmPositiveKey)}>
          <p ref={confirmRef} tabIndex={-1} style={{ margin: 0 }}>
            {t(lang, confirmPositiveKey)}
          </p>
          {needsAck && (
            <label style={CHECK_LABEL_STYLE}>
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
                style={CHECKBOX_STYLE}
              />
              {t(lang, "C-prop-ack-late")}
            </label>
          )}
          <div style={ROW_STYLE}>
            <button
              type="button"
              disabled={busy || (needsAck && !acknowledged)}
              onClick={() => void submit("positive")}
              style={ROW_BUTTON_STYLE}
            >
              {t(lang, "C-prop-confirm-yes")}
            </button>
            <button type="button" disabled={busy} onClick={() => toIdle("positive")} style={ROW_BUTTON_STYLE}>
              {t(lang, "C-prop-confirm-no")}
            </button>
          </div>
        </div>
      )}

      {step === "confirm-reject" && (
        <div role="group" aria-label={t(lang, confirmRejectKey)}>
          <p ref={confirmRef} tabIndex={-1} style={{ margin: 0 }}>
            {t(lang, confirmRejectKey)}
          </p>
          <div style={ROW_STYLE}>
            <button type="button" disabled={busy} onClick={() => void submit("reject")} style={ROW_BUTTON_STYLE}>
              {t(lang, "C-prop-confirm-yes")}
            </button>
            <button type="button" disabled={busy} onClick={() => toIdle("reject")} style={ROW_BUTTON_STYLE}>
              {t(lang, "C-prop-confirm-no")}
            </button>
          </div>
        </div>
      )}

      {message !== null && (
        <p role="alert" style={MESSAGE_STYLE}>
          {t(lang, message)}
        </p>
      )}
    </div>
  );
}
