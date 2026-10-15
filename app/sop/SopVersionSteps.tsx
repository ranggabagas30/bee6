import Link from "next/link";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import { Chip } from "@/app/ui";
import { ROLE_KEY } from "@/app/sop/SopChangeCard";
import { shortDate, type SopVersionView } from "@/app/sop/versions";
import styles from "@/app/sop/sop.module.css";

/**
 * The steps of one SOP version (R-19 PR-9a, §9.1). The step this version changed (`change.after.step_id`) carries
 * the badge "IMPROVED · NEW ON dd/mm/yy" (or "NEW ON dd/mm/yy" for an added step), its new text, the old wording
 * struck through (`<del>`, with a visually hidden "Before:" for screen readers) and the link to why it changed.
 * The seed version has no badge. Every model text field is rendered as a plain text node: never through `t()`,
 * never as HTML.
 *
 * The "why" link goes to /proposals for both roles (the owner's Approvals live on the same path) and carries the SOP
 * version number (`?v=`; a number, not an id: the wire contract carries no source_proposal_id). /proposals ignores
 * unknown queries today; PR-12a owns the anchor.
 */
export function SopVersionSteps({ view, lang }: { view: SopVersionView; lang: Lang }) {
  const change = view.change;
  const changedId = change?.after.step_id ?? null;
  const date = change ? shortDate(change.effective_from_date) : "";
  const badge = change ? t(lang, change.kind === "add" ? "C-sop-book-new" : "C-sop-book-improved", { date }) : "";
  return (
    <ol className={styles.steps}>
      {view.steps.map((step) => {
        const changed = change !== null && step.step_id === changedId;
        return (
          <li key={step.step_id} className={changed ? styles.stepChanged : styles.step}>
            {changed && <Chip variant="teal">{badge}</Chip>}
            <p className={styles.stepTitle}>{step.title}</p>
            <p className={styles.stepText}>{step.text}</p>
            {changed && change.before !== null && (
              <p className={styles.stepBefore}>
                <span className="b6-sr-only">{t(lang, "C-sop-book-before")}</span>
                <del>{change.before.text}</del>
              </p>
            )}
            <p className={styles.stepRole}>{t(lang, "C-sop-step-role", { role: t(lang, ROLE_KEY[step.role]) })}</p>
            {changed && (
              <Link href={`/proposals?v=${change.version}`} className={styles.why}>
                {t(lang, "C-sop-book-why")}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
