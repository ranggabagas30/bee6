"use client";

import Link from "next/link";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { Chip } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { useDemoExpiryHHMM } from "@/app/demo/demo-expiry";
import { LangSwitch } from "@/app/shop/LangSwitch";
import { BrandMark } from "@/app/web/BrandMark";
import { SignOutButton } from "@/app/web/SignOutButton";
import { AppNav, type NavItemId, type NavRoleId } from "@/app/web/AppNav";
import { useRoleClaim, type RoleClaim } from "@/app/web/useRoleClaim";
import styles from "@/app/web/shell.module.css";

/**
 * Owner/supervisor top bar (R-06 Task 4.6; nav shell in R-19 PR-6 §8.2; page-2 `.dtop` bar in R-25 T8). Left: the Bee6
 * mark, on a demo sandbox "Demo Bakery · Outlet 1 · ends 11:20" (the end time from `useDemoExpiryHHMM`, shown only while it has one), the role chip and the DEMO DATA chip. Right: the
 * ID | EN switch and Sign out. The role and the demo flag come from the ID token's own claims (`useRoleClaim`): labels
 * and links only, never the security boundary. No nav is drawn until the claim is read, and none for a non-web role.
 *
 * Not shown on a real outlet: the outlet name (no client-reachable route returns it); the demo line is a fixed string.
 *
 * `WebTopBar` alone = the bar plus the nav row under it, for a page that has not adopted `WebShell` yet.
 */

export function webRoleOf(claim: RoleClaim): NavRoleId | null {
  return claim.role === "owner" || claim.role === "supervisor" ? claim.role : null;
}

export function ShellBar({ auth, claim, showSignOut }: { auth: Auth | null; claim: RoleClaim; showSignOut: boolean }) {
  const { lang } = useLang();
  const webRole = webRoleOf(claim);
  const ends = useDemoExpiryHHMM();

  return (
    <header className={cx("b6-dtop", styles.dtop)}>
      <div className={styles.dtopLeft}>
        <Link href="/" className={styles.brand}>
          <BrandMark />
        </Link>
        <div className={styles.meta}>
          {claim.demo && (
            <span className={styles.outlet}>
              {t(lang, "C-web-outlet-demo")}
              {ends !== null && <span className={styles.ends}> · {t(lang, "C-web-ends-at", { time: ends })}</span>}
            </span>
          )}
          {webRole && <Chip className={styles.upper}>{t(lang, webRole === "owner" ? "C-signin-role-owner" : "C-signin-role-supervisor")}</Chip>}
          {claim.demo && (
            <Chip variant="line" className={styles.upper}>
              {t(lang, "C-web-demo-chip")}
            </Chip>
          )}
        </div>
      </div>
      <div className={styles.dtopRight}>
        <LangSwitch />
        {showSignOut && auth ? <SignOutButton auth={auth} /> : null}
      </div>
    </header>
  );
}

export function WebTopBar({ auth, showSignOut, current }: { auth: Auth | null; showSignOut: boolean; current?: NavItemId }) {
  const claim = useRoleClaim(auth);
  const webRole = webRoleOf(claim);
  return (
    <>
      <ShellBar auth={auth} claim={claim} showSignOut={showSignOut} />
      {webRole && <AppNav role={webRole} current={current} />}
    </>
  );
}
