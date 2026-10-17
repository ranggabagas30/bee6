"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { authedGetJson } from "@/lib/auth/client/api";
import { getClientAuth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
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
  stageIndex,
  todoDoneCount,
  type Bilingual,
  type GuideKey,
  type GuideState,
  type JourneyProgress,
} from "@/lib/demo/guide";
import { scriptFor, type ScriptCardV2, type ScriptDay, type ScriptSpeaker } from "@/lib/demo/script";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n/lang";
import { Button, Chip, Sheet, SidePanel, StepTick } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import styles from "@/app/demo/guide.module.css";
import { demoSnapshot, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { clearPairDone, useCaptureBridge, usePairBridge, useProposalsSignal, type CaptureBridge } from "@/app/demo/guide-bridge";
import { GUIDE_CONTROLS } from "@/app/demo/guide-controls";

/**
 * R-19 PR-5 judge guide (docs/tasks/R-19-demo-v2.md section 7; one card per screen, no tabs). Mounted by the root
 * layout ONLY when DEMO_MODE is on (through JudgeGuideLoader, a lazy chunk), so the pilot never renders it.
 *
 * - Phone (< 900 px): a collapsed bottom-sheet handle (kicker + stage chip, the card's one-line title, the day clock);
 *   laptop (>= 900 px): a "JUDGE GUIDE [STAGE n OF 5] v" pill top-right opening a 360 px side panel. Collapsed by
 *   default, after every route change and after every card change (except listening -> all spoken, one flow).
 *   Non-modal, no focus trap.
 * - Contents (R-25 T6, board look): the stage label, then the ONE card of `guideKeyFor(route, state)` in a card box.
 *   No journey list: the stage lives in the chip, and the web cards carry their own "Do this now" rows.
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

/** localStorage flag (value "1"): this browser has seen the entry page's auto-opened welcome panel (R-25 fixes-2 §3). */
export const WELCOME_SEEN_KEY = "bee6.guide.welcome_seen";
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
/** Every guide control is at least 48 px high (plan 7.2); the board's control is 44, the guide keeps the larger tap row. */
const GUIDE_BUTTON: CSSProperties = { minHeight: 48 };

/** `{code}`, `{day}`, `{next}`, `{n}`, `{total}` in guide copy; `**x**` is bold; `strong` bolds a phrase that has no markup. */
function rich(text: string, strong?: string): ReactNode {
  if (text.includes("**")) {
    return text.split("**").map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
  }
  if (strong && text.includes(strong)) {
    const [head, ...rest] = text.split(strong);
    return (
      <>
        {head}
        <b>{strong}</b>
        {rest.join(strong)}
      </>
    );
  }
  return text;
}

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
function fill(text: string, vars: Record<string, string | number> = {}): string {
  const all: Record<string, string | number> = { code: DEMO_STAFF_CODE, ...vars };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in all ? String(all[k]) : m));
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
  const pairDone = usePairBridge();
  const demoSnap = useSyncExternalStore(subscribeDemoState, () => demoSnapshot(), () => "");
  const demoView = viewFromSnapshot(demoSnap);
  const webRole = demoView && !demoView.expired && demoView.state.role !== "staff" ? demoView.state.role : null;

  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  const isEntry = seg === "" || seg === "sign-in" || seg === "pair";
  const isCapture = seg === "capture";
  const isPair = seg === "pair";
  // R-25 R12: /pair reports "paired" through the pair bridge; a stale signal never outlives the /pair route.
  useEffect(() => {
    if (!isPair) clearPairDone();
  }, [isPair]);
  // The proposals page's own screen and write counter (after-merge wiring, lib/demo/proposals-signal). The screen
  // counts only on /proposals; the counter re-reads the progress after an ask, a feasible mark, a rejection or an approval.
  const proposals = useProposalsSignal();
  const proposalsScreen = seg === "proposals" ? proposals.screen : null;

  // ── web progress (supervisor / owner): once the Firebase user is restored, on every route change, each time the
  // guide is opened, and on every write the proposals page reports. On a hard load the user arrives asynchronously;
  // reading before that makes authedGetJson answer `signed_out` without a request and the pill stuck at stage 1 (R-21 D4). ──
  const auth = config ? getClientAuth(config) : null;
  const authStatus = useAuthUser(auth).status;
  const [progress, setProgress] = useState<JourneyProgress | null>(null);
  // R-25 fixes-2 §3: on the entry page the laptop panel opens by itself the first time this browser sees it. Decided
  // once, in the first client render (the guide never renders on the server); the phone sheet never auto-opens.
  const [autoOpened] = useState(
    () => seg === "" && readLocal(WELCOME_SEEN_KEY) !== "1" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches,
  );
  const [open, setOpen] = useState(autoOpened);
  // The first close of the auto-opened panel (close button, Escape, a route change, the pill) remembers it was seen.
  useEffect(() => {
    if (autoOpened && !open) writeLocal(WELCOME_SEEN_KEY, "1");
  }, [autoOpened, open]);
  // Escape closes the auto-opened panel even while nothing inside it has focus (SidePanel handles Escape only inside).
  useEffect(() => {
    if (!autoOpened || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autoOpened, open]);
  // "Supervisor visited" (plan 7.1): true the moment any supervisor page is on screen, and remembered in
  // localStorage for the later stages. Derived, not set in the effect: the effect only persists it.
  const [visitedStored] = useState(() => readLocal(SUPERVISOR_SEEN_KEY) === "1");
  const supervisorHere = !isEntry && !isCapture && webRole === "supervisor";
  const visited = visitedStored || supervisorHere;
  useEffect(() => {
    if (supervisorHere) writeLocal(SUPERVISOR_SEEN_KEY, "1");
  }, [supervisorHere]);
  useEffect(() => {
    if (isEntry || isCapture || webRole === null || !auth || authStatus !== "signed_in") return;
    let cancelled = false;
    void (async () => {
      const result = await authedGetJson(auth, "/api/v1/demo/progress", DemoProgressResponseSchema);
      if (cancelled || result.kind !== "ok") return; // a failed read keeps the default card
      setProgress((prev) => ({ ...result.data, supervisor_visited: prev?.supervisor_visited ?? false }));
    })();
    return () => {
      cancelled = true;
    };
  }, [isEntry, isCapture, webRole, auth, authStatus, pathname, open, proposals.progressVersion]);

  // ── the one card ──────────────────────────────────────────────────────────────────────────────────────────
  // The session whose 5 cards are all marked spoken (reported by the script card); a new session id resets it.
  const [allSpokenFor, setAllSpokenFor] = useState<string | null>(null);
  const allSpoken = bridge !== null && bridge.state.sessionId !== null && allSpokenFor === bridge.state.sessionId;
  // The script card reports which card of the session is on screen, for the handle title "Read card n of 5 aloud".
  const [cardPos, setCardPos] = useState<{ sid: string; n: number; total: number } | null>(null);
  const state: GuideState | null = isCapture
    ? bridge
      ? { kind: "capture", phase: bridge.state.phase === "listening" && allSpoken ? "all_spoken" : bridge.state.phase }
      : null
    : isPair
      ? { kind: "pair", paired: pairDone }
      : webRole !== null
        ? { kind: "web", role: webRole, progress: progress ? { ...progress, supervisor_visited: visited } : null, screen: proposalsScreen }
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
  // R-25 R7: on a supervisor web page right after day 1 the stage stays "Supervisor · look around".
  const stage = currentStage(journey, { onSupervisorWeb: supervisorHere });
  const stageN = stageIndex(stage) + 1;

  // Collapsed on every route change and on every card change the PAGE drives (a capture phase, the proposals page's
  // screen, the role); listening -> all spoken is one flow and keeps it open. A card change that comes only from a
  // progress read (the re-read on open, or the one a page write signals) never collapses it: the guide re-reads the
  // counters the moment it opens, and shutting itself on that read was integration QA D1 (one tap opened it, the
  // moved card closed it ~50 ms later, a second tap was needed).
  const pageSig = `${pathname}|${bridge?.state.phase ?? ""}|${proposalsScreen ?? ""}|${webRole ?? ""}|${isPair && pairDone ? "paired" : ""}`;
  const prevRef = useRef({ pathname, key, pageSig });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { pathname, key, pageSig };
    if (prev.pathname === pathname && prev.key === key) return;
    if (prev.pageSig === pageSig) return; // only the progress data moved: the open card updates in place
    const sameFlow = prev.pathname === pathname && prev.key === "capture_listening" && key === "capture_all_spoken";
    if (!sameFlow) setOpen(false);
  }, [pathname, key, pageSig]);

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

  const dayText = bridge ? t(lang, "C-journey-guide-day", { n: bridge.state.profile.day, total: DEMO_DAYS_TOTAL }) : null;
  const pos = cardPos && bridge && cardPos.sid === bridge.state.sessionId ? cardPos : null;
  const handleText = fill(pick(card.handle ?? card.title, lang), { n: pos?.n ?? 1, total: pos?.total ?? 5, next: (day ?? 1) + 1 });
  const chipText = key === "entry" ? t(lang, "C-journey-guide-demo-chip") : t(lang, "C-journey-guide-stage-chip", { n: stageN, total: STAGE_TOTAL });
  const kicker = t(lang, "C-journey-guide-kicker");
  const stageLabel = key === "entry" ? t(lang, "C-journey-welcome") : pick(STAGES[stageN - 1]!.title, lang);

  const body = (
    <>
      <span className="b6-dsec">{stageLabel}</span>
      <GuideCardView
        key={key}
        guideKey={key}
        day={day}
        openClosingReached={openClosingReached}
        lang={lang}
        bridge={bridge}
        open={open}
        journey={journey}
        onAllSpoken={setAllSpokenFor}
        onPosition={setCardPos}
        onFilled={() => setOpen(false)}
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
        pill={
          <span className="b6-fab">
            <span className="b6-kick">{kicker}</span>
            <Chip variant="teal" className={styles.chipSm}>
              {chipText}
            </Chip>
          </span>
        }
        bodyLabelledBy={`guide-card-${key}`}
        header={
          <span className={cx("b6-kick", styles.kickRow)}>
            {kicker}
            <Chip variant="teal" className={styles.chipSm}>
              {chipText}
            </Chip>
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
        className={styles.sheet}
        label={t(lang, "C-journey-guide-label")}
        open={open}
        onOpenChange={setOpen}
        collapseOnOutsidePointerDown
        openLabel={t(lang, "C-journey-guide-open")}
        closeLabel={t(lang, "C-journey-guide-close")}
        bodyLabelledBy={`guide-card-${key}`}
        handle={
          <span className={styles.handleRow}>
            <span className={styles.handleText}>
              <span className={cx("b6-kick", styles.kickRow)}>
                {kicker}
                <Chip variant="teal" className={styles.chipSm}>
                  {chipText}
                </Chip>
              </span>
              {open ? null : <span className={styles.handleTitle}>{handleText}</span>}
            </span>
            {dayText ? (
              <span className={styles.handleEnd}>
                <span className="b6-clock">{dayText}</span>
              </span>
            ) : null}
          </span>
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
  /** The sheet / panel is open: a registered control is mounted only then (see `RegisteredControl`). */
  open: boolean;
  /** The stage counters (the "Do this now" rows read them). */
  journey: JourneyProgress;
  /** Called with the session id once every card of the day is marked spoken. */
  onAllSpoken: (sessionId: string) => void;
  /** The script card reports the card on screen (the handle title says which). */
  onPosition: (pos: { sid: string; n: number; total: number }) => void;
  /** The pair card's Fill in ran: the guide collapses so the page's Set up button is reachable. */
  onFilled: () => void;
}

function GuideCardView({ guideKey, day, openClosingReached, lang, bridge, open, journey, onAllSpoken, onPosition, onFilled }: GuideCardViewProps) {
  const card = guideCard(guideKey, day, { openClosingReached });
  const action = card.action;
  const vars = { day: day ?? 1, next: (day ?? 1) + 1 };
  const title = pick(card.title, lang);
  const headId = `guide-card-${guideKey}`;
  const footnote = card.footnote ? fill(pick(card.footnote, lang), vars) : null;
  const done = card.todo ? todoDoneCount(guideKey, journey) : 0;
  return (
    <article aria-labelledby={headId} className="b6-cardbox">
      {/* The card's name for assistive tech; the sighted card leads with its kicker (or "Do this now"). */}
      <h2 id={headId} className="b6-sr-only">
        {title}
      </h2>
      {card.kicker ? <span className="b6-kick">{pick(card.kicker, lang)}</span> : null}
      {card.todo ? (
        <>
          <p id={`${headId}-todo`} className={styles.cardLead}>
            {t(lang, "C-journey-do-now")}
          </p>
          <ul aria-labelledby={`${headId}-todo`} className={styles.todo}>
            {card.todo.map((row, i) => {
              const status = i < done ? "done" : i === done ? "now" : "todo";
              return (
                <StepTick
                  key={i}
                  as="li"
                  status={status}
                  statusLabel={t(lang, status === "done" ? "C-journey-stage-done" : status === "now" ? "C-journey-stage-now" : "C-journey-stage-todo")}
                >
                  <span className={status === "now" ? styles.todoNow : status === "done" ? styles.todoDone : styles.todoLater}>{pick(row, lang)}</span>
                </StepTick>
              );
            })}
          </ul>
        </>
      ) : null}
      {card.body.map((line, i) => (
        <p key={i} className={styles.line}>
          {rich(fill(pick(line, lang), vars), guideKey === "pair_done" ? title : undefined)}
        </p>
      ))}
      {action?.kind === "fill_demo_code" ? <FillCode lang={lang} onFilled={onFilled} /> : null}
      {action?.kind === "script_card" && bridge ? <ScriptCard lang={lang} bridge={bridge} note={footnote} onAllSpoken={onAllSpoken} onPosition={onPosition} /> : null}
      {action?.kind === "jump_closing" && bridge ? <JumpClosing lang={lang} bridge={bridge} /> : null}
      {action?.kind === "jump_tomorrow" && bridge ? <JumpTomorrow lang={lang} bridge={bridge} /> : null}
      {action?.kind === "reset_demo" && open ? <RegisteredControl kind="reset_demo" lang={lang} /> : null}
      {footnote && action?.kind !== "script_card" ? <p className={styles.why}>{footnote}</p> : null}
    </article>
  );
}

/**
 * A registered control gets only `{ lang }` and reads the Firebase app the page initialised, at its own mount (the
 * reset control's `useIsDemoOwner` reads `getExistingClientAuth()` in render and nothing re-renders it when the app
 * appears later). The guide's body is rendered collapsed too, so the control is mounted only once the card is OPEN:
 * by then the page has long initialised the app, including after a hard reload of an owner page.
 */
function RegisteredControl({ kind, lang }: { kind: "reset_demo"; lang: Lang }) {
  const Control = GUIDE_CONTROLS[kind];
  return Control ? <Control lang={lang} /> : null;
}

/** The board's dark guide control: label on the left, a glyph on the right (the glyph is decoration). */
function Ctl({ label, glyph, disabled, onClick }: { label: string; glyph: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="b6-ctl" style={GUIDE_BUTTON} disabled={disabled} onClick={onClick}>
      <span className={styles.ctlLabel}>{label}</span>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** Pair: puts the demo code in the page's 6-digit field without submitting (the field is `#pairing-code`, PairForm). */
function FillCode({ lang, onFilled }: { lang: Lang; onFilled: () => void }) {
  const [filled, setFilled] = useState(false);
  function onFill() {
    const input = document.getElementById("pairing-code");
    if (!(input instanceof HTMLInputElement)) return;
    // Through the native setter so React's controlled input sees the change (a plain `.value =` is swallowed).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, DEMO_STAFF_CODE);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setFilled(true);
    onFilled(); // the open phone sheet covers Set up (R-21 D7): hand the page back
  }
  return (
    <>
      <Ctl
        label={filled ? t(lang, "C-journey-filled-short") : t(lang, "C-journey-fill-code", { code: DEMO_STAFF_CODE })}
        glyph={filled ? "✓" : "›"}
        disabled={filled}
        onClick={onFill}
      />
      {/* The control's own label changes silently for a screen reader: say what to do next. */}
      <p role="status" aria-live="polite" style={SR_ONLY}>
        {filled ? t(lang, "C-journey-filled") : ""}
      </p>
    </>
  );
}

/** The speech of one script card: the speaker tag (never spoken) over the line. Scrolls inside the card box, keyboard-reachable. */
function ScriptLines({ lang, card }: { lang: Lang; card: ScriptCardV2 }) {
  return (
    <div className={styles.lines} tabIndex={0} role="region" aria-label={t(lang, "C-journey-script-text")}>
      {card.lines.map((line, i) => (
        <div key={i} className={styles.say}>
          <span className={styles.who}>{t(lang, SPEAKER_KEY[line.speaker])}</span>
          <p className={styles.tx}>{pick(line.text, lang)}</p>
        </div>
      ))}
    </div>
  );
}

/** Listening (plan 5.3): ONE script card, "I have spoken this" after 1 heard line, previous card read-only. */
function ScriptCard({
  lang,
  bridge,
  note,
  onAllSpoken,
  onPosition,
}: {
  lang: Lang;
  bridge: CaptureBridge;
  note: string | null;
  onAllSpoken: (sessionId: string) => void;
  onPosition: (pos: { sid: string; n: number; total: number }) => void;
}) {
  const { profile, sessionId, linesThisSession, micTrouble, uploadBusy } = bridge.state;
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
    onPosition({ sid, n: live.index + 1, total: live.total });
  }, [sid, live.index, live.total, onPosition]);

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
  const isLast = live.index === live.total - 1;

  return (
    <>
      {/* The heading is the card's kicker row; its "Card n of 5" is the one live line that announces the card that
          replaced the last one (and the re-read of the previous card), and focus lands here after "next card". */}
      <h3 ref={headingRef} tabIndex={-1} className={styles.scriptHead}>
        <span role="status" aria-live="polite" aria-atomic="true" className="b6-kick">
          {t(lang, "C-journey-card-of", { n: shownN, total: live.total })}
        </span>
        <Chip>{pick(shown.title, lang)}</Chip>
      </h3>
      <div className={styles.bars} aria-hidden="true">
        {cards.map((c, i) => (
          <span key={c.id} className={cx(styles.bar, i < shownN - 1 && styles.barOn)} />
        ))}
      </div>
      <ScriptLines lang={lang} card={shown} />
      {lang === "id" ? <p className={styles.why}>{t(lang, "C-journey-id-soon")}</p> : null}
      {note ? <p className={styles.why}>{note}</p> : null}
      {previous && prevCard ? (
        <button type="button" className={styles.link} style={GUIDE_BUTTON} onClick={() => setPrevious(false)}>
          {t(lang, "C-journey-back-to-card", { n: live.index + 1 })}
        </button>
      ) : (
        <>
          <Ctl
            label={isLast ? t(lang, "C-journey-spoken-finish") : t(lang, "C-journey-spoken-next")}
            glyph="✓"
            disabled={!live.canMarkSpoken}
            onClick={markSpoken}
          />
          {!live.canMarkSpoken ? <p className={styles.mono}>{t(lang, "C-journey-waiting-hear")}</p> : null}
          {/* R-23: a stalled upload is the service being busy, not the mic: say so and hold the mic hint back. */}
          {!live.canMarkSpoken && uploadBusy ? <p className={styles.mono}>{t(lang, "C-journey-catching-up")}</p> : null}
          {!live.canMarkSpoken && micTrouble && !uploadBusy && linesSinceCardShown === 0 ? (
            <div className={styles.mono}>
              <p style={{ margin: 0, fontWeight: 600 }}>{t(lang, "C-journey-not-picking-up")}</p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                <li>{t(lang, "C-journey-check-mic")}</li>
                <li>{t(lang, "C-journey-check-tab")}</li>
                <li>{t(lang, "C-journey-check-closer")}</li>
              </ul>
            </div>
          ) : null}
          {prevCard ? (
            <button type="button" className={styles.link} style={GUIDE_BUTTON} onClick={() => setPrevious(true)}>
              {t(lang, "C-journey-previous-card")}
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** All spoken: "‹ Previous card (re-read only)" shows the last script card again, read-only (the speech is already captured). */
function RereadLast({ lang, bridge }: { lang: Lang; bridge: CaptureBridge }) {
  const [shown, setShown] = useState(false);
  const { profile } = bridge.state;
  const script = scriptFor(profile.script_id);
  const cards: readonly ScriptCardV2[] = script ? script.days[profile.day as ScriptDay] : [];
  const last = cards[cards.length - 1];
  if (!last) return null;
  return (
    <>
      {shown ? <ScriptLines lang={lang} card={last} /> : null}
      <button type="button" className={styles.link} style={GUIDE_BUTTON} onClick={() => setShown((v) => !v)}>
        {shown ? t(lang, "C-journey-reread-hide") : t(lang, "C-journey-previous-card")}
      </button>
    </>
  );
}

/** All spoken (plan 5.4): the page's "Jump to closing time · 21:00"; disabled while the request is in flight. */
function JumpClosing({ lang, bridge }: { lang: Lang; bridge: CaptureBridge }) {
  const { closingBusy, closingError, closeHm } = bridge.state;
  const label = closingBusy ? t(lang, "C-journey-jump-closing-busy") : closeHm ? t(lang, "C-journey-jump-closing-at", { time: closeHm }) : t(lang, "C-journey-jump-closing");
  return (
    <>
      <Ctl label={label} glyph="»" disabled={closingBusy} onClick={bridge.actions.jumpToClosing} />
      {closingError ? (
        // Not an alert: the page already announces this same failure (one role=alert under End), and two
        // alerts would read it twice. The guide's copy is for sighted users reading the card.
        <p className={styles.error}>{t(lang, closingError.key, closingError.vars)}</p>
      ) : null}
      <RereadLast lang={lang} bridge={bridge} />
    </>
  );
}

/** Debrief / done (plan 4.4, 7.2): Jump to tomorrow, the lock reason, and the inline unanswered confirm. */
function JumpTomorrow({ lang, bridge }: { lang: Lang; bridge: CaptureBridge }) {
  const { profile, nextDate } = bridge.state;
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
      <div role="group" aria-labelledby="guide-unanswered-h" className={styles.ctlWrap}>
        <p id="guide-unanswered-h" className={styles.line} style={{ fontWeight: 600 }}>
          {t(lang, "C-journey-next-day-unanswered_questions", { n: confirm })}
        </p>
        <p className={styles.line}>{t(lang, "C-journey-next-day-unanswered-body")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
      <div className={styles.ctlWrap}>
        <Ctl
          label={busy ? t(lang, "C-journey-jump-tomorrow-busy") : nextDate ? t(lang, "C-journey-jump-tomorrow-on", { date: dayLabel(nextDate, lang) }) : t(lang, "C-journey-jump-tomorrow")}
          glyph="»"
          disabled={busy || postReason !== null}
          onClick={() => void jump(false)}
        />
        {postReason !== null ? <p className={styles.mono}>{t(lang, NEXT_DAY_REASON_KEY[postReason])}</p> : null}
      </div>
    );
  } else if (reason !== null && reason !== "unanswered_questions") {
    // Transient reasons (busy, preparing) re-poll by themselves (the guide's interval): a line, no retry tap.
    content = <p className={styles.mono}>{t(lang, NEXT_DAY_REASON_KEY[reason])}</p>;
  } else {
    content = null;
  }

  return (
    <>
      {content}
      {errorKey ? (
        <p role="alert" className={styles.error}>
          {t(lang, errorKey)}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className={jumpedTo !== null ? styles.mono : undefined} style={jumpedTo !== null ? undefined : SR_ONLY}>
        {jumpedTo !== null ? t(lang, "C-journey-jumped", { n: jumpedTo, total: DEMO_DAYS_TOTAL }) : ""}
      </p>
    </>
  );
}
