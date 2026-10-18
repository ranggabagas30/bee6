import { useId } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import type { ProposalView } from "@/lib/proposals/contract";
import { Card } from "@/app/ui";
import styles from "@/app/proposals/checked.module.css";

/**
 * CHK-1: "Checked by Bee6 · N of N checks". The plain-code check that already ran on every proposal (hard rule 10: code
 * decides; this only reports it), made visible to the supervisor and the owner. Counts only (hard rule 7): no rule name,
 * no tool name, no fact. Works for the single-call agent (v3, 8 checks) and the tool-using agent (v4, 18 checks).
 *
 * `full` (supervisor detail): the count, "every check is a fixed rule in code", for v4 what the agent read, and how many
 * times it revised. `short` (owner card): the count and the code line only, so the owner summary stays short.
 * Renders nothing when `checked` is null (a suppressed doc ran no check) or absent (a response that predates CHK-1).
 * A partial count (a blocked doc) reads as plain text: no icon, no colour.
 */
export function CheckedByBee6({ lang, checked, variant }: { lang: Lang; checked: ProposalView["checked"]; variant: "full" | "short" }) {
  const id = useId();
  if (!checked) return null;
  const full = variant === "full";
  return (
    <Card as="section" aria-labelledby={`${id}-checked`} className={styles.card}>
      <span id={`${id}-checked`} className={`b6-kick ${styles.kicker}`}>
        {t(lang, "C-propd-checked", { passed: checked.checks_passed, total: checked.checks_total })}
      </span>
      <p className={styles.line}>{t(lang, "C-propd-checked-code")}</p>
      {full && checked.read_sections !== null && (
        <p className={styles.line}>{t(lang, "C-propd-checked-v4", { sections: checked.read_sections, facts: checked.read_facts ?? 0 })}</p>
      )}
      {full && checked.revisions >= 1 && <p className={styles.line}>{t(lang, "C-propd-checked-rev", { n: checked.revisions })}</p>}
    </Card>
  );
}
