"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { Button } from "@/app/ui";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * The marked-feasible hand-over (R-19 PR-12a, plan 9.5; board D2-03g; R-25 T10), in two parts because the board puts
 * them in two places:
 * - `FeasibleHandover`, the banner right under the title: "Marked feasible. The owner decides next. Sign out and pick
 *   Owner to approve or reject." It takes focus when it appears, so the answer is read out instead of focus dropping to
 *   <body> when the Mark feasible button unmounts.
 * - `FeasibleActions`, the bottom button row that replaces Reject / Mark feasible: the done look "Marked feasible ✓"
 *   (a real `disabled` button) and "Sign out · pick Owner", which ends the supervisor session through the same
 *   best-effort sign-out as the top bar's button and lands on the sign-in page with the Owner tab open.
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

export function FeasibleActions({ lang, auth }: { lang: Lang; auth: Auth }) {
  const router = useRouter();

  async function signOutAndPickOwner() {
    try {
      await signOut(auth);
    } catch {
      // Best-effort, like the top bar's Sign out: still navigate away.
    }
    router.replace("/sign-in?as=owner");
  }

  return (
    <div className={styles.actions}>
      <Button variant="secondary" disabled>
        {t(lang, "C-propd-feasible-done")}
      </Button>
      <Button variant="primary" onClick={() => void signOutAndPickOwner()}>
        {t(lang, "C-propd-signout-owner")}
      </Button>
    </div>
  );
}
