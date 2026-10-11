"use client";

import { useId, useState } from "react";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { scriptFor, type ScriptCard } from "@/lib/demo/script";
import { HANDLE_HEIGHT_PX, PANEL_WIDTH_PX, SHEET_MAX_DVH, sidePanelBoxStyle, type DrawerState } from "@/app/capture/drawer-layout";

/**
 * R-18 script drawer on /capture: sandbox judge devices only (the page mounts it only when the server's
 * capture config carries `demo_session`). Non-modal on purpose: it never traps focus, sets no aria-modal and
 * makes nothing inert, because the judge must still reach the Listening status, End and Cancel. Under 900 px
 * it sits IN THE PAGE FLOW after the status banner and the End / Cancel buttons (so it can never cover them);
 * from 900 px it is a fixed 360 px side panel pinned to the bottom edge. See `drawer-layout.ts` for the layout rationale and the manual
 * geometry check.
 *
 * Structure: a one-row handle (title, "Card n of N", short countdown, a 48 px show/hide toggle) that always
 * fits its content; below it, when open, a scrolling card area and, pinned under that area, Back / Next /
 * Finish so they never scroll out of reach.
 *
 * Pure view: the page owns the clock (`nowMs`), the session state and the Finish action. No audio, no network.
 */

export interface ScriptDrawerProps {
  /** Which script to show (the capture config's `demo_session.script_id`); the drawer resolves it itself so the page never imports the script data. */
  scriptId: string;
  lang: Lang;
  state: DrawerState;
  startedAtMs: number | null;
  maxMs: number;
  /** The page's clock; the countdown is computed from it, so the drawer runs no timer of its own. */
  nowMs: number | null;
  /** The page's confirmed Selesai path (the drawer is the confirmation, so no dialog). */
  onFinish: () => void;
  /** An end request is in flight (Finish or the auto-stop). */
  finishing: boolean;
  open: boolean;
  onToggle: () => void;
  wide: boolean;
  reducedMotion: boolean;
}

const SPEAKER_KEY: Record<NonNullable<ScriptCard["speaker"]>, DictKey> = {
  you: "C-script-speaker-you",
  customer: "C-script-speaker-customer",
  colleague: "C-script-speaker-colleague",
  caller: "C-script-speaker-caller",
};

/** Visually hidden, still read by assistive tech (the live region's own text). */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const BUTTON: React.CSSProperties = { minHeight: 48, padding: "8px 16px", fontSize: 16 };

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ScriptDrawer(props: ScriptDrawerProps) {
  const { scriptId, lang, state, startedAtMs, maxMs, nowMs, onFinish, finishing, open, onToggle, wide, reducedMotion } = props;
  const bodyId = useId();
  const [index, setIndex] = useState(0);
  const [seenState, setSeenState] = useState(state);
  // A new run (before -> running, ended -> before) starts again at card 1.
  if (seenState !== state) {
    setSeenState(state);
    setIndex(0);
  }

  const script = scriptFor(scriptId);
  const rules = script?.cards.find((c) => c.kind === "rules");
  const cards = script?.cards.filter((c) => c.kind !== "rules") ?? [];
  const total = cards.length;
  const safeIndex = Math.max(0, Math.min(index, total - 1));
  const card = cards[safeIndex];
  const isLast = safeIndex === total - 1;

  if (!script) return null; // an unknown script id shows no drawer rather than an empty one

  const region: React.CSSProperties = {
    background: "#fff",
    color: "#222",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    // Opening and closing is an instant toggle; this only keeps any future size animation off for
    // prefers-reduced-motion users.
    transition: reducedMotion ? "none" : "max-height 200ms ease",
    ...(wide
      ? {
          position: "fixed",
          zIndex: 20,
          right: 0,
          ...sidePanelBoxStyle(open),
          width: PANEL_WIDTH_PX,
          borderLeft: "2px solid #444",
        }
      : {
          marginTop: 16,
          border: "2px solid #444",
          borderRadius: 12,
          overflow: "hidden",
          maxHeight: open ? `${SHEET_MAX_DVH}dvh` : undefined,
        }),
  };

  const remaining =
    state === "running" && startedAtMs !== null && nowMs !== null ? clock(startedAtMs + maxMs - nowMs) : null;

  const showRunning = state === "running" && card;

  return (
    <section aria-label={t(lang, "C-script-title")} style={region}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 4px 12px", minHeight: HANDLE_HEIGHT_PX }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 6, position: "relative" }}>
          <h2 style={{ fontSize: 14, margin: 0 }}>{t(lang, "C-script-title")}</h2>
          {/* Mounted in every state and empty before Start: a live region announces changes to its content, not
              its own arrival, so "Card 1 of 10" is read out when it fills. It is visually hidden: the handle
              shows the same fact as a short "1/10" so title, card and countdown fit one line. */}
          <p role="status" aria-live="polite" aria-atomic="true" style={SR_ONLY}>
            {state === "running" ? t(lang, "C-script-card", { n: safeIndex + 1, total }) : ""}
          </p>
          {state === "running" ? (
            <p aria-hidden="true" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
              {t(lang, "C-script-card-short", { n: safeIndex + 1, total })}
            </p>
          ) : null}
          {/* The same countdown, short enough to share the handle's line. Hidden from assistive tech: the full
              sentence is in the card area, and a ticking live text would be noise. */}
          {remaining ? (
            <p aria-hidden="true" style={{ margin: 0, fontSize: 14 }}>
              {t(lang, "C-script-countdown-short", { time: remaining })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          style={{ ...BUTTON, minWidth: 48, padding: 0, flex: "0 0 auto" }}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? t(lang, "C-script-collapse") : t(lang, "C-script-expand")}
          onClick={onToggle}
        >
          <span aria-hidden="true">{open ? "▾" : "▴"}</span>
        </button>
      </div>

      <div
        id={bodyId}
        hidden={!open}
        style={open ? { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } : undefined}
      >
        <div
          data-testid="script-scroll"
          // The card area scrolls at phone size, so a keyboard user must be able to focus it (axe
          // scrollable-region-focusable) and a screen reader needs a name for it. The browser's default focus ring
          // applies (nothing in the app removes outlines).
          tabIndex={0}
          role="region"
          aria-label={t(lang, "C-script-cards-label")}
          style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0, padding: "0 12px 8px" }}
        >
          {state === "before" && rules ? (
            <>
              <p style={{ fontSize: 18, margin: "0 0 8px" }}>{rules.text[lang]}</p>
              <p style={{ fontSize: 14, margin: "0 0 8px" }}>{t(lang, "C-script-before")}</p>
            </>
          ) : null}

          {state === "ended" ? <p style={{ fontSize: 18, margin: "0 0 8px" }}>{t(lang, "C-script-ended")}</p> : null}

          {showRunning ? (
            <>
              {card.kind !== "finish" ? (
                <p style={{ fontSize: 14, margin: "0 0 4px", fontWeight: 700 }}>
                  {card.kind === "own_words" ? t(lang, "C-script-own-words") : t(lang, "C-script-say")}
                  {card.speaker ? ` · ${t(lang, SPEAKER_KEY[card.speaker])}` : ""}
                </p>
              ) : null}
              <p style={{ fontSize: 18, margin: "0 0 8px" }}>{card.text[lang]}</p>
              {card.example ? (
                <>
                  <p style={{ fontSize: 13, margin: "0 0 2px", fontWeight: 700 }}>{t(lang, "C-script-example")}</p>
                  <p style={{ fontSize: 14, margin: "0 0 8px" }}>{card.example[lang]}</p>
                </>
              ) : null}
              <p style={{ fontSize: 13, margin: "0 0 2px", color: "#444", fontWeight: 700 }}>{t(lang, "C-script-intent")}</p>
              <p style={{ fontSize: 13, margin: "0 0 4px", color: "#444" }}>{card.intent[lang]}</p>
              <p style={{ fontSize: 13, margin: "0 0 8px", color: "#444" }}>{t(lang, "C-script-seconds", { n: card.seconds })}</p>
            </>
          ) : null}

          {/* The general rules and the reload note (not once the day has ended) come last in the scroll area, so the card is what the judge
              sees first; they are always one scroll away. */}
          <p style={{ fontSize: 13, margin: "0 0 4px", color: "#444" }}>{t(lang, "C-script-rules")}</p>
          {state !== "ended" ? <p style={{ fontSize: 13, margin: "0 0 4px", color: "#444" }}>{t(lang, "C-script-reload")}</p> : null}
          {remaining ? <p style={{ fontSize: 13, margin: 0, color: "#444" }}>{t(lang, "C-script-countdown", { time: remaining })}</p> : null}
        </div>

        {showRunning ? (
          <div style={{ display: "flex", gap: 8, padding: "8px 12px 12px", borderTop: "1px solid #ccc", flex: "0 0 auto" }}>
            <button
              type="button"
              style={{ ...BUTTON, flex: 1 }}
              disabled={safeIndex === 0}
              onClick={() => setIndex(Math.max(0, safeIndex - 1))}
            >
              {t(lang, "C-script-back")}
            </button>
            {isLast ? (
              <button type="button" style={{ ...BUTTON, flex: 2, fontWeight: 700 }} disabled={finishing} onClick={onFinish}>
                {finishing ? t(lang, "C-script-finishing") : t(lang, "C-script-finish")}
              </button>
            ) : (
              <button type="button" style={{ ...BUTTON, flex: 2, fontWeight: 700 }} onClick={() => setIndex(safeIndex + 1)}>
                {t(lang, "C-script-next")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
