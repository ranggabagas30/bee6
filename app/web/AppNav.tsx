"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { cx } from "@/app/ui/cx";
import styles from "@/app/web/shell.module.css";

/**
 * The supervisor and owner navigation (R-19 PR-6 §8.2, decision D-9; page-2 look in R-25 T8). Supervisor = Day record,
 * Proposals, SOP, Reviews, Connected devices; owner = Home, Approvals, SOP, Reviews. No Team item. The role comes from
 * the ID token claim (navigation only; the server still enforces). `/devices` is a placeholder page.
 *
 * `variant="rail"` is the board's left column (210 px from 900 px; inside `WebShell`, next to `main`). `variant="row"` is
 * the same links in one row under the top bar, for a page that has not adopted `WebShell` yet. Under 900 px both are the
 * horizontally scrolling row.
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

/**
 * The right-edge fade is a cue that more items wait to the right, so it shows only while the row overflows AND is not
 * scrolled to the end. At the end (or with no overflow) nothing follows, and the last item and its focus ring stay undimmed.
 */
function useOverflowFade(dep: unknown) {
  const ref = useRef<HTMLElement>(null);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const more = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
      setFade(more);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [dep]);
  return { ref, fade };
}

export interface AppNavProps {
  role: NavRoleId;
  current?: NavItemId;
  variant?: "rail" | "row";
  /**
   * Proposals waiting for this role. The badge shows only when a page already holds a count (none does today: no route
   * returns it without a fetch, so the shell draws no badge and fetches nothing).
   */
  proposalsBadge?: number;
}

export function AppNav({ role, current, variant = "row", proposalsBadge }: AppNavProps) {
  const { lang } = useLang();
  const { ref, fade } = useOverflowFade(`${lang}:${role}`);
  // QA M-004: on a phone the row scrolls sideways and the current item can start off-screen (Reviews, Connected devices).
  // Only the row's own scrollLeft moves (never scrollIntoView, which could also scroll the page vertically).
  useEffect(() => {
    const nav = ref.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    // Right-align the item with 24 px of air (the row's scroll-padding-inline), clamped at the start.
    nav.scrollLeft = Math.max(0, link.offsetLeft + link.offsetWidth + 24 - nav.clientWidth);
  }, [ref, current, variant]);
  return (
    <nav
      ref={ref}
      data-fade={fade ? "true" : "false"}
      aria-label={t(lang, "C-web-nav-label")}
      className={cx("b6-nav", styles.nav, variant === "rail" && styles.navRail)}
    >
      <ul className={styles.navList}>
        {NAV[role].map((item) => {
          const isCurrent = item === current;
          const badge = item === "proposals" && proposalsBadge !== undefined && proposalsBadge > 0 ? proposalsBadge : null;
          return (
            <li key={item}>
              <Link
                href={HREF[item]}
                aria-current={isCurrent ? "page" : undefined}
                onFocus={revealOnFocus}
                className={cx(styles.navLink, isCurrent && styles.navLinkCurrent)}
              >
                {t(lang, labelKey(item, role))}
                {badge !== null && (
                  <>
                    <span className={cx("b6-badge", styles.badge)} aria-hidden="true">
                      {badge}
                    </span>
                    <span className={styles.sr}>{t(lang, "C-web-nav-badge", { n: badge })}</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
