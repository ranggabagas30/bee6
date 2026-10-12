import type { CSSProperties } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { WorkCategory } from "@/lib/pipeline/categories";
import { CATEGORY_KEY, categoryOptions, type CategoryFilterValue } from "@/lib/day/view-model";

/**
 * The category filter row (R-06 Task 7.4 item 3). Rendered only by the
 * caller when there is at least one thread. Pure chips: no fetch, selection
 * lives in `DayRecordView`.
 */

const CHIP_STYLE: CSSProperties = {
  minHeight: 48,
  padding: "0 12px",
  fontSize: 16,
  borderRadius: 8,
  cursor: "pointer",
};

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
  const options = categoryOptions(threads);

  return (
    <div
      role="group"
      aria-label={t(lang, "C-day-filter-group")}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}
    >
      <button
        type="button"
        aria-pressed={value === "ALL"}
        onClick={() => onChange("ALL")}
        style={CHIP_STYLE}
      >
        {t(lang, "C-day-filter-all", { N: threads.length + unlabelledCount })}
      </button>
      {options.map(({ category, count }) => (
        <button
          key={category}
          type="button"
          aria-pressed={value === category}
          onClick={() => onChange(category)}
          style={CHIP_STYLE}
        >
          {t(lang, "C-day-filter-cat", { label: t(lang, CATEGORY_KEY[category]), N: count })}
        </button>
      ))}
      {unlabelledCount > 0 && (
        <button
          type="button"
          aria-pressed={value === "UNLABELLED"}
          onClick={() => onChange("UNLABELLED")}
          style={CHIP_STYLE}
        >
          {t(lang, "C-day-filter-unlabelled", { N: unlabelledCount })}
        </button>
      )}
    </div>
  );
}
