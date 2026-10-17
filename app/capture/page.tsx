"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBanner, headlineStateFor } from "@/app/capture/StatusBanner";
import { DevPanel } from "@/app/capture/DevPanel";
import {
  UploadStatusLine,
  deriveLostNotice,
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
import { OpenSessionView } from "@/app/capture/OpenSessionView";
import { SignOutDialog, type SignOutKind } from "@/app/capture/SignOutDialog";
import { configPollMs, dropOpenSession, markOpenSessionClosed, mergeRefreshedLastEnded } from "@/app/capture/config-refresh";
import { drawerInsetStyle, isCompactChrome, useDrawerLayout } from "@/app/capture/drawer-layout";
import { capturePhaseFor, publishCaptureBridge, useDebriefDoneFlag, useDebriefView, type CaptureBridgeActions } from "@/app/demo/guide-bridge";
import { StageScreen } from "@/app/capture/StageScreen";
import css from "@/app/capture/capture.module.css";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { Button, Mist } from "@/app/ui";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { clockLabel, dayLabel } from "@/lib/i18n/format";
import { sessionErrorKey } from "@/lib/i18n/codes";
import {
  clearDeviceAuth,
  fetchCaptureConfig,
  postDemoClosing,
  postSessionDiscard,
  postSessionEnd,
  postSessionStart,
  readDeviceAuth,
} from "@/lib/capture/browser/client";
import {
  startCaptureSession,
  type CaptureSession,
  type CaptureStopOptions,
  type CaptureStopResult,
} from "@/lib/capture/browser/session";
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
 * R-19 PR-5: the judge guide (script cards, Jump to closing time, Jump to tomorrow) lives in the root layout,
 * mounted only when DEMO_MODE is on. This page never imports it or the script data (see
 * app/demo/import-boundaries.test.ts); for a sandbox judge device it publishes ONE snapshot through
 * app/demo/guide-bridge.ts (profile, phase, counts, two callbacks; never text) and the guide subscribes.
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

/** R-19 PR-4b (plan 5.7): the longest the demo sign-out waits for the upload queue to drain. */
const SIGN_OUT_DRAIN_MAX_MS = 15_000;

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
  // Sandbox only: from 900 px the judge guide's side panel takes the right 360 px, so the page column moves left.
  const drawerLayout = useDrawerLayout();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [lastUploadStatus, setLastUploadStatus] = useState<CaptureStatus | null>(null);
  // R-23 L-3: the drop count the user dismissed. The "not captured" notice shows while the engine's drop count is
  // above it; a Start resets it with the (zeroed) retained status, so the notice ends at the next Start.
  const [dismissedDrops, setDismissedDrops] = useState(0);
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

  // R-19 PR-4b (plan 5.7; sandbox only): staff sign-out is LOCAL (clear the device pair, back to "/"). Before closing
  // it first cancels today through the existing discard route; after closing it touches no session route.
  const [signOutKind, setSignOutKind] = useState<SignOutKind | null>(null);
  const signOutBusyRef = useRef(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutFinishing, setSignOutFinishing] = useState(false);
  const [signOutErrorKey, setSignOutErrorKey] = useState<DictKey | null>(null);
  // R-19 PR-4b (plan 5.7a): End / Cancel from the open-session view (a server session this page is not running).
  const openBusyRef = useRef(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [openErrorKey, setOpenErrorKey] = useState<DictKey | null>(null);
  // R-19 PR-4b: bumped whenever the phone itself changes the session, so a config re-fetch that started earlier
  // can never overwrite what the phone just did.
  const configGenRef = useRef(0);

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

  // The sandbox journey profile exists only for a sandbox judge device (server field `demo_session`).
  const demoSession = config?.demo_session;
  const compactChrome = isCompactChrome({ present: demoSession !== undefined, wide: drawerLayout.wide });

  // R-19 PR-4b: the "cancel today" sign-out dialog promises a cancel. If the 10-min auto-stop ends the session
  // underneath it, that promise is gone (there is nothing left to cancel), so the dialog closes rather than letting
  // Confirm fall into the after-closing branch. Render-time sync, same shape as the drawer state above. The
  // dialog's `busy` also covers `autoStopBusy`, so Confirm cannot fire during the end call itself.
  if (signOutKind === "running" && session === null) {
    setSignOutKind(null);
  }

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
  // It returns the engine's stop promise (settles once the in-flight upload drained, or at `drainMs`, 5 s by
  // default) so the demo sign-out can wait for it; every other caller ignores it, as before.
  const stopRunningSession = useCallback((options?: CaptureStopOptions): Promise<CaptureStopResult | null> => {
    sessionGenRef.current += 1;
    const s = sessionRef.current;
    sessionRef.current = null;
    setSessionRunning(false);
    setStatus(null);
    return s ? s.stop(options) : Promise.resolve(null);
  }, []);

  // ── R-19 PR-4b: re-read the capture config (sandbox only) ──────────────────
  // The page loads it once at mount, but on a sandbox the answer changes under it: after End or Cancel, when the
  // debrief ends, after a next-day jump, and while `next_day` reports `busy`. A result is applied only if the
  // phone did not change the session since the request started (configGenRef), and never replaces the
  // phone-local `lastEnded` of the same day (it is the debrief's key). Failures keep the screen as it is.
  const refreshConfig = useCallback(async (): Promise<void> => {
    const auth = readDeviceAuth();
    if (!auth) return;
    const gen = configGenRef.current;
    try {
      const loaded = await fetchCaptureConfig(auth);
      if (gen !== configGenRef.current) return;
      setConfig(loaded);
      // NOTE (PR-7, owner reset): mergeRefreshedLastEnded keeps the phone's record when the server returns
      // last_ended null. Once the owner can reset the sandbox, a null from the server is legitimate (the day is
      // gone) and PR-7 must invalidate the local record there, or the phone keeps showing a day that no longer exists.
      setLastEnded((prev) => mergeRefreshedLastEnded(prev, loaded.last_ended));
    } catch {
      /* keep the config we have */
    }
  }, []);
  /** The phone ended or cancelled a session itself: invalidate older fetches, then read the server's view. */
  const afterSessionChanged = useCallback((): void => {
    configGenRef.current += 1;
    void refreshConfig();
  }, [refreshConfig]);

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
        if (config.demo_session !== undefined) afterSessionChanged();
      })();
    });
  }, [session, config, nowMs, stopRunningSession, afterSessionChanged]);

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

  // R-19 PR-4b: an idle sandbox phone re-reads its config every 30 s (5 s while `next_day` is `busy`, which is
  // transient) and when the tab becomes visible. Not while a session runs or Start is in flight, and never on
  // the pilot. This is also what shows the end of the debrief and a next-day jump without a reload.
  const refreshable = view === "ready" && demoSession !== undefined && session === null && !mulaiBusy;
  const pollMs = configPollMs(demoSession?.next_day.reason ?? null);
  useEffect(() => {
    if (!refreshable) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshConfig();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshConfig();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshable, pollMs, refreshConfig]);

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

  // R-23 L-3: a new engine starts at 0 drops, so the old notice ends at Start. The retained status still holds the
  // previous engine's drop count until the new engine's first report, so zero the displayed copy here (the retained
  // ref keeps its carried loss for the retry row) and forget the dismissed count.
  function resetLostNotice() {
    setDismissedDrops(0);
    setLastUploadStatus((s) => (s === null ? s : { ...s, droppedCount: 0 }));
  }

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
    // R-19 PR-4b: no config re-fetch started before this Start may land after it.
    configGenRef.current += 1;
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
    resetLostNotice();
    const captureSession = await startCaptureSession(
      auth,
      config,
      engineCallbacks(gen),
      sessionId,
    );
    mulaiInFlightRef.current = false;
    setMulaiBusy(false);
    if (!captureSession) return; // onUnsupported already switched the view
    // The page moved on while the engine was starting (unmount bumps the generation: a sign-out from the idle
    // branch, or navigation): this session has no owner, so release the mic now instead of uploading from a dead
    // page.
    if (gen !== sessionGenRef.current) {
      void captureSession.stop();
      return;
    }
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
    if (config?.demo_session !== undefined) afterSessionChanged();
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

  // ── R-19 PR-5: publish the guide bridge (sandbox only) ───────────────────────
  // The guide's "Jump to closing time" runs the latest handleJumpToClosing through a ref, so the published
  // actions object is stable and the snapshot is re-published only when one of its fields changes.
  const jumpRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    jumpRef.current = handleJumpToClosing;
  });
  const bridgeActions: CaptureBridgeActions = useMemo(
    () => ({ jumpToClosing: () => void jumpRef.current(), refetchConfig: refreshConfig }),
    [refreshConfig],
  );
  // The engine's own mic trouble, as a flag (drives the guide's "Not picking up your voice?" hint). R-23: mic only;
  // a stalled upload is `uploadBusy` and a drop is the page's own notice.
  const micTrouble = status !== null && (status.state === "mic_error" || status.micError !== null);
  // R-23: the queue head is being retried (server refusal or network failure): the guide says "Bee6 is catching up".
  const uploadBusy = status !== null && status.headFailedAttempts > 0;
  // R-23 L-3: the sticky "not captured" notice (until Dismiss or the next Start), read from the running engine, or
  // from the last one's retained status after a stop.
  const uploadSource = sessionRunning ? status : lastUploadStatus;
  const lostNotice = deriveLostNotice(uploadSource, dismissedDrops);
  const sessionId = session?.session_id ?? null;
  const sessionClosingReached = session ? closingReached : null;
  const startOffered = idle?.offered ?? false;
  // Re-read the moment the debrief's done screen writes it (R-19 PR-5 D3), not on the next 30 s tick.
  const debriefDoneFlag = useDebriefDoneFlag();
  // ...and the debrief's own screen (round-4 D2), so preparing -> question flips the phase with the page, not on
  // the guide's next config re-poll.
  const debriefView = useDebriefView();
  useEffect(() => {
    if (view !== "ready" || demoSession === undefined || nowMs === null) {
      publishCaptureBridge(null);
      return;
    }
    const phase = capturePhaseFor({
      profile: demoSession,
      session: sessionClosingReached === null ? null : { closingReached: sessionClosingReached },
      lastEnded,
      nowMs,
      debriefDoneFlag,
      debriefView,
      startOffered,
    });
    publishCaptureBridge({
      state: { profile: demoSession, phase, sessionId, linesThisSession, closingBusy, closingError, micTrouble, uploadBusy },
      actions: bridgeActions,
    });
  }, [view, demoSession, nowMs, sessionClosingReached, lastEnded, debriefDoneFlag, debriefView, startOffered, sessionId, linesThisSession, closingBusy, closingError, micTrouble, uploadBusy, bridgeActions]);
  useEffect(() => () => publishCaptureBridge(null), []);

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
    if (config?.demo_session !== undefined) afterSessionChanged();
  }

  // ── R-19 PR-4b: the open-session view's two actions (plan 5.7a) ─────────────
  // The server session this page is NOT running (a reload or a returning judge). End = the existing end route
  // (`selesai`, now), then the debrief as after any End. Cancel = the existing discard route, then Start is offered.
  // The business date is derived the way the server derived it for the stored start.
  function openSessionDate(startedAtMs: number): string | null {
    if (!config) return null;
    return mulaiWindowDateOf(startedAtMs, config.weekly_hours, config.timezone) ?? businessDateOf(startedAtMs, config.timezone);
  }
  async function handleOpenEnd() {
    const open = demoSession?.open_session;
    if (!open || openBusyRef.current) return;
    const auth = readDeviceAuth();
    const localDate = openSessionDate(open.started_at_ms);
    if (!auth || localDate === null) return;
    openBusyRef.current = true;
    setOpenBusy(true);
    setOpenErrorKey(null);
    const endedAt = Date.now();
    const result = await postSessionEnd(auth, open.session_id, {
      started_at_ms: open.started_at_ms,
      ended_at_ms: endedAt,
      end_reason: "selesai",
    });
    openBusyRef.current = false;
    setOpenBusy(false);
    if (!result.ok) {
      setOpenErrorKey(sessionErrorKey(result.status, result.code));
      return;
    }
    setLastEnded({ business_date: localDate, end_reason: "selesai", debrief_ends_at_ms: endedAt + DEBRIEF_DURATION_MS });
    setConfig((c) => (c ? dropOpenSession(c) : c));
    afterSessionChanged();
  }
  async function handleOpenCancel() {
    const open = demoSession?.open_session;
    if (!open || openBusyRef.current) return;
    const auth = readDeviceAuth();
    const localDate = openSessionDate(open.started_at_ms);
    if (!auth || localDate === null) return;
    openBusyRef.current = true;
    setOpenBusy(true);
    setOpenErrorKey(null);
    const result = await postSessionDiscard(auth, open.session_id, {
      started_at_ms: open.started_at_ms,
      discarded_at_ms: Date.now(),
    });
    openBusyRef.current = false;
    setOpenBusy(false);
    if (!result.ok) {
      if (result.status === 409 && result.code === "closing_reached") {
        // Closing was marked meanwhile: the day can no longer be cancelled, only ended.
        setConfig((c) => (c ? markOpenSessionClosed(c) : c));
        return;
      }
      setOpenErrorKey(sessionErrorKey(result.status, result.code));
      return;
    }
    setLastEnded({ business_date: localDate, end_reason: "discarded", debrief_ends_at_ms: null });
    setConfig((c) => (c ? dropOpenSession(c) : c));
    afterSessionChanged();
  }

  // ── R-19 PR-4b: demo staff sign-out (plan 5.7; local) ───────────────────────
  function finishSignOut() {
    clearDeviceAuth();
    router.replace("/");
  }
  function handleSignOutTap() {
    // Not while Start is in flight: the engine may still be starting, and a sign-out now would leave the mic on
    // and the engine uploading from an unmounted page. The button is disabled too; this keeps a stale tap honest.
    if (signOutBusyRef.current || mulaiInFlightRef.current || openBusyRef.current) return;
    setSignOutErrorKey(null);
    if (session) {
      setSignOutKind(closingReached ? "closed" : "running");
      return;
    }
    // No running session on this page. A server session that is still open past closing time stays open, so say so;
    // an interrupted one (or none) is not touched and the judge leaves at once.
    if (demoSession?.open_session?.closing_reached) {
      setSignOutKind("closed");
      return;
    }
    finishSignOut();
  }
  async function confirmSignOut() {
    if (signOutKind === null || signOutBusyRef.current) return;
    signOutBusyRef.current = true;
    setSignOutBusy(true);
    setSignOutErrorKey(null);
    if (signOutKind === "running" && session) {
      // Before closing: signing out cancels today, through the existing discard route. A failure keeps the judge here.
      const auth = readDeviceAuth();
      if (!auth) {
        finishSignOut();
        return;
      }
      const result = await postSessionDiscard(auth, session.session_id, {
        started_at_ms: session.started_at_ms,
        discarded_at_ms: Date.now(),
      });
      if (!result.ok) {
        signOutBusyRef.current = false;
        setSignOutBusy(false);
        if (result.status === 409 && result.code === "closing_reached") {
          // The server already marked closing: nothing can be cancelled, and nothing was deleted.
          setClosingReached(true);
          setSignOutKind("closed");
          return;
        }
        setSignOutErrorKey(sessionErrorKey(result.status, result.code));
        return;
      }
      configGenRef.current += 1;
      void stopRunningSession();
      finishSignOut();
      return;
    }
    // After closing (or an open session past closing): no session route at all. Stop the engine (mic off, wake lock
    // released, no end POST), then give the in-memory upload queue at most 15 s to drain. The engine's own stop()
    // bounds the drain at 5 s by default, so the 15 s is passed down to it; the race here is only the outer guard
    // should the stop promise itself hang (it never waits on an upload beyond `drainMs`).
    setSignOutFinishing(session !== null);
    configGenRef.current += 1;
    const drain = stopRunningSession({ drainMs: SIGN_OUT_DRAIN_MAX_MS });
    if (session !== null) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        drain.catch((): null => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SIGN_OUT_DRAIN_MAX_MS);
        }),
      ]);
      clearTimeout(timer);
      // Observability for the judge run: a COUNT only (hard rule #7: no text, no session or device id).
      // `droppedCount` alone undercounts (queue overflow and pump give-ups only); the segments still queued or in
      // flight when the drain ended are the other half.
      console.info(
        "[capture] demo sign-out after closing: segments dropped by the engine:",
        result?.droppedCount ?? 0,
        "still queued or in flight:",
        result?.queuedCount ?? 0,
      );
    }
    finishSignOut();
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
    resetLostNotice();
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

  // ── R-25 T5: sandbox screen pieces ───────────────────────────────────────────
  // A sandbox device (server field `demo_session`) gets the page-2 staff screen; the pilot keeps its screen.
  const sandbox = demoSession !== undefined;
  // R-19 (Q6): "Day n of 3 · date". The date is the real local date (the shifted days are behind it).
  const dayLine =
    view === "ready" && demoSession !== undefined && config && nowMs !== null
      ? t(lang, "C-sess-day-of", {
          n: demoSession.day,
          total: demoSession.days_total,
          date: dayLabel(businessDateOf(nowMs, config.timezone), lang),
        })
      : null;
  /**
   * The one quiet sign-out control of the footer (board P2-05: a text link, not a button pair). Before closing, while a
   * session runs, it is the red "cancels today's session" link; otherwise a muted "Sign out". Same handler as the old
   * header button, same disabled rule.
   */
  function renderSignOutLink(tone: "muted" | "danger") {
    return (
      <button
        type="button"
        className={[css.link, tone === "danger" ? css.linkDanger : undefined].filter(Boolean).join(" ")}
        onClick={handleSignOutTap}
        disabled={signOutBusy || selesaiBusy || autoStopBusy || closingBusy || mulaiBusy || openBusy}
      >
        {t(lang, tone === "danger" ? "C-sess-signout-running-link" : "C-sess-signout")}
      </button>
    );
  }
  /** Capture privacy notice (UX-03 §5.10): a muted notice, not a consent gate (CLAUDE.md §7b). */
  function renderNote() {
    return (
      <p data-testid="capture-notice" className={css.note}>
        {t(lang, "C-notice-pilot")}
      </p>
    );
  }

  // ── idle view (no session open) ─────────────────────────────────────────────
  // The debrief card sits above the primary slot (UX-03 §5.2 / plan §7.5),
  // and while a question is open it must replace the idle section entirely —
  // no headline, no Mulai, no `C-h-idle-help` underneath (tech-lead ruling,
  // UX-03 §5.8). `DebriefFlow` owns that placement via its `headline`/
  // `primary` slots; `renderIdle` only builds the two pieces and decides
  // whether a debrief exists to hand them to.
  function renderIdle() {
    // R-19 PR-4b (plan 5.7a): a still-open server session of this device replaces the idle screen (and its Start)
    // entirely. The page never resumes listening into it; it can only be ended (past closing) or cancelled.
    const openSession = demoSession?.open_session ?? null;
    if (openSession) {
      return (
        <>
          <OpenSessionView
            lang={lang}
            closingReached={openSession.closing_reached}
            busy={openBusy}
            errorKey={openErrorKey}
            onEnd={() => void handleOpenEnd()}
            onCancel={() => void handleOpenCancel()}
          />
          <div className={css.foot}>{renderSignOutLink("muted")}</div>
        </>
      );
    }
    if (!idle) return null;
    // R-25 T5: a sandbox gets the page-2 stage instead of the status banner; the pilot keeps the banner as before.
    const headline = sandbox ? null : (
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
    // `day_not_ended` can never be true while Start is locked (the day already ended), and the jump is not
    // allowed either, so it gets no reason line and no jump hint.
    const lockedHintKey: DictKey | null =
      nextDayReason === "day_not_ended"
        ? null
        : nextDayReason === null || nextDayReason === "unanswered_questions"
          ? "C-sess-start-jump-hint"
          : NEXT_DAY_REASON_KEY[nextDayReason];
    const sandboxPrimary = sandbox ? (
      <>
        {startLocked ? (
          <>
            <Button size="lg" block disabled>
              {t(lang, "C-sess-start-locked")}
            </Button>
            {lockedHintKey ? <p className={css.lock}>{t(lang, lockedHintKey)}</p> : null}
          </>
        ) : (
          <Button
            size="lg"
            block
            onClick={handleMulaiTap}
            disabled={mulaiBusy}
            aria-disabled={!idle.offered || mulaiBusy ? "true" : undefined}
          >
            {mulaiBusy ? t(lang, "C-b-mulai-busy") : t(lang, "C-b-mulai")}
          </Button>
        )}
        {mulaiErrorKey ? (
          <p role="alert" className={css.alert}>
            {t(lang, mulaiErrorKey)}
          </p>
        ) : null}
      </>
    ) : null;
    const primary = sandbox ? (
      <>
        {sandboxPrimary}
        {renderSignOutLink("muted")}
      </>
    ) : (
      <>
        {startLocked ? (
          <>
            <p style={{ marginTop: 16, fontSize: 16, fontWeight: 700 }}>{t(lang, "C-sess-start-locked")}</p>
            {lockedHintKey ? <p style={{ fontSize: 14 }}>{t(lang, lockedHintKey)}</p> : null}
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
      if (sandbox) {
        const ended = !idle.offered;
        const title = ended
          ? idle.headline === "ended_auto"
            ? t(lang, "C-h-ended-auto", { time: idle.endedAt ?? "" })
            : t(lang, idle.headline === "discarded" ? "C-h-discarded" : "C-h-ended")
          : idle.headline === "discarded"
            ? t(lang, "C-h-discarded")
            : t(lang, "C-sess-ready-h");
        const subText = ended ? idle.note : t(lang, "C-sess-ready-sub");
        return (
          <StageScreen
            tone={ended ? "done" : "idle"}
            orbLabel={ended ? undefined : t(lang, "C-b-mulai")}
            title={title}
            sub={subText ? <p className={css.sub}>{subText}</p> : null}
            mono={dayLine}
          >
            {sandboxPrimary}
            {renderNote()}
            {renderSignOutLink("muted")}
          </StageScreen>
        );
      }
      return (
        <>
          {headline}
          {primary}
        </>
      );
    }
    return (
      <>
        {/* R-25 T5: the debrief screens carry their own h2 until R-25 T7 gives each its stage and h1; the page keeps one h1. */}
        {sandbox ? <h1 className="b6-sr-only">{t(lang, "C-cap-title")}</h1> : null}
        {dayLine ? <p className={css.mono} style={{ textAlign: "center", margin: "0 0 12px" }}>{dayLine}</p> : null}
        <DebriefFlow
          key={debriefEndsAtMs}
          auth={auth}
          endsAtMs={debriefEndsAtMs}
          nowMs={nowMs}
          tz={effectiveConfig.timezone}
          nextMulaiText={nextMulaiText}
          headline={headline}
          primary={primary}
          demo={config?.demo_session !== undefined}
        />
      </>
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
        <Button size="lg" block disabled={!closingReached} onClick={openSelesaiConfirm}>
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

  /** R-25 T5, sandbox only (boards P2-05 / P2-05d / P2-06): the listening stage; End, then the one sign-out link. */
  function renderSandboxRunning() {
    const micError = headlineStateFor(status?.state ?? "listening") === "mic_error";
    return (
      <StageScreen
        tone={micError ? "idle" : "listening"}
        title={t(lang, micError ? "C-h-mic" : "C-h-listening")}
        sub={
          micError ? (
            <p className={css.alert}>{t(lang, "C-h-mic-help")}</p>
          ) : (
            <p className={css.sub}>
              {closingReached ? (
                t(lang, "C-sess-closing-sub")
              ) : (
                <>
                  {t(lang, "C-sess-listening-sub-1")}
                  <br />
                  {t(lang, "C-sess-listening-sub-2")}
                </>
              )}
            </p>
          )
        }
        mono={dayLine}
      >
        {sampleRateMsg ? (
          <p role="alert" className={css.alert}>
            {t(lang, "C-cap-rate")}
          </p>
        ) : null}
        {session ? (
          <>
            {!selesaiConfirmOpen ? renderSelesaiArea() : null}
            {closingError && !selesaiConfirmOpen ? (
              <p role="alert" className={css.alert}>
                {t(lang, closingError.key, closingError.vars)}
              </p>
            ) : null}
            {selesaiConfirmOpen ? renderSelesaiConfirmPanel() : null}
            {!selesaiConfirmOpen ? renderSignOutLink(closingReached ? "muted" : "danger") : null}
          </>
        ) : null}
        {renderNote()}
      </StageScreen>
    );
  }

  function renderRunning() {
    if (sandbox) return renderSandboxRunning();
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
            {!selesaiConfirmOpen && !batalkanOpen && !(config?.demo_session !== undefined && closingReached) ? (
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
  });
  // R-25 T5: the page-2 screen is for a sandbox device. Its config is what says so, so loading / error (no config yet)
  // keep the plain markup; a loaded pilot keeps the screen it always had. One tree for both, with fixed slots, so
  // nothing (the dev panel, the upload block) remounts when the config arrives.
  const modern = sandbox;
  // Compact top-of-page chrome keeps banner + End + Cancel above the guide's collapsed handle on a 360 x 640 screen.
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
    <div className={modern ? css.page : undefined}>
      {modern ? <Mist /> : null}
      <main className={modern ? css.column : undefined} style={modern ? inset : mainStyle}>
        <ShopTopBar compact={modern || compactChrome} />
        {/* The outlet line of the board (the demo outlet is the only one a sandbox can pair). */}
        {modern ? <p className={css.outlet}>{t(lang, "C-sess-outlet-demo")}</p> : null}
        {modern ? null : (
          <h1 style={compactChrome ? { fontSize: 22, margin: "0 0 8px" } : { fontSize: 22 }}>{t(lang, "C-cap-title")}</h1>
        )}

        {devControlsEnabled ? (
          <DevPanel
            onStart={handleDevStart}
            onPause={handleDevStop}
            onStop={handleDevStop}
            events={events}
            linesHeard={linesThisSession}
          />
        ) : null}

        {/* One polite status for the headline (the pilot's StatusBanner does this job there). It is mounted for the
            whole sandbox screen, so Start -> "Listening" and a mic problem are announced; the stage is decorative. */}
        {modern ? (
          <p role="status" aria-live="polite" aria-atomic="true" className="b6-sr-only">
            {sessionRunning
              ? headlineStateFor(status?.state ?? "listening") === "mic_error"
                ? `${t(lang, "C-h-mic")}. ${t(lang, "C-h-mic-help")}`
                : t(lang, "C-h-listening")
              : ""}
          </p>
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

        {signOutKind !== null ? (
          <SignOutDialog
            kind={signOutKind}
            lang={lang}
            busy={signOutBusy || autoStopBusy}
            finishing={signOutFinishing}
            errorKey={signOutErrorKey}
            onConfirm={() => void confirmSignOut()}
            onDismiss={() => setSignOutKind(null)}
          />
        ) : null}

        {/* Upload block (UX-03 §5.7): shown in every mode, including idle and
            stopped. While a session runs it follows the live status; after a
            stop it keeps the lost notice (until Dismiss or the next Start, R-23)
            and the retry row. It never changes the headline. */}
        <UploadStatusLine
          view={
            sessionRunning
              ? deriveUploadView(status)
              : deriveRetainedUploadView(lastUploadStatus)
          }
          lost={lostNotice}
          onDismissLost={() => setDismissedDrops(uploadSource?.droppedCount ?? 0)}
          online={networkOnline}
          httpStatus={
            sessionRunning ? status?.lastUploadHttpStatus : lastUploadStatus?.lastUploadHttpStatus
          }
        />
        {/* Capture privacy notice (UX-03 §5.10): a muted notice, not a consent
            gate (CLAUDE.md §7b). One per page, in the page's language, every mode. On a sandbox it sits in the
            stage screens' footer (renderNote), right under the action, as on the board. */}
        {modern ? null : (
          <p data-testid="capture-notice" style={{ marginTop: 24, fontSize: 14, color: "#444" }}>
            {t(lang, "C-notice-pilot")}
          </p>
        )}
      </main>
    </div>
  );
}
