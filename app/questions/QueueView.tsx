import type { CSSProperties } from "react";
import Link from "next/link";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { QueueItem, ReviewQueueResponse } from "@/lib/day/contract";
import { LegacyThreadCard } from "@/app/day/LegacyThreadCard";

/**
 * The supervisor review-queue body (R-06 Task 13.6, web spec §4.3/§6.2):
 * every answered gate question still waiting for a supervisor, across the
 * last 14 days, grouped by the business date it belongs to — in the order
 * the server already sorted it (date descending, then start time
 * ascending), never re-sorted here. Each row is the pre-restyle `LegacyThreadCard` +
 * `ThreadActions` the day record uses, so confirm/override/reject behave
 * identically in both places.
 */

const CONTAINER_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const LIST_STYLE: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
// Links, not buttons — stay text-only, but the tappable area still reaches
// the 48px minimum (CLAUDE.md §2 global constraint).
const LINK_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 48 };

/** Groups consecutive items by `date`, preserving the server's own order. */
function groupByDate(items: readonly QueueItem[]): { date: string; items: QueueItem[] }[] {
  const groups: { date: string; items: QueueItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) {
      last.items.push(item);
    } else {
      groups.push({ date: item.date, items: [item] });
    }
  }
  return groups;
}

export function QueueView({
  data,
  auth,
  onReload,
}: {
  data: ReviewQueueResponse;
  auth: Auth;
  onReload: () => void;
}) {
  const { lang } = useLang();
  const groups = groupByDate(data.items);

  return (
    <div style={CONTAINER_STYLE}>
      <h1>{t(lang, "C-queue-title")}</h1>
      <p>{t(lang, "C-queue-help")}</p>
      <p>
        <Link href="/day" style={LINK_STYLE}>
          {t(lang, "C-queue-to-day")}
        </Link>
      </p>

      {data.truncated && <p>{t(lang, "C-day-truncated", { N: data.items.length })}</p>}

      {data.items.length === 0 ? (
        <p>{t(lang, "C-queue-empty")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.date}>
            <h2>{dayLabel(group.date, lang)}</h2>
            <p>
              <Link href={`/day/${group.date}`} style={LINK_STYLE}>
                {t(lang, "C-queue-open-day")}
              </Link>
            </p>
            <ol style={LIST_STYLE}>
              {group.items.map((item) => (
                <li key={`${group.date}-${item.row}`}>
                  <LegacyThreadCard view="supervisor" thread={item} auth={auth} onReload={onReload} />
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
