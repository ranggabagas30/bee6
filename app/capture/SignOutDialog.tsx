"use client";

import { useId, type KeyboardEvent } from "react";
import { Button, Card } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-19 PR-4b (plan 5.7; boards P2-07a / P2-07b, L2-06a / L2-06b): the demo staff sign-out confirmation.
 * Presentation only: the page decides which kind to show and runs the actions.
 * - `running`: before closing. Signing out CANCELS today (the page calls the existing discard route first).
 * - `closed`: after closing. Today can no longer be cancelled; the server session stays open and nothing is deleted.
 * The safe choice has focus; Escape dismisses unless a request is in flight. Sandbox only (the pilot never mounts it).
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
  const copy = COPY[kind];

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !busy) onDismiss();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(17, 24, 39, 0.45)",
      }}
    >
      <Card
        as="section"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        style={{ width: "100%", maxWidth: 328, maxHeight: "calc(100dvh - 32px)", overflowY: "auto", padding: 20 }}
      >
        <h2 id={titleId} style={{ fontSize: 20, margin: "0 0 8px" }}>
          {t(lang, copy.title)}
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.45 }}>{t(lang, copy.body)}</p>
        {finishing ? (
          <p role="status" style={{ margin: "0 0 12px", fontSize: 14 }}>
            {t(lang, "C-sess-signout-finishing")}
          </p>
        ) : null}
        {errorKey ? (
          <p role="alert" style={{ margin: "0 0 12px", fontSize: 14, color: "#b00020" }}>
            {t(lang, errorKey)}
          </p>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Button variant="primary" size="lg" block autoFocus onClick={onDismiss} disabled={busy}>
            {t(lang, copy.dismiss)}
          </Button>
          <Button variant={kind === "running" ? "destructive" : "secondary"} block onClick={onConfirm} disabled={busy}>
            {t(lang, copy.confirm)}
          </Button>
        </div>
      </Card>
    </div>
  );
}
