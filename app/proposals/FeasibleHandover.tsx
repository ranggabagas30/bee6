"use client";

import { useEffect, useRef } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * The marked-feasible hand-over banner (R-19 PR-A, plan 19):
 * "Marked feasible. The owner decides next. Sign out and pick Owner to approve or reject."
 * Takes focus when it appears so the answer is read out instead of focus dropping to <body>
 * when the Mark feasible button unmounts. The Sign out · pick Owner button was removed (R-19 PR-A);
 * judges sign out via the top bar or entry page, and the guide cards route them.
 */
export function FeasibleHandover({ lang }: { lang: Lang }) {
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bannerRef.current?.focus();
  }, []);
  return (
    <div ref={bannerRef} tabIndex={-1} role="status" className={styles.banner}>
      <span className={styles.bannerStrong}>{t(lang, "C-propd-feasible-h")}</span> {t(lang, "C-propd-feasible-p")}{" "}
      <span className={styles.bannerStrong}>{t(lang, "C-propd-feasible-owner")}</span>
    </div>
  );
}
