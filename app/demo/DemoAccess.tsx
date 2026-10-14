"use client";

import { useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { DEMO_EMAILS, DEMO_PASSWORD, matchDemoCredential } from "@/lib/demo/credentials";
import type { DemoRole } from "@/lib/demo/contract";
import { demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { hhmm } from "@/app/demo/DemoBar";
import { refusalLines } from "@/app/demo/demo-errors";
import { useDemoStart } from "@/app/demo/useDemoStart";
import type { DemoAccessProps, DemoFill, DemoPanelHooks } from "@/app/sign-in/panel-hooks";
import { DemoHooksProvider } from "@/app/sign-in/demo-hooks";
import { Glass } from "@/app/ui";

/**
 * The demo access box (R-18 P1; trimmed in R-19 PR-6 §8.1), on demo deployments only. It is reached through a
 * `next/dynamic` import in `RoleSignIn` and `PairScreen`, so the pilot's pages never load this file or
 * `lib/demo/credentials.ts`.
 *
 * For the web roles it shows the published email and password with a "Fill in" button (puts them in the panel's fields
 * without submitting). For staff it shows nothing to copy: the demo code lives only in the judge guide (W8, PR-5),
 * whose "Fill in" fills the pair field itself. In every case it hands the panel two intercepts: a typed demo credential
 * (the credential decides the role, not the panel) starts a demo through `startOrSwitch`: a switch inside this browser's
 * live sandbox, or a fresh private one. Anything else returns `false` and the panel signs in for real.
 * The "start a fresh demo" control is gone (§8.1: the owner resets). The server contract is unchanged
 * (POST /api/v1/demo/session); DEMO_MODE, the caps and the 2 h expiry are the boundary.
 */

const BOX_STYLE: CSSProperties = { boxSizing: "border-box", padding: "14px 16px", margin: "0 0 16px 0" };
const TITLE_STYLE: CSSProperties = { margin: "0 0 8px 0", fontWeight: 600 };
const ROW_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const VALUE_STYLE: CSSProperties = { userSelect: "all", fontFamily: "var(--b6-font-mono, monospace)", fontWeight: 600 };
const PARAGRAPH_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere", lineHeight: 1.5, fontSize: 14 };
const STATUS_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere", minHeight: 0, lineHeight: 1.5 };

/** How long a successful start keeps swallowing repeat submits: the hard navigation (or the next step) is under way. */
const NAVIGATING_MS = 3_000;

function fillFor(role: "supervisor" | "owner"): DemoFill {
  return { email: DEMO_EMAILS[role], password: DEMO_PASSWORD };
}

const noNavigation = () => {};

export function DemoAccess({ config, role, onFill, onStarted, children }: DemoAccessProps) {
  const { lang } = useLang();
  const pathname = usePathname();
  const { busy, refusal, start, clearRefusal } = useDemoStart(config, "restart", onStarted ? noNavigation : undefined);
  // The role the box last filled in for; the "Filled in" line shows only while the panel is still on that role.
  const [filledFor, setFilledFor] = useState<"supervisor" | "owner" | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const startedAt = useRef<number | null>(null);

  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const earlier = viewFromSnapshot(snapshot);

  /** Starts the demo a typed credential names. Resolves `true` always: the input WAS a demo credential, whatever came of it. */
  async function open(target: DemoRole): Promise<boolean> {
    if (startedAt.current !== null && Date.now() - startedAt.current < NAVIGATING_MS) return true; // already navigating
    setFilledFor(null);
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

  function fillIn(webRole: "supervisor" | "owner") {
    clearRefusal();
    setFilledFor(webRole);
    onFill(fillFor(webRole));
  }

  let statusText = "";
  if (busy) {
    statusText = t(lang, "C-demo-busy");
  } else if (refusal) {
    const lines = refusalLines(refusal);
    statusText = [t(lang, lines.message), lines.hint ? t(lang, lines.hint.key, lines.hint.vars) : ""].filter(Boolean).join(" ");
  } else if (filledFor !== null && filledFor === role) {
    statusText = t(lang, "C-demo-cred-filled");
  } else if (earlier?.expired && pathname !== "/pair") {
    // On /pair the DemoBar is visible and already says the session ended; /sign-in hides it once ended, so the box says it there.
    statusText = t(lang, "C-demo-expired");
  }

  const liveDemo = earlier && !earlier.expired ? earlier.state : null;

  return (
    <DemoHooksProvider value={hooks}>
      <Glass as="section" aria-labelledby="demo-access-title" style={BOX_STYLE}>
        <p id="demo-access-title" style={TITLE_STYLE}>
          {t(lang, "C-demo-cred-title")}
        </p>
        {role !== "staff" && (
          <>
            <p style={ROW_STYLE}>
              {t(lang, "C-demo-cred-email")}: <span style={VALUE_STYLE}>{DEMO_EMAILS[role]}</span>
            </p>
            <p style={ROW_STYLE}>
              {t(lang, "C-demo-cred-password")}: <span style={VALUE_STYLE}>{DEMO_PASSWORD}</span>
            </p>
            <button type="button" className="b6-btn b6-btn--secondary b6-btn--block" disabled={busy} onClick={() => fillIn(role)}>
              {t(lang, "C-demo-cred-fill")}
            </button>
          </>
        )}
        <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-private")}</p>
        {liveDemo && <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-continuing", { time: hhmm(liveDemo.expires_at_ms) })}</p>}
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" data-testid="demo-status" style={STATUS_STYLE}>
          {statusText}
        </p>
      </Glass>
      {children}
    </DemoHooksProvider>
  );
}
