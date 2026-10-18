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
import { Button } from "@/app/ui";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * Manual constraints panel (R-08 Task 8.7; web spec §6.6). Mounted by
 * `SupervisorProposals` inside the collapsed "Rules for Bee6 (optional)" section at the
 * bottom of the page (R-25 T10, R8; page-2 `.b6-field` / `.b6-btn` look). Every read/write goes through the API — never
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

/** The list item's own wrap rule stays inline (a long unbroken constraint must never push the page wider than 360px). */
const ITEM_TEXT_STYLE: CSSProperties = { overflowWrap: "anywhere" };

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

const SOURCE_KEY: Record<ConstraintView["source"], DictKey> = {
  manual: "C-con-src-manual",
  supervisor_rejection: "C-con-src-rejection",
  owner_rejection: "C-con-src-owner-rejection",
};

export function ConstraintsPanel({
  auth,
  role,
  lang,
  reloadKey = 0,
}: {
  auth: Auth;
  role: "owner" | "supervisor";
  lang: Lang;
  /** Bump to re-fetch the list (a rejection just wrote a constraint). The old list stays on screen meanwhile. */
  reloadKey?: number;
}) {
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
    // Runs on mount and whenever `reloadKey` changes; `auth` is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

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
      <section className={styles.conSection}>
        <p role="status" aria-live="polite" className={styles.conHelp}>
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
    <section className={styles.conSection}>
      <h2 className={styles.conTitle}>{t(lang, "C-con-title")}</h2>
      <p className={styles.conHelp}>{t(lang, "C-con-help")}</p>

      {listState.constraints.length === 0 ? (
        <p className={styles.conHelp}>{t(lang, "C-con-empty")}</p>
      ) : (
        <ul className={styles.conList}>
          {listState.constraints.map((c) => (
            <li key={c.constraint_id}>
              <p className={styles.conItem} style={ITEM_TEXT_STYLE}>
                {c.text}
              </p>
              <p className={styles.conMeta}>
                {t(lang, SOURCE_KEY[c.source])} ·{" "}
                {dayLabel(localDateFromMs(c.created_at_ms), lang)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {(role === "owner" || role === "supervisor") && (
        <form onSubmit={handleSubmit} noValidate className={styles.conForm}>
          <label className={styles.conLabel} htmlFor="con-add-text">
            {t(lang, "C-con-add-label")}
          </label>
          <textarea
            id="con-add-text"
            ref={textareaRef}
            className={`b6-field ${styles.conTextarea}`}
            value={text}
            maxLength={300}
            rows={3}
            disabled={busy || formState.kind === "confirm"}
            aria-describedby="con-add-hint con-add-count"
            onChange={(event) => setText(event.target.value)}
          />
          <p id="con-add-hint" className={styles.conHelp}>
            {t(lang, "C-con-add-hint")}
          </p>
          <p id="con-add-count" className={styles.conHelp}>
            {t(lang, "C-con-count", { n: text.length })}
          </p>
          <Button type="submit" variant="secondary" block disabled={!canSubmit || busy}>
            {t(lang, "C-con-add")}
          </Button>

          {formState.kind === "confirm" || busy ? (
            <div role="alertdialog" aria-label={t(lang, "C-con-confirm")} className={`b6-alert b6-alert--amber ${styles.conConfirm}`}>
              <p ref={confirmRef} tabIndex={-1}>
                {t(lang, "C-con-confirm")}
              </p>
              <div className={styles.conConfirmRow}>
                <Button type="button" variant="primary" disabled={busy} onClick={() => void handleConfirmYes()}>
                  {t(lang, "C-con-confirm-yes")}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={handleCancel}>
                  {t(lang, "C-con-confirm-no")}
                </Button>
              </div>
            </div>
          ) : null}

          {resultMessage !== null && (
            <p role="status" aria-live="polite" className={styles.conHelp}>
              {resultMessage}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
