"use client";

import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { matchDemoCredential } from "@/lib/demo/credentials";
import type { DemoRole } from "@/lib/demo/contract";
import { demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { publishSignInRole } from "@/app/demo/guide-bridge";
import { hhmm } from "@/app/demo/DemoBar";
import { refusalLines } from "@/app/demo/demo-errors";
import { useDemoStart } from "@/app/demo/useDemoStart";
import type { DemoAccessProps, DemoPanelHooks } from "@/app/sign-in/panel-hooks";
import { DemoHooksProvider } from "@/app/sign-in/demo-hooks";
import { Card } from "@/app/ui";

/**
 * The demo access box (R-18 P1; trimmed in R-19 PR-6 §8.1), on demo deployments only. It is reached through a
 * `next/dynamic` import in `RoleSignIn` and `PairScreen`, so the pilot's pages never load this file or
 * `lib/demo/credentials.ts`.
 *
 * The box prints no credential (demo feedback 2, finding 4): the demo email and password (web roles) and the demo code
 * (staff) live only in the judge guide, whose "Fill in" controls fill the panel's fields through the DOM. The box keeps
 * one pointer line to the guide and publishes the panel's role to it (the sign-in bridge), so the guide shows the
 * matching card. In every case it hands the panel two intercepts: a typed demo credential
 * (the credential decides the role, not the panel) starts a demo through `startOrSwitch`: a switch inside this browser's
 * live sandbox, or a fresh private one. Anything else returns `false` and the panel signs in for real.
 * The "start a fresh demo" control is gone (§8.1: the owner resets). The server contract is unchanged
 * (POST /api/v1/demo/session); DEMO_MODE, the caps and the 2 h expiry are the boundary.
 */

const BOX_STYLE: CSSProperties = { boxSizing: "border-box", padding: "16px 18px", margin: "0 0 16px 0" };
const TITLE_STYLE: CSSProperties = { margin: "0 0 8px 0" };
const PARAGRAPH_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere", lineHeight: 1.5, fontSize: 14 };
const STATUS_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere", minHeight: 0, lineHeight: 1.5 };

/** How long a successful start keeps swallowing repeat submits: the hard navigation (or the next step) is under way. */
const NAVIGATING_MS = 3_000;

const noNavigation = () => {};

/**
 * `bare` (R-25 T4, ruling R5): /pair shows no "Demo access" box (board P2-02 has none). The hooks and the start logic are
 * unchanged; only the box chrome is dropped, leaving the one live status line (busy, refusal, ended) below the form.
 */
export function DemoAccess({ config, role, onStarted, suppressEnded, bare = false, children }: DemoAccessProps & { bare?: boolean }) {
  const { lang } = useLang();
  const { busy, refusal, start } = useDemoStart(config, "restart", onStarted ? noNavigation : undefined);
  // Tell the judge guide which role panel is on screen (a role word, never a credential); the cleanup takes it back.
  useEffect(() => publishSignInRole(role), [role]);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const startedAt = useRef<number | null>(null);

  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const earlier = viewFromSnapshot(snapshot);

  /** Starts the demo a typed credential names. Resolves `true` always: the input WAS a demo credential, whatever came of it. */
  async function open(target: DemoRole): Promise<boolean> {
    if (startedAt.current !== null && Date.now() - startedAt.current < NAVIGATING_MS) return true; // already navigating
    const result = await start(target);
    if (result === null) return true; // double-tap guard: a request is already in flight
    if (result.kind === "started") {
      startedAt.current = Date.now();
      onStarted?.();
    } else {
      statusRef.current?.focus();
    }
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

  let statusText = "";
  if (busy) {
    statusText = t(lang, "C-demo-busy");
  } else if (refusal) {
    const lines = refusalLines(refusal);
    statusText = [t(lang, lines.message), lines.hint ? t(lang, lines.hint.key, lines.hint.vars) : ""].filter(Boolean).join(" ");
  } else if (earlier?.expired && !suppressEnded) {
    // /pair says nothing about an ended session (`suppressEnded`; demo feedback 2, ruling B); /sign-in hides the DemoBar once ended, so the box says it there.
    statusText = t(lang, "C-demo-expired");
  }

  const liveDemo = earlier && !earlier.expired ? earlier.state : null;

  if (bare) {
    const attention = statusText !== "" && !busy;
    return (
      <DemoHooksProvider value={hooks}>
        {children}
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          data-testid="demo-status"
          className={attention ? "b6-alert b6-alert--amber" : "b6-sr-only"}
          style={attention ? { margin: "16px 0 0 0", overflowWrap: "anywhere" } : undefined}
        >
          {statusText}
        </p>
      </DemoHooksProvider>
    );
  }

  return (
    <DemoHooksProvider value={hooks}>
      <Card as="section" aria-labelledby="demo-access-title" style={BOX_STYLE}>
        <p id="demo-access-title" className="b6-kick" style={TITLE_STYLE}>
          {t(lang, "C-demo-cred-title")}
        </p>
        <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-in-guide")}</p>
        <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-private")}</p>
        {liveDemo && <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-continuing", { time: hhmm(liveDemo.expires_at_ms) })}</p>}
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" data-testid="demo-status" style={STATUS_STYLE}>
          {statusText}
        </p>
      </Card>
      {children}
    </DemoHooksProvider>
  );
}
