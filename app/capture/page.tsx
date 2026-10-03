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
import {
  createEventRingBuffer,
  type CaptureEvent,
  type LoggedCaptureEvent,
} from "@/lib/capture/browser/event-log";
import { isDevControlsEnabled } from "@/lib/capture/dev-mode";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import type { CaptureStatus } from "@/lib/capture/browser/engine";
import type { MicSourceClass } from "@/lib/capture/mic-source";

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

// Privacy line shown on the active and closed views. Keep it to exactly what is
// true today: no "not recorded" / "anonymous" / "private" claims.
const PRIVACY_NOTE = (
  <div style={{ marginTop: 16, fontSize: 14, color: "#444" }}>
    <p style={{ margin: 0 }}>
      Suara diubah jadi catatan kerja singkat. Rekaman suara tidak disimpan.
    </p>
    <p style={{ margin: "4px 0 0" }}>Speech becomes short work notes. Audio is not kept.</p>
  </div>
);

type View =
  | "loading"
  | "error"
  | "no_consent"
  | "outside_hours"
  | "unsupported"
  | "active";

export default function CapturePage() {
  // Build-time flag (lib/capture/dev-mode.ts): off in every real build, so
  // this branch and the <DevPanel /> below are never rendered there — not a
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
      const phase = resolveCapturePhase(loadedConfig, new Date());

      if (devControlsEnabled) {
        // Dev mode bypasses the opening_hours/consent auto-gate entirely for
        // this session — manual Start/Pause/Stop below owns the session.
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
      <h1 style={{ fontSize: 22 }}>
        <span style={{ display: "block" }}>Mendengarkan toko</span>
        <span style={{ display: "block", fontSize: 16, fontWeight: 400 }}>
          Shop listening
        </span>
      </h1>

      {devControlsEnabled ? (
        <DevPanel
          onStart={handleDevStart}
          onPause={handleDevStop}
          onStop={handleDevStop}
          events={events}
        />
      ) : null}

      {view === "loading" ? (
        <>
          <p style={{ margin: 0 }}>Memuat pengaturan…</p>
          <p style={{ margin: "2px 0 0", fontSize: 14, color: "#444" }}>
            Loading capture settings…
          </p>
        </>
      ) : null}

      {view === "error" ? (
        <p role="alert" style={{ color: "#b00020" }}>
          <span style={{ display: "block" }}>
            Pengaturan tidak bisa dimuat. Periksa koneksi lalu muat ulang.
          </span>
          <span style={{ display: "block", fontSize: 14 }}>
            Couldn&apos;t load capture settings. Check the connection and reload.
          </span>
        </p>
      ) : null}

      {view === "no_consent" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18 }}>
            <span style={{ display: "block" }}>Pengambilan audio belum aktif</span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 400 }}>
              Capture is off
            </span>
          </h2>
          <p>
            Outlet ini belum menyelesaikan langkah persetujuan staf, jadi
            pengambilan audio belum bisa dimulai. Minta supervisor menyelesaikan
            persetujuan, lalu muat ulang halaman ini.
          </p>
          <p>
            This outlet hasn&apos;t completed the staff-consent step yet, so
            listening can&apos;t start. Ask the supervisor to complete consent,
            then reload this page.
          </p>
        </section>
      ) : null}

      {view === "outside_hours" && config ? (
        <section role="status" aria-live="polite">
          <h2 style={{ fontSize: 18 }}>
            <span style={{ display: "block" }}>Dijeda — di luar jam buka</span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 400 }}>
              Paused — outside opening hours
            </span>
          </h2>
          <p>Mendengarkan dari {config.opening_time} sampai {config.closing_time} ({config.timezone}).</p>
          <p>
            Listening runs from {config.opening_time} to {config.closing_time} (
            {config.timezone}).
          </p>
          <p>Mulai lagi saat buka berikutnya ({config.opening_time})</p>
          <p>Resumes at the next opening ({config.opening_time})</p>
          {PRIVACY_NOTE}
        </section>
      ) : null}

      {view === "unsupported" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18 }}>
            <span style={{ display: "block" }}>Browser tidak didukung</span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 400 }}>
              Browser not supported
            </span>
          </h2>
          <p>Gunakan Chrome terbaru di ponsel ini.</p>
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
            Biarkan halaman ini terbuka, di depan, dan ponsel tetap tercolok.
          </p>
          <p style={{ marginTop: 4, fontSize: 14, color: "#444" }}>
            Keep this page open, in front, and the phone plugged in.
          </p>
          {PRIVACY_NOTE}
          {/* Staff PIN flow ships in R-07; this is a layout stub only. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            style={{ marginTop: 16, width: "100%", padding: 12, fontSize: 16 }}
          >
            <span style={{ display: "block" }}>Dibuka otomatis saat tutup</span>
            <span style={{ display: "block", fontSize: 14 }}>
              Opens automatically at closing
            </span>
          </button>
        </>
      ) : null}
    </main>
  );
}
