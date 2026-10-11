"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { DEMO_EMAILS, DEMO_PASSWORD, DEMO_STAFF_CODE, matchDemoCredential } from "@/lib/demo/credentials";
import type { DemoRole } from "@/lib/demo/contract";
import { endDemo, demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { hhmm } from "@/app/demo/DemoBar";
import { refusalLines } from "@/app/demo/demo-errors";
import { authOrNull, useDemoStart } from "@/app/demo/useDemoStart";
import type { DemoAccessProps, DemoFill, DemoPanelHooks } from "@/app/sign-in/panel-hooks";
import { DemoHooksProvider } from "@/app/sign-in/demo-hooks";
import type { SignInRole } from "@/app/sign-in/roles";

/**
 * The demo access box (R-18 P1) of the official sign-in, on demo deployments only. It is reached through a `next/dynamic`
 * import in `RoleSignIn`, so the pilot's pages never load this file or `lib/demo/credentials.ts`.
 *
 * It shows the published credential for the chosen role (a "Fill in" button puts it in the panel's fields without
 * submitting), and hands the panel two intercepts. A typed demo credential (the staff code, or a demo email with the shown
 * password; the credential decides the role, not the panel) starts a demo through `startOrSwitch`: a switch inside this
 * browser's live sandbox, or a fresh private one. Anything else returns `false` and the panel signs in for real (the panels read the intercepts from `DemoHooksProvider`). The
 * server contract is unchanged (POST /api/v1/demo/session); DEMO_MODE, the caps and the 2 h expiry are the boundary.
 */

const BOX_STYLE: CSSProperties = { border: "2px solid currentColor", borderRadius: 8, padding: 12, margin: "0 0 16px 0" };
const TITLE_STYLE: CSSProperties = { margin: "0 0 8px 0", fontWeight: 700 };
const ROW_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const VALUE_STYLE: CSSProperties = { userSelect: "all", fontFamily: "monospace", fontWeight: 700 };
const PARAGRAPH_STYLE: CSSProperties = { margin: "8px 0", overflowWrap: "anywhere", lineHeight: 1.5 };
const BUTTON_STYLE: CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", minHeight: 48, marginBottom: 12, padding: "0 16px", fontSize: 16, cursor: "pointer" };
const STATUS_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere", minHeight: 24 };

/** How long a successful start keeps swallowing repeat submits: the hard navigation is under way. */
const NAVIGATING_MS = 3_000;

function fillFor(role: SignInRole): DemoFill {
  return role === "staff" ? { code: DEMO_STAFF_CODE } : { email: DEMO_EMAILS[role], password: DEMO_PASSWORD };
}

export function DemoAccess({ config, role, onFill, children }: DemoAccessProps) {
  const { lang } = useLang();
  const { busy, refusal, start, clearRefusal } = useDemoStart(config, "restart");
  // The role the box last filled in for; the "Filled in" line shows only while the panel is still on that role.
  const [filledFor, setFilledFor] = useState<SignInRole | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const freshRef = useRef<HTMLButtonElement>(null);
  // Which control the next render should hand focus to: the tapped button unmounts when the confirm step swaps in or out.
  const focusNext = useRef<"confirm" | "fresh" | null>(null);
  // The Firebase sign-out of "Yes, start over". A demo credential submitted meanwhile waits for it: a late sign-out must not land after (and undo) a new sign-in.
  const ending = useRef<Promise<void> | null>(null);
  const startedAt = useRef<number | null>(null);

  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const earlier = viewFromSnapshot(snapshot);

  useEffect(() => {
    if (focusNext.current === "confirm") confirmRef.current?.focus();
    else if (focusNext.current === "fresh") freshRef.current?.focus();
    focusNext.current = null;
  }, [confirming]);

  /** Starts the demo a typed credential names. Resolves `true` always: the input WAS a demo credential, whatever came of it. */
  async function open(target: DemoRole): Promise<boolean> {
    if (startedAt.current !== null && Date.now() - startedAt.current < NAVIGATING_MS) return true; // already navigating
    setRestarted(false);
    setConfirming(false);
    setFilledFor(null);
    if (ending.current) await ending.current;
    const result = await start(target);
    if (result === null) return true; // double-tap guard: a request is already in flight
    if (result.kind === "started") startedAt.current = Date.now();
    else statusRef.current?.focus();
    return true;
  }

  const hooks: DemoPanelHooks = {
    interceptCode: async (code) => {
      const matched = matchDemoCredential({ kind: "code", code });
      return matched ? open(matched) : false;
    },
    interceptEmail: async (email, password) => {
      const matched = matchDemoCredential({ kind: "email", email, password });
      return matched ? open(matched) : false;
    },
  };

  function fillIn() {
    setRestarted(false);
    clearRefusal();
    setFilledFor(role);
    onFill(fillFor(role));
  }

  function onFreshYes() {
    // Forgets the sandbox and device keys now (the status line says so at once); the sign-out settles in the background and
    // is awaited by the next start. endDemo never throws.
    ending.current = endDemo(authOrNull(config)).finally(() => {
      ending.current = null;
    });
    clearRefusal();
    setConfirming(false);
    setRestarted(true);
    statusRef.current?.focus();
  }

  let statusText = "";
  if (busy) {
    statusText = t(lang, "C-demo-busy");
  } else if (refusal) {
    const lines = refusalLines(refusal);
    statusText = [t(lang, lines.message), lines.hint ? t(lang, lines.hint.key, lines.hint.vars) : ""].filter(Boolean).join(" ");
  } else if (restarted) {
    statusText = t(lang, "C-demo-restarted");
  } else if (filledFor === role) {
    statusText = t(lang, "C-demo-cred-filled");
  } else if (earlier?.expired) {
    statusText = t(lang, "C-demo-expired");
  }

  const liveDemo = earlier && !earlier.expired && !restarted ? earlier.state : null;

  return (
    <DemoHooksProvider value={hooks}>
      <section aria-labelledby="demo-access-title" style={BOX_STYLE}>
        <p id="demo-access-title" style={TITLE_STYLE}>
          {t(lang, "C-demo-cred-title")}
        </p>
        {role === "staff" ? (
          <p style={ROW_STYLE}>
            {t(lang, "C-demo-cred-code")}: <span style={VALUE_STYLE}>{DEMO_STAFF_CODE}</span>
          </p>
        ) : (
          <>
            <p style={ROW_STYLE}>
              {t(lang, "C-demo-cred-email")}: <span style={VALUE_STYLE}>{DEMO_EMAILS[role]}</span>
            </p>
            <p style={ROW_STYLE}>
              {t(lang, "C-demo-cred-password")}: <span style={VALUE_STYLE}>{DEMO_PASSWORD}</span>
            </p>
          </>
        )}
        <button type="button" disabled={busy} onClick={fillIn} style={BUTTON_STYLE}>
          {t(lang, "C-demo-cred-fill")}
        </button>
        <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-private")}</p>
        {liveDemo && <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-continuing", { time: hhmm(liveDemo.expires_at_ms) })}</p>}
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" data-testid="demo-status" style={STATUS_STYLE}>
          {statusText}
        </p>
        {liveDemo &&
          (confirming ? (
            <div role="group" aria-labelledby="demo-fresh-confirm">
              <p id="demo-fresh-confirm" ref={confirmRef} tabIndex={-1} style={PARAGRAPH_STYLE}>
                {t(lang, "C-demo-restart-confirm")}
              </p>
              <button type="button" disabled={busy} onClick={onFreshYes} style={BUTTON_STYLE}>
                {t(lang, "C-demo-restart-yes")}
              </button>
              <button
                type="button"
                onClick={() => {
                  focusNext.current = "fresh";
                  setConfirming(false);
                }}
                style={BUTTON_STYLE}
              >
                {t(lang, "C-demo-restart-keep")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              ref={freshRef}
              disabled={busy}
              onClick={() => {
                focusNext.current = "confirm";
                setConfirming(true);
              }}
              style={BUTTON_STYLE}
            >
              {t(lang, "C-demo-cred-fresh")}
            </button>
          ))}
      </section>
      {children}
    </DemoHooksProvider>
  );
}
