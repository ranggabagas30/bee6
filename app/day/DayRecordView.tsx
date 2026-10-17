import { useState } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { DayRecordResponse, OwnerThread, SupervisorThread, SupervisorUnlabelled } from "@/lib/day/contract";
import { CATEGORY_KEY, buildTimeline, type CategoryFilterValue } from "@/lib/day/view-model";
import { DayHeader } from "@/app/day/DayHeader";
import { CategoryFilter } from "@/app/day/CategoryFilter";
import { ThreadCard } from "@/app/day/ThreadCard";
import { UnlabelledCard } from "@/app/day/UnlabelledCard";
import { StaffDebrief } from "@/app/day/StaffDebrief";
import { summarize } from "@/app/day/summary";
import { EmptyState } from "@/app/web/EmptyState";
import { Tile } from "@/app/ui";
import styles from "@/app/day/day.module.css";

/**
 * The day record screen body (R-06 Task 7.4; restyled in R-25 T9 to board D2-02). `WebTopBar` is rendered by
 * `DayRecordApp`, above this component. One component renders both shapes; `ThreadCard` narrows on `view` for its
 * evidence and action rows: the owner/supervisor boundary is the response shape, not this split.
 *
 * Order: header (title, date control), tiles (supervisor: work notes, debrief answers, need your check; owner: work
 * notes), the category filter, the notes card, then the supervisor's "Staff debrief" section. The tiles and the
 * debrief section only re-read fields the response already carries.
 *
 * `auth` is threaded through to `ThreadCard`'s supervisor variant, which needs it for `ThreadActions`;
 * `DayRecordApp` never constructs this component before it has a non-null `Auth`.
 */
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
  // the element union — widen it once so the generic `buildTimeline` can
  // infer a single `T`.
  const threads: (OwnerThread | SupervisorThread)[] = data.threads;
  // Task 12: the owner shape has no `unlabelled` field at all (an
  // unlabelled unit can never be a fact) — `buildTimeline` always gets `[]`
  // for it there.
  const unlabelled: SupervisorUnlabelled[] = data.view === "supervisor" ? data.unlabelled : [];
  const timeline = buildTimeline(threads, unlabelled, filter);
  const isEmpty = threads.length === 0 && unlabelled.length === 0;

  return (
    <div className={styles.content}>
      <DayHeader
        view={data.view}
        day={data.day}
        threadCount={threads.length + unlabelled.length}
        onPrev={onPrev}
        onNext={onNext}
      />

      {!isEmpty && (
        <Tiles
          view={data.view}
          threads={data.view === "supervisor" ? data.threads : []}
          unlabelled={unlabelled}
          noteCount={threads.length}
        />
      )}

      {!isEmpty && (
        <CategoryFilter
          threads={threads}
          unlabelledCount={unlabelled.length}
          value={filter}
          onChange={setFilter}
        />
      )}

      {isEmpty && (
        // R-19 PR-6 §8.3: one empty state for both views; the "notes appear after..." line only on a day that can still fill.
        <EmptyState
          title={t(lang, "C-web-empty-day-h")}
          detail={data.day.day_status === "on" || data.day.day_status === "pending" ? t(lang, "C-web-empty-day-p") : undefined}
        />
      )}

      {timeline.length > 0 && (
        <ol aria-label={t(lang, "C-day2-notes-label")} className={`b6-card ${styles.list}`}>
          {timeline.map((item) =>
            item.kind === "thread" ? (
              <li key={item.thread.row} className={styles.item}>
                {data.view === "owner" ? (
                  <ThreadCard view="owner" thread={item.thread as OwnerThread} />
                ) : (
                  <ThreadCard
                    view="supervisor"
                    thread={item.thread as SupervisorThread}
                    onReload={onReload}
                    auth={auth}
                  />
                )}
              </li>
            ) : (
              <li key={`u-${item.item.key}`} className={styles.item}>
                <UnlabelledCard item={item.item} />
              </li>
            ),
          )}
        </ol>
      )}

      {data.view === "supervisor" && !isEmpty && (
        <StaffDebrief timeline={buildTimeline(data.threads, data.unlabelled, "ALL")} />
      )}
    </div>
  );
}

/**
 * The day's numbers (ruling R16: three tiles, no coverage figure, the API has none). The owner shape carries
 * facts only, so it gets the one tile it can fill.
 */
function Tiles({
  view,
  threads,
  unlabelled,
  noteCount,
}: {
  view: "owner" | "supervisor";
  threads: readonly SupervisorThread[];
  unlabelled: readonly SupervisorUnlabelled[];
  noteCount: number;
}) {
  const { lang } = useLang();

  if (view === "owner") {
    return (
      <ul aria-label={t(lang, "C-day2-tiles-label")} className={`${styles.tiles} ${styles.tilesOne}`}>
        <li>
          <Tile label={t(lang, "C-day2-tile-notes")} value={noteCount} />
        </li>
      </ul>
    );
  }

  const s = summarize(threads, unlabelled);
  const answersDetail =
    s.asked === 0
      ? t(lang, "C-day2-tile-answers-none")
      : s.unverified > 0
        ? t(lang, "C-day2-tile-answers-unv", { n: s.unverified })
        : s.open > 0
          ? t(lang, "C-day2-tile-answers-open", { n: s.open })
          : undefined;
  const checkDetail =
    s.check === 0
      ? t(lang, "C-day2-tile-check-none")
      : s.firstCheck
        ? t(lang, "C-day2-tile-check-d", { time: s.firstCheck.start_hm, label: t(lang, CATEGORY_KEY[s.firstCheck.category]) }) +
          (s.check > 1 ? ` ${t(lang, "C-day2-tile-check-more", { n: s.check - 1 })}` : "")
        : undefined;

  return (
    <ul aria-label={t(lang, "C-day2-tiles-label")} className={styles.tiles}>
      <li>
        <Tile
          label={t(lang, "C-day2-tile-notes")}
          value={s.notes}
          detail={s.unlabelled > 0 ? t(lang, "C-day2-tile-notes-d", { n: s.unlabelled }) : undefined}
        />
      </li>
      <li>
        <Tile
          label={t(lang, "C-day2-tile-answers")}
          value={s.asked === 0 ? t(lang, "C-web-empty-tile-value") : t(lang, "C-day2-tile-answers-v", { answered: s.answered, asked: s.asked })}
          detail={answersDetail}
        />
      </li>
      <li>
        <Tile
          tone={s.check > 0 ? "amber" : "default"}
          label={t(lang, "C-day2-tile-check")}
          value={s.check}
          detail={checkDetail}
        />
      </li>
    </ul>
  );
}
