import { useState, type CSSProperties } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { DayRecordResponse, OwnerThread, SupervisorThread } from "@/lib/day/contract";
import { filterThreads, type CategoryFilterValue } from "@/lib/day/view-model";
import { DayHeader } from "@/app/day/DayHeader";
import { CategoryFilter } from "@/app/day/CategoryFilter";
import { ThreadCard } from "@/app/day/ThreadCard";

/**
 * The day record screen body (R-06 Task 7.4). `WebTopBar` is rendered by
 * `DayRecordApp`, above this component. One component renders both shapes;
 * `ThreadCard` narrows on `view` for its evidence/staff-answer/action rows —
 * the owner/supervisor boundary is the response shape, not this split.
 *
 * `auth` is threaded through to `ThreadCard`'s supervisor variant, which
 * needs it once Task 10's `ThreadActions` renders inside it; `DayRecordApp`
 * never constructs this component before it has a non-null `Auth` (R-06
 * plan Task 7.4/7.5 gap, flagged to tech-lead — see the task handback).
 */

const CONTAINER_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const LIST_STYLE: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
const LIST_ITEM_STYLE: CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "auto 160px" } as CSSProperties;

export function DayRecordView({
  data,
  auth,
  onPrev,
  onNext,
  onReload,
}: {
  data: DayRecordResponse;
  auth: Auth;
  onPrev: () => void;
  onNext: () => void;
  onReload: () => void;
}) {
  const { lang } = useLang();
  const [filter, setFilter] = useState<CategoryFilterValue>("ALL");
  // Reset the filter when the date changes, not on every render (React's
  // "adjusting state when a prop changes" pattern: applied during render, so
  // there is no stale-filter flash).
  const [resetForDate, setResetForDate] = useState(data.day.date);
  if (data.day.date !== resetForDate) {
    setResetForDate(data.day.date);
    setFilter("ALL");
  }

  // `data.threads` is `OwnerThread[] | SupervisorThread[]` (a union of two
  // array types, from the discriminated union on `view`), not an array of
  // the element union — widen it once so the generic `filterThreads` can
  // infer a single `T`.
  const threads: (OwnerThread | SupervisorThread)[] = data.threads;
  const filtered = filterThreads(threads, filter);
  const isSupervisor = data.view === "supervisor";

  return (
    <div style={CONTAINER_STYLE}>
      <DayHeader
        view={data.view}
        day={data.day}
        threadCount={threads.length}
        onPrev={onPrev}
        onNext={onNext}
      />

      {threads.length > 0 && (
        <CategoryFilter threads={threads} value={filter} onChange={setFilter} />
      )}

      {threads.length === 0 && (
        <div>
          <p>{t(lang, isSupervisor ? "C-day-empty" : "C-day-empty-owner")}</p>
          {isSupervisor && (data.day.day_status === "on" || data.day.day_status === "pending") && (
            <p>{t(lang, "C-day-empty-2")}</p>
          )}
        </div>
      )}

      <ol style={LIST_STYLE}>
        {filtered.map((thread) => (
          <li key={thread.row} style={LIST_ITEM_STYLE}>
            {data.view === "owner" ? (
              <ThreadCard view="owner" thread={thread as OwnerThread} />
            ) : (
              <ThreadCard
                view="supervisor"
                thread={thread as SupervisorThread}
                onReload={onReload}
                auth={auth}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
