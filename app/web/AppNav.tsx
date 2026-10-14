"use client";

import type { FocusEvent } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { cx } from "@/app/ui/cx";
import styles from "@/app/web/shell.module.css";

/**
 * The supervisor and owner navigation (R-19 PR-6 §8.2, decision D-9). One row of links under the top bar:
 * supervisor = Day record, Proposals, SOP, Reviews, Connected devices; owner = Home, Approvals, SOP, Reviews.
 * No Team item. The role comes from the ID token claim (navigation only; the server still enforces).
 * `/devices` is a placeholder page until PR-10 replaces it.
 */

export type NavItemId = "home" | "day" | "proposals" | "sop" | "reviews" | "devices";
export type NavRoleId = "supervisor" | "owner";

export const NAV: Readonly<Record<NavRoleId, readonly NavItemId[]>> = {
  supervisor: ["day", "proposals", "sop", "reviews", "devices"],
  owner: ["home", "proposals", "sop", "reviews"],
};

const HREF: Record<NavItemId, string> = {
  home: "/home",
  day: "/day",
  proposals: "/proposals",
  sop: "/sop",
  reviews: "/reviews",
  devices: "/devices",
};

function labelKey(item: NavItemId, role: NavRoleId): DictKey {
  if (item === "proposals") return role === "owner" ? "C-web-nav-approvals" : "C-web-nav-proposals";
  return `C-web-nav-${item}` as const;
}

/** The row scrolls sideways on a phone, and Chromium does not scroll a partly visible focused link into view itself. */
function revealOnFocus(e: FocusEvent<HTMLAnchorElement>) {
  e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" });
}

export function AppNav({ role, current }: { role: NavRoleId; current?: NavItemId }) {
  const { lang } = useLang();
  return (
    <nav aria-label={t(lang, "C-web-nav-label")} className={styles.nav}>
      <ul className={styles.navList}>
        {NAV[role].map((item) => {
          const isCurrent = item === current;
          return (
            <li key={item}>
              <Link
                href={HREF[item]}
                aria-current={isCurrent ? "page" : undefined}
                onFocus={revealOnFocus}
                className={cx(styles.navLink, isCurrent && styles.navLinkCurrent)}
              >
                {t(lang, labelKey(item, role))}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
