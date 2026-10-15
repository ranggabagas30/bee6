import { Glass } from "@/app/ui";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * "Asking Bee6…" (R-19 PR-12a, plan 9.5; board D2-03d): shown in place of the proposal list while the generate call
 * runs, and while another one runs (a 409 GENERATION_IN_PROGRESS). A polite status so the change is read out once;
 * the orb is decoration (hidden from assistive tech, still under prefers-reduced-motion).
 *
 * `minHeight` (integration QA D2): the height of the list this block replaces, so the constraints panel under it is
 * not pulled up while Bee6 works and pushed back down when the rows return (a layout shift on a 360 px phone).
 */
export function GeneratingState({ lang, minHeight }: { lang: Lang; minHeight?: number }) {
  return (
    <Glass
      as="div"
      role="status"
      aria-live="polite"
      className={styles.generating}
      style={minHeight !== undefined ? { minHeight, boxSizing: "border-box" } : undefined}
    >
      <span className={styles.generatingOrb} aria-hidden="true" />
      <p className={styles.generatingTitle}>{t(lang, "C-propg-title")}</p>
      <p className={styles.generatingBody}>{t(lang, "C-propg-body")}</p>
    </Glass>
  );
}
