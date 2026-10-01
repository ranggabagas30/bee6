"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/app/capture/StatusBanner";
import { DevPanel } from "@/app/capture/DevPanel";
import {
  fetchCaptureConfig,
  readDeviceAuth,
  resolveCapturePhase,
} from "@/lib/capture/browser/client";
import { startCaptureSession, type CaptureSession } from "@/lib/capture/browser/session";
import { isDevControlsEnabled } from "@/lib/capture/dev-mode";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import type { CaptureStatus } from "@/lib/capture/browser/engine";

/**
 * /capture — the shop phone's always-on listening screen (web spec §4.1, §5).
 * Runs on the same paired phone as /pair: reads the stored device credential (or
 * redirects to /pair), fetches the outlet's consent + hours, and — only when
 * consent is complete and inside opening hours — starts the capture session
 * (mic → VAD → segments → upload) with heartbeat + wake lock. It shows a big
 * status only; a transcript is NEVER displayed (hard rule #2 / spec).
 */

const PAGE_STYLE: React.CSSProperties = {
  maxWidth: 360,
  margin: "0 auto",
  padding: 24,
  fontFamily: "system-ui, sans-serif",
};

type View =
  | "loading"
  | "error"
  | "no_consent"
  | "outside_hours"
  | "unsupported"
  | "active";

export default function CapturePage() {
  // Build-time flag (lib/capture/dev-mode.ts): off in every real build, so
  // this branch and the <DevPanel /> import below are dead code there — not a
  // runtime toggle a query param could flip.
  const devControlsEnabled = isDevControlsEnabled();
  const router = useRouter();
  const [view, setView] = useState<View>("loading");
  const [config, setConfig] = useState<CaptureConfigResponse | null>(null);
  const [status, setStatus] = useState<CaptureStatus>({
    state: "listening",
    queuedCount: 0,
    droppedCount: 0,
    micError: null,
  });
  const [micSource, setMicSource] = useState("microphone");
  const [sampleRateMsg, setSampleRateMsg] = useState<string | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);

  useEffect(() => {
    const auth = readDeviceAuth();
    if (!auth) {
      router.replace("/pair");
      return;
    }

    let cancelled = false;
    let unsupported = false;
    let starting = false;
    let phaseTimer: ReturnType<typeof setInterval> | null = null;
    let loadedConfig: CaptureConfigResponse | null = null;

    async function applyPhase() {
      if (cancelled || starting || unsupported || !loadedConfig) return;
      const phase = resolveCapturePhase(loadedConfig, new Date());

      if (phase !== "active") {
        if (sessionRef.current) {
          await sessionRef.current.stop();
          sessionRef.current = null;
        }
        if (!cancelled) setView(phase);
        return;
      }

      if (sessionRef.current) return; // already capturing
      starting = true;
      try {
        const session = await startCaptureSession(auth!, loadedConfig, {
          onStatus: (s) => !cancelled && setStatus(s),
          onMicSource: (label) => !cancelled && setMicSource(label),
          onUnsupported: () => {
            unsupported = true;
            if (!cancelled) setView("unsupported");
          },
          onSampleRateRejected: (msg) => !cancelled && setSampleRateMsg(msg),
        });
        if (cancelled) {
          await session?.stop();
          return;
        }
        if (session) {
          sessionRef.current = session;
          setView("active");
        }
      } finally {
        starting = false;
      }
    }

    (async () => {
      try {
        loadedConfig = await fetchCaptureConfig(auth);
      } catch {
        if (!cancelled) setView("error");
        return;
      }
      if (cancelled) return;
      setConfig(loadedConfig);
      await applyPhase();
      // Re-check hours periodically so capture starts/stops around open/close.
      phaseTimer = setInterval(() => void applyPhase(), 30_000);
    })();

    return () => {
      cancelled = true;
      if (phaseTimer) clearInterval(phaseTimer);
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.stop();
    };
  }, [router]);

  return (
    <main style={PAGE_STYLE}>
      <h1 style={{ fontSize: 22 }}>Shop listening</h1>

      {devControlsEnabled ? <DevPanel /> : null}

      {view === "loading" ? <p>Loading capture settings…</p> : null}

      {view === "error" ? (
        <p role="alert" style={{ color: "#b00020" }}>
          Couldn&apos;t load capture settings. Check the connection and reload.
        </p>
      ) : null}

      {view === "no_consent" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18 }}>Capture is off</h2>
          <p>
            This outlet hasn&apos;t completed the staff-consent step yet, so
            listening can&apos;t start. Ask the supervisor to complete consent,
            then reload this page.
          </p>
        </section>
      ) : null}

      {view === "outside_hours" && config ? (
        <section role="status" aria-live="polite">
          <h2 style={{ fontSize: 18 }}>Paused — outside opening hours</h2>
          <p>
            Listening runs from {config.opening_time} to {config.closing_time} (
            {config.timezone}). It will start again automatically at opening time.
          </p>
        </section>
      ) : null}

      {view === "unsupported" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18 }}>Browser not supported</h2>
          <p>
            This browser can&apos;t encode audio for capture. Use the latest
            Chrome on the shop phone.
          </p>
        </section>
      ) : null}

      {/* devControlsEnabled bypasses the opening_hours/consent early return so
          this section is visible for manual testing, without deleting the
          real blocked-view sections above (still rendered alongside it). */}
      {view === "active" || devControlsEnabled ? (
        <>
          <StatusBanner
            state={status.state}
            queuedCount={status.queuedCount}
            micSource={micSource}
          />
          {sampleRateMsg ? (
            <p role="alert" style={{ color: "#b00020", marginTop: 16 }}>
              {sampleRateMsg}
            </p>
          ) : null}
          <p style={{ marginTop: 16, fontSize: 14, color: "#444" }}>
            Keep this page open, in front, and the phone plugged in.
          </p>
          {/* Staff PIN flow ships in R-07; this is a layout stub only. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            style={{ marginTop: 16, width: "100%", padding: 12, fontSize: 16 }}
          >
            Staff (available soon)
          </button>
        </>
      ) : null}
    </main>
  );
}
