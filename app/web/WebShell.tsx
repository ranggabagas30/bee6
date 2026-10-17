"use client";

import type { ReactNode } from "react";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { cx } from "@/app/ui/cx";
import { AppNav, type NavItemId } from "@/app/web/AppNav";
import { ShellBar, webRoleOf } from "@/app/web/WebTopBar";
import { useRoleClaim } from "@/app/web/useRoleClaim";
import styles from "@/app/web/shell.module.css";

/**
 * The page-2 web shell (R-25 T8; boards D2-02..D2-08): the `.dtop` bar, the 210 px left nav and `main.b6-main`. Every
 * supervisor and owner page wraps its content in this, so the bar, the nav and the page ground are one thing.
 *
 * - `children` become the content of the page's single `<main>` (a flex column, 22 px gap, padding 22/32/56 from 900 px).
 *   Pass the page's own sections, not another `<main>`.
 * - `auth` null = the bar without role chips, nav or Sign out (sign-in, "not set up" states).
 * - `proposalsBadge` draws the count on the Proposals item; omit it when the page has no count (nothing is fetched here).
 * - The closed judge-guide pill and the open panel are fixed-position and make room through `<body>` padding
 *   (globals.css `.b6-panel-*`), so the shell does nothing for them.
 */
export interface WebShellProps {
  auth: Auth | null;
  current?: NavItemId;
  showSignOut?: boolean;
  proposalsBadge?: number;
  /** Extra class on `<main>`, for a page that needs its own max-width or grid. */
  mainClassName?: string;
  children: ReactNode;
}

export function WebShell({ auth, current, showSignOut, proposalsBadge, mainClassName, children }: WebShellProps) {
  const claim = useRoleClaim(auth);
  const webRole = webRoleOf(claim);
  return (
    <div className={styles.shell}>
      <ShellBar auth={auth} claim={claim} showSignOut={showSignOut ?? auth !== null} />
      <div className={cx("b6-dwrap", styles.dwrap)}>
        {webRole ? (
          <AppNav role={webRole} current={current} variant="rail" proposalsBadge={proposalsBadge} />
        ) : (
          auth !== null && claim.role === null && <div className={styles.navSlot} aria-hidden="true" />
        )}
        <main className={cx("b6-main", styles.main, mainClassName)}>{children}</main>
      </div>
    </div>
  );
}
