"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { idleViewFor } from "@/app/capture/idle-view";
import { selesaiViewFor } from "@/app/capture/selesai-view";
import { isDiscardArmed, nextMulaiIsNow, shouldAutoClosePanel } from "@/app/capture/batalkan-panel";
import { DebriefFlow } from "@/app/capture/debrief/DebriefFlow";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { clockLabel, dayLabel } from "@/lib/i18n/format";
import { sessionErrorKey } from "@/lib/i18n/codes";
import {
  fetchCaptureConfig,
  postSessionDiscard,
  postSessionEnd,
  postSessionStart,
  readDeviceAuth,
} from "@/lib/capture/browser/client";
import { startCaptureSession, type CaptureSession } from "@/lib/capture/browser/session";
import {
  createEventRingBuffer,
  type CaptureEvent,
  type LoggedCaptureEvent,
} from "@/lib/capture/browser/event-log";
import { isDevControlsEnabled } from "@/lib/capture/dev-mode";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import {
  addDays,
  autoStopAtMs,
  businessDateOf,
  localDateOf,
  mulaiAvailability,
  mulaiWindowDateOf,
  nextOpenDay,
  zonedTimeToEpochMs,
  DEBRIEF_DURATION_MS,
} from "@/lib/capture/calendar";
import type { CaptureStatus } from "@/lib/capture/browser/engine";
import type { MicSourceClass } from "@/lib/capture/mic-source";

/**
 * /capture — the shop phone's always-on listening screen (technical spec §8,
 * UX-03 §5.2-§5.6). A session only ever starts on a Mulai tap and only ever
 * stops on Selesai, Batalkan or the deadline-driven auto-stop (close(D) + 1h,
 * no confirm dialog — §8.7). Reads the stored device credential (or
 * redirects to /pair), fetches the outlet's timezone/weekly hours/last_ended,
 * and shows a big status only; a transcript is NEVER displayed (hard rule #2).
 */

const PAGE_STYLE: React.CSSProperties = {
  maxWidth: 360,
  margin: "0 auto",
  padding: 24,
  fontFamily: "system-ui, sans-serif",
};

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 16,
  width: "100%",
  minHeight: 56,
  padding: 12,
  fontSize: 18,
  fontWeight: 700,
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 12,
  width: "100%",
  minHeight: 48,
  padding: 12,
  fontSize: 16,
};

const PANEL_STYLE: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #ccc",
  borderRadius: 12,
  padding: 16,
};

type View = "loading" | "error" | "unsupported" | "ready";

/**
 * The next OPEN business day strictly after `localDate` — never the closed
 * weekday immediately following it (technical spec §8.7: the Selesai/Batalkan
 * confirm panels must name a day Mulai is actually offered again). Falls back
 * to the naive next calendar day only if `nextOpenDay` finds no open weekday
 * within its 7-day search.
 */
function nextOpenLocalDate(
  localDate: string,
  weekly: CaptureConfigResponse["weekly_hours"],
): string {
  return nextOpenDay(addDays(localDate, 1), weekly)?.local_date ?? addDays(localDate, 1);
}

/** The local session this device is tracking (R-P1: in-memory only — lost on reload). */
interface LocalSession {
  session_id: string;
  started_at_ms: number;
  local_date: string;
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
  const devControlsEnabled = isDevControlsEnabled();
  const router = useRouter();
  const { lang } = useLang();
  const networkOnline = useNetworkOnlineHint();

  const [view, setView] = useState<View>("loading");
  const [config, setConfig] = useState<CaptureConfigResponse | null>(null);
  // Mirrors config.last_ended, updated locally the instant Selesai/Batalkan
  // succeed so the idle screen reflects it without a refetch.
  const [lastEnded, setLastEnded] = useState<CaptureConfigResponse["last_ended"]>(null);
  // Re-checked every 30s and on visibilitychange (technical spec §8.6) so the
  // Mulai/Selesai gates and their notes stay current without a reload.
  const [nowMs, setNowMs] = useState<number | null>(null);

  const [session, setSession] = useState<LocalSession | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const sessionGenRef = useRef(0);
  const [sessionRunning, setSessionRunning] = useState(false);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [lastUploadStatus, setLastUploadStatus] = useState<CaptureStatus | null>(null);
  const retainedUploadRef = useRef<RetainedUpload>(NO_RETAINED_UPLOAD);
  const [micSource, setMicSource] = useState<MicSourceClass>("unknown");
  const [sampleRateMsg, setSampleRateMsg] = useState<string | null>(null);

  // Mulai (§8.7): a generation guard (ref, synchronous) so a double tap before
  // the first postSessionStart settles makes exactly one session.
  const mulaiInFlightRef = useRef(false);
  const [mulaiBusy, setMulaiBusy] = useState(false);
  const [mulaiErrorKey, setMulaiErrorKey] = useState<DictKey | null>(null);

  // Selesai (§5.5).
  const [selesaiConfirmOpen, setSelesaiConfirmOpen] = useState(false);
  const selesaiBusyRef = useRef(false);
  const [selesaiBusy, setSelesaiBusy] = useState(false);
  const [selesaiErrorKey, setSelesaiErrorKey] = useState<DictKey | null>(null);

  // Batalkan (§5.6): a fast tick while the panel is open drives the 1s arm
  // delay and the 15s self-close; the page-wide 30s `nowMs` tick is too coarse.
  const [batalkanOpen, setBatalkanOpen] = useState(false);
  const [batalkanOpenedAtMs, setBatalkanOpenedAtMs] = useState<number | null>(null);
  const [batalkanTickMs, setBatalkanTickMs] = useState<number | null>(null);
  const batalkanBusyRef = useRef(false);
  const [batalkanBusy, setBatalkanBusy] = useState(false);
  const [batalkanErrorKey, setBatalkanErrorKey] = useState<DictKey | null>(null);

  // DEV-01 manual-start re-entrancy guards (unchanged from the pre-rewrite page).
  const devStartingRef = useRef(false);
  const devStopRequestedRef = useRef(false);

  const eventBufRef = useRef(createEventRingBuffer(200));
  const [events, setEvents] = useState<readonly LoggedCaptureEvent[]>([]);
  const handleEvent = (event: CaptureEvent) => {
    eventBufRef.current.push(event);
    setEvents(eventBufRef.current.list());
  };

  // ── config load + the 30s/visibilitychange re-check (§8.6) ─────────────────
  useEffect(() => {
    const auth = readDeviceAuth();
    if (!auth) {
      router.replace("/pair");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchCaptureConfig(auth);
        if (cancelled) return;
        setConfig(loaded);
        setLastEnded(loaded.last_ended);
        setView("ready");
      } catch {
        if (!cancelled) setView("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // `config.last_ended` only ever reflects what the page loaded at mount; a
  // local Selesai/Batalkan success updates `lastEnded` instead (no refetch).
  // Every idle-view computation must read the merged value, never the raw
  // `config` object, or the just-ended/discarded day never shows as ended.
  const effectiveConfig = config ? { ...config, last_ended: lastEnded } : null;
  // Computed once per render from the merged config, shared by the Mulai tap
  // handler (reads `idle.offered`) and the idle screen (reads the rest) so
  // neither computes it independently.
  const idle =
    effectiveConfig && nowMs !== null
      ? idleViewFor({ config: effectiveConfig, nowMs, lang })
      : null;

  // Debrief entry (R-07, technical spec §8.10): per-device, from this
  // device's own last-ended record — the phone-local one set the instant
  // Selesai/the auto-stop succeeds (below), or the config's on load/reload.
  // A discarded session has no debrief (technical spec §8.9).
  const debriefEndsAtMs =
    lastEnded && lastEnded.end_reason !== "discarded" ? lastEnded.debrief_ends_at_ms : null;

  // The same next-Mulai day/time P1's `C-m-debrief` note already carries
  // (`idleViewFor`'s own `mulaiAvailability` call), computed the same way so
  // the debrief card and done screen never show a different answer than the
  // Mulai note underneath.
  const nextMulaiText =
    effectiveConfig && nowMs !== null
      ? (() => {
          const nextMs = mulaiAvailability({
            now_ms: nowMs,
            weekly: effectiveConfig.weekly_hours,
            tz: effectiveConfig.timezone,
            session_open: false,
            last_ended: lastEnded
              ? { business_date: lastEnded.business_date, debrief_ends_at_ms: lastEnded.debrief_ends_at_ms }
              : null,
          }).next_offer_ms;
          return nextMs === null
            ? null
            : {
                day: dayLabel(localDateOf(nextMs, effectiveConfig.timezone), lang),
                hm: clockLabel(nextMs, effectiveConfig.timezone),
              };
        })()
      : null;

  // stopRunningSession reads only refs and stable setState setters, so an
  // empty dep array is accurate — it lets the auto-stop effect below list it
  // as a dependency without re-running on every render.
  const stopRunningSession = useCallback((): void => {
    sessionGenRef.current += 1;
    const s = sessionRef.current;
    sessionRef.current = null;
    setSessionRunning(false);
    setStatus(null);
    if (s) void s.stop();
  }, []);

  // ── Auto-stop (§8.7): close(D) + 1h, enforced by the phone only ────────────
  // Reacts to the same `nowMs` the 30s tick / visibilitychange handler below
  // already sets, so this always sees the current session/config without a
  // hand-rolled "latest ref". The state-setting work runs inside a
  // `queueMicrotask` callback (same shape as the Batalkan panel's interval
  // callback below: a scheduled callback, not a direct call from the
  // effect's own synchronous body) so it stays a real microtask — safe under
  // fake timers in tests, unlike a macrotask such as `setTimeout`.
  const autoStopInFlightRef = useRef(false);
  useEffect(() => {
    if (!session || !config || nowMs === null || autoStopInFlightRef.current) return;
    const deadline = autoStopAtMs(session.local_date, config.weekly_hours, config.timezone);
    if (deadline === null || nowMs < deadline) return;
    const auth = readDeviceAuth();
    if (!auth) return;
    autoStopInFlightRef.current = true;
    const current = session;
    queueMicrotask(() => {
      void (async () => {
        const endedAt = Date.now();
        await postSessionEnd(auth, current.session_id, {
          started_at_ms: current.started_at_ms,
          ended_at_ms: endedAt,
          end_reason: "auto_stop",
        });
        // No confirm dialog for an auto-stop: close either panel if one was open.
        setSelesaiConfirmOpen(false);
        setBatalkanOpen(false);
        setBatalkanOpenedAtMs(null);
        setLastEnded({
          business_date: current.local_date,
          end_reason: "auto_stop",
          debrief_ends_at_ms: endedAt + DEBRIEF_DURATION_MS,
        });
        stopRunningSession();
        setSession(null);
        autoStopInFlightRef.current = false;
      })();
    });
  }, [session, config, nowMs, stopRunningSession]);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  // Batalkan panel's own fast tick (arm delay + auto-close).
  useEffect(() => {
    if (!batalkanOpen || batalkanOpenedAtMs === null) return;
    const id = setInterval(() => {
      const now = Date.now();
      setBatalkanTickMs(now);
      if (shouldAutoClosePanel(batalkanOpenedAtMs, now)) {
        setBatalkanOpen(false);
        setBatalkanOpenedAtMs(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [batalkanOpen, batalkanOpenedAtMs]);

  // Unmount: release the mic/VAD/wake lock of whichever session (Mulai or dev) is open.
  useEffect(() => {
    return () => {
      sessionGenRef.current += 1;
      const s = sessionRef.current;
      sessionRef.current = null;
      void s?.stop();
    };
  }, []);

  function engineCallbacks(gen: number) {
    const isCurrent = () => gen === sessionGenRef.current;
    return {
      onStatus: (s: CaptureStatus) => {
        retainedUploadRef.current = retainEngineStatus(retainedUploadRef.current, s, gen);
        setLastUploadStatus(retainedUploadRef.current.status);
        if (isCurrent()) setStatus(s);
      },
      onMicSource: (source: MicSourceClass) => {
        if (isCurrent()) setMicSource(source);
      },
      onUnsupported: () => setView("unsupported"),
      onSampleRateRejected: (msg: string) => setSampleRateMsg(msg),
      onEvent: devControlsEnabled ? handleEvent : undefined,
    };
  }

  // ── Mulai (§8.7, web spec §6.6.3) ───────────────────────────────────────────
  async function handleMulaiTap() {
    if (!config || !effectiveConfig || !idle) return;
    if (!idle.offered || mulaiInFlightRef.current) return;
    const auth = readDeviceAuth();
    if (!auth) {
      router.replace("/pair");
      return;
    }
    mulaiInFlightRef.current = true;
    setMulaiBusy(true);
    setMulaiErrorKey(null);
    const sessionId = crypto.randomUUID();
    const startedAt = Date.now();
    const result = await postSessionStart(auth, {
      session_id: sessionId,
      started_at_ms: startedAt,
    });
    // A definite rejection (bad/old timestamp, or a server-side conflict) must
    // never start the engine. Any other failure (network, 5xx) still starts
    // it — capture must not depend on a confirmed round trip (technical spec
    // §8.7: "failure never stops capture").
    if (!result.ok && (result.status === 422 || result.status === 409)) {
      mulaiInFlightRef.current = false;
      setMulaiBusy(false);
      setMulaiErrorKey(sessionErrorKey(result.status, result.code));
      return;
    }
    const localDate =
      mulaiWindowDateOf(startedAt, config.weekly_hours, config.timezone) ??
      businessDateOf(startedAt, config.timezone);
    const gen = ++sessionGenRef.current;
    retainedUploadRef.current = beginSessionRetention(retainedUploadRef.current, gen);
    const captureSession = await startCaptureSession(
      auth,
      config,
      engineCallbacks(gen),
      sessionId,
    );
    mulaiInFlightRef.current = false;
    setMulaiBusy(false);
    if (!captureSession) return; // onUnsupported already switched the view
    sessionRef.current = captureSession;
    setSessionRunning(true);
    setSession({ session_id: sessionId, started_at_ms: startedAt, local_date: localDate });
  }

  // ── Selesai (§5.5, web spec §6.6.3) ─────────────────────────────────────────
  function openSelesaiConfirm() {
    setBatalkanOpen(false);
    setBatalkanOpenedAtMs(null);
    setSelesaiErrorKey(null);
    setSelesaiConfirmOpen(true);
  }
  function closeSelesaiConfirm() {
    setSelesaiConfirmOpen(false);
  }
  async function confirmSelesai() {
    if (!session || selesaiBusyRef.current) return;
    const auth = readDeviceAuth();
    if (!auth) return;
    selesaiBusyRef.current = true;
    setSelesaiBusy(true);
    const endedAt = Date.now();
    const result = await postSessionEnd(auth, session.session_id, {
      started_at_ms: session.started_at_ms,
      ended_at_ms: endedAt,
      end_reason: "selesai",
    });
    selesaiBusyRef.current = false;
    setSelesaiBusy(false);
    if (!result.ok) {
      setSelesaiErrorKey(sessionErrorKey(result.status, result.code));
      return; // stay running; the tap can be retried
    }
    setSelesaiConfirmOpen(false);
    setLastEnded({
      business_date: session.local_date,
      end_reason: "selesai",
      debrief_ends_at_ms: endedAt + DEBRIEF_DURATION_MS,
    });
    stopRunningSession();
    setSession(null);
  }

  // ── Batalkan (§5.6, web spec §6.6.5) ────────────────────────────────────────
  function openBatalkan() {
    setSelesaiConfirmOpen(false);
    setBatalkanErrorKey(null);
    const now = Date.now();
    setBatalkanOpenedAtMs(now);
    setBatalkanTickMs(now);
    setBatalkanOpen(true);
  }
  function closeBatalkan() {
    setBatalkanOpen(false);
    setBatalkanOpenedAtMs(null);
  }
  async function confirmBatalkan() {
    if (!session || batalkanBusyRef.current) return;
    if (batalkanOpenedAtMs === null || !isDiscardArmed(batalkanOpenedAtMs, Date.now())) return;
    const auth = readDeviceAuth();
    if (!auth) return;
    batalkanBusyRef.current = true;
    setBatalkanBusy(true);
    const discardedAt = Date.now();
    const result = await postSessionDiscard(auth, session.session_id, {
      started_at_ms: session.started_at_ms,
      discarded_at_ms: discardedAt,
    });
    batalkanBusyRef.current = false;
    setBatalkanBusy(false);
    if (!result.ok) {
      setBatalkanErrorKey(sessionErrorKey(result.status, result.code));
      return;
    }
    setBatalkanOpen(false);
    setBatalkanOpenedAtMs(null);
    setLastEnded({
      business_date: session.local_date,
      end_reason: "discarded",
      debrief_ends_at_ms: null,
    });
    stopRunningSession();
    setSession(null);
  }

  // ── DEV-01 manual controls: same startCaptureSession()/session.stop() as
  // Mulai/Selesai, triggered by a button instead — entirely independent of the
  // Mulai/Selesai/Batalkan session bookkeeping (no postSessionStart/End/Discard
  // call), so a developer can exercise the audio pipeline without waiting on
  // the calendar. Only reachable when the dev panel is mounted. ────────────────
  const handleDevStart = () => {
    const auth = readDeviceAuth();
    if (!auth || !config || sessionRef.current || devStartingRef.current) return;
    devStartingRef.current = true;
    devStopRequestedRef.current = false;
    const gen = ++sessionGenRef.current;
    retainedUploadRef.current = beginSessionRetention(retainedUploadRef.current, gen);
    void (async () => {
      try {
        const captureSession = await startCaptureSession(auth, config, engineCallbacks(gen));
        if (!captureSession) return;
        if (devStopRequestedRef.current) {
          await captureSession.stop();
          return;
        }
        sessionRef.current = captureSession;
        setSessionRunning(true);
      } finally {
        devStartingRef.current = false;
      }
    })();
  };
  const handleDevStop = () => {
    devStopRequestedRef.current = true;
    stopRunningSession();
  };

  // ── idle view (no session open) ─────────────────────────────────────────────
  function renderDebriefFlow() {
    // nowMs is set by the mount-time tick effect before any debrief can
    // exist (debriefEndsAtMs only comes from a real Selesai/auto-stop, both
    // of which require config/nowMs already loaded), so the `nowMs === null`
    // arm is defensive only.
    if (debriefEndsAtMs === null || nowMs === null || !effectiveConfig) return null;
    const auth = readDeviceAuth();
    if (!auth) return null;
    return (
      <DebriefFlow
        key={debriefEndsAtMs}
        auth={auth}
        endsAtMs={debriefEndsAtMs}
        nowMs={nowMs}
        tz={effectiveConfig.timezone}
        nextMulaiText={nextMulaiText}
      />
    );
  }

  function renderIdle() {
    if (!idle) return null;
    return (
      <>
        {renderDebriefFlow()}
        <StatusBanner
          state={idle.headline}
          micSource={micSource}
          note={idle.note}
          endedAt={idle.endedAt ?? undefined}
        />
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          onClick={handleMulaiTap}
          disabled={mulaiBusy}
          aria-disabled={!idle.offered || mulaiBusy ? "true" : undefined}
        >
          {mulaiBusy ? t(lang, "C-b-mulai-busy") : t(lang, "C-b-mulai")}
        </button>
        {idle.offered ? <p style={{ fontSize: 14 }}>{t(lang, "C-h-idle-help")}</p> : null}
        {mulaiErrorKey ? (
          <p role="alert" style={{ color: "#b00020" }}>
            {t(lang, mulaiErrorKey)}
          </p>
        ) : null}
      </>
    );
  }

  // ── running view (a session is open) ────────────────────────────────────────
  function renderSelesaiArea() {
    if (!session || !config || nowMs === null) return null;
    const sv = selesaiViewFor({
      nowMs,
      session,
      weekly: config.weekly_hours,
      tz: config.timezone,
      lang,
    });
    if (!sv.ready) return <p>{sv.note}</p>;
    return (
      <button type="button" style={SECONDARY_BUTTON_STYLE} onClick={openSelesaiConfirm}>
        {t(lang, "C-b-selesai")}
      </button>
    );
  }

  function renderSelesaiConfirmPanel() {
    // nowMs is set by the mount-time tick effect before any session can
    // exist (Mulai is gated on it via `idle` above), so this is never the
    // fallback path in practice; the guard just avoids an impure render call.
    if (!session || !config || nowMs === null) return null;
    const tz = config.timezone;
    const now = nowMs;
    const nextDay = nextOpenLocalDate(session.local_date, config.weekly_hours);
    const nextMulaiMs = Math.max(
      zonedTimeToEpochMs(nextDay, "01:00", tz),
      now + 60 * 60_000,
    );
    return (
      <div role="group" aria-label={t(lang, "C-c-selesai-h")} style={PANEL_STYLE}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t(lang, "C-c-selesai-h")}</h2>
        <p>
          {t(lang, "C-c-selesai-b", {
            date: dayLabel(localDateOf(nextMulaiMs, tz), lang),
            time: clockLabel(nextMulaiMs, tz),
          })}
        </p>
        <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={closeSelesaiConfirm} autoFocus>
          {t(lang, "C-b-belum-lanjut")}
        </button>
        <button
          type="button"
          style={SECONDARY_BUTTON_STYLE}
          onClick={confirmSelesai}
          disabled={selesaiBusy}
        >
          {t(lang, "C-b-ya-selesai")}
        </button>
        {selesaiErrorKey ? (
          <p role="alert" style={{ color: "#b00020" }}>
            {t(lang, selesaiErrorKey)}
          </p>
        ) : null}
      </div>
    );
  }

  function renderBatalkanPanel() {
    // batalkanTickMs is set in the same call as batalkanOpenedAtMs
    // (openBatalkan) and on every subsequent fast tick while the panel is
    // open, so it is never null once batalkanOpenedAtMs isn't; the guard
    // just avoids an impure render call.
    if (!session || !config || batalkanOpenedAtMs === null || batalkanTickMs === null) {
      return null;
    }
    const tz = config.timezone;
    const now = batalkanTickMs;
    const armed = isDiscardArmed(batalkanOpenedAtMs, now);
    const body = nextMulaiIsNow(session.local_date, now, tz)
      ? t(lang, "C-c-cancel-b-now")
      : t(lang, "C-c-cancel-b", {
          date: dayLabel(nextOpenLocalDate(session.local_date, config.weekly_hours), lang),
        });
    return (
      <div
        role="group"
        aria-label={t(lang, "C-c-cancel-h", { time: clockLabel(session.started_at_ms, tz) })}
        style={PANEL_STYLE}
      >
        <h2 style={{ fontSize: 18, margin: 0 }}>
          {t(lang, "C-c-cancel-h", { time: clockLabel(session.started_at_ms, tz) })}
        </h2>
        <p>{body}</p>
        <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={closeBatalkan} autoFocus>
          {t(lang, "C-b-tetap-simpan")}
        </button>
        <button
          type="button"
          style={{ ...SECONDARY_BUTTON_STYLE, color: "#b00020" }}
          onClick={confirmBatalkan}
          disabled={!armed || batalkanBusy}
        >
          {t(lang, "C-b-ya-hapus")}
        </button>
        {batalkanErrorKey ? (
          <p role="alert" style={{ color: "#b00020" }}>
            {t(lang, batalkanErrorKey)}
          </p>
        ) : null}
      </div>
    );
  }

  function renderRunning() {
    return (
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
        {session ? (
          <>
            {!selesaiConfirmOpen && !batalkanOpen ? renderSelesaiArea() : null}
            {selesaiConfirmOpen ? renderSelesaiConfirmPanel() : null}
            {!selesaiConfirmOpen && !batalkanOpen ? (
              <button
                type="button"
                style={{ ...SECONDARY_BUTTON_STYLE, minHeight: 48 }}
                onClick={openBatalkan}
              >
                {t(lang, "C-b-batalkan")}
              </button>
            ) : null}
            {batalkanOpen ? renderBatalkanPanel() : null}
          </>
        ) : null}
      </>
    );
  }

  return (
    <main style={PAGE_STYLE}>
      <ShopTopBar />
      <h1 style={{ fontSize: 22 }}>{t(lang, "C-cap-title")}</h1>

      {devControlsEnabled ? (
        <DevPanel onStart={handleDevStart} onPause={handleDevStop} onStop={handleDevStop} events={events} />
      ) : null}

      {view === "loading" ? <p>{t(lang, "C-h-loading")}</p> : null}

      {view === "error" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18, color: "#b00020" }}>{t(lang, "C-h-error")}</h2>
          <p>{t(lang, "C-h-error-help")}</p>
        </section>
      ) : null}

      {view === "unsupported" ? (
        <section role="alert">
          <h2 style={{ fontSize: 18 }}>{t(lang, "C-h-unsupported")}</h2>
          <p>{t(lang, "C-h-unsupported-help")}</p>
        </section>
      ) : null}

      {view === "ready" ? (sessionRunning ? renderRunning() : renderIdle()) : null}

      {/* Upload block (UX-03 §5.7): shown in every mode, including idle and
          stopped. While a session runs it follows the live status; after a
          stop it keeps only the lost line and the retry row, until the next
          2xx. It never changes the headline. */}
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
