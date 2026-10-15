"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { Chip, Kicker, Mist, Pill } from "@/app/ui";
import { LangSwitch } from "@/app/shop/LangSwitch";
import { cx } from "@/app/ui/cx";
import styles from "@/app/web/entry.module.css";

/**
 * The demo entry page `/` (R-19 PR-6 §8.1; page-1 W1 Judge landing without the long paragraph, V4). Rendered only by a
 * demo deployment (the pilot `/` redirects to /sign-in before anything renders). Top strip "DEMO OUTLET · FICTIONAL
 * DATA" + ID | EN; the headline; "TRY ALL THREE ROLES · ABOUT 20 MINUTES"; three role cards, each one link
 * (STEP 1 Staff → /pair, START HERE, best on a phone; STEP 2 Supervisor and STEP 3 Owner → the role sign-in); the
 * fictional-data footer. No demo code, no sign-in details and no role-switch tip here: the judge guide owns them (W8).
 * Preview images (`public/demo/preview-{role}.png`) are added by uiux after promotion P2; until then the cards have none.
 */

interface RoleCard {
  href: string;
  roleKey: DictKey;
  lineKey: DictKey;
  startHere: boolean;
}

const CARDS: readonly RoleCard[] = [
  { href: "/pair", roleKey: "C-signin-role-staff", lineKey: "C-web-entry-staff-line", startHere: true },
  { href: "/sign-in?as=supervisor", roleKey: "C-signin-role-supervisor", lineKey: "C-web-entry-supervisor-line", startHere: false },
  { href: "/sign-in?as=owner", roleKey: "C-signin-role-owner", lineKey: "C-web-entry-owner-line", startHere: false },
];

export function EntryLanding() {
  const { lang } = useLang();
  return (
    <div className={styles.page}>
      <Mist />
      <main className={styles.main}>
        <header className={styles.strip}>
          <Chip variant="amber">{t(lang, "C-web-entry-strip")}</Chip>
          <LangSwitch />
        </header>

        <section className={styles.hero} aria-labelledby="entry-h1">
          <span className={styles.brand}>bee6</span>
          <h1 id="entry-h1" className={styles.h1}>
            {t(lang, "C-web-entry-h1")}
          </h1>
          <Kicker className={styles.kicker}>{t(lang, "C-web-entry-kicker")}</Kicker>
        </section>

        <ol className={styles.cards}>
          {CARDS.map((card, index) => (
            <li key={card.href} className={styles.cardItem}>
              <Link href={card.href} className={cx(styles.card, card.startHere && styles.cardStart)}>
                <span className={styles.cardTop}>
                  <Chip variant="line">{t(lang, "C-web-entry-step", { n: index + 1 })}</Chip>
                  {card.startHere && <Pill tone="teal">{t(lang, "C-web-entry-start-here")}</Pill>}
                </span>
                <span className={styles.cardTitle} role="heading" aria-level={2}>
                  {t(lang, card.roleKey)}
                </span>
                {card.startHere && <span className={styles.cardNote}>{t(lang, "C-web-entry-phone")}</span>}
                <span className={styles.cardLine}>{t(lang, card.lineKey)}</span>
              </Link>
            </li>
          ))}
        </ol>

        <footer className={styles.footer}>
          <p className={styles.footerLine}>{t(lang, "C-web-entry-footer")}</p>
        </footer>
      </main>
    </div>
  );
}
