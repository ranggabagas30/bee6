"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/app/ui";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * The marked-feasible hand-over (R-19 PR-12a, plan 9.5; board D2-03g): "Marked feasible. The owner decides next."
 * The banner takes focus when it appears, so the answer is read out instead of focus dropping to <body> when
 * the Mark feasible button unmounts. The "Sign out and pick Owner" step is the judge guide's card (PR-5), not
 * this screen's: a real supervisor on the pilot simply goes back to the list.
 */
export function FeasibleHandover({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bannerRef.current?.focus();
  }, []);
  return (
    <>
      <div ref={bannerRef} tabIndex={-1} role="status" className={styles.banner}>
        <span className={styles.bannerStrong}>{t(lang, "C-propd-feasible-h")}</span> {t(lang, "C-propd-feasible-p")}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" disabled>
          {t(lang, "C-propd-feasible-done")}
        </Button>
        <Button variant="primary" onClick={onBack}>
          {t(lang, "C-propd-back-list")}
        </Button>
      </div>
    </>
  );
}
