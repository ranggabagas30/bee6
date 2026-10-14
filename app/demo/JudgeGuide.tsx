"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { authedGetJson } from "@/lib/auth/client/api";
import { getClientAuth } from "@/lib/auth/client/firebase-client";
import { postDemoNextDay, readDeviceAuth } from "@/lib/capture/browser/client";
import { DEMO_DAYS_TOTAL } from "@/lib/demo/constants";
import { DemoProgressResponseSchema, type NextDayRefusal } from "@/lib/demo/contract";
import { DEMO_STAFF_CODE } from "@/lib/demo/credentials";
import {
  guideCard,
  STAGES,
  cardState,
  currentStage,
  guideKeyFor,
  jumpLockText,
  stageIndex,
  type Bilingual,
  type GuideKey,
  type GuideState,
  type JourneyProgress,
} from "@/lib/demo/guide";
import { scriptFor, type ScriptCardV2, type ScriptDay, type ScriptSpeaker } from "@/lib/demo/script";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { Button, Kicker, Sheet, SidePanel, StepTick } from "@/app/ui";
import { demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { useCaptureBridge, type CaptureBridge } from "@/app/demo/guide-bridge";
import { GUIDE_CONTROLS } from "@/app/demo/guide-controls";

/**
 * R-19 PR-5 judge guide (docs/tasks/R-19-demo-v2.md section 7; one card per screen, no tabs). Mounted by the root
 * layout ONLY when DEMO_MODE is on (through JudgeGuideLoader, a lazy chunk), so the pilot never renders it.
 *
 * - Phone (< 900 px): a collapsed bottom-sheet handle "JUDGE GUIDE · STAGE n OF 5 · <card title> · Day n of 3";
 *   laptop (>= 900 px): a pill top-right opening a 360 px side panel. Collapsed by default, after every route
 *   change and after every card change (except listening -> all spoken, one flow). Non-modal, no focus trap.
 * - Contents: the 5-stage list, then the ONE card of `guideKeyFor(route, state)`.
 * - /capture: state comes from the page's published bridge (app/demo/guide-bridge.ts); the card exists only
 *   when a sandbox judge device published one. Web routes: state is the demo role (localStorage) plus
 *   GET /api/v1/demo/progress. Entry and pairing routes need no state.
 * - One language at a time (`useLang`); the Bahasa column is PROVISIONAL (EN text with a note in ID mode).
 * No audio, no transcript text, no name: the guide only ever reads counts, phases and its own copy.
 */

export const SUPERVISOR_SEEN_KEY = "bee6.guide.sup_seen";
/** sessionStorage key of the spoken-cards progress of one local session (`{ spoken: string[] }`). */
export const scriptStorageKey = (sessionId: string) => `bee6.script.${sessionId}`;
/**
 * Bottom space the page keeps free under the collapsed sheet handle (grip + two text lines + padding), so Start,
 * End and Cancel are never covered. The safe-area inset is added on top (the sheet pads itself by it too).
 */
export const SHEET_RESERVE_PX = 96;
/** While the server says `busy` or `preparing`, or the phone is in the debrief, the config is re-read this often. */
export const CONFIG_REPOLL_MS = 10_000;

const WIDE_QUERY = "(min-width: 900px)";
const STAGE_TOTAL = STAGES.length;

const NEXT_DAY_REASON_KEY: Record<Exclude<NextDayRefusal, "unanswered_questions">, DictKey> = {
  proposal_exists: "C-journey-next-day-proposal_exists",
  max_days: "C-journey-next-day-max_days",
  session_open: "C-journey-next-day-session_open",
  day_not_ended: "C-journey-next-day-day_not_ended",
  preparing: "C-journey-next-day-preparing",
  shift_incomplete: "C-journey-next-day-shift_incomplete",
  busy: "C-journey-next-day-busy",
};
/** Reasons that clear by themselves: the guide re-polls instead of offering a retry tap. */
const TRANSIENT_REASONS: ReadonlySet<NextDayRefusal> = new Set(["busy", "preparing"]);

const SPEAKER_KEY: Record<ScriptSpeaker, DictKey> = {
  staff: "C-journey-speaker-staff",
  customer: "C-journey-speaker-customer",
  caller: "C-journey-speaker-caller",
};

const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
const CARD_TITLE: CSSProperties = { fontSize: 18, fontWeight: 600, margin: 0, outline: "none" };
const BODY_LINE: CSSProperties = { margin: "6px 0 0", fontSize: 15, lineHeight: 1.45 };
const FOOTNOTE: CSSProperties = { margin: "10px 0 0", fontSize: 13, color: "var(--b6-muted)" };
const ERROR_LINE: CSSProperties = { margin: "8px 0 0", fontSize: 14, color: "var(--b6-red-ink)" };
const MUTED_LINE: CSSProperties = { margin: "8px 0 0", fontSize: 14, color: "var(--b6-muted)" };
const SCRIPT_BOX: CSSProperties = { maxHeight: "50vh", overflowY: "auto", margin: "8px 0 0", padding: "10px 12px", borderRadius: 12, background: "var(--b6-surface-soft)" };
const SPEAKER_TAG: CSSProperties = { display: "block", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--b6-muted)", margin: "10px 0 2px" };
const LINE_TEXT: CSSProperties = { margin: 0, fontSize: 18, lineHeight: 1.4 };
/** Every guide control is at least 48 px high (plan 7.2); the Button look alone is 44. */
const GUIDE_BUTTON: CSSProperties = { minHeight: 48 };
const LINK_BUTTON: CSSProperties = { background: "none", border: 0, padding: "12px 0", minHeight: 48, font: "inherit", fontSize: 14, color: "var(--b6-teal-ink)", textDecoration: "underline", cursor: "pointer" };

function useWide(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window.matchMedia !== "function") return () => {};
    const mq = window.matchMedia(WIDE_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY).matches : false),
    () => false,
  );
}

function pick(text: Bilingual, lang: Lang): string {
  return text[lang];
}

/** `{code}` in guide copy is the demo pairing code (never a literal in copy, see import-boundaries.test). */
function fill(text: string): string {
  return text.replace(/\{code\}/g, DEMO_STAFF_CODE);
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the stage list is simply one step behind.
  }
}

function readSpoken(sessionId: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(scriptStorageKey(sessionId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    const spoken = (parsed as { spoken?: unknown } | null)?.spoken;
    return Array.isArray(spoken) ? spoken.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}
function writeSpoken(sessionId: string, spoken: string[]): void {
  try {
    window.sessionStorage.setItem(scriptStorageKey(sessionId), JSON.stringify({ spoken }));
  } catch {
    // A reload then starts at card 1 again; nothing else is lost.
  }
}

export interface JudgeGuideProps {
  config: FirebaseWebConfig | null;
}

export function JudgeGuide({ config }: JudgeGuideProps) {
  const { lang } = useLang();
  const pathname = usePathname() ?? "/";
  const wide = useWide();
  const bridge = useCaptureBridge();
  const demoSnap = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const demoView = viewFromSnapshot(demoSnap);
  const webRole = demoView && !demoView.expired && demoView.state.role !== "staff" ? demoView.state.role : null;

  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  const isEntry = seg === "" || seg === "sign-in" || seg === "pair";
  const isCapture = seg === "capture";

  // ── web progress (supervisor / owner): on mount, on every route change, and each time the guide is opened ──
  const [progress, setProgress] = useState<JourneyProgress | null>(null);
  const [open, setOpen] = useState(false);
  // "Supervisor visited" (plan 7.1): true the moment any supervisor page is on screen, and remembered in
  // localStorage for the later stages. Derived, not set in the effect: the effect only persists it.
  const [visitedStored] = useState(() => readLocal(SUPERVISOR_SEEN_KEY) === "1");
  const supervisorHere = !isEntry && !isCapture && webRole === "supervisor";
  const visited = visitedStored || supervisorHere;
  useEffect(() => {
    if (supervisorHere) writeLocal(SUPERVISOR_SEEN_KEY, "1");
  }, [supervisorHere]);
  useEffect(() => {
    if (isEntry || isCapture || webRole === null || !config) return;
    let cancelled = false;
    void (async () => {
      const result = await authedGetJson(getClientAuth(config), "/api/v1/demo/progress", DemoProgressResponseSchema);
      if (cancelled || result.kind !== "ok") return; // a failed read keeps the default card
      setProgress((prev) => ({ ...result.data, supervisor_visited: prev?.supervisor_visited ?? false }));
    })();
    return () => {
      cancelled = true;
    };
  }, [isEntry, isCapture, webRole, config, pathname, open]);

  // ── the one card ──────────────────────────────────────────────────────────────────────────────────────────
  // The session whose 5 cards are all marked spoken (reported by the script card); a new session id resets it.
  const [allSpokenFor, setAllSpokenFor] = useState<string | null>(null);
  const allSpoken = bridge !== null && bridge.state.sessionId !== null && allSpokenFor === bridge.state.sessionId;
  const state: GuideState | null = isCapture
    ? bridge
      ? { kind: "capture", phase: bridge.state.phase === "listening" && allSpoken ? "all_spoken" : bridge.state.phase }
      : null
    : webRole !== null
      ? { kind: "web", role: webRole, progress: progress ? { ...progress, supervisor_visited: visited } : null }
      : null;
  const key = guideKeyFor(pathname, state);
  const day = bridge ? bridge.state.profile.day : null;
  const openClosingReached = bridge?.state.profile.open_session?.closing_reached;
  const card = guideCard(key, day, { openClosingReached });

  const journey: JourneyProgress = useMemo(() => {
    if (bridge) {
      return { day: bridge.state.profile.day, days_done: bridge.state.profile.days_done, proposals_with_content: 0, feasible: 0, owner_decided: 0, supervisor_visited: visited };
    }
    return progress ? { ...progress, supervisor_visited: visited } : { day: 1, days_done: 0, proposals_with_content: 0, feasible: 0, owner_decided: 0, supervisor_visited: visited };
  }, [bridge, progress, visited]);
  const stage = currentStage(journey);
  const stageN = stageIndex(stage) + 1;

  // Collapsed on every route change and card change; listening -> all spoken is one flow and keeps it open.
  const prevRef = useRef({ pathname, key });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { pathname, key };
    if (prev.pathname === pathname && prev.key === key) return;
    const sameFlow = prev.pathname === pathname && prev.key === "capture_listening" && key === "capture_all_spoken";
    if (!sameFlow) setOpen(false);
  }, [pathname, key]);

  // ── config refetches: once on every debrief phase change (End, preparing -> questions, debrief end), and a
  // 10 s re-poll while the next-day reason is transient (`busy`, `preparing`): a line, never a retry tap. ──────
  const phase = bridge?.state.phase ?? null;
  const reason = bridge?.state.profile.next_day.reason ?? null;
  const refetch = bridge?.actions.refetchConfig;
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase !== null && phase !== prev && phase.startsWith("debrief")) void refetch?.();
  }, [phase, refetch]);
  const transient = reason !== null && TRANSIENT_REASONS.has(reason);
  useEffect(() => {
    if (!transient || !refetch) return;
    const id = setInterval(() => void refetch(), CONFIG_REPOLL_MS);
    return () => clearInterval(id);
  }, [transient, refetch]);

  if (isCapture && !bridge) return null;
  if (!isEntry && !isCapture && webRole === null) return null;

  const title = pick(card.title, lang);
  const dayText = bridge ? t(lang, "C-journey-guide-day", { n: bridge.state.profile.day, total: DEMO_DAYS_TOTAL }) : null;

  const body = (
    <>
      {lang === "id" ? <p style={MUTED_LINE}>{t(lang, "C-journey-id-soon")}</p> : null}
      <section aria-label={t(lang, "C-journey-guide-stages")}>
        <Kicker>{t(lang, "C-journey-guide-stages").toUpperCase()}</Kicker>
        <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {STAGES.map((s, i) => {
            const status = i + 1 < stageN ? "done" : i + 1 === stageN ? "now" : "todo";
            return (
              <StepTick key={s.id} as="li" status={status} statusLabel={t(lang, status === "done" ? "C-journey-stage-done" : status === "now" ? "C-journey-stage-now" : "C-journey-stage-todo")}>
                {pick(s.title, lang)}
              </StepTick>
            );
          })}
        </ol>
      </section>
      <GuideCardView
        key={key}
        guideKey={key}
        day={day}
        openClosingReached={openClosingReached}
        lang={lang}
        bridge={bridge}
        onAllSpoken={setAllSpokenFor}
      />
    </>
  );

  if (wide) {
    return (
      <SidePanel
        label={t(lang, "C-journey-guide-label")}
        open={open}
        onOpenChange={setOpen}
        openLabel={t(lang, "C-journey-guide-open")}
        closeLabel={t(lang, "C-journey-guide-close")}
        pill={<span>{t(lang, "C-journey-guide-pill", { n: stageN, total: STAGE_TOTAL })}</span>}
        bodyLabelledBy={`guide-card-${key}`}
        header={
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <Kicker>{t(lang, "C-journey-guide-handle", { n: stageN, total: STAGE_TOTAL })}</Kicker>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{dayText ? `${title} · ${dayText}` : title}</span>
          </span>
        }
      >
        {body}
      </SidePanel>
    );
  }

  return (
    <>
      <div data-testid="guide-sheet-reserve" aria-hidden="true" style={{ height: `calc(${SHEET_RESERVE_PX}px + env(safe-area-inset-bottom))` }} />
      <Sheet
        label={t(lang, "C-journey-guide-label")}
        open={open}
        onOpenChange={setOpen}
        openLabel={t(lang, "C-journey-guide-open")}
        closeLabel={t(lang, "C-journey-guide-close")}
        bodyLabelledBy={`guide-card-${key}`}
        handle={
          <>
            <Kicker>{t(lang, "C-journey-guide-handle", { n: stageN, total: STAGE_TOTAL })}</Kicker>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{dayText ? `${title} · ${dayText}` : title}</span>
          </>
        }
      >
        {body}
      </Sheet>
    </>
  );
}

// ── the card ─────────────────────────────────────────────────────────────────────────────────────────────────

interface GuideCardViewProps {
  guideKey: GuideKey;
  /** The demo day on /capture (the debrief cards read differently on day 1), else null. */
  day: number | null;
  /** The open session's closing flag on /capture (the open-session card says End today or Cancel today), else undefined. */
  openClosingReached: boolean | undefined;
  lang: Lang;
  bridge: CaptureBridge | null;
  /** Called with the session id once every card of the day is marked spoken. */
  onAllSpoken: (sessionId: string) => void;
}

function GuideCardView({ guideKey, day, openClosingReached, lang, bridge, onAllSpoken }: GuideCardViewProps) {
  const card = guideCard(guideKey, day, { openClosingReached });
  const action = card.action;
  return (
    <article aria-labelledby={`guide-card-${guideKey}`}>
      <h2 id={`guide-card-${guideKey}`} style={CARD_TITLE}>
        {pick(card.title, lang)}
      </h2>
      {card.body.map((line, i) => (
        <p key={i} style={BODY_LINE}>
          {fill(pick(line, lang))}
        </p>
      ))}
      {action?.kind === "fill_demo_code" ? <FillCode lang={lang} /> : null}
      {action?.kind === "script_card" && bridge ? <ScriptCard lang={lang} bridge={bridge} onAllSpoken={onAllSpoken} /> : null}
      {action?.kind === "jump_closing" && bridge ? <JumpClosing lang={lang} bridge={bridge} /> : null}
      {action?.kind === "jump_tomorrow" && bridge ? <JumpTomorrow lang={lang} bridge={bridge} /> : null}
      {action?.kind === "reset_demo" ? <RegisteredControl kind="reset_demo" lang={lang} /> : null}
      {card.footnote ? <p style={FOOTNOTE}>{fill(pick(card.footnote, lang))}</p> : null}
    </article>
  );
}

function RegisteredControl({ kind, lang }: { kind: "reset_demo"; lang: Lang }) {
  const Control = GUIDE_CONTROLS[kind];
  return Control ? <Control lang={lang} /> : null;
}

/** Pair: puts the demo code in the page's 6-digit field without submitting (the field is `#pairing-code`, PairForm). */
function FillCode({ lang }: { lang: Lang }) {
  const [filled, setFilled] = useState(false);
  function onFill() {
    const input = document.getElementById("pairing-code");
    if (!(input instanceof HTMLInputElement)) return;
    // Through the native setter so React's controlled input sees the change (a plain `.value =` is swallowed).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, DEMO_STAFF_CODE);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setFilled(true);
  }
  return (
    <div style={{ marginTop: 12 }}>
      <Button variant="secondary" style={GUIDE_BUTTON} onClick={onFill}>
        {t(lang, "C-journey-fill-code", { code: DEMO_STAFF_CODE })}
      </Button>
      <p role="status" aria-live="polite" style={filled ? MUTED_LINE : SR_ONLY}>
        {filled ? t(lang, "C-journey-filled") : ""}
      </p>
    </div>
  );
}

/** Listening (plan 5.3): ONE script card, "I have spoken this" after 1 heard line, previous card read-only, lock text. */
function ScriptCard({ lang, bridge, onAllSpoken }: { lang: Lang; bridge: CaptureBridge; onAllSpoken: (sessionId: string) => void }) {
  const { profile, sessionId, linesThisSession, micTrouble } = bridge.state;
  const script = scriptFor(profile.script_id);
  const cards: readonly ScriptCardV2[] = script ? script.days[profile.day as ScriptDay] : [];
  const sid = sessionId ?? "none";
  const [spoken, setSpoken] = useState<string[]>(() => readSpoken(sid));
  const [seenSid, setSeenSid] = useState(sid);
  if (seenSid !== sid) {
    setSeenSid(sid);
    setSpoken(readSpoken(sid));
  }
  const [previous, setPrevious] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusNextRef = useRef(false);

  const st = cardState({ cards, spoken, linesSinceCardShown: 0 });
  // The line count when the active card appeared, so lines heard on the previous card never count for this one.
  // Card 1 became active at Start, when the count was 0; any later active card (a remount of the guide) starts
  // counting from now. Adjusted during render (React's "derive from props" pattern), not in an effect.
  // Known and accepted: a segment_accepted for card k that arrives after the tap can count toward card k+1. The
  // 1-line card gate is soft (a nudge, not a check); the server guard `requiredLines` is the real check.
  const [shownAt, setShownAt] = useState(() => ({ index: st.index, lines: st.index === 0 ? 0 : linesThisSession }));
  if (shownAt.index !== st.index) setShownAt({ index: st.index, lines: linesThisSession });
  const linesSinceCardShown = Math.max(0, linesThisSession - shownAt.lines);
  const live = cardState({ cards, spoken, linesSinceCardShown });

  useEffect(() => {
    if (live.allSpoken && sessionId !== null) onAllSpoken(sessionId);
  }, [live.allSpoken, sessionId, onAllSpoken]);

  useEffect(() => {
    if (focusNextRef.current) {
      focusNextRef.current = false;
      headingRef.current?.focus();
    }
  }, [live.index]);

  if (!script || cards.length === 0) return null;
  const active = cards[live.index]!;
  const prevCard = live.index > 0 ? cards[live.index - 1]! : null;

  function markSpoken() {
    if (!live.canMarkSpoken) return;
    const next = [...spoken, active.id];
    setSpoken(next);
    writeSpoken(sid, next);
    setPrevious(false);
    focusNextRef.current = true;
  }

  const shown = previous && prevCard ? prevCard : active;
  const shownN = previous && prevCard ? live.index : live.index + 1;

  return (
    <div>
      {/* One live line: it announces the card that replaced the last one (and the re-read of the previous card). */}
      <p role="status" aria-live="polite" aria-atomic="true" style={{ ...MUTED_LINE, marginTop: 12 }}>
        {t(lang, "C-journey-card-of", { n: shownN, total: live.total })}
      </p>
      <h3 ref={headingRef} tabIndex={-1} style={{ ...CARD_TITLE, fontSize: 16, marginTop: 2 }}>
        {pick(shown.title, lang)}
      </h3>
      <div style={SCRIPT_BOX}>
        {shown.lines.map((line, i) => (
          <div key={i}>
            <span style={SPEAKER_TAG}>{t(lang, SPEAKER_KEY[line.speaker])}</span>
            <p style={LINE_TEXT}>{pick(line.text, lang)}</p>
          </div>
        ))}
      </div>
      {previous && prevCard ? (
        <button type="button" style={LINK_BUTTON} onClick={() => setPrevious(false)}>
          {t(lang, "C-journey-back-to-card", { n: live.index + 1 })}
        </button>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            <Button variant="primary" block style={GUIDE_BUTTON} disabled={!live.canMarkSpoken} onClick={markSpoken}>
              {t(lang, "C-journey-spoken")}
            </Button>
          </div>
          {!live.canMarkSpoken ? <p style={MUTED_LINE}>{t(lang, "C-journey-waiting-hear")}</p> : null}
          {!live.canMarkSpoken && micTrouble && linesSinceCardShown === 0 ? (
            <div style={MUTED_LINE}>
              <p style={{ margin: 0, fontWeight: 600 }}>{t(lang, "C-journey-not-picking-up")}</p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                <li>{t(lang, "C-journey-check-mic")}</li>
                <li>{t(lang, "C-journey-check-tab")}</li>
                <li>{t(lang, "C-journey-check-closer")}</li>
              </ul>
            </div>
          ) : null}
          <p style={MUTED_LINE}>{jumpLockText(lang, spoken.filter((id) => cards.some((c) => c.id === id)).length, live.total)}</p>
          {prevCard ? (
            <button type="button" style={LINK_BUTTON} onClick={() => setPrevious(true)}>
              {t(lang, "C-journey-previous-card")}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** All spoken (plan 5.4): the page's "Jump to closing time"; disabled while the request is in flight. */
function JumpClosing({ lang, bridge }: { lang: Lang; bridge: CaptureBridge }) {
  const { closingBusy, closingError } = bridge.state;
  return (
    <div style={{ marginTop: 12 }}>
      <Button variant="primary" block style={GUIDE_BUTTON} disabled={closingBusy} onClick={bridge.actions.jumpToClosing}>
        {closingBusy ? t(lang, "C-journey-jump-closing-busy") : t(lang, "C-journey-jump-closing")}
      </Button>
      {closingError ? (
        // Not an alert: the page already announces this same failure (one role=alert under End), and two
        // alerts would read it twice. The guide's copy is for sighted users reading the card.
        <p style={ERROR_LINE}>
          {t(lang, closingError.key, closingError.vars)}
        </p>
      ) : null}
    </div>
  );
}

/** Debrief / done (plan 4.4, 7.2): Jump to tomorrow, the lock reason, and the inline unanswered confirm. */
function JumpTomorrow({ lang, bridge }: { lang: Lang; bridge: CaptureBridge }) {
  const { profile } = bridge.state;
  const { refetchConfig } = bridge.actions;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<DictKey | null>(null);
  const [jumpedTo, setJumpedTo] = useState<number | null>(null);
  // The route itself answered 409 `busy` / `preparing` (a lock the config did not show yet): the same transient
  // state as a config-driven busy. The button stays disabled with the transient line, the config is re-read on its
  // own after CONFIG_REPOLL_MS (no retry tap), and the button is back only once that re-read no longer blocks it.
  const [postReason, setPostReason] = useState<"busy" | "preparing" | null>(null);
  useEffect(() => {
    if (postReason === null) return;
    const id = setTimeout(() => {
      void (async () => {
        await refetchConfig();
        setPostReason(null);
      })();
    }, CONFIG_REPOLL_MS);
    return () => clearTimeout(id);
  }, [postReason, refetchConfig]);

  const reason = profile.next_day.reason;
  const allowed = profile.next_day.allowed;

  async function jump(confirmUnanswered: boolean) {
    if (busyRef.current || !allowed || profile.day === 3) return; // never call the route on day 3 (`max_days`)
    const auth = readDeviceAuth();
    if (!auth) return;
    busyRef.current = true;
    setBusy(true);
    setErrorKey(null);
    setConfirm(null);
    setPostReason(null);
    const result = await postDemoNextDay(auth, { expected_day: profile.day, confirm_unanswered: confirmUnanswered });
    busyRef.current = false;
    setBusy(false);
    if (result.ok) {
      setJumpedTo(result.data.day);
      await refetchConfig();
      return;
    }
    if (result.status === 409 && result.code === "unanswered_questions" && result.details?.unanswered !== undefined) {
      setConfirm(result.details.unanswered);
      return;
    }
    if (result.status === 409 && (result.code === "busy" || result.code === "preparing")) {
      setPostReason(result.code);
      return;
    }
    const code = result.code as NextDayRefusal | undefined;
    setErrorKey(code !== undefined && code !== "unanswered_questions" && code in NEXT_DAY_REASON_KEY ? NEXT_DAY_REASON_KEY[code] : "C-journey-err-generic");
  }

  let content: ReactNode;
  if (confirm !== null) {
    content = (
      <div role="group" aria-labelledby="guide-unanswered-h" style={{ marginTop: 12 }}>
        <p id="guide-unanswered-h" style={{ ...BODY_LINE, fontWeight: 600 }}>
          {t(lang, "C-journey-next-day-unanswered_questions", { n: confirm })}
        </p>
        <p style={BODY_LINE}>{t(lang, "C-journey-next-day-unanswered-body")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Button variant="primary" style={GUIDE_BUTTON} onClick={() => setConfirm(null)}>
            {t(lang, "C-journey-next-day-unanswered-answer-first")}
          </Button>
          <Button variant="secondary" style={GUIDE_BUTTON} disabled={busy} onClick={() => void jump(true)}>
            {t(lang, "C-journey-next-day-unanswered-jump-anyway")}
          </Button>
        </div>
      </div>
    );
  } else if (allowed && profile.day !== 3) {
    content = (
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" block style={GUIDE_BUTTON} disabled={busy || postReason !== null} onClick={() => void jump(false)}>
          {busy ? t(lang, "C-journey-jump-tomorrow-busy") : t(lang, "C-journey-jump-tomorrow")}
        </Button>
        {postReason !== null ? <p style={MUTED_LINE}>{t(lang, NEXT_DAY_REASON_KEY[postReason])}</p> : null}
      </div>
    );
  } else if (reason !== null && reason !== "unanswered_questions") {
    // Transient reasons (busy, preparing) re-poll by themselves (the guide's interval): a line, no retry tap.
    content = <p style={MUTED_LINE}>{t(lang, NEXT_DAY_REASON_KEY[reason])}</p>;
  } else {
    content = null;
  }

  return (
    <div>
      {content}
      {errorKey ? (
        <p role="alert" style={ERROR_LINE}>
          {t(lang, errorKey)}
        </p>
      ) : null}
      <p role="status" aria-live="polite" style={jumpedTo !== null ? MUTED_LINE : SR_ONLY}>
        {jumpedTo !== null ? t(lang, "C-journey-jumped", { n: jumpedTo, total: DEMO_DAYS_TOTAL }) : ""}
      </p>
    </div>
  );
}
