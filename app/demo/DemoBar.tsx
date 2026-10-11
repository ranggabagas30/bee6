"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { DemoRole } from "@/lib/demo/contract";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { demoSnapshot, notifyDemoChange, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { refusalLines } from "@/app/demo/demo-errors";
import { useDemoStart } from "@/app/demo/useDemoStart";

/**
 * The demo bar (R-12 Task 8.4). Mounted by the root layout only when the server has DEMO_MODE on, and shown
 * only while this browser holds a demo state (localStorage, shared by its tabs). It names the role, says when the 2 h session
 * ends (device-local HH:MM), and switches to the other two roles inside the same sandbox. Past the end it
 * says so and offers "Start a new demo" (a link to `/`, where the Try-as buttons live). Hidden on `/`
 * (the landing has its own controls) and, once ended, on `/sign-in` (which carries its own restart link).
 *
 * The switch uses `onExpired: "stop"`: if the server says the sandbox is gone it shows the ended state; it
 * never quietly builds a new sandbox behind the visitor's back.
 */

const BAR_STYLE: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: "8px 16px",
  background: "#fff7d6",
  color: "#1f1300",
  borderBottom: "2px solid #8a6d00",
  fontSize: 16,
};
const LINE_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere", fontWeight: 700 };
const ROW_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const BUTTON_STYLE: CSSProperties = {
  minHeight: 48,
  minWidth: 48,
  padding: "0 16px",
  fontSize: 16,
  cursor: "pointer",
  flex: "1 1 140px",
};
const LINK_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 48,
  padding: "0 16px",
  color: "#1f1300",
  fontWeight: 700,
  textDecoration: "underline",
};
const STATUS_STYLE: CSSProperties = { margin: "8px 0 0 0", overflowWrap: "anywhere", minHeight: 0 };

const ROLE_KEY: Record<DemoRole, DictKey> = {
  staff: "C-demo-role-staff",
  supervisor: "C-demo-role-supervisor",
  owner: "C-demo-role-owner",
};
const ALL_ROLES: readonly DemoRole[] = ["staff", "supervisor", "owner"];
const MAX_TIMEOUT_MS = 2_147_483_647;

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DemoBar({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const pathname = usePathname();
  const { busy, refusal, start } = useDemoStart(config, "stop");
  const [endedHere, setEndedHere] = useState(false);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const view = viewFromSnapshot(snapshot);
  const expiresAt = view && !view.expired ? view.state.expires_at_ms : null;

  // Re-read the snapshot at the expiry instant so a bar left open flips to "ended" without a tap.
  useEffect(() => {
    if (expiresAt === null) return;
    const id = setTimeout(notifyDemoChange, Math.min(Math.max(expiresAt - Date.now(), 0) + 1, MAX_TIMEOUT_MS));
    return () => clearTimeout(id);
  }, [expiresAt]);

  async function onSwitch(role: DemoRole) {
    const result = await start(role);
    if (result === null) return;
    if (result.kind === "started") {
      lineRef.current?.focus(); // the line now names the new role
    } else if (result.kind === "sandbox_expired") {
      setEndedHere(true);
    } else {
      statusRef.current?.focus();
    }
  }

  if (pathname === "/") {
    // Back at the landing page the visitor is starting over: forget a stale "ended here" (the bar lives
    // across soft navigations, so it would otherwise greet the next sandbox as ended).
    if (endedHere) setEndedHere(false);
    return null;
  }
  const ended = endedHere || view?.expired === true;
  if (!view && !endedHere) return null;
  if (ended && pathname === "/sign-in") return null;

  if (ended) {
    return (
      <aside aria-labelledby="demo-bar-line" style={BAR_STYLE}>
        <p id="demo-bar-line" style={{ ...LINE_STYLE, margin: 0 }}>
          {t(lang, "C-demo-expired")}
        </p>
        <Link href="/" style={LINK_STYLE}>
          {t(lang, "C-demo-restart")}
        </Link>
      </aside>
    );
  }

  const live = view!.state;
  const roleLabel = t(lang, ROLE_KEY[live.role]);
  const barText = t(lang, "C-demo-bar", { role: roleLabel, time: hhmm(live.expires_at_ms) });

  let statusText = "";
  if (busy) {
    statusText = t(lang, "C-demo-busy");
  } else if (refusal && refusal.kind !== "sandbox_expired") {
    // "Sandbox gone" is shown by the ended state above, not as a leftover line under a later live session.
    const lines = refusalLines(refusal);
    statusText = [t(lang, lines.message), lines.hint ? t(lang, lines.hint.key, lines.hint.vars) : ""].filter(Boolean).join(" ");
  }

  return (
    <aside aria-labelledby="demo-bar-line" style={BAR_STYLE}>
      <p id="demo-bar-line" ref={lineRef} tabIndex={-1} style={LINE_STYLE}>
        {barText}
      </p>
      <div style={ROW_STYLE}>
        {ALL_ROLES.filter((role) => role !== live.role).map((role) => (
          <button key={role} type="button" disabled={busy} onClick={() => void onSwitch(role)} style={BUTTON_STYLE}>
            {t(lang, "C-demo-switch", { role: t(lang, ROLE_KEY[role]) })}
          </button>
        ))}
      </div>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" data-testid="demo-bar-status" style={STATUS_STYLE}>
        {statusText}
      </p>
    </aside>
  );
}
