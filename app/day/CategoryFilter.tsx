"use client";

import { Segmented, type SegmentedOption } from "@/app/ui";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { WorkCategory } from "@/lib/pipeline/categories";
import { CATEGORY_KEY, categoryOptions, type CategoryFilterValue } from "@/lib/day/view-model";
import styles from "@/app/day/day.module.css";

/**
 * The category filter row (R-06 Task 7.4 item 3; board D2-02 / R-25 T9: a plain `Segmented` above the notes card).
 * Rendered only by the caller when there is at least one thread. Pure chips: no fetch, selection lives in
 * `DayRecordView`. The group wraps onto more lines when the categories do not fit one line.
 */
export function CategoryFilter({
  threads,
  unlabelledCount = 0,
  value,
  onChange,
}: {
  threads: readonly { category: WorkCategory }[];
  /** Task 12: count for the "Not labelled" chip; 0 (default) on the owner view, which never has any. */
  unlabelledCount?: number;
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
}) {
  const { lang } = useLang();
  const options: SegmentedOption<CategoryFilterValue>[] = [
    { value: "ALL", label: t(lang, "C-day-filter-all", { N: threads.length + unlabelledCount }) },
    ...categoryOptions(threads).map(({ category, count }) => ({
      value: category,
      label: t(lang, "C-day-filter-cat", { label: t(lang, CATEGORY_KEY[category]), N: count }),
    })),
    ...(unlabelledCount > 0
      ? [{ value: "UNLABELLED" as const, label: t(lang, "C-day-filter-unlabelled", { N: unlabelledCount }) }]
      : []),
  ];

  return (
    <Segmented
      variant="plain"
      label={t(lang, "C-day-filter-group")}
      options={options}
      value={value}
      onChange={onChange}
      className={styles.filter}
    />
  );
}
