"use client";

import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import { groupByChapter, legendCounts } from "@/lib/sop/chapters";
import { Button, Kicker } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { CHAPTER_KEY } from "@/app/sop/SopTable";
import { SopVersionSteps } from "@/app/sop/SopVersionSteps";
import { stepOrigins, type SopVersionView } from "@/app/sop/versions";
import styles from "@/app/sop/sop.module.css";

/**
 * The Book view of one SOP version (R-19 PR-9b, §9.1; boards D2-04/D2-04b): a two-page spread. Left page: the
 * contents (one entry per non-empty chapter, with its step count) and the legend "From your SOP n / Improved with
 * Bee6 n". Right page: the open chapter's steps, rendered by PR-9a's `SopVersionSteps` so the improved badge, the
 * struck old wording and the "why" link are the same code in both views. Previous/Next page move through the
 * chapters. At 360 px the two pages stack into one column (CSS only; the open chapter is the only state, and the
 * parent may hold it via `chapter`/`onChapterChange`).
 *
 * The legend counts for the shown version: a step is "improved" when an approved change at or before that version
 * touched it, so the seed always reads 0 improved, as its steps carry no badge.
 */
export function SopBookSpread({
  view,
  versions,
  lang,
  chapter: controlled,
  onChapterChange,
}: {
  view: SopVersionView;
  versions: readonly SopVersionView[];
  lang: Lang;
  /** Controlled open chapter (the parent keeps it so it outlives a Book -> Table -> Book round trip); own state otherwise. */
  chapter?: number;
  onChapterChange?: (index: number) => void;
}) {
  const chapters = groupByChapter(view.steps);
  const total = chapters.length;
  const [own, setOwn] = useState(0);
  const requested = controlled ?? own;
  const setRequested = onChapterChange ?? setOwn;
  // Clamp rather than reset: a version with fewer chapters keeps the reader as close as possible to where they were.
  const index = Math.min(requested, Math.max(total - 1, 0));
  const chapter = chapters[index] ?? null;
  const legend = legendCounts(view.steps, stepOrigins(versions, view.version).keys());

  // After a page turn, focus the chapter heading so a screen reader lands on the new page.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    headingRef.current?.focus();
  }, [index]);

  const turnTo = (next: number) => {
    if (next === index) {
      // Already open (the contents entry of the current chapter): no index change, so the effect would never run and
      // the pending flag would leak into the next clamp. Land on the heading now instead.
      headingRef.current?.focus();
      return;
    }
    focusPending.current = true;
    setRequested(next);
  };

  const chapterName = (c: (typeof chapters)[number]) => t(lang, CHAPTER_KEY[c.chapter]);
  const stepCount = (c: (typeof chapters)[number]) =>
    c.steps.length === 1 ? t(lang, "C-sop-book-steps-1") : t(lang, "C-sop-book-steps-n", { n: c.steps.length });

  return (
    <div className={styles.spread}>
      <div className={cx(styles.bookPage, styles.pageLeft)} data-page="contents">
        <nav aria-label={t(lang, "C-sop-book-contents")}>
          <Kicker className={styles.pageKicker}>{t(lang, "C-sop-book-contents").toUpperCase()}</Kicker>
          <ul className={styles.contents}>
            {chapters.map((c, i) => (
              <li key={c.chapter}>
                <button
                  type="button"
                  className={styles.contentsItem}
                  aria-current={i === index ? "page" : undefined}
                  // The name and the count are two spans with no text between them, so the computed name would run
                  // them together ("Stock1 step"); the label reads "Stock, 1 step" the same way in every engine.
                  aria-label={`${chapterName(c)}, ${stepCount(c)}`}
                  onClick={() => turnTo(i)}
                >
                  <span className={styles.contentsName}>{chapterName(c)}</span>
                  <span className={styles.contentsCount}>{stepCount(c)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <ul className={styles.legend}>
          <li className={styles.legendItem}>
            <span className={cx(styles.swatch, styles.swatchSop)} aria-hidden="true" />
            <span className={styles.legendLabel}>{t(lang, "C-sop-book-legend-from")}</span>
            <span className={styles.legendCount}>{legend.fromSop}</span>
          </li>
          <li className={styles.legendItem}>
            <span className={cx(styles.swatch, styles.swatchImproved)} aria-hidden="true" />
            <span className={styles.legendLabel}>{t(lang, "C-sop-book-legend-improved")}</span>
            <span className={styles.legendCount}>{legend.improved}</span>
          </li>
        </ul>
      </div>

      <div className={cx(styles.bookPage, styles.pageRight)} data-page="chapter">
        {chapter !== null && (
          <>
            <Kicker className={styles.pageKicker}>{t(lang, "C-sop-book-chapter-of", { n: index + 1, total }).toUpperCase()}</Kicker>
            <h3 ref={headingRef} tabIndex={-1} className={styles.chapterTitle}>
              {chapterName(chapter)}
            </h3>
            <SopVersionSteps view={{ ...view, steps: chapter.steps }} lang={lang} />
          </>
        )}
        {total > 1 && (
          <div className={styles.pageNav}>
            <Button variant="secondary" disabled={index === 0} onClick={() => turnTo(index - 1)}>
              {t(lang, "C-sop-book-prev")}
            </Button>
            <span className={styles.pageOf} aria-live="polite">
              {t(lang, "C-sop-book-page-of", { n: index + 1, total })}
            </span>
            <Button variant="secondary" disabled={index === total - 1} onClick={() => turnTo(index + 1)}>
              {t(lang, "C-sop-book-next")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
