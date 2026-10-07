"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner, headlineStateFor } from "@/app/capture/StatusBanner";
import { DevPanel } from "@/app/capture/DevPanel";
import {
  UploadStatusLine,
  deriveLostLine,
  deriveRetainedUploadView,
  deriveUploadView,
} from "@/app/capture/UploadStatusLine";
import {
  NO_RETAINED_UPLOAD,
  beginSessionRetention,
  retainEngineStatus,
  type RetainedUpload,
} from "@/app/capture/upload-retention";
import { offHoursBanner } from "@/app/capture/off-hours-banner";
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

/**
 * navigator.onLine as a display hint only (it can be true behind a dead server,
 * so it never decides whether capture runs). Starts true so the first render
 * makes no "no internet" claim; the real value is read after mount.
 */
function useNetworkOnlineHint(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export default function CapturePage() {
  // Build-time flag (lib/capture/dev-mode.ts): off in every real build, so
  // this branch and the <DevPanel /> below are never rendered there — not a
  // runtime toggle a query param could flip.
  const devControlsEnabled = isDevControlsEnabled();
  const router = useRouter();
  const { lang } = useLang();
  const networkOnline = useNetworkOnlineHint();
  const [view, setView] = useState<View>("loading");
  const [config, setConfig] = useState<CaptureConfigResponse | null>(null);
  const [hours, setHours] = useState<{ from: string; to: string; tz: string } | null>(null);
  // Clock of the last phase check outside hours, so the banner's day and times
  // follow the same tick as the hours line. Null until the first check.
  const [clockMs, setClockMs] = useState<number | null>(null);
  // Business date on which this page saw a live session stop at the planned close
  // (UX-03 decision 7 Oct: "Ended automatically", never "Not started", that day).
  const [autoStoppedOn, setAutoStoppedOn] = useState<string | null>(null);
  // Engine status from the running session only. Null until the first report
  // and reset on stop, so nothing from a previous session is ever shown.
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  // Last engine status from any session, kept across a stop (UX-03 §5.7): the
  // lost line and the retry row stay up until the next 2xx. Never reset on stop.
  const [lastUploadStatus, setLastUploadStatus] = useState<CaptureStatus | null>(null);
  // Same upload state as a ref, so engine callbacks fold each report in order
  // (including reports from a stopped engine). See upload-retention.ts.
  const retainedUploadRef = useRef<RetainedUpload>(NO_RETAINED_UPLOAD);
  // True exactly while sessionRef holds a started, not-yet-stopped session. The
  // banner reads this, not the engine's default state, so it never says
  // "Listening" when no capture is actually running.
  const [sessionRunning, setSessionRunning] = useState(false);
  // Session generation guard: a stopped session's late callbacks never overwrite
  // the status of the session that replaced it.
  const sessionGenRef = useRef(0);
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
        setClockMs(now.getTime());
      }

      if (devControlsEnabled) {
        // Dev mode bypasses the opening-hours auto-gate entirely for this
        // session — manual Start/Pause/Stop below owns the session.
        // Still reflect the real computed phase so it's visible underneath.
        if (!cancelled) setView(phase);
        return;
      }

      if (phase !== "active") {
        sessionGenRef.current += 1;
        const session = sessionRef.current;
        if (session) {
          // Clear the reference at once and never await the stop: a segment PUT
          // that never answers must not hold this loop, or the next open would
          // find a stale session and skip the restart (QA defect 2).
          sessionRef.current = null;
          if (!cancelled) {
            setSessionRunning(false);
            setStatus(null);
            setAutoStoppedOn(businessDateOf(now.getTime(), loadedConfig.timezone));
          }
          void session.stop();
        }
        if (!cancelled) setView(phase);
        return;
      }

      if (sessionRef.current) return; // already capturing
      starting = true;
      const gen = ++sessionGenRef.current;
      const isCurrent = () => !cancelled && gen === sessionGenRef.current;
      retainedUploadRef.current = beginSessionRetention(retainedUploadRef.current, gen);
      try {
        const session = await startCaptureSession(auth!, loadedConfig, {
          onStatus: (s) => {
            // Upload results are kept even after a stop (UX-03 §5.7); only the
            // live headline status is limited to the current session.
            retainedUploadRef.current = retainEngineStatus(retainedUploadRef.current, s, gen);
            setLastUploadStatus(retainedUploadRef.current.status);
            if (isCurrent()) setStatus(s);
          },
          onMicSource: (source) => {
            if (isCurrent()) setMicSource(source);
          },
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
          void session?.stop();
          return;
        }
        if (session) {
          sessionRef.current = session;
          setSessionRunning(true);
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
      sessionGenRef.current += 1;
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.stop();
      setSessionRunning(false);
      setStatus(null);
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
    const gen = ++sessionGenRef.current;
    const isCurrent = () => gen === sessionGenRef.current;
    retainedUploadRef.current = beginSessionRetention(retainedUploadRef.current, gen);
    void (async () => {
      try {
        const session = await startCaptureSession(auth, config, {
          onStatus: (s) => {
            retainedUploadRef.current = retainEngineStatus(retainedUploadRef.current, s, gen);
            setLastUploadStatus(retainedUploadRef.current.status);
            if (isCurrent()) setStatus(s);
          },
          onMicSource: (label) => {
            if (isCurrent()) setMicSource(label);
          },
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
        setSessionRunning(true);
        setView("active");
      } finally {
        devStartingRef.current = false;
      }
    })();
  };

  const handleDevStop = () => {
    devStopRequestedRef.current = true;
    sessionGenRef.current += 1;
    const session = sessionRef.current;
    setSessionRunning(false);
    setStatus(null);
    if (!session) return;
    sessionRef.current = null;
    void session.stop();
  };

  // The status banner outside hours (UX-03 decision 7 Oct). Dev mode already renders
  // the banner in its own block, so it is not doubled here.
  const offHours =
    view === "outside_hours" && !devControlsEnabled && config && clockMs !== null
      ? offHoursBanner({ config, nowMs: clockMs, autoStoppedOn, lang })
      : null;

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

      {offHours ? (
        <StatusBanner
          state={offHours.state}
          micSource={micSource}
          note={offHours.state === "idle" ? offHours.note : null}
          endedAt={offHours.state === "ended_auto" ? offHours.endedAt : undefined}
        />
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
            state={sessionRunning ? headlineStateFor(status?.state ?? "listening") : "idle"}
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
      {/* Upload block (UX-03 §5.7): shown in every mode, including idle, outside
          hours and stopped. While a session runs it follows the live status; after
          a stop it keeps only the lost line and the retry row, until the next 2xx.
          It never changes the headline. */}
      <UploadStatusLine
        view={
          sessionRunning
            ? deriveUploadView(status)
            : deriveRetainedUploadView(lastUploadStatus)
        }
        lost={deriveLostLine(lastUploadStatus)}
        online={networkOnline}
        httpStatus={
          sessionRunning ? status?.lastUploadHttpStatus : lastUploadStatus?.lastUploadHttpStatus
        }
      />
      {/* Capture privacy notice (UX-03 §5.10): a muted notice, not a consent
          gate (CLAUDE.md §7b). One per page, in the page's language, every mode. */}
      <p data-testid="capture-notice" style={{ marginTop: 24, fontSize: 14, color: "#444" }}>
        {t(lang, "C-notice-pilot")}
      </p>
    </main>
  );
}
