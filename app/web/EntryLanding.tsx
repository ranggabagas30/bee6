"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { buttonClassName, Chip, Logo, Mist } from "@/app/ui";
import { LangSwitch } from "@/app/shop/LangSwitch";
import { cx } from "@/app/ui/cx";
import styles from "@/app/web/entry.module.css";

/**
 * The demo entry page `/` (R-19 PR-6 §8.1; restyled to the page-2 boards P2-01 and D2-01 in R-25 T3). Rendered only
 * by a demo deployment (the pilot `/` redirects to /sign-in before anything renders).
 *
 * Phone: Logo + ID | EN, the outlet line, the "DEMO OUTLET · FICTIONAL DATA" chip, the headline, the kicker, then
 * three role cards. Each card is an article with its own button-looking link inside (the card itself is not a link);
 * the buttons go exactly where the old whole-card links went, so entry and sign-in behaviour is unchanged (R5).
 * From 900 px the top bar is the `.b6-dtop` row (Logo + "DEMO DATA" chip left, ID | EN right) and each card shows a
 * decorative preview block. The fictional-data note shows from 600 px. No demo code, no sign-in details and no
 * role-switch tip here: the judge guide owns them (W8).
 */

type Role = "staff" | "supervisor" | "owner";

interface RoleCard {
  role: Role;
  href: string;
  titleKey: DictKey;
  lineKey: DictKey;
  openKey: DictKey;
  primary: boolean;
}

const CARDS: readonly RoleCard[] = [
  {
    role: "staff",
    href: "/pair",
    titleKey: "C-journey-entry-title-staff",
    lineKey: "C-journey-entry-line-staff",
    openKey: "C-journey-entry-open-staff",
    primary: true,
  },
  {
    role: "supervisor",
    href: "/sign-in?as=supervisor",
    titleKey: "C-journey-entry-title-supervisor",
    lineKey: "C-journey-entry-line-supervisor",
    openKey: "C-journey-entry-open-supervisor",
    primary: false,
  },
  {
    role: "owner",
    href: "/sign-in?as=owner",
    titleKey: "C-journey-entry-title-owner",
    lineKey: "C-journey-entry-line-owner",
    openKey: "C-journey-entry-open-owner",
    primary: false,
  },
];

/** Decorative illustration (board `.prev`): a listening orb, three evidence bars, a dot grid. Hidden below 900 px. */
function Preview({ role }: { role: Role }) {
  if (role === "staff") {
    return (
      <div className={styles.prev} aria-hidden="true">
        <span className={styles.glow} />
        <span className={styles.orb}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        </span>
      </div>
    );
  }
  if (role === "supervisor") {
    return (
      <div className={cx(styles.prev, styles.prevBars)} aria-hidden="true">
        <span className={styles.barRow}>
          <span className={styles.barKey} />
          <span className={cx(styles.barVal, styles.barPlain)} />
        </span>
        <span className={styles.barRow}>
          <span className={styles.barKey} />
          <span className={cx(styles.barVal, styles.barFlag)} />
        </span>
        <span className={styles.barRow}>
          <span className={styles.barKey} />
          <span className={cx(styles.barVal, styles.barDone)} />
        </span>
      </div>
    );
  }
  return (
    <div className={styles.prev} aria-hidden="true">
      <span className={styles.dots}>
        <span className={cx(styles.dot, styles.dotWarm, styles.dotM)} />
        <span className={cx(styles.dot, styles.dotHot, styles.dotL)} />
        <span className={cx(styles.dot, styles.dotWarm, styles.dotM)} />
        <span className={cx(styles.dot, styles.dotSoft, styles.dotS)} />
        <span className={cx(styles.dot, styles.dotSoft, styles.dotS)} />
        <span className={cx(styles.dot, styles.dotEmpty, styles.dotXs)} />
        <span className={cx(styles.dot, styles.dotEmpty, styles.dotXs)} />
      </span>
    </div>
  );
}

export function EntryLanding() {
  const { lang } = useLang();
  return (
    <div className={styles.page}>
      <Mist />
      <div className={styles.shell}>
        <header className={cx("b6-dtop", styles.bar)}>
          <div className={styles.brand}>
            <Logo />
            <Chip variant="line" className={styles.deskOnly}>
              {t(lang, "C-web-demo-chip")}
            </Chip>
          </div>
          <LangSwitch />
        </header>

        <main className={styles.main}>
          <p className={cx("b6-mono", styles.outlet)}>{t(lang, "C-journey-outlet-demo")}</p>

          <div className={styles.content}>
            <section className={styles.hero} aria-labelledby="entry-h1">
              <Chip variant="line" className={styles.strip}>
                {t(lang, "C-web-entry-strip")}
              </Chip>
              <h1 id="entry-h1" className="b6-h1-entry">
                {t(lang, "C-web-entry-h1")}
              </h1>
              <span className="b6-kick">{t(lang, "C-web-entry-kicker")}</span>
            </section>

            <ol className={styles.cards}>
              {CARDS.map((card, index) => {
                const titleId = `entry-card-${card.role}`;
                return (
                  <li key={card.role} className={styles.cardItem}>
                    <article className={cx("b6-card", styles.card)} aria-labelledby={titleId}>
                      <span className="b6-kick">{t(lang, "C-web-entry-step", { n: index + 1 })}</span>
                      <h2 id={titleId} className={styles.title}>
                        {t(lang, card.titleKey)}
                      </h2>
                      <p className={styles.line}>{t(lang, card.lineKey)}</p>
                      <Preview role={card.role} />
                      <Link
                        href={card.href}
                        className={buttonClassName({
                          variant: card.primary ? "primary" : "secondary",
                          size: card.primary ? "lg" : "md",
                          block: true,
                          className: cx(styles.action, card.primary && styles.actionPrimary),
                        })}
                      >
                        {t(lang, card.openKey)}
                      </Link>
                    </article>
                  </li>
                );
              })}
            </ol>

            <footer className={cx("b6-glass", styles.footer)}>
              <p className={styles.footerLine}>{t(lang, "C-web-entry-footer")}</p>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
