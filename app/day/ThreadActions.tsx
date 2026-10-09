"use client";

import { useState, type CSSProperties } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { WorkCategorySchema, type WorkCategory } from "@/lib/pipeline/categories";
import { ConfirmResponseSchema, type SupervisorThread } from "@/lib/day/contract";
import { CATEGORY_KEY } from "@/lib/day/view-model";

/**
 * Supervisor confirm / change-category controls (R-06 Task 10.7). Rendered
 * by `ThreadCard` only when `thread.can_review && thread.handle !== null` —
 * this component never decides eligibility itself, it only acts on a row
 * the server already said is reviewable.
 *
 * Only one inline panel (the category picker) is open at a time; the panel
 * shares the busy/message state with the plain Confirm button so a double
 * tap while a request is in flight can only ever send one request.
 */

const BUTTON_ROW_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 };
const ACTION_BUTTON_STYLE: CSSProperties = { minHeight: 48, padding: "0 16px", fontSize: 16 };
const PANEL_STYLE: CSSProperties = { marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const SELECT_STYLE: CSSProperties = { minHeight: 48, fontSize: 16, padding: "0 8px" };
const LABEL_STYLE: CSSProperties = { fontSize: 16 };
const STATUS_STYLE: CSSProperties = { margin: "8px 0 0 0" };

type Phase = "idle" | "busy-confirm" | "busy-save";

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
  const [changeOpen, setChangeOpen] = useState(false);
  const [selected, setSelected] = useState<WorkCategory>(thread.category);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messageKey, setMessageKey] = useState<DictKey | null>(null);

  const busy = phase !== "idle";
  const showConfirm = thread.display_status !== "fact" &&
    thread.display_status !== "fact_staff_confirmed" &&
    thread.display_status !== "fact_supervisor_confirmed";

  async function post(body: { action: "confirm" } | { action: "override"; category: WorkCategory }) {
    const result = await authedPostJson(
      auth,
      `/api/v1/threads/${encodeURIComponent(thread.handle!)}/confirm`,
      body,
      ConfirmResponseSchema,
    );

    if (result.kind === "ok") {
      setPhase("idle");
      setChangeOpen(false);
      setMessageKey(null);
      onDone();
      return;
    }
    if (result.kind === "conflict" && result.code === "GATE_BLOCKED") {
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
      // Same handling as the day fetch: DayRecordApp's own effect reacts
      // to the signed-out auth state and redirects; nothing further here.
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
    setChangeOpen(true);
    setMessageKey(null);
  }

  function handleCancelChange() {
    setChangeOpen(false);
  }

  function handleSaveTap() {
    if (busy || selected === thread.category) return;
    setPhase("busy-save");
    void post({ action: "override", category: selected });
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
      </div>

      {changeOpen && (
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

      {messageKey && (
        <p role="status" aria-live="polite" style={STATUS_STYLE}>
          {t(lang, messageKey)}
        </p>
      )}
    </div>
  );
}
