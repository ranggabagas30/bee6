import type { CSSProperties } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { HomeResponse } from "@/lib/home/contract";
import { CATEGORY_KEY } from "@/lib/day/view-model";

/**
 * The owner home body (R-06 Task 14a, web spec §4.4): "today in 5 lines
 * (summaries only)". No evidence, no question, no action button — the owner
 * shape structurally carries none of those, so this view never renders one.
 */

const CONTAINER_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const LIST_STYLE: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

// Links, not buttons — stay text-only, but the tappable area still reaches
// the 48px minimum (CLAUDE.md §2 global constraint).
const LINK_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 48,
};

export function HomeView({ data }: { data: HomeResponse }) {
  const { lang } = useLang();

  return (
    <div style={CONTAINER_STYLE}>
      <h1>{t(lang, "C-home-title")}</h1>
      <p>{dayLabel(data.today, lang)}</p>

      {(data.day_status === "closed" || data.day_status === "off") && (
        <p>{t(lang, "C-day-off-closed")}</p>
      )}
      {data.day_status === "pending" && <p>{t(lang, "C-day-pending")}</p>}

      <p>{t(lang, "C-day-counts-owner", { facts: data.fact_count })}</p>

      {data.lines.length === 0 ? (
        <p>{t(lang, "C-day-empty-owner")}</p>
      ) : (
        <ol style={LIST_STYLE}>
          {data.lines.map((line, index) => (
            <li key={index}>
              <p>
                {line.start_hm} · {t(lang, CATEGORY_KEY[line.category])}
              </p>
              <p style={{ overflowWrap: "anywhere" }}>
                {line.summary.trim() === "" ? t(lang, "C-day-no-summary") : line.summary}
              </p>
            </li>
          ))}
        </ol>
      )}

      {data.more > 0 && (
        <p>
          <Link href={`/day/${data.today}`} style={LINK_STYLE}>
            {t(lang, "C-home-more", { N: data.more })}
          </Link>
        </p>
      )}

      <p>
        <Link href={`/day/${data.today}`} style={LINK_STYLE}>
          {t(lang, "C-home-to-day")}
        </Link>
      </p>

      <p>
        <Link href="/proposals" style={LINK_STYLE}>
          {t(lang, "C-prop-title")}
        </Link>
      </p>
    </div>
  );
}
