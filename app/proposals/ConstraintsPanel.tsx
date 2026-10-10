"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson, authedPostJson } from "@/lib/auth/client/api";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import {
  CONSTRAINT_INPUT_MIN,
  CreateConstraintResponseSchema,
  ListConstraintsResponseSchema,
  type ConstraintView,
} from "@/lib/constraints/contract";

/**
 * Manual constraints panel (R-08 Task 8.7; web spec §6.6). Mounted by
 * `ProposalsApp` below the Generate panel and result card, for owner AND
 * supervisor (Q-11 b). Every read/write goes through the API — never
 * Firestore, never the server-side constraint service directly (hard
 * rule #6; see `app/proposals/import-boundaries.test.ts`).
 *
 * Submit never posts directly: a two-step confirm (textarea -> inline
 * confirm region, never a modal) stands between a tap on "Add constraint"
 * and the actual `POST`, so a single accidental submit can never write a
 * permanent constraint (E33's "double tap" half is handled by disabling
 * every control while the POST is in flight).
 */

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; constraints: ConstraintView[] }
  | { kind: "error" };

type FormState =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "busy" }
  | { kind: "added" }
  | { kind: "duplicate" }
  | { kind: "err-length" }
  | { kind: "err-limit" }
  | { kind: "error" };

const SECTION_STYLE: CSSProperties = { marginTop: 24, overflowWrap: "anywhere" };
const LIST_STYLE: CSSProperties = { paddingLeft: 20, margin: "8px 0 16px 0", overflowWrap: "anywhere" };
const ITEM_TEXT_STYLE: CSSProperties = { overflowWrap: "anywhere" };
const ITEM_META_STYLE: CSSProperties = { color: "#6b7280", fontSize: 14, overflowWrap: "anywhere" };
const LABEL_STYLE: CSSProperties = { display: "block", fontSize: 16, marginBottom: 4 };
const TEXTAREA_STYLE: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
  fontSize: 16,
  padding: 8,
};
const COUNTER_STYLE: CSSProperties = { fontSize: 14, color: "#6b7280", margin: "4px 0 8px 0" };
const BUTTON_STYLE: CSSProperties = { minHeight: 48, width: "100%", fontSize: 16, padding: "0 16px", boxSizing: "border-box" };
const CONFIRM_ROW_STYLE: CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
const CONFIRM_BUTTON_STYLE: CSSProperties = { minHeight: 48, flex: 1, fontSize: 16, padding: "0 16px", boxSizing: "border-box" };
const STATUS_STYLE: CSSProperties = { margin: "8px 0", overflowWrap: "anywhere" };

/** The browser's own local date for a server epoch-ms timestamp — a display
 * nuance only (same idiom as `ProposalsApp`'s `todayLocalDate`), never a
 * security or business-logic boundary. */
function localDateFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const RESULT_KEY: Record<"added" | "duplicate" | "err-length" | "err-limit" | "error", DictKey> = {
  added: "C-con-added",
  duplicate: "C-con-duplicate",
  "err-length": "C-con-err-length",
  "err-limit": "C-con-err-limit",
  error: "C-srv-generic",
};

export function ConstraintsPanel({ auth, role, lang }: { auth: Auth; role: "owner" | "supervisor"; lang: Lang }) {
  const router = useRouter();
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [text, setText] = useState("");
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    void authedGetJson(auth, "/api/v1/constraints", ListConstraintsResponseSchema).then((result) => {
      if (!active) return;
      if (result.kind === "ok") {
        setListState({ kind: "ready", constraints: result.data.constraints });
      } else {
        setListState({ kind: "error" });
      }
    });
    return () => {
      active = false;
    };
    // Runs once on mount; `auth` is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (formState.kind === "confirm") {
      confirmRef.current?.focus();
    } else if (formState.kind === "idle") {
      // Focus the textarea when returning to idle state (e.g., after cancel).
      // Set a microtask to ensure the textarea is enabled before focusing.
      queueMicrotask(() => textareaRef.current?.focus());
    }
  }, [formState.kind]);

  const trimmed = text.trim();
  const canSubmit = trimmed.length >= CONSTRAINT_INPUT_MIN;
  const busy = formState.kind === "busy";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setFormState({ kind: "confirm" });
  }

  function handleCancel() {
    setFormState({ kind: "idle" });
    // Focus is handled by the useEffect above when formState changes to "idle".
  }

  async function handleConfirmYes() {
    if (busy) return; // double-click guard: ignore once already in flight
    setFormState({ kind: "busy" });
    const result = await authedPostJson(auth, "/api/v1/constraints", { text: trimmed }, CreateConstraintResponseSchema);

    if (result.kind === "ok") {
      if (result.data.duplicate) {
        setFormState({ kind: "duplicate" });
        return;
      }
      setListState((prev) =>
        prev.kind === "ready"
          ? { kind: "ready", constraints: [...prev.constraints, result.data.constraint] }
          : { kind: "ready", constraints: [result.data.constraint] },
      );
      setText("");
      setFormState({ kind: "added" });
      return;
    }
    if (result.kind === "invalid") {
      setFormState({ kind: "err-length" });
      return;
    }
    if (result.kind === "conflict") {
      setFormState({ kind: "err-limit" });
      return;
    }
    if (result.kind === "signed_out") {
      router.replace("/sign-in");
      return;
    }
    // Anything else, including a 403 a real owner/supervisor cannot get.
    setFormState({ kind: "error" });
  }

  if (listState.kind === "loading") return null;

  if (listState.kind === "error") {
    return (
      <section style={SECTION_STYLE}>
        <p role="status" aria-live="polite" style={STATUS_STYLE}>
          {t(lang, "C-srv-generic")}
        </p>
      </section>
    );
  }

  const resultMessage: string | null =
    formState.kind === "added" ||
    formState.kind === "duplicate" ||
    formState.kind === "err-length" ||
    formState.kind === "err-limit" ||
    formState.kind === "error"
      ? t(lang, RESULT_KEY[formState.kind])
      : null;

  return (
    <section style={SECTION_STYLE}>
      <h2>{t(lang, "C-con-title")}</h2>
      <p>{t(lang, "C-con-help")}</p>

      {listState.constraints.length === 0 ? (
        <p>{t(lang, "C-con-empty")}</p>
      ) : (
        <ul style={LIST_STYLE}>
          {listState.constraints.map((c) => (
            <li key={c.constraint_id}>
              <p style={ITEM_TEXT_STYLE}>{c.text}</p>
              <p style={ITEM_META_STYLE}>
                {t(lang, c.source === "manual" ? "C-con-src-manual" : "C-con-src-rejection")} ·{" "}
                {dayLabel(localDateFromMs(c.created_at_ms), lang)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {(role === "owner" || role === "supervisor") && (
        <form onSubmit={handleSubmit} noValidate>
          <label style={LABEL_STYLE} htmlFor="con-add-text">
            {t(lang, "C-con-add-label")}
          </label>
          <textarea
            id="con-add-text"
            ref={textareaRef}
            value={text}
            maxLength={300}
            rows={3}
            disabled={busy || formState.kind === "confirm"}
            aria-describedby="con-add-hint con-add-count"
            onChange={(event) => setText(event.target.value)}
            style={TEXTAREA_STYLE}
          />
          <p id="con-add-hint" style={COUNTER_STYLE}>
            {t(lang, "C-con-add-hint")}
          </p>
          <p id="con-add-count" style={COUNTER_STYLE}>
            {t(lang, "C-con-count", { n: text.length })}
          </p>
          <button type="submit" disabled={!canSubmit || busy} style={BUTTON_STYLE}>
            {t(lang, "C-con-add")}
          </button>

          {formState.kind === "confirm" || busy ? (
            <div role="alertdialog" aria-label={t(lang, "C-con-confirm")}>
              <p ref={confirmRef} tabIndex={-1}>
                {t(lang, "C-con-confirm")}
              </p>
              <div style={CONFIRM_ROW_STYLE}>
                <button type="button" disabled={busy} onClick={() => void handleConfirmYes()} style={CONFIRM_BUTTON_STYLE}>
                  {t(lang, "C-con-confirm-yes")}
                </button>
                <button type="button" disabled={busy} onClick={handleCancel} style={CONFIRM_BUTTON_STYLE}>
                  {t(lang, "C-con-confirm-no")}
                </button>
              </div>
            </div>
          ) : null}

          {resultMessage !== null && (
            <p role="status" aria-live="polite" style={STATUS_STYLE}>
              {resultMessage}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
