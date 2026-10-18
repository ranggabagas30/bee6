import { useEffect, useState } from "react";
import { Glass, Stage } from "@/app/ui";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import type { AskEstimate } from "@/lib/proposals/v4/flag";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * "Bee6 is writing a proposal" (R-19 PR-12a, plan 9.5; board D2-03d; page-2 look R-25 T10): shown in place of the proposal
 * list while the generate call runs, and while another one runs (a 409 GENERATION_IN_PROGRESS). A polite status so the
 * change is read out once (the only live region here); the orb is G0's `Stage` (decoration, hidden from assistive tech,
 * still under prefers-reduced-motion).
 *
 * `minHeight` (integration QA D2): the height of the list this block replaces, so the constraints panel under it is
 * not pulled up while Bee6 works and pushed back down when the rows return (a layout shift on a 360 px phone).
 *
 * `estimate` (R-24 D11, plan 3.11): present only while the v4 agent flag is on and this tab's own Ask is running.
 * The body then names the range ("Usually 10–30 seconds…"), and switches ONCE to "Taking longer than usual…" after
 * `max_s`, where it stays until the server answers. The block mounts when the Ask starts, so its mount time is the
 * Ask's start. No ticking counter (it would re-announce every second in the live region) and no progress bar (there
 * is no progress signal to show). Absent or `null`: exactly the screen before R-24.
 */
export function GeneratingState({
  lang,
  minHeight,
  estimate,
}: {
  lang: Lang;
  minHeight?: number;
  estimate?: AskEstimate | null;
}) {
  const maxS = estimate ? estimate.max_s : null;
  // The `max_s` whose time has elapsed; "over" is derived, so a changed or removed estimate never shows a stale line.
  const [elapsedFor, setElapsedFor] = useState<number | null>(null);
  useEffect(() => {
    if (maxS === null) return;
    const timer = setTimeout(() => setElapsedFor(maxS), maxS * 1000);
    return () => clearTimeout(timer);
  }, [maxS]);
  const over = maxS !== null && elapsedFor === maxS;

  return (
    <Glass
      as="div"
      role="status"
      aria-live="polite"
      className={styles.generating}
      style={minHeight !== undefined ? { minHeight, boxSizing: "border-box" } : undefined}
    >
      {/* The page-2 amber orb with its spinner (board D2-03d), scaled to 0.8 in a 200px box. Decorative: the Stage is aria-hidden. */}
      <Stage tone="amber" className={styles.generatingStage} />
      <p className={styles.generatingTitle}>{t(lang, "C-propg-title")}</p>
      <p className={styles.generatingBody}>
        {estimate
          ? over
            ? t(lang, "C-propg-over")
            : t(lang, "C-propg-est", { min: estimate.min_s, max: estimate.max_s })
          : t(lang, "C-propg-body")}
      </p>
    </Glass>
  );
}
