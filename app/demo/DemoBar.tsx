"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { DemoRole } from "@/lib/demo/contract";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { closeEndedDemo, demoSnapshot, notifyDemoChange, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { authOrNull } from "@/app/demo/useDemoStart";

/**
 * The demo bar (R-12 Task 8.4, copy reworked in R-18 P1, cut down in R-19 PR-5 per plan D-8 / 7.2). Mounted by
 * the root layout only when the server has DEMO_MODE on, and shown only while this browser holds a demo state
 * (localStorage, shared by its tabs). It names the role and says when the 2 h session ends (device-local
 * HH:MM); past the end it says so. Nothing else: the Switch row and the "start a new demo" link are gone (the
 * judge changes role by signing out and picking again on the entry page, as the judge guide says), and the bar
 * never calls a demo route. Hidden on `/` (the entry page has its own controls) and, once ended, on `/sign-in`
 * (which carries the same ended line).
 *
 * The ended-sandbox handling stays: once the demo has ended its credentials are of no use any more, so the judge
 * phone's device keys are removed (so /capture does not keep a dead credential) and the Firebase web user is
 * signed out. The expired record stays, so /sign-in can say the session ended.
 */

// Height, box-sizing and the vertical centring come from `.b6-topbar` (globals.css), which keeps the bar exactly as
// tall as the slot DemoBarLoader reserves at every width.
const BAR_STYLE: CSSProperties = {
  width: "100%",
  padding: "8px 16px",
  background: "#fff7d6",
  color: "#1f1300",
  borderBottom: "2px solid #8a6d00",
  fontSize: 16,
};
const LINE_STYLE: CSSProperties = { margin: 0, overflowWrap: "anywhere", fontWeight: 700 };
const STATUS_STYLE: CSSProperties = { margin: 0, overflowWrap: "anywhere", minHeight: 0 };

const ROLE_KEY: Record<DemoRole, DictKey> = {
  staff: "C-demo-role-staff",
  supervisor: "C-demo-role-supervisor",
  owner: "C-demo-role-owner",
};
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Device-local HH:MM; an em-dash, never the text "NaN", when the instant is not a valid date. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DemoBar({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const pathname = usePathname();

  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const view = viewFromSnapshot(snapshot);
  const expiresAt = view && !view.expired ? view.state.expires_at_ms : null;
  const ended = view?.expired === true;

  useEffect(() => {
    if (ended) void closeEndedDemo(authOrNull(config));
  }, [ended, config]);

  // Re-read the snapshot at the expiry instant so a bar left open flips to "ended" without a tap.
  useEffect(() => {
    if (expiresAt === null) return;
    const id = setTimeout(notifyDemoChange, Math.min(Math.max(expiresAt - Date.now(), 0) + 1, MAX_TIMEOUT_MS));
    return () => clearTimeout(id);
  }, [expiresAt]);

  if (pathname === "/") return null;
  if (!view) return null;
  if (ended && pathname === "/sign-in") return null;

  const live = view.state;

  // ONE live region (the status line) stays mounted for the bar's whole life, empty at first, so the end of
  // the demo is announced when its text lands in it; a separate element that appears with its text already
  // in it is not reliably announced.
  return (
    <aside aria-labelledby={ended ? "demo-bar-status-line" : "demo-bar-line"} className="b6-topbar" style={BAR_STYLE}>
      {!ended && (
        <p id="demo-bar-line" style={LINE_STYLE}>
          {t(lang, "C-demo-bar", { role: t(lang, ROLE_KEY[live.role]), time: hhmm(live.expires_at_ms) })}
        </p>
      )}
      <p id="demo-bar-status-line" role="status" aria-live="polite" data-testid="demo-bar-status" style={ended ? LINE_STYLE : STATUS_STYLE}>
        {ended ? t(lang, "C-demo-expired") : ""}
      </p>
    </aside>
  );
}
