"use client";

import { useEffect, useRef, useState } from "react";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { WorkCategorySchema, type WorkCategory } from "@/lib/pipeline/categories";
import { ConfirmResponseSchema, type SupervisorThread } from "@/lib/day/contract";
import { Button } from "@/app/ui";
import { ChangeLabelDialog } from "@/app/day/ChangeLabelDialog";
import { isFactStatus } from "@/app/day/summary";
import styles from "@/app/day/day.module.css";

/**
 * Supervisor confirm / change-category / reject controls (R-06 Task 10.7;
 * reject added in Task 15, v4). Rendered by `ThreadCard` only when
 * `thread.can_review && thread.handle !== null` — this component never
 * decides eligibility itself, it only acts on a row the server already
 * said is reviewable.
 *
 * Only one panel (the change-label dialog or the reject confirm) is open at
 * a time; both share the busy/message state with the plain Confirm button
 * so a double tap while a request is in flight can only ever send one
 * request. Reject needs its own confirm step (Task 15.6, "Yes, reject")
 * to guard against a mis-tap — there is no undo button for either action:
 * a mistaken decision is fixed with Change category or the opposite action.
 *
 * R-19 PR-12a (plan 9.5, board D2-02b): "Change label" opens
 * `ChangeLabelDialog` (a radio list of the work categories) instead of the
 * inline select; Save sends the same `override` action. A failed save
 * (GATE_BLOCKED, generic) shows inside the dialog, which stays open; a
 * stale 409 closes it and shows the stale line under the row instead.
 */

type Phase = "idle" | "busy-confirm" | "busy-save" | "busy-reject";
type Panel = "none" | "change" | "reject";

export function ThreadActions({
  thread,
  auth,
  onDone,
}: {
  thread: SupervisorThread;
  auth: Auth;
  onDone: () => void;
}) {
  const { lang } = useLang();
  const [panel, setPanel] = useState<Panel>("none");
  const [phase, setPhase] = useState<Phase>("idle");
  const [messageKey, setMessageKey] = useState<DictKey | null>(null);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const rejectYesRef = useRef<HTMLButtonElement>(null);

  const busy = phase !== "idle";
  const showConfirm = !isFactStatus(thread.display_status);
  const showReject = thread.display_status !== "rejected_by_supervisor";

  // Focus moves to "Yes, reject" when the reject panel opens (Task 15.6).
  useEffect(() => {
    if (panel === "reject") rejectYesRef.current?.focus();
  }, [panel]);

  async function post(body: { action: "confirm" } | { action: "override"; category: WorkCategory } | { action: "reject" }) {
    const result = await authedPostJson(
      auth,
      `/api/v1/threads/${encodeURIComponent(thread.handle!)}/confirm`,
      body,
      ConfirmResponseSchema,
    );

    if (result.kind === "ok") {
      setPhase("idle");
      setPanel("none");
      setMessageKey(null);
      onDone();
      return;
    }
    if (result.kind === "conflict" && result.code === "GATE_BLOCKED") {
      // Can only happen for confirm/override; a reject never gate-blocks.
      setPhase("idle");
      setMessageKey("C-act-blocked");
      return;
    }
    if (result.kind === "conflict") {
      // The row is stale: close any open panel so the stale line shows under the row (not inside a dialog
      // that would otherwise stay open over the reloaded day), then reload.
      setPhase("idle");
      setPanel("none");
      setMessageKey("C-act-stale");
      onDone();
      return;
    }
    if (result.kind === "signed_out") {
      // This "signed_out" result comes from a 401 after a forced token
      // refresh (e.g. claims revoked / account disabled) — Firebase's own
      // auth state has not actually changed yet, so DayRecordApp's
      // auth-state effect would never fire on its own. Force it to change
      // (same pattern as DayRecordApp.tsx's fetch-effect handling) so that
      // effect then correctly redirects to /sign-in, instead of leaving the
      // user stuck on a dead button.
      await signOut(auth);
      setPhase("idle");
      return;
    }
    if (result.kind === "forbidden") {
      setPhase("idle");
      setMessageKey("C-day-forbidden");
      return;
    }
    setPhase("idle");
    setMessageKey("C-srv-generic");
  }

  function handleConfirmTap() {
    if (busy) return;
    setPhase("busy-confirm");
    setMessageKey(null);
    void post({ action: "confirm" });
  }

  function handleChangeTap() {
    if (busy) return;
    setPanel("change");
    setMessageKey(null);
  }

  function handleCancelChange() {
    setPanel("none");
    setMessageKey(null);
  }

  function handleSaveLabel(category: WorkCategory) {
    if (busy || category === thread.category) return;
    setPhase("busy-save");
    void post({ action: "override", category });
  }

  function handleRejectTap() {
    if (busy) return;
    setPanel("reject");
    setMessageKey(null);
  }

  function handleCancelReject() {
    setPanel("none");
    rejectButtonRef.current?.focus();
  }

  function handleRejectYesTap() {
    if (busy) return;
    setPhase("busy-reject");
    void post({ action: "reject" });
  }

  return (
    <div>
      <div className={styles.buttons}>
        {showConfirm && (
          <Button variant="primary" disabled={busy} onClick={handleConfirmTap}>
            {phase === "busy-confirm" ? t(lang, "C-act-busy") : t(lang, "C-act-confirm")}
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={handleChangeTap}>
          {t(lang, "C-lbl-title")}
        </Button>
        {showReject && (
          <Button ref={rejectButtonRef} variant="secondary" disabled={busy} onClick={handleRejectTap}>
            {t(lang, "C-act-reject")}
          </Button>
        )}
      </div>

      {panel === "change" && (
        <ChangeLabelDialog
          lang={lang}
          current={thread.category}
          runnerUp={thread.runner_up && WorkCategorySchema.safeParse(thread.runner_up.category).success ? (thread.runner_up.category as WorkCategory) : null}
          summary={thread.summary}
          confidencePct={thread.confidence_pct}
          busy={phase === "busy-save"}
          errorKey={messageKey}
          onSave={handleSaveLabel}
          onCancel={handleCancelChange}
        />
      )}

      {panel === "reject" && (
        <div className={styles.reject}>
          <p>{t(lang, "C-act-reject-q")}</p>
          <Button ref={rejectYesRef} variant="destructive" disabled={busy} onClick={handleRejectYesTap}>
            {phase === "busy-reject" ? t(lang, "C-act-busy") : t(lang, "C-act-reject-yes")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={handleCancelReject}>
            {t(lang, "C-act-cancel")}
          </Button>
        </div>
      )}

      {messageKey && panel !== "change" && (
        <p role="status" aria-live="polite" className={styles.status}>
          {t(lang, messageKey)}
        </p>
      )}
    </div>
  );
}
