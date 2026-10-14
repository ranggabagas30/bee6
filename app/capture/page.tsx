"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
import { drawerInsetStyle, isCompactChrome, useDrawerLayout, type DrawerState } from "@/app/capture/drawer-layout";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { Button, Chip } from "@/app/ui";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { clockLabel, dayLabel } from "@/lib/i18n/format";
import { sessionErrorKey } from "@/lib/i18n/codes";
import {
  fetchCaptureConfig,
  postDemoClosing,
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
import { autoStopDeadline, selesaiReady } from "@/lib/capture/demo-session";
import {
  addDays,
  businessDateOf,
  closeMs,
  localDateOf,
  mulaiAvailability,
  mulaiWindowDateOf,
  nextOpenDay,
  zonedTimeToEpochMs,
  DEBRIEF_DURATION_MS,
} from "@/lib/capture/calendar";
import type { NextDayRefusal } from "@/lib/demo/contract";
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

/**
 * The R-18 script drawer (sandbox judge devices only). Loaded lazily and only rendered when the server's
 * capture config carries `demo_session`, so the pilot /capture never downloads the script text. The page
 * must not import the drawer or the script data statically (see app/demo/import-boundaries.test.ts).
 */
const ScriptDrawer = dynamic(() => import("@/app/capture/ScriptDrawer").then((m) => m.ScriptDrawer), {
  ssr: false,
});

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
 * R-19 (plan 4.4): the one-line reason shown under a locked Start on a sandbox. `unanswered_questions` is a
 * confirm dialog in the judge guide (PR-2), not a lock line, so it falls back to the guide hint.
 */
const NEXT_DAY_REASON_KEY: Record<Exclude<NextDayRefusal, "unanswered_questions">, DictKey> = {
  proposal_exists: "C-sess-next-day-proposal_exists",
  max_days: "C-sess-next-day-max_days",
  session_open: "C-sess-next-day-session_open",
  day_not_ended: "C-sess-next-day-day_not_ended",
  preparing: "C-sess-next-day-preparing",
  shift_incomplete: "C-sess-next-day-shift_incomplete",
  busy: "C-sess-next-day-busy",
};

/** The page's own copy for a closing-route failure (plan 5.4); the server's message is never shown. */
interface ClosingError {
  key: DictKey;
  vars?: Record<string, string | number>;
}

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
  // R-18 script drawer (sandbox only): open/collapsed is page state (the side-panel layout moves the page
  // column). Collapsed before Start; it opens by itself on Start (see the state change below).
  const [scriptOpen, setScriptOpen] = useState(false);
  const drawerLayout = useDrawerLayout();
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

  // R-19 PR-4a "Jump to closing time" (plan 5.4, 5.5; sandbox only). `closingReached` unlocks End for the
  // current local session; it resets on every Start. The error is the page's own copy (never server text).
  const closingBusyRef = useRef(false);
  const [closingBusy, setClosingBusy] = useState(false);
  const [closingReached, setClosingReached] = useState(false);
  const [closingError, setClosingError] = useState<ClosingError | null>(null);
  // R-19 PR-4a (plan 5.2): the sum of `segment_accepted` line COUNTS since Start. A number only; it never
  // sees a line. Shown through the dev readout; PR-5's script card reads it for "I have spoken this".
  const [linesThisSession, setLinesThisSession] = useState(0);

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

  // R-18: the script drawer exists only for a sandbox judge device (server field `demo_session`).
  const demoSession = config?.demo_session;
  const drawerState: DrawerState = session
    ? "running"
    : idle && !idle.offered && (idle.headline === "ended" || idle.headline === "ended_auto")
      ? "ended"
      : "before";
  // The drawer is collapsed before Start and opens by itself as Start is tapped (and on the ended text); a
  // return to "before" (Cancel session) collapses it again. A tap on its toggle wins until the next change.
  const [seenDrawerState, setSeenDrawerState] = useState<DrawerState>(drawerState);
  if (seenDrawerState !== drawerState) {
    setSeenDrawerState(drawerState);
    setScriptOpen(drawerState !== "before");
  }
  const compactChrome = isCompactChrome({ present: demoSession !== undefined, wide: drawerLayout.wide });

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
  // R-18: a sandbox has one demo day, so "You can tap Start again <date>" is never true there; no line at all.
  const nextMulaiText =
    effectiveConfig && nowMs !== null && effectiveConfig.demo_session === undefined
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
  const [autoStopBusy, setAutoStopBusy] = useState(false);
  useEffect(() => {
    // Also stay out while a Selesai (End dialog or the drawer's Finish) request is in flight: one end call only.
    if (!session || !config || nowMs === null || autoStopInFlightRef.current || selesaiBusyRef.current) return;
    const deadline = autoStopDeadline({
      localDate: session.local_date,
      startedAtMs: session.started_at_ms,
      weekly: config.weekly_hours,
      tz: config.timezone,
      maxMs: config.demo_session?.max_ms,
    });
    if (deadline === null || nowMs < deadline) return;
    const auth = readDeviceAuth();
    if (!auth) return;
    autoStopInFlightRef.current = true;
    const current = session;
    queueMicrotask(() => {
      setAutoStopBusy(true);
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
        // autoStopInFlightRef stays true until the next Mulai: this session is over, and a render that still
        // holds it (a tick between the render and the effect flush) must not end it a second time.
        setAutoStopBusy(false);
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

  // R-18: a sandbox session hard-stops at start + max_ms, so the clock must not wait for the 30 s tick.
  // Only while a demo session is open; a pilot page never runs this interval.
  const demoTicking = session !== null && config?.demo_session !== undefined;
  useEffect(() => {
    if (!demoTicking) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [demoTicking]);

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
      // Always wired (R-19 line counting needs it); the DEV-01 ring buffer only fills in dev mode.
      onEvent: (event: CaptureEvent) => {
        if (event.type === "segment_accepted" && isCurrent()) {
          setLinesThisSession((n) => n + event.lines);
        }
        if (devControlsEnabled) handleEvent(event);
      },
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
    // A new session: the previous one's end guards (Selesai, auto-stop) are done.
    selesaiBusyRef.current = false;
    autoStopInFlightRef.current = false;
    setMulaiBusy(true);
    setMulaiErrorKey(null);
    // R-19: closing and the heard-line count belong to one session each.
    setClosingReached(false);
    setClosingError(null);
    setLinesThisSession(0);
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
    // The page clock is only refreshed every 30 s: bring it up to now so the sandbox countdown (computed from
    // it) starts at 5:00 instead of showing the staleness (up to 5:30) until the first 1 s tick.
    setNowMs(Date.now());
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
    // The 10:00 auto-stop already ended (or is ending) this session: a second end call would race it and could
    // flip the headline from "Ended automatically" to a plain Selesai.
    if (!session || selesaiBusyRef.current || autoStopInFlightRef.current) return;
    // R-19 (plan 5.5): on a sandbox, End is locked until closing. The button is disabled before that; this guard
    // keeps the drawer's Finish and any stale handler honest too (the server would answer 409 closing_not_reached).
    if (config?.demo_session !== undefined && !closingReached) return;
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
    setSelesaiBusy(false);
    if (!result.ok) {
      selesaiBusyRef.current = false;
      setSelesaiErrorKey(sessionErrorKey(result.status, result.code));
      return; // stay running; the tap can be retried
    }
    // On success selesaiBusyRef stays true until the next Mulai, for the same reason as the auto-stop guard.
    setSelesaiConfirmOpen(false);
    setLastEnded({
      business_date: session.local_date,
      end_reason: "selesai",
      debrief_ends_at_ms: endedAt + DEBRIEF_DURATION_MS,
    });
    stopRunningSession();
    setSession(null);
  }

  // ── R-19 "Jump to closing time" (plan 5.4; sandbox only) ────────────────────
  // POST /api/v1/demo/closing for the current session. 200 unlocks End ("End today"); 409 not_enough_speech
  // shows the {have} of {need} line (counts from the server, zod-validated in the client); anything else the
  // generic line. The server guard is the only speech rule: the page never measures time or text.
  async function handleJumpToClosing() {
    if (!session || !config?.demo_session || closingReached) return;
    if (closingBusyRef.current || autoStopInFlightRef.current || selesaiBusyRef.current) return;
    const auth = readDeviceAuth();
    if (!auth) return;
    closingBusyRef.current = true;
    setClosingBusy(true);
    setClosingError(null);
    const result = await postDemoClosing(auth, session.session_id);
    closingBusyRef.current = false;
    setClosingBusy(false);
    if (result.ok) {
      setClosingReached(true);
      return;
    }
    if (result.status === 409 && result.code === "not_enough_speech" && result.details) {
      setClosingError({ key: "C-sess-closing-not-enough", vars: result.details });
      return;
    }
    setClosingError({ key: sessionErrorKey(result.status, result.code) });
  }

  // R-18: the drawer's Finish IS the Selesai confirmation (it skips the dialog) and runs the same handler.
  // It does nothing while the 10:00 auto-stop is already ending the session.
  // R-19 PR-4a: on a sandbox the first Finish is "Jump to closing time" (End is locked until then); once
  // closing is reached it is the Selesai path as before. PR-5 moves the jump into the judge guide card.
  function handleDrawerFinish() {
    if (autoStopInFlightRef.current) return;
    if (config?.demo_session !== undefined && !closingReached) {
      void handleJumpToClosing();
      return;
    }
    void confirmSelesai();
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
  // The debrief card sits above the primary slot (UX-03 §5.2 / plan §7.5),
  // and while a question is open it must replace the idle section entirely —
  // no headline, no Mulai, no `C-h-idle-help` underneath (tech-lead ruling,
  // UX-03 §5.8). `DebriefFlow` owns that placement via its `headline`/
  // `primary` slots; `renderIdle` only builds the two pieces and decides
  // whether a debrief exists to hand them to.
  function renderIdle() {
    if (!idle) return null;
    const headline = (
      <StatusBanner
        state={idle.headline}
        micSource={micSource}
        note={idle.note}
        endedAt={idle.endedAt ?? undefined}
        compact={compactChrome}
      />
    );
    // R-19 (plan 5.6), sandbox only: while Start is locked the button is NOT rendered; the unlock line and
    // either the guide hint (next_day allowed) or the one-line reason take its place. The pilot keeps its
    // disabled button exactly as before.
    const startLocked = demoSession !== undefined && !idle.offered;
    const nextDayReason = demoSession?.next_day.reason ?? null;
    const lockedHintKey: DictKey =
      nextDayReason === null || nextDayReason === "unanswered_questions"
        ? "C-sess-start-jump-hint"
        : NEXT_DAY_REASON_KEY[nextDayReason];
    const primary = (
      <>
        {startLocked ? (
          <>
            <p style={{ marginTop: 16, fontSize: 16, fontWeight: 700 }}>{t(lang, "C-sess-start-locked")}</p>
            <p style={{ fontSize: 14 }}>{t(lang, lockedHintKey)}</p>
          </>
        ) : (
          <button
            type="button"
            style={PRIMARY_BUTTON_STYLE}
            onClick={handleMulaiTap}
            disabled={mulaiBusy}
            aria-disabled={!idle.offered || mulaiBusy ? "true" : undefined}
          >
            {mulaiBusy ? t(lang, "C-b-mulai-busy") : t(lang, "C-b-mulai")}
          </button>
        )}
        {idle.offered ? <p style={{ fontSize: 14 }}>{t(lang, "C-h-idle-help")}</p> : null}
        {mulaiErrorKey ? (
          <p role="alert" style={{ color: "#b00020" }}>
            {t(lang, mulaiErrorKey)}
          </p>
        ) : null}
      </>
    );

    // nowMs is set by the mount-time tick effect before any debrief can
    // exist (debriefEndsAtMs only comes from a real Selesai/auto-stop, both
    // of which require config/nowMs already loaded), so the `nowMs === null`
    // arm is defensive only.
    const auth = debriefEndsAtMs !== null && nowMs !== null && effectiveConfig ? readDeviceAuth() : null;
    if (debriefEndsAtMs === null || nowMs === null || !effectiveConfig || !auth) {
      return (
        <>
          {headline}
          {primary}
        </>
      );
    }
    return (
      <DebriefFlow
        key={debriefEndsAtMs}
        auth={auth}
        endsAtMs={debriefEndsAtMs}
        nowMs={nowMs}
        tz={effectiveConfig.timezone}
        nextMulaiText={nextMulaiText}
        headline={headline}
        primary={primary}
        refresh={config?.demo_session !== undefined}
      />
    );
  }

  // ── running view (a session is open) ────────────────────────────────────────
  function renderSelesaiArea() {
    if (!session || !config || nowMs === null) return null;
    if (config.demo_session !== undefined) {
      // R-19 (plan 5.5), sandbox: End is ALWAYS rendered, really `disabled` (not only aria-disabled) with the
      // template outlet's closing time until "Jump to closing time", then enabled as "End today". `closeMs` is
      // null only on a closed weekday of the template hours, which the demo template never has.
      const close = closeMs(session.local_date, config.weekly_hours, config.timezone);
      const closeHm = close === null ? "--:--" : clockLabel(close, config.timezone);
      return (
        <Button
          variant="secondary"
          block
          style={{ marginTop: 12, minHeight: 48 }}
          disabled={!closingReached}
          onClick={openSelesaiConfirm}
        >
          {closingReached ? t(lang, "C-sess-end-today") : t(lang, "C-sess-end-locked", { time: closeHm })}
        </Button>
      );
    }
    const sv = selesaiViewFor({
      nowMs,
      session,
      weekly: config.weekly_hours,
      tz: config.timezone,
      lang,
      demo: selesaiReady(config.demo_session),
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
          {config.demo_session
            ? // Sandbox: one demo day, End has no restart, so no "tap Start again <date>".
              t(lang, "C-script-end-b")
            : t(lang, "C-c-selesai-b", {
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
          disabled={selesaiBusy || autoStopBusy}
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
    // Sandbox: Cancel is the retake path and Start is offered again at once, whatever the weekday hours say.
    const body = config.demo_session || nextMulaiIsNow(session.local_date, now, tz)
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
          compact={compactChrome}
        />
        {sampleRateMsg ? (
          <p role="alert" style={{ color: "#b00020", marginTop: 16 }}>
            {t(lang, "C-cap-rate")}
          </p>
        ) : null}
        {session ? (
          <>
            {!selesaiConfirmOpen && !batalkanOpen ? renderSelesaiArea() : null}
            {closingError && !selesaiConfirmOpen && !batalkanOpen ? (
              <p role="alert" style={{ color: "#b00020" }}>
                {t(lang, closingError.key, closingError.vars)}
              </p>
            ) : null}
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

  const inset = drawerInsetStyle({
    present: view === "ready" && demoSession !== undefined,
    wide: drawerLayout.wide,
    open: scriptOpen,
  });
  // Compact top-of-page chrome keeps banner + End + Cancel + the open drawer on one 360 x 640 screen.
  const mainPadding = compactChrome ? "12px 24px 24px" : PAGE_STYLE.padding;
  const mainStyle: React.CSSProperties =
    Object.keys(inset).length === 0
      ? { ...PAGE_STYLE, padding: mainPadding }
      : {
          maxWidth: 360,
          marginLeft: "auto",
          marginRight: "auto",
          padding: mainPadding,
          fontFamily: "system-ui, sans-serif",
          ...inset,
        };

  return (
    <main style={mainStyle}>
      <ShopTopBar compact={compactChrome} />
      <h1 style={compactChrome ? { fontSize: 22, margin: "0 0 8px" } : { fontSize: 22 }}>{t(lang, "C-cap-title")}</h1>
      {/* R-19 (Q6), sandbox only: "Day n of 3 · date". The date is the real local date (the shifted days are
          behind it); the pilot never renders this line. */}
      {view === "ready" && demoSession !== undefined && config && nowMs !== null ? (
        <p style={{ margin: "0 0 8px" }}>
          <Chip>
            {t(lang, "C-sess-day-of", {
              n: demoSession.day,
              total: demoSession.days_total,
              date: dayLabel(businessDateOf(nowMs, config.timezone), lang),
            })}
          </Chip>
        </p>
      ) : null}

      {devControlsEnabled ? (
        <DevPanel
          onStart={handleDevStart}
          onPause={handleDevStop}
          onStop={handleDevStop}
          events={events}
          linesHeard={linesThisSession}
        />
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

      {view === "ready" && demoSession ? (
        <ScriptDrawer
          scriptId={demoSession.script_id}
          lang={lang}
          state={drawerState}
          startedAtMs={session?.started_at_ms ?? null}
          maxMs={demoSession.max_ms}
          nowMs={nowMs}
          onFinish={handleDrawerFinish}
          finishing={closingBusy || selesaiBusy || autoStopBusy}
          open={scriptOpen}
          onToggle={() => setScriptOpen((o) => !o)}
          wide={drawerLayout.wide}
          reducedMotion={drawerLayout.reducedMotion}
        />
      ) : null}

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
