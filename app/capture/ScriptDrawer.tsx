"use client";

import { useId, useState } from "react";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import type { DemoScript, ScriptCard } from "@/lib/demo/script";

/**
 * R-18 script drawer on /capture: sandbox judge devices only (the page mounts it only when the server's
 * capture config carries `demo_session`). Non-modal on purpose: it never traps focus, sets no aria-modal and
 * makes nothing inert, because the judge must still reach the Listening status, End and Cancel. Under 900 px
 * it is a bottom sheet (at most 55 vh open, a 56 px handle collapsed); from 900 px a 360 px side panel. The
 * page keeps its own content clear of the drawer (see `drawerInsetStyle`).
 *
 * Pure view: the page owns the clock (`nowMs`), the session state and the Finish action. No audio, no network.
 */

export type DrawerState = "before" | "running" | "ended";

export const HANDLE_HEIGHT_PX = 56;
export const PANEL_WIDTH_PX = 360;
export const SHEET_MAX_VH = 55;

export interface ScriptDrawerProps {
  script: DemoScript;
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

const BUTTON: React.CSSProperties = { minHeight: 48, padding: "8px 16px", fontSize: 16 };

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ScriptDrawer(props: ScriptDrawerProps) {
  const { script, lang, state, startedAtMs, maxMs, nowMs, onFinish, finishing, open, onToggle, wide, reducedMotion } = props;
  const bodyId = useId();
  const [index, setIndex] = useState(0);
  const [seenState, setSeenState] = useState(state);
  // A new run (before -> running, ended -> before) starts again at card 1.
  if (seenState !== state) {
    setSeenState(state);
    setIndex(0);
  }

  const rules = script.cards.find((c) => c.kind === "rules");
  const cards = script.cards.filter((c) => c.kind !== "rules");
  const total = cards.length;
  const safeIndex = Math.min(index, total - 1);
  const card = cards[safeIndex];
  const isLast = safeIndex === total - 1;

  const region: React.CSSProperties = {
    position: "fixed",
    zIndex: 20,
    background: "#fff",
    color: "#222",
    boxSizing: "border-box",
    overflowY: open ? "auto" : "hidden",
    transition: reducedMotion ? "none" : "max-height 200ms ease, height 200ms ease",
    ...(wide
      ? { top: 0, right: 0, bottom: open ? 0 : undefined, width: PANEL_WIDTH_PX, borderLeft: "2px solid #444" }
      : { left: 0, right: 0, bottom: 0, borderTop: "2px solid #444" }),
    ...(open ? (wide ? {} : { maxHeight: `${SHEET_MAX_VH}vh` }) : { height: `${HANDLE_HEIGHT_PX}px` }),
  };

  const countdown =
    state === "running" && startedAtMs !== null && nowMs !== null
      ? t(lang, "C-script-countdown", { time: clock(startedAtMs + maxMs - nowMs) })
      : null;

  return (
    <section aria-label={t(lang, "C-script-title")} style={region}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 12px", minHeight: HANDLE_HEIGHT_PX }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>{t(lang, "C-script-title")}</h2>
          {state === "running" ? (
            <p role="status" aria-live="polite" aria-atomic="true" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
              {t(lang, "C-script-card", { n: safeIndex + 1, total })}
            </p>
          ) : null}
          {countdown ? <p style={{ margin: 0, fontSize: 14 }}>{countdown}</p> : null}
        </div>
        <button
          type="button"
          style={BUTTON}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          {open ? t(lang, "C-script-collapse") : t(lang, "C-script-expand")}
        </button>
      </div>


      <div id={bodyId} hidden={!open} style={{ padding: "0 12px 12px" }}>
        <p style={{ fontSize: 14, margin: "0 0 12px" }}>{t(lang, "C-script-rules")}</p>

        {state === "before" && rules ? (
          <>
            <p style={{ fontSize: 18, margin: "0 0 8px" }}>{rules.text[lang]}</p>
            <p style={{ fontSize: 14, margin: 0 }}>{t(lang, "C-script-before")}</p>
          </>
        ) : null}

        {state === "ended" ? <p style={{ fontSize: 18, margin: 0 }}>{t(lang, "C-script-ended")}</p> : null}

        {state === "running" && card ? (
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
            <p style={{ fontSize: 13, margin: "0 0 12px", color: "#444" }}>{t(lang, "C-script-seconds", { n: card.seconds })}</p>
            <div style={{ display: "flex", gap: 8 }}>
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
          </>
        ) : null}
      </div>
    </section>
  );
}
