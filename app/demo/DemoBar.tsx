"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { closeEndedDemo, demoSnapshot, notifyDemoChange, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { authOrNull } from "@/app/demo/useDemoStart";
import { hhmm, useDemoExpiryHHMM } from "@/app/demo/demo-expiry";

/**
 * The demo bar, headless since R-25 (ruling R6 / UI-022: the yellow bar is on no page-2 board). Mounted by the
 * root layout only when the server has DEMO_MODE on. It no longer draws anything while the demo is live; what it
 * keeps is the behaviour around the 2 h session:
 *
 * - the expiry timer (re-reads the stored demo state at the expiry instant, so every screen flips to "ended"
 *   without a tap);
 * - the ended-sandbox cleanup (`closeEndedDemo`: the judge phone's device keys are removed so /capture does not keep
 *   a dead credential, and the Firebase web user is signed out; the expired record stays so /sign-in can say the
 *   session ended);
 * - the ONE polite live region (`role="status"`), mounted and empty for the demo's whole life so the end is
 *   announced when its text lands in it;
 * - the ended line, shown as an amber alert box (rare state, no board). Hidden on `/` (the entry page has its own
 *   controls) and on `/sign-in` (which carries the same ended line). On `/pair` the ended line is not shown at all
 *   once the demo has ended (demo feedback 2, finding 1, ruling B): the whole bar renders nothing there, so no amber
 *   box, no empty gap and no empty status region is left (a live demo on /pair still mounts the empty region).
 *
 * The 2 h expiry itself stays visible where the boards have an empty mono slot: the outlet line of the staff top
 * bar and the web `.dtop` bar, "Demo Bakery · Outlet 1 · ends 11:20", read through `useDemoExpiryHHMM()` below.
 * The bar never calls a demo route and no longer reserves any room (`b6-topbar-reserved` is gone).
 */

// The ended box sits at the very top of the page, above the page's own header; the margin is its only layout (the
// colours and radius come from `.b6-alert--amber`).
const ENDED_BOX_STYLE: CSSProperties = { margin: "8px 16px" };
const STATUS_STYLE: CSSProperties = { margin: 0, overflowWrap: "anywhere" };

const MAX_TIMEOUT_MS = 2_147_483_647;

// The hook and the formatter live in demo-expiry.ts (no Firebase in their import graph); the contract keeps them
// exported from here.
export { hhmm, useDemoExpiryHHMM };

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

  // Re-read the snapshot at the expiry instant so a page left open flips to "ended" without a tap.
  useEffect(() => {
    if (expiresAt === null) return;
    const id = setTimeout(notifyDemoChange, Math.min(Math.max(expiresAt - Date.now(), 0) + 1, MAX_TIMEOUT_MS));
    return () => clearTimeout(id);
  }, [expiresAt]);

  // R-21 D5: Hidden on `/` (its own controls), `/sign-in` (page's own ended line carries the time), and with no usable record.
  // Demo feedback 2 (ruling B): an ended demo on /pair says nothing, so the bar draws nothing at all there.
  const shown = pathname !== "/" && pathname !== "/sign-in" && view !== null && !(ended && pathname === "/pair");
  if (!shown) return null;

  // ONE live region stays mounted for the demo's whole life (empty while live), so the end of the demo is announced
  // when its text lands in it; a separate element that appears with its text already in it is not reliably
  // announced. The wrapper turns into the amber box when the demo ends; the region inside it is the same element.
  return (
    <div className={ended ? "b6-alert b6-alert--amber" : undefined} style={ended ? ENDED_BOX_STYLE : undefined}>
      <p role="status" aria-live="polite" data-testid="demo-bar-status" style={STATUS_STYLE}>
        {ended ? t(lang, "C-demo-expired") : ""}
      </p>
    </div>
  );
}
