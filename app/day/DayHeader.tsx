import type { CSSProperties } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { OwnerDayHeader, SupervisorDayHeader } from "@/lib/day/contract";

/**
 * The day record header (R-06 Task 7.4 item 2): date navigation, then the
 * status/count/mode lines that only show when they apply.
 */

const NAV_BUTTON_STYLE: CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  fontSize: 20,
  lineHeight: 1,
  cursor: "pointer",
};

// Link, not a button — stays text-only, but the tappable area still reaches
// the 48px minimum (CLAUDE.md §2 global constraint). Shared by the owner's
// Home link and the supervisor's queue link below.
const NAV_LINK_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 48,
};

const MODE_KEY: Record<SupervisorDayHeader["capture_mode"], DictKey> = {
  room: "C-day-mode-room",
  wearable: "C-day-mode-wearable",
  none: "C-day-mode-none",
};

export function DayHeader({
  view,
  day,
  threadCount,
  onPrev,
  onNext,
}: {
  view: "owner" | "supervisor";
  day: OwnerDayHeader | SupervisorDayHeader;
  threadCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { lang } = useLang();
  const nextDisabled = day.date === day.today;

  return (
    <header style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          aria-label={t(lang, "C-day-prev")}
          onClick={onPrev}
          style={NAV_BUTTON_STYLE}
        >
          {"‹"}
        </button>
        <h1 style={{ flex: 1, textAlign: "center", margin: 0, fontSize: 20 }}>
          {dayLabel(day.date, lang)}
        </h1>
        <button
          type="button"
          aria-label={t(lang, "C-day-next")}
          onClick={onNext}
          disabled={nextDisabled}
          style={NAV_BUTTON_STYLE}
        >
          {"›"}
        </button>
      </div>

      {(day.day_status === "closed" || day.day_status === "off") && (
        <p>{t(lang, "C-day-off-closed")}</p>
      )}
      {day.day_status === "pending" && <p>{t(lang, "C-day-pending")}</p>}

      <p>
        {view === "supervisor"
          ? t(lang, "C-day-counts", {
              facts: day.fact_count,
              questions: (day as SupervisorDayHeader).question_count,
            })
          : t(lang, "C-day-counts-owner", { facts: day.fact_count })}
      </p>

      {day.sessions_cancelled > 0 && (
        <p>{t(lang, "C-day-cancelled", { N: day.sessions_cancelled })}</p>
      )}

      <p>{t(lang, MODE_KEY[day.capture_mode])}</p>

      {day.truncated && <p>{t(lang, "C-day-truncated", { N: threadCount })}</p>}

      {view === "supervisor" && (
        <p>
          <Link href="/questions" style={NAV_LINK_STYLE}>
            {t(lang, "C-day-to-queue")}
          </Link>
        </p>
      )}

      {view === "owner" && (
        <p>
          <Link href="/home" style={NAV_LINK_STYLE}>
            {t(lang, "C-day-to-home")}
          </Link>
        </p>
      )}
    </header>
  );
}
