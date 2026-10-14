"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/app/ui";
import { authedPostJson } from "@/lib/auth/client/api";
import { getExistingClientAuth, type Auth, type User } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { DemoResetResponseSchema } from "@/lib/demo/contract";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-19 PR-7 (plan 8.4; board D2-07b): the owner's "Reset the demo" control, DEMO ONLY.
 *
 * Owner-only by itself: it renders nothing unless the signed-in user's ID-token claims say `role: "owner"` AND carry
 * `demo_exp_ms` (only a demo sandbox principal has it), so mounting it anywhere is safe. This is navigation only; the
 * server (POST /api/v1/demo/reset) still checks the role, the sandbox and the outlet from the verified claims.
 *
 * Wiring (PR-5's guide registers it; this file does not touch the guide): `GUIDE_CONTROLS.reset_demo = ResetDemoButton`
 * in app/demo/guide-controls.tsx. The card passes only `{ lang }`: the Firebase app is the one the page already
 * initialised (`getExistingClientAuth`), so no config is needed here. `ResetNotice` is the other half: mount it on the
 * owner Home so "Demo reset to day 1" is shown after the reload this control triggers (`/home?demo_reset=1`).
 *
 * Copy is only ever the plan's own text keyed by outcome: a server message is never shown. No id, key or token is
 * read, stored or logged here.
 */

type FailKey = Extract<DictKey, "C-home-reset-failed" | "C-home-reset-busy">;

const HOME_AFTER_RESET = "/home?demo_reset=1";
const NOTICE_PARAM = "demo_reset";

const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

// 360 px: the overlay pads itself, the panel is at most the overlay's width, buttons wrap and are at least 44 px tall.
const OVERLAY = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  boxSizing: "border-box",
  background: "rgba(43, 42, 38, 0.45)",
} as const;
const PANEL = {
  width: "min(100%, 420px)",
  maxWidth: "100%",
  maxHeight: "100%",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: 20,
  borderRadius: 18,
  background: "var(--b6-surface, #fff)",
  color: "var(--b6-ink, #2b2a26)",
  boxShadow: "0 12px 28px -14px rgba(43, 42, 38, 0.35)",
} as const;
const ACTIONS = { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 } as const;
const BTN = { minHeight: 44, flex: "1 1 120px" } as const;

/** True while the signed-in user is the owner of a demo sandbox (claims only; navigation, never authority). */
function useIsDemoOwner(): { auth: Auth | null; owner: boolean } {
  const auth = getExistingClientAuth();
  const authUser = useAuthUser(auth);
  const user = authUser.status === "signed_in" ? authUser.user : null;
  // The verdict is kept with the user it was read for, so a different user never inherits it.
  const [owner, setOwner] = useState<{ user: User; ok: boolean } | null>(null);
  useEffect(() => {
    if (!user) return;
    let active = true;
    user
      .getIdTokenResult()
      .then(({ claims }) => {
        if (active) setOwner({ user, ok: claims.role === "owner" && typeof claims.demo_exp_ms === "number" });
      })
      .catch(() => {
        if (active) setOwner({ user, ok: false });
      });
    return () => {
      active = false;
    };
  }, [user]);
  return { auth, owner: user !== null && owner !== null && owner.user === user && owner.ok };
}

export interface ResetDemoButtonProps {
  lang: Lang;
  /** Where to go after a reset; tests inject it. Default: a full page load, so every screen and the guide read the fresh sandbox. */
  navigate?: (url: string) => void;
}

export function ResetDemoButton({ lang, navigate = (url) => window.location.assign(url) }: ResetDemoButtonProps) {
  const { auth, owner } = useIsDemoOwner();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailKey | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const flight = useRef(false);

  async function confirm() {
    if (flight.current || !auth) return;
    flight.current = true;
    setBusy(true);
    setFailure(null);
    let next: FailKey | null = "C-home-reset-failed";
    try {
      const result = await authedPostJson(auth, "/api/v1/demo/reset", { confirm: "reset" }, DemoResetResponseSchema);
      if (result.kind === "ok") next = null;
      else if (result.kind === "conflict" && result.code === "busy") next = "C-home-reset-busy";
    } catch {
      /* the failure line below */
    }
    flight.current = false;
    if (next === null) {
      navigate(HOME_AFTER_RESET); // the page reloads: the busy state stays until it does
      return;
    }
    setFailure(next);
    setBusy(false);
  }

  if (!owner) return null;
  return (
    <div>
      <Button ref={triggerRef} variant="secondary" block onClick={() => setOpen(true)}>
        {t(lang, "C-home-reset-open")}
      </Button>
      {open
        ? createPortal(
            <ResetDialog
              lang={lang}
              busy={busy}
              failure={failure}
              onConfirm={() => void confirm()}
              onDismiss={() => {
                setOpen(false);
                setFailure(null);
                triggerRef.current?.focus();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

interface ResetDialogProps {
  lang: Lang;
  busy: boolean;
  failure: FailKey | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** Modal for real: the safe choice has focus, Tab cycles inside, Escape dismisses unless a request is in flight. */
function ResetDialog({ lang, busy, failure, onConfirm, onDismiss }: ResetDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ busy, onDismiss });
  useEffect(() => {
    latest.current = { busy, onDismiss };
  });

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  // A disabled button drops focus to <body>: when the request ends, put it back on the safe choice.
  useEffect(() => {
    if (!busy) cancelRef.current?.focus();
  }, [busy]);

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
      if (focusables.length === 0) {
        e.preventDefault();
        root.querySelector<HTMLElement>('[role="alertdialog"]')?.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && root.contains(active);
      if (!inside || (e.shiftKey && active === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div ref={rootRef} style={OVERLAY}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} style={PANEL}>
        <h2 id={titleId} style={{ margin: 0, fontSize: 18 }}>
          {t(lang, "C-home-reset-title")}
        </h2>
        <p id={bodyId} style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.45 }}>
          {t(lang, "C-home-reset-body")}
        </p>
        {failure ? (
          <p role="alert" style={{ margin: "12px 0 0", fontSize: 15, color: "var(--b6-red-ink, #8e3526)" }}>
            {t(lang, failure)}
          </p>
        ) : null}
        <div style={ACTIONS}>
          <Button ref={cancelRef} variant="secondary" style={BTN} disabled={busy} onClick={onDismiss}>
            {t(lang, "C-home-reset-cancel")}
          </Button>
          <Button variant="destructive" style={BTN} disabled={busy} onClick={onConfirm}>
            {busy ? t(lang, "C-home-reset-working") : t(lang, "C-home-reset-confirm")}
          </Button>
        </div>
        <span style={VISUALLY_HIDDEN} aria-live="polite">
          {busy ? t(lang, "C-home-reset-working") : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * The owner Home notice after a reset. Reads only the flag the button put in the URL (a plain `1`, no data); renders
 * nothing otherwise and on the server. Once shown it removes the flag from the URL (other params and the hash stay), so
 * a refresh does not announce the reset again. Mount it once on the owner Home (PR-8 / the after-merge wiring).
 */
export function ResetNotice({ lang }: { lang: Lang }) {
  const [flagged, setFlagged] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(NOTICE_PARAM) !== "1") return;
    setFlagged(true);
    url.searchParams.delete(NOTICE_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  if (!flagged) return null;
  return (
    <p
      role="status"
      style={{
        margin: "0 0 12px",
        padding: "10px 14px",
        borderRadius: 12,
        fontSize: 15,
        background: "var(--b6-teal-bg, #eef6f4)",
        color: "var(--b6-teal-ink, #2f6a5d)",
      }}
    >
      {t(lang, "C-home-reset-done")}
    </p>
  );
}
