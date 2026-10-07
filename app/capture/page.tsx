"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner } from "@/app/capture/StatusBanner";
import { DevPanel } from "@/app/capture/DevPanel";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import {
  fetchCaptureConfig,
  readDeviceAuth,
  resolveCapturePhase,
} from "@/lib/capture/browser/client";
import { startCaptureSession, type CaptureSession } from "@/lib/capture/browser/session";
import {
  createEventRingBuffer,
  type CaptureEvent,
  type LoggedCaptureEvent,
} from "@/lib/capture/browser/event-log";
import { isDevControlsEnabled } from "@/lib/capture/dev-mode";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import { businessDateOf, nextOpenDay } from "@/lib/capture/calendar";
import type { CaptureStatus } from "@/lib/capture/browser/engine";
import type { MicSourceClass } from "@/lib/capture/mic-source";

/**
 * /capture — the shop phone's always-on listening screen (web spec §4.1, §5).
 * Runs on the same paired phone as /pair: reads the stored device credential (or
 * redirects to /pair), fetches the outlet's timezone and weekly hours, and — only
 * inside the planned hours — starts the capture session (mic → VAD → segments →
 * upload) with heartbeat + wake lock. It shows a big status only; a transcript is
 * NEVER displayed (hard rule #2 / spec).
 */

const PAGE_STYLE: React.CSSProperties = {
  maxWidth: 360,
  margin: "0 auto",
  padding: 24,
  fontFamily: "system-ui, sans-serif",
};

type View = "loading" | "error" | "outside_hours" | "unsupported" | "active";

/**
 * The hours line on a paused phone: today's weekly hours, or the next open day's
 * hours on a closed day (R-P1, strict config shape). null only if no day is open.
 */
function hoursToShow(
  config: CaptureConfigResponse,
  now: Date,
): { from: string; to: string; tz: string } | null {
  const tz = config.timezone;
  const next = nextOpenDay(businessDateOf(now.getTime(), tz), config.weekly_hours);
  return next ? { from: next.hours.open, to: next.hours.close, tz } : null;
}

export default function CapturePage() {
  // Build-time flag (lib/capture/dev-mode.ts): off in every real build, so
  // this branch and the <DevPanel /> below are never rendered there — not a
  // runtime toggle a query param could flip.
  const devControlsEnabled = isDevControlsEnabled();
  const router = useRouter();
  const { lang } = useLang();
  const [view, setView] = useState<View>("loading");
  const [config, setConfig] = useState<CaptureConfigResponse | null>(null);
  const [hours, setHours] = useState<{ from: string; to: string; tz: string } | null>(null);
  const [status, setStatus] = useState<CaptureStatus>({
    state: "listening",
    queuedCount: 0,
    droppedCount: 0,
    micError: null,
  });
  const [micSource, setMicSource] = useState<MicSourceClass>("unknown");
  const [sampleRateMsg, setSampleRateMsg] = useState<string | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);

  // DEV-01 manual-start re-entrancy guards, mirroring the real auto-gate
  // effect's own `starting` guard below (see handleDevStart for how they're
  // used):
  //  - devStartingRef is true for the whole span between a Start click and
  //    that startCaptureSession() call settling, so a second Start click (or
  //    double-click) while one is in flight is a no-op instead of leaking a
  //    second mic/wake-lock session that nothing can ever stop.
  //  - devStopRequestedRef records that Pause/Stop (or unmount, via the
  //    main effect's cleanup) was requested while a start was still in
  //    flight, so the just-created session is stopped immediately once it
  //    resolves instead of being handed to sessionRef for no one to find.
  const devStartingRef = useRef(false);
  const devStopRequestedRef = useRef(false);

  // DEV-01 event log: one ring buffer per mount, in-memory only, never
  // persisted. The buffer itself is a mutable, non-reactive object; `events`
  // (state) is the snapshot the render body actually reads, refreshed on
  // every push — reading `eventBufRef.current` during render would violate
  // the "no ref access during render" rule.
  const eventBufRef = useRef(createEventRingBuffer(200));
  const [events, setEvents] = useState<readonly LoggedCaptureEvent[]>([]);
  const handleEvent = (event: CaptureEvent) => {
    eventBufRef.current.push(event);
    setEvents(eventBufRef.current.list());
  };

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
      const now = new Date();
      const phase = resolveCapturePhase(loadedConfig, now);
      if (phase === "outside_hours" && !cancelled) {
        setHours(hoursToShow(loadedConfig, now));
      }

      if (devControlsEnabled) {
        // Dev mode bypasses the opening-hours auto-gate entirely for this
        // session — manual Start/Pause/Stop below owns the session.
        // Still reflect the real computed phase so it's visible underneath.
        if (!cancelled) setView(phase);
        return;
      }

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
          onMicSource: (source) => !cancelled && setMicSource(source),
          onUnsupported: () => {
            unsupported = true;
            if (!cancelled) setView("unsupported");
          },
          onSampleRateRejected: (msg) => !cancelled && setSampleRateMsg(msg),
          // Nothing in the real (non-dev) path reads the ring buffer, so only
          // wire it up when the dev panel is actually mounted to consume it.
          onEvent: devControlsEnabled
            ? (e) => {
                if (!cancelled) handleEvent(e);
              }
            : undefined,
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
      // Also covers a dev-mode Start that's still in flight when this effect
      // tears down (route change / unmount): see devStopRequestedRef below.
      devStopRequestedRef.current = true;
      if (phaseTimer) clearInterval(phaseTimer);
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.stop();
    };
  }, [router, devControlsEnabled]);

  // Dev-only manual controls (DEV-01): call the exact same
  // startCaptureSession()/session.stop() the real auto-gate effect above
  // uses, just triggered by a button instead of the phase check — re-entrancy
  // is guarded by devStartingRef/devStopRequestedRef, declared above. Only
  // reachable when the dev panel is mounted.
  const handleDevStart = () => {
    const auth = readDeviceAuth();
    if (!auth || !config || sessionRef.current || devStartingRef.current) return;
    devStartingRef.current = true;
    devStopRequestedRef.current = false;
    void (async () => {
      try {
        const session = await startCaptureSession(auth, config, {
          onStatus: (s) => setStatus(s),
          onMicSource: (label) => setMicSource(label),
          onUnsupported: () => setView("unsupported"),
          onSampleRateRejected: (msg) => setSampleRateMsg(msg),
          onEvent: handleEvent,
        });
        if (!session) return;
        if (devStopRequestedRef.current) {
          // A stop/unmount landed while this start was in flight — the
          // caller already moved on, so stop the session we just created
          // instead of assigning it to sessionRef.
          await session.stop();
          return;
        }
        sessionRef.current = session;
        setView("active");
      } finally {
        devStartingRef.current = false;
      }
    })();
  };

  const handleDevStop = () => {
    devStopRequestedRef.current = true;
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    void session.stop();
  };

  return (
    <main style={PAGE_STYLE}>
      <ShopTopBar />
      <h1 style={{ fontSize: 22 }}>{t(lang, "C-cap-title")}</h1>

      {devControlsEnabled ? (
        <DevPanel
          onStart={handleDevStart}
          onPause={handleDevStop}
          onStop={handleDevStop}
          events={events}
        />
      ) : null}

      {view === "loading" ? <p>{t(lang, "C-h-loading")}</p> : null}

      {view === "error" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18, color: "#b00020" }}>{t(lang, "C-h-error")}</h2>
          <p>{t(lang, "C-h-error-help")}</p>
        </section>
      ) : null}

      {view === "outside_hours" && hours ? (
        <section role="status" aria-live="polite">
          <h2 style={{ fontSize: 18 }}>{t(lang, "C-cap-hours-h")}</h2>
          <p>
            {t(lang, "C-cap-hours-b", {
              from: hours.from,
              to: hours.to,
              tz: hours.tz,
            })}
          </p>
        </section>
      ) : null}

      {view === "unsupported" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18 }}>{t(lang, "C-h-unsupported")}</h2>
          <p>{t(lang, "C-h-unsupported-help")}</p>
        </section>
      ) : null}

      {/* devControlsEnabled bypasses the opening-hours early return so
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
              {t(lang, "C-cap-rate")}
            </p>
          ) : null}
          <p style={{ marginTop: 16, fontSize: 14, color: "#444" }}>
            {t(lang, "C-pair-step-2")}
          </p>
          {/* Staff PIN flow ships in R-07; this is a layout stub only. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            style={{ marginTop: 16, width: "100%", minHeight: 48, padding: 12, fontSize: 16 }}
          >
            {t(lang, "C-cap-staff")}
          </button>
        </>
      ) : null}
    </main>
  );
}
