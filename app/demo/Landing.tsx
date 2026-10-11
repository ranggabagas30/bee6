"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { DemoRole } from "@/lib/demo/contract";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { getClientAuth, type Auth } from "@/lib/auth/client/firebase-client";
import { WebTopBar } from "@/app/web/WebTopBar";
import { endDemo, demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { refusalLines } from "@/app/demo/demo-errors";
import { useDemoStart } from "@/app/demo/useDemoStart";

/**
 * "/" on a demo deployment (R-12 Task 8.3). One paragraph on the product, the suggested judge path, the
 * fictional-data line and three Try-as buttons (Staff first, matching the path). Everything goes through
 * `startDemo`, which talks only to POST /api/v1/demo/session. The page is only rendered when the server has
 * DEMO_MODE on; if the route still answers 404 the visitor is sent to sign-in and sees no demo copy.
 */

const PAGE_STYLE: CSSProperties = { maxWidth: 560, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const PARAGRAPH_STYLE: CSSProperties = { margin: "0 0 16px 0", overflowWrap: "anywhere", lineHeight: 1.5 };
const BUTTON_STYLE: CSSProperties = {
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  minHeight: 48,
  marginBottom: 12,
  padding: "0 16px",
  fontSize: 16,
  cursor: "pointer",
};
const SECONDARY_STYLE: CSSProperties = { ...BUTTON_STYLE, marginTop: 24 };
const STATUS_STYLE: CSSProperties = { margin: "16px 0", overflowWrap: "anywhere", minHeight: 24 };

const ROLES: ReadonlyArray<{ role: DemoRole; key: DictKey }> = [
  { role: "staff", key: "C-demo-try-staff" },
  { role: "supervisor", key: "C-demo-try-supervisor" },
  { role: "owner", key: "C-demo-try-owner" },
];

export function Landing({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const { busy, refusal, start, clearRefusal } = useDemoStart(config, "restart");
  const [confirming, setConfirming] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  // Which control the next render should hand focus to: the tapped button unmounts when the confirm step swaps in or out.
  const focusNext = useRef<"confirm" | "restart" | null>(null);

  const snapshot = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const earlier = viewFromSnapshot(snapshot);

  // Demo mode is off on the server: nothing here should show. Navigation only.
  const off = refusal?.kind === "off";
  useEffect(() => {
    if (off) router.replace("/sign-in");
  }, [off, router]);

  useEffect(() => {
    if (focusNext.current === "confirm") confirmRef.current?.focus();
    else if (focusNext.current === "restart") restartRef.current?.focus();
    focusNext.current = null;
  }, [confirming]);

  async function onTry(role: DemoRole) {
    setRestarted(false);
    setConfirming(false);
    const result = await start(role);
    if (result !== null && result.kind !== "started") statusRef.current?.focus();
  }

  function onRestartYes() {
    // Forgets the sandbox and device keys now; the Firebase web user is signed out in the background.
    let auth: Auth | null = null;
    try {
      auth = config ? getClientAuth(config) : null;
    } catch {
      // No usable auth client: nothing to sign out of.
    }
    void endDemo(auth);
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
  } else if (earlier?.expired) {
    statusText = t(lang, "C-demo-expired");
  }

  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={null} showSignOut={false} />
      <h1>{t(lang, "C-demo-title")}</h1>
      <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-intro")}</p>
      <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-path")}</p>
      <p style={{ ...PARAGRAPH_STYLE, fontWeight: 700 }}>{t(lang, "C-demo-fictional")}</p>

      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" data-testid="demo-status" style={STATUS_STYLE}>
        {statusText}
      </p>

      {ROLES.map(({ role, key }) => (
        <button key={role} type="button" disabled={busy} onClick={() => void onTry(role)} style={BUTTON_STYLE}>
          {t(lang, key)}
        </button>
      ))}

      {earlier && !earlier.expired && !restarted && (
        <div>
          {confirming ? (
            <div role="group" aria-labelledby="demo-restart-confirm">
              <p id="demo-restart-confirm" ref={confirmRef} tabIndex={-1} style={PARAGRAPH_STYLE}>
                {t(lang, "C-demo-restart-confirm")}
              </p>
              <button type="button" disabled={busy} onClick={onRestartYes} style={BUTTON_STYLE}>
                {t(lang, "C-demo-restart-yes")}
              </button>
              <button
                type="button"
                onClick={() => {
                  focusNext.current = "restart";
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
              ref={restartRef}
              disabled={busy}
              onClick={() => {
                focusNext.current = "confirm";
                setConfirming(true);
              }}
              style={SECONDARY_STYLE}
            >
              {t(lang, "C-demo-restart")}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
