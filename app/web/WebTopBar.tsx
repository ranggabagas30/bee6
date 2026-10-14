"use client";

import Link from "next/link";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { Chip, Pill } from "@/app/ui";
import { LangSwitch } from "@/app/shop/LangSwitch";
import { SignOutButton } from "@/app/web/SignOutButton";
import { AppNav, type NavItemId } from "@/app/web/AppNav";
import { useRoleClaim } from "@/app/web/useRoleClaim";
import styles from "@/app/web/shell.module.css";

/**
 * Owner/supervisor top bar (R-06 Task 4.6; nav shell in R-19 PR-6 §8.2). Brand, role chip and (on a demo sandbox)
 * the DEMO DATA chip on the left; the ID | EN switch and Sign out on the right; the role's nav row under it.
 * The role and the demo flag come from the ID token's own claims (`useRoleClaim`): labels and links only, never
 * the security boundary. No nav is drawn until the claim is read, and none for a non-web role.
 *
 * Not shown: the outlet name (no client-reachable route returns it; PR-6 ships no contract change).
 */
export function WebTopBar({ auth, showSignOut, current }: { auth: Auth | null; showSignOut: boolean; current?: NavItemId }) {
  const { lang } = useLang();
  const { role, demo } = useRoleClaim(auth);
  const webRole = role === "owner" || role === "supervisor" ? role : null;

  return (
    <>
      <header className={styles.bar}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.brand}>
            bee6
          </Link>
          {webRole && <Pill tone="neutral">{t(lang, webRole === "owner" ? "C-signin-role-owner" : "C-signin-role-supervisor")}</Pill>}
          {demo && <Chip variant="amber">{t(lang, "C-web-demo-chip")}</Chip>}
        </div>
        <div className={styles.controls}>
          <LangSwitch />
          {showSignOut && auth ? <SignOutButton auth={auth} /> : null}
        </div>
      </header>
      {webRole && <AppNav role={webRole} current={current} />}
    </>
  );
}
