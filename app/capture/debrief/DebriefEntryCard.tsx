"use client";

import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";

/**
 * The debrief entry card (R-07 Task 7.2, UX-03 section 3.1/5.8). Shown on
 * `/capture` whenever `nowMs < endsAtMs` for this device and the debrief flow
 * is still `closed` (not yet opened). Never shows a question count, kind or
 * topic — the list isn't fetched until the button is tapped.
 */

export interface DebriefEntryCardProps {
  endsAtMs: number;
  nowMs: number;
  /** The same next-Mulai day/time P1 shows in `C-m-debrief`, or null if none resolves. */
  nextMulaiText: { day: string; hm: string } | null;
  onOpen: () => void;
}

const CARD_STYLE: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #ccc",
  borderRadius: 12,
  padding: 16,
};

const BUTTON_STYLE: React.CSSProperties = {
  marginTop: 12,
  width: "100%",
  minHeight: 56,
  padding: 12,
  fontSize: 18,
  fontWeight: 700,
};

export function DebriefEntryCard({ endsAtMs, nowMs, nextMulaiText, onOpen }: DebriefEntryCardProps) {
  const { lang } = useLang();
  const mm = Math.max(1, Math.ceil((endsAtMs - nowMs) / 60_000));

  return (
    <section style={CARD_STYLE} aria-label={t(lang, "C-d-entry-h")}>
      <h2 style={{ fontSize: 18, margin: 0 }}>{t(lang, "C-d-entry-h")}</h2>
      <p style={{ margin: "4px 0 0" }}>
        {t(lang, mm === 1 ? "C-d-entry-left-one" : "C-d-entry-left", { mm })}
      </p>
      <button type="button" style={BUTTON_STYLE} onClick={onOpen}>
        {t(lang, "C-d-btn")}
      </button>
      <p style={{ margin: "4px 0 0", fontSize: 14 }}>{t(lang, "C-d-takes")}</p>
      {nextMulaiText ? (
        <p style={{ margin: "12px 0 0", fontSize: 14, color: "#555" }}>
          {t(lang, "C-d-next", { day: nextMulaiText.day, hm: nextMulaiText.hm })}
        </p>
      ) : null}
    </section>
  );
}
