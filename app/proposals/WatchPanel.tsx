import { Button, Card, Kicker, Pill } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { ProposalsWatch, WatchRow } from "@/lib/proposals/review-contract";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * "What Bee6 is watching" (R-19 PR-12a, plan 3.5 / 9.5; boards D2-03, D2-03a, D2-03b): one row per work category
 * the plain code has seen at least once in the last 7 business dates, with how many of the needed dates it was
 * seen on and a state chip, plus the one button that asks for a proposal. Presentation only: the data is the
 * `watch` block of GET /api/v1/proposals (counts only: never a thread, device, name or summary, hard rule #7)
 * and the parent runs the generate call.
 *
 * The button has one of four looks, decided by the rows (the parent passes whether any proposal already exists):
 * - a `ready` row and no proposal yet: "Ask Bee6 for a proposal" (`another` false);
 * - a `ready` row and a proposal exists: "Ask for another proposal" (`another` true, plan 3.3);
 * - no `ready` row, every seen category `proposed`: "All asked", disabled (D2-03);
 * - no `ready` row otherwise: "Not enough evidence yet", disabled (D2-03b).
 * While `busy` it reads "Asking Bee6…" and is disabled (D2-03d). The server stays the authority: a tap only
 * sends the request; whatever it answers is what the parent shows.
 */

const STATE_KEY: Record<WatchRow["state"], DictKey> = {
  ready: "C-propw-ready",
  needs_more: "C-propw-needs",
  proposed: "C-propw-proposed",
};

const STATE_TONE: Record<WatchRow["state"], "teal" | "amber" | "green"> = {
  ready: "teal",
  needs_more: "amber",
  proposed: "green",
};

export interface WatchPanelProps {
  lang: Lang;
  watch: ProposalsWatch;
  /** A proposal with content already exists (open or decided): the next ask is "another". */
  hasProposal: boolean;
  /** The generate call is in flight (or another one is, per a 409): the button is locked. */
  busy: boolean;
  onAsk: (another: boolean) => void;
}

export function WatchPanel({ lang, watch, hasProposal, busy, onAsk }: WatchPanelProps) {
  const rows = watch.categories;
  const ready = rows.some((r) => r.state === "ready");
  const allProposed = rows.length > 0 && rows.every((r) => r.state === "proposed");
  const another = ready && hasProposal;
  const buttonKey: DictKey = busy
    ? "C-propw-asking"
    : ready
      ? another
        ? "C-propw-ask-another"
        : "C-propw-ask"
      : allProposed
        ? "C-propw-all-asked"
        : "C-propw-none";
  const disabled = busy || !ready;

  return (
    <Card as="section" aria-labelledby="prop-watch-kicker" className={styles.watch}>
      <div className={styles.watchHead}>
        <div className={styles.watchTitle}>
          <Kicker id="prop-watch-kicker">{t(lang, "C-propw-kicker")}</Kicker>
          <span className={styles.watchNote}>{t(lang, "C-propw-note")}</span>
          <span className={styles.watchRange}>
            {t(lang, "C-propw-range", { from: dayLabel(watch.from_date, lang), to: dayLabel(watch.to_date, lang) })}
          </span>
        </div>
        <Button
          variant={ready && !busy ? "primary" : "secondary"}
          className={styles.watchAsk}
          disabled={disabled}
          aria-busy={busy || undefined}
          onClick={() => {
            if (!disabled) onAsk(another);
          }}
        >
          {t(lang, buttonKey)}
        </Button>
      </div>
      {rows.length > 0 && (
        <ul className={styles.watchList}>
          {rows.map((row) => {
            const seen = Math.min(row.dates, row.need_dates);
            return (
              <li key={row.category} className={styles.watchRow}>
                <div className={styles.watchRowMain}>
                  <span className={styles.watchLabel}>{t(lang, CATEGORY_KEY[row.category])}</span>
                  <span className={styles.watchSeen}>
                    {t(lang, "C-propw-seen", { dates: row.dates, need: row.need_dates })}
                  </span>
                </div>
                <span className={styles.watchState}>
                  <span className={styles.dots} role="img" aria-label={`${t(lang, "C-propw-days")}: ${seen}/${row.need_dates}`}>
                    {Array.from({ length: row.need_dates }, (_, i) => (
                      <span key={i} className={cx(styles.dot, i < seen && styles.dotOn)} />
                    ))}
                  </span>
                  <Pill tone={STATE_TONE[row.state]}>
                    {t(lang, STATE_KEY[row.state], { n: Math.max(1, row.need_dates - row.dates) })}
                  </Pill>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
