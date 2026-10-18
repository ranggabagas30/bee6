"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { ReviewVerdict } from "@/lib/firestore/schema";
import {
  VerdictResponseSchema,
  type ReviewConflictCode,
  type ReviewView,
} from "@/lib/reviews/contract";
import { Button } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import styles from "@/app/reviews/reviews.module.css";
import { VERDICT_KEY, suggestionDomId } from "@/app/reviews/ReviewCard";

/**
 * The verdict buttons under an open review (R-11 Task 6.5). One panel for both
 * roles: a supervisor decides an `awaiting_supervisor` review, the owner an
 * `awaiting_owner` one. This is a UI mirror only; the verdict route re-derives
 * every rule (role, order, deadline) and its answer decides what is reported.
 *
 * Nothing posts on the first tap: a verdict goes through an inline confirm
 * region (never a modal) with an optional reason (3..300 characters when
 * given; the server redacts it before storing). Every control is disabled
 * while a request is in flight, and a ref guard turns a second tap into a
 * no-op, so a double tap sends one request.
 *
 * "settled" holds until a fresh `review` arrives: the server answered, so no
 * action shows while the list reloads. Every fetch yields new review objects,
 * so a review that is still open after the answer (conflict, unchanged) gets
 * its buttons back, clean; one that left the open list simply unmounts.
 *
 * Every read/write goes through `authedPostJson` (hard rule #6).
 */

type Step = "idle" | "confirm" | "settled";

// Button order is a UI choice (worked, then revise and revert on one row) and must not shift if the schema enum is ever reordered.

const REASON_MIN = 3;
const REASON_MAX = 300;

// Exhaustive on purpose: a new server conflict code that is not mapped here fails `tsc`.
const CONFLICT_KEY: Record<ReviewConflictCode, DictKey> = {
  ALREADY_DECIDED: "C-rev-err-decided",
  NOT_YET_REVIEWABLE: "C-rev-err-not-yet",
  EXPIRED: "C-rev-err-expired",
  NOTHING_TO_REVIEW: "C-srv-generic", // a fast-forward code; never answered by the verdict route
};

export function VerdictPanel({
  auth,
  role,
  review,
  lang,
  onSettled,
}: {
  auth: Auth;
  role: "owner" | "supervisor";
  review: ReviewView;
  lang: Lang;
  /** Called after any server answer that changed or may have changed state (ok, conflict). */
  onSettled: (messageKey: DictKey) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<DictKey | null>(null);
  // A fresh `review` (a reload) ends "settled": adjusted during render, the React-recommended way to reset state on a prop change.
  const [seenReview, setSeenReview] = useState(review);
  if (seenReview !== review) {
    setSeenReview(review);
    if (step === "settled") {
      setStep("idle");
      setVerdict(null);
      setReason("");
      setMessage(null);
    }
  }
  const inFlight = useRef(false);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const buttonRefs = useRef<Partial<Record<ReviewVerdict, HTMLButtonElement | null>>>({});
  const returnFocusTo = useRef<ReviewVerdict | null>(null);
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const hintId = `${ids}-hint`;

  const canAct =
    (role === "supervisor" && review.status === "awaiting_supervisor") ||
    (role === "owner" && review.status === "awaiting_owner");

  useEffect(() => {
    if (step === "confirm") {
      confirmRef.current?.focus();
    } else if (returnFocusTo.current !== null) {
      buttonRefs.current[returnFocusTo.current]?.focus();
      returnFocusTo.current = null;
    }
  }, [step]);

  if (!canAct) return null;
  if (step === "settled") return null;

  const trimmed = reason.trim();
  const reasonTooShort = trimmed.length > 0 && trimmed.length < REASON_MIN;

  function toSettled() {
    returnFocusTo.current = null;
    setReason("");
    setMessage(null);
    setStep("settled");
  }

  async function submit() {
    if (verdict === null) return;
    if (inFlight.current) return; // double-tap guard: ignore once already in flight
    inFlight.current = true;
    setBusy(true);
    setMessage(null);

    const body = trimmed.length > 0 ? { verdict, reason: trimmed } : { verdict };
    const result = await authedPostJson(
      auth,
      `/api/v1/reviews/${review.version}/verdict`,
      body,
      VerdictResponseSchema,
    );
    inFlight.current = false;
    setBusy(false);

    if (result.kind === "ok") {
      toSettled();
      onSettled(result.data.result === "recorded" ? "C-rev-done" : "C-rev-done-unchanged");
      return;
    }
    if (result.kind === "conflict") {
      toSettled();
      onSettled(
        Object.hasOwn(CONFLICT_KEY, result.code)
          ? CONFLICT_KEY[result.code as ReviewConflictCode]
          : "C-srv-generic",
      );
      return;
    }
    if (result.kind === "invalid") {
      setMessage("C-rev-err-length"); // stay in confirm; the reason is kept
      return;
    }
    if (result.kind === "forbidden") {
      setMessage("C-rev-err-forbidden");
      return;
    }
    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    // "error": stay in the confirm step, so Yes retries.
    setMessage("C-srv-generic");
  }

  function pick(v: ReviewVerdict) {
    setMessage(null);
    setVerdict(v);
    setStep("confirm");
  }

  /** One verdict button. `worked` is the lead (primary, 56 px); the others are quieter. Same handler for all. */
  function verdictButton(v: ReviewVerdict) {
    return (
      <Button
        key={v}
        ref={(el) => {
          buttonRefs.current[v] = el;
        }}
        variant={v === "worked" ? "primary" : "secondary"}
        size={v === "worked" ? "lg" : "md"}
        block={v === "worked"}
        disabled={busy}
        aria-describedby={review.suggestion.verdict === v ? suggestionDomId(review.version) : undefined}
        onClick={() => pick(v)}
      >
        {t(lang, VERDICT_KEY[v])}
      </Button>
    );
  }

  return (
    <div className={styles.verdicts}>
      {step === "idle" && (
        <>
          {verdictButton("worked")}
          <div className={styles.row}>
            {verdictButton("revise")}
            {verdictButton("revert")}
          </div>
        </>
      )}

      {step === "confirm" && verdict !== null && (
        <div className={styles.confirm} role="group" aria-label={t(lang, "C-rev-confirm", { verdict: t(lang, VERDICT_KEY[verdict]) })}>
          <p ref={confirmRef} tabIndex={-1} className={styles.confirmQ}>
            {t(lang, "C-rev-confirm", { verdict: t(lang, VERDICT_KEY[verdict]) })}
          </p>
          <label className={styles.label} htmlFor={reasonId}>
            {t(lang, "C-rev-reason-label")}
          </label>
          <textarea
            id={reasonId}
            className={cx("b6-field", styles.textarea)}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            disabled={busy}
            aria-describedby={hintId}
            aria-invalid={reasonTooShort || message === "C-rev-err-length" ? true : undefined}
            onChange={(event) => setReason(event.target.value)}
          />
          <p id={hintId} className={styles.hint}>
            {t(lang, "C-rev-reason-hint")}
          </p>
          <div className={styles.row}>
            <Button disabled={busy || reasonTooShort} onClick={() => void submit()}>
              {t(lang, "C-rev-yes")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                returnFocusTo.current = verdict;
                setReason("");
                setMessage(null);
                setStep("idle");
              }}
            >
              {t(lang, "C-rev-no")}
            </Button>
          </div>
        </div>
      )}

      {message !== null && (
        <p role="alert" className={cx("b6-alert", "b6-alert--red", styles.message)}>
          {t(lang, message)}
        </p>
      )}
    </div>
  );
}
