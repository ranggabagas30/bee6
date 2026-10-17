"use client";

import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { LangSwitch } from "@/app/shop/LangSwitch";
import { useDemoExpiryHHMM } from "@/app/demo/demo-expiry"; // Firebase-free module: the pilot bar must not pull demo-client
import { Button, Chip, Logo } from "@/app/ui";
import styles from "@/app/shop/shop.module.css";

/**
 * The staff top bar (page-2 `.top` on a phone, `.dtop` from 900 px; R-25 T4, UI-002 / UI-019). One component, two CSS
 * layouts, used by every staff screen (`/pair` now; `/capture` in T5).
 *
 * - Always: the Bee6 logo on the left and the ID | EN switch on the right.
 * - `demo` (a demo sandbox only; the pilot bar is just logo + switch): `outletLine` adds "Demo Bakery · Outlet 1" with the
 *   two-hour expiry in the mono slot ("ends 11:20", from `useDemoExpiryHHMM`; empty while no live sandbox is known).
 *   From 900 px the row also shows the STAFF and DEMO DATA chips.
 * - `signOut` adds the secondary Sign out button beside the switch from 900 px (on a phone the sign-out lives in the
 *   screen's footer, never in the header). The label is the caller's copy.
 */
export interface StaffTopBarProps {
  demo?: boolean;
  outletLine?: boolean;
  signOut?: { label: string; onClick: () => void; disabled?: boolean };
}

export function StaffTopBar({ demo = false, outletLine = false, signOut }: StaffTopBarProps) {
  const { lang } = useLang();
  const expiry = useDemoExpiryHHMM();
  const showOutlet = demo && outletLine;
  return (
    <header className={styles.bar}>
      <Logo className={styles.logo} />
      {showOutlet && (
        <p className={styles.outlet}>
          <span>{t(lang, "C-pair-outlet-demo")}</span>
          {expiry !== null && <span className={styles.ends}>{t(lang, "C-pair-ends-at", { time: expiry })}</span>}
        </p>
      )}
      {demo && (
        <span className={styles.chips}>
          <Chip className={styles.upper}>{t(lang, "C-demo-role-staff")}</Chip>
          <Chip variant="line">{t(lang, "C-web-demo-chip")}</Chip>
        </span>
      )}
      <div className={styles.tools}>
        <LangSwitch />
        {signOut && (
          <Button variant="secondary" className={styles.signOut} onClick={signOut.onClick} disabled={signOut.disabled}>
            {signOut.label}
          </Button>
        )}
      </div>
    </header>
  );
}
