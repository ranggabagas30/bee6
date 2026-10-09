"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { WorkCategorySchema, type WorkCategory } from "@/lib/pipeline/categories";
import { ConfirmResponseSchema, type SupervisorThread } from "@/lib/day/contract";
import { CATEGORY_KEY } from "@/lib/day/view-model";

/**
 * Supervisor confirm / change-category / reject controls (R-06 Task 10.7;
 * reject added in Task 15, v4). Rendered by `ThreadCard` only when
 * `thread.can_review && thread.handle !== null` — this component never
 * decides eligibility itself, it only acts on a row the server already
 * said is reviewable.
 *
 * Only one inline panel (change-category or the reject confirm) is open at
 * a time; both share the busy/message state with the plain Confirm button
 * so a double tap while a request is in flight can only ever send one
 * request. Reject needs its own confirm step (Task 15.6, "Yes, reject")
 * to guard against a mis-tap — there is no undo button for either action:
 * a mistaken decision is fixed with Change category or the opposite action.
 */

const BUTTON_ROW_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 };
const ACTION_BUTTON_STYLE: CSSProperties = { minHeight: 48, padding: "0 16px", fontSize: 16 };
const PANEL_STYLE: CSSProperties = { marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const SELECT_STYLE: CSSProperties = { minHeight: 48, fontSize: 16, padding: "0 8px" };
const LABEL_STYLE: CSSProperties = { fontSize: 16 };
const STATUS_STYLE: CSSProperties = { margin: "8px 0 0 0" };

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
  const [selected, setSelected] = useState<WorkCategory>(thread.category);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messageKey, setMessageKey] = useState<DictKey | null>(null);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const rejectYesRef = useRef<HTMLButtonElement>(null);

  const busy = phase !== "idle";
  const isFactStatus =
    thread.display_status === "fact" ||
    thread.display_status === "fact_staff_confirmed" ||
    thread.display_status === "fact_supervisor_confirmed";
  const showConfirm = !isFactStatus;
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
      setPhase("idle");
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
    setSelected(thread.category);
    setPanel("change");
    setMessageKey(null);
  }

  function handleCancelChange() {
    setPanel("none");
  }

  function handleSaveTap() {
    if (busy || selected === thread.category) return;
    setPhase("busy-save");
    void post({ action: "override", category: selected });
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
      <div style={BUTTON_ROW_STYLE}>
        {showConfirm && (
          <button type="button" style={ACTION_BUTTON_STYLE} disabled={busy} onClick={handleConfirmTap}>
            {phase === "busy-confirm" ? t(lang, "C-act-busy") : t(lang, "C-act-confirm")}
          </button>
        )}
        <button type="button" style={ACTION_BUTTON_STYLE} disabled={busy} onClick={handleChangeTap}>
          {t(lang, "C-act-change")}
        </button>
        {showReject && (
          <button
            ref={rejectButtonRef}
            type="button"
            style={ACTION_BUTTON_STYLE}
            disabled={busy}
            onClick={handleRejectTap}
          >
            {t(lang, "C-act-reject")}
          </button>
        )}
      </div>

      {panel === "change" && (
        <div style={PANEL_STYLE}>
          <label style={LABEL_STYLE}>
            {t(lang, "C-act-select")}{" "}
            <select
              style={SELECT_STYLE}
              disabled={busy}
              value={selected}
              onChange={(e) => setSelected(e.target.value as WorkCategory)}
            >
              {WorkCategorySchema.options.map((category) => (
                <option key={category} value={category}>
                  {t(lang, CATEGORY_KEY[category])}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={ACTION_BUTTON_STYLE}
            disabled={busy || selected === thread.category}
            onClick={handleSaveTap}
          >
            {phase === "busy-save" ? t(lang, "C-act-busy") : t(lang, "C-act-save")}
          </button>
          <button type="button" style={ACTION_BUTTON_STYLE} disabled={busy} onClick={handleCancelChange}>
            {t(lang, "C-act-cancel")}
          </button>
        </div>
      )}

      {panel === "reject" && (
        <div style={PANEL_STYLE}>
          <p style={{ margin: 0, flexBasis: "100%" }}>{t(lang, "C-act-reject-q")}</p>
          <button
            ref={rejectYesRef}
            type="button"
            style={ACTION_BUTTON_STYLE}
            disabled={busy}
            onClick={handleRejectYesTap}
          >
            {phase === "busy-reject" ? t(lang, "C-act-busy") : t(lang, "C-act-reject-yes")}
          </button>
          <button type="button" style={ACTION_BUTTON_STYLE} disabled={busy} onClick={handleCancelReject}>
            {t(lang, "C-act-cancel")}
          </button>
        </div>
      )}

      {messageKey && (
        <p role="status" aria-live="polite" style={STATUS_STYLE}>
          {t(lang, messageKey)}
        </p>
      )}
    </div>
  );
}
