"use client";

import { useEffect, useId, useRef, useState } from "react";
import css from "@/app/capture/capture.module.css";
import { cx } from "@/app/ui/cx";
import { Emphasis } from "@/app/capture/emphasis";
import { Button, DialogSheet } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-19 PR-4b (plan 5.7; boards P2-07a / P2-07b, L2-06a / L2-06b): the demo staff sign-out confirmation.
 * Presentation only: the page decides which kind to show and runs the actions.
 * - `running`: before closing. Signing out CANCELS today (the page calls the existing discard route first).
 * - `closed`: after closing. Today can no longer be cancelled; the server session stays open and nothing is deleted.
 * The safe choice has focus; Escape dismisses unless a request is in flight. Sandbox only (the pilot never mounts it).
 *
 * Modal for real (WCAG 2.4.3 / 2.1.2): Tab and Shift+Tab cycle inside the dialog and never reach the page behind,
 * Escape works wherever focus is while the dialog is open, and focus goes back to whatever opened it (the footer
 * Sign out link) when it unmounts.
 */
export type SignOutKind = "running" | "closed";

const COPY: Record<SignOutKind, { title: DictKey; body: DictKey; dismiss: DictKey; confirm: DictKey }> = {
  running: {
    title: "C-sess-signout-running-h",
    body: "C-sess-signout-running-b",
    dismiss: "C-sess-signout-keep",
    confirm: "C-sess-signout-cancel",
  },
  closed: {
    title: "C-sess-signout-closed-h",
    body: "C-sess-signout-closed-b",
    dismiss: "C-sess-signout-stay",
    confirm: "C-sess-signout-anyway",
  },
};

const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

export interface SignOutDialogProps {
  kind: SignOutKind;
  lang: Lang;
  /** A request (discard, or the upload drain) is in flight: both buttons are disabled. */
  busy: boolean;
  /** The in-memory upload queue is draining ("Finishing uploads…"). */
  finishing: boolean;
  /** The page's own copy key for a failed cancel; never server text. */
  errorKey: DictKey | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function SignOutDialog({ kind, lang, busy, finishing, errorKey, onConfirm, onDismiss }: SignOutDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const copy = COPY[kind];
  // The kind this dialog opened with: a later change (a 409 closing_reached turns running into closed) is announced.
  const [openedKind] = useState(kind);
  const rootRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  // Latest callbacks/flags for the document listener, so the listener is bound once per mount.
  const latest = useRef({ busy, onDismiss });
  useEffect(() => {
    latest.current = { busy, onDismiss };
  });

  // Initial focus on the safe choice, and focus return: remember what had focus when the dialog opened (the
  // top-bar Sign out button) and give it back on unmount. The opener is read before the dismiss button takes
  // focus, which is why this is an effect rather than `autoFocus` (that fires earlier, in the commit).
  useEffect(() => {
    const opener = document.activeElement;
    dismissRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // After an async outcome the buttons come back from `disabled` (a disabled button drops focus to <body>) or the
  // dialog swaps its content: put focus back on the safe choice so a keyboard / screen-reader user is not left
  // outside the dialog.
  useEffect(() => {
    if (!busy) dismissRef.current?.focus();
  }, [busy, kind]);

  // Escape anywhere + focus trap. On the document so it holds even when focus is on <body> (a disabled button
  // drops focus) or outside the dialog.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.key === "Escape") {
        if (!latest.current.busy) {
          e.preventDefault();
          latest.current.onDismiss();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
      const active = document.activeElement;
      if (focusables.length === 0) {
        // Both buttons disabled (busy): park focus on the dialog's content box (tabIndex -1) so Tab cannot leave it.
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const inside = active instanceof HTMLElement && root.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <DialogSheet labelledBy={titleId} describedBy={bodyId}>
      <div ref={rootRef} tabIndex={-1} className={css.dfocus}>
        <h2 id={titleId} className="b6-dsheet__title">
          {t(lang, copy.title)}
        </h2>
        <p id={bodyId} className={cx("b6-dsheet__body", css.dbody)}>
          <Emphasis text={t(lang, copy.body)} />
        </p>
        {/* Polite live region: always mounted, filled only when the kind switched after open (running -> closed),
            so the new title and body are read out. */}
        <div aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN}>
          {kind !== openedKind ? `${t(lang, copy.title)}. ${t(lang, copy.body).replaceAll("**", "")}` : ""}
        </div>
        {finishing ? (
          <p role="status" className="b6-note">
            {t(lang, "C-sess-signout-finishing")}
          </p>
        ) : null}
        {errorKey ? (
          <p role="alert" className="b6-alert b6-alert--red">
            {t(lang, errorKey)}
          </p>
        ) : null}
        <Button ref={dismissRef} variant="primary" size="lg" block onClick={onDismiss} disabled={busy}>
          {t(lang, copy.dismiss)}
        </Button>
        <Button
          variant={kind === "running" ? "destructive" : "secondary"}
          block
          className={css.dsecond}
          onClick={onConfirm}
          disabled={busy}
        >
          {t(lang, copy.confirm)}
        </Button>
      </div>
    </DialogSheet>
  );
}
