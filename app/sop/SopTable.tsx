import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { chapterOf, type ChapterId } from "@/lib/sop/chapters";
import { Chip } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { ROLE_KEY } from "@/app/sop/SopChangeCard";
import { shortDate, stepOrigins, type SopVersionView } from "@/app/sop/versions";
import styles from "@/app/sop/sop.module.css";

/**
 * The Table view of one SOP version (R-19 PR-9b, §9.1; board D2-04c): one row per step in SOP order with the
 * columns CODE / STEP / CHAPTER / WHO (role) / WHEN (version date) / WHERE IT CAME FROM ("Your SOP" or "Bee6
 * proposal, approved dd/mm/yy"). The origin of a step is the latest approved change at or before the shown
 * version (`stepOrigins`); a step no change touched is dated by the seed. Every model text field is a plain text
 * node: never through `t()`, never as HTML.
 *
 * Explicit table roles are set so the header association survives the stacked phone layout, where CSS turns rows
 * into cards and each cell shows its column name from `data-label`.
 */

export const CHAPTER_KEY: Record<ChapterId, DictKey> = {
  opening_closing: "C-sop-book-ch-opening_closing",
  production: "C-sop-book-ch-production",
  stock: "C-sop-book-ch-stock",
  customer: "C-sop-book-ch-customer",
  other: "C-sop-book-ch-other",
};

const COLUMNS: readonly DictKey[] = [
  "C-sop-book-col-code",
  "C-sop-book-col-step",
  "C-sop-book-col-chapter",
  "C-sop-book-col-who",
  "C-sop-book-col-when",
  "C-sop-book-col-from",
];

export function SopTable({ view, versions, lang }: { view: SopVersionView; versions: readonly SopVersionView[]; lang: Lang }) {
  const origins = stepOrigins(versions, view.version);
  const seedDate = versions.find((v) => v.version === 1)?.effective_from_date ?? null;
  const heads = COLUMNS.map((key) => t(lang, key));
  const cell = (index: number) => ({ role: "cell" as const, "data-label": heads[index], className: styles.td });

  return (
    <table role="table" className={styles.table}>
      <caption className="b6-sr-only">{t(lang, "C-sop-book-table-caption", { version: view.version })}</caption>
      <thead role="rowgroup" className={styles.thead}>
        <tr role="row">
          {heads.map((head) => (
            <th key={head} role="columnheader" scope="col" className={styles.th}>
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {view.steps.map((step) => {
          const origin = origins.get(step.step_id) ?? null;
          const when = origin ? shortDate(origin.effective_from_date) : seedDate ? shortDate(seedDate) : t(lang, "C-sop-book-when-unknown");
          const from = origin ? t(lang, "C-sop-book-from-bee6", { date: shortDate(origin.approved_date) }) : t(lang, "C-sop-book-from-sop");
          return (
            <tr key={step.step_id} role="row" className={styles.tr}>
              <td {...cell(0)} className={cx(styles.td, styles.tdKeep)}>
                <Chip>{step.step_id}</Chip>
              </td>
              <td {...cell(1)}>
                <span className={styles.tdStep}>
                  <span className={styles.tdTitle}>{step.title}</span>
                  <span className={styles.tdText}>{step.text}</span>
                </span>
              </td>
              <td {...cell(2)}>{t(lang, CHAPTER_KEY[chapterOf(step.step_id)])}</td>
              <td {...cell(3)} className={cx(styles.td, styles.tdKeep)}>
                {t(lang, ROLE_KEY[step.role])}
              </td>
              <td {...cell(4)} className={cx(styles.td, styles.tdKeep)}>
                {when}
              </td>
              <td {...cell(5)}>{from}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
