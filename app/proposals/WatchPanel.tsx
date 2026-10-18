import { Button, Card, Chip, Glass, Pill } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { ProposalsWatch, WatchRow } from "@/lib/proposals/review-contract";
import { DEMO_WATCH_PLACEHOLDERS, watchDisplayRows, type WatchDisplayRow } from "@/app/proposals/watch-placeholders";
import styles from "@/app/proposals/supervisor.module.css";

/**
 * "What Bee6 is watching" (R-19 PR-12a, plan 3.5 / 9.5; page-2 boards D2-03, D2-03a, D2-03b; R-25 T10): one row per work
 * category the plain code has seen at least once in the last 7 business dates, with how many of the needed dates it was
 * seen on and a state chip, plus the one button that asks for a proposal. Presentation only: the data is the
 * `watch` block of GET /api/v1/proposals (counts only: never a thread, device, name or summary, hard rule #7)
 * and the parent runs the generate call.
 *
 * The button has one of four looks, decided by the rows (the parent passes whether any proposal already exists):
 * - a `ready` row and no proposal yet: "Ask Bee6 for a proposal" (`another` false);
 * - a `ready` row and a proposal exists: "Ask for another proposal" (`another` true, plan 3.3);
 * - no `ready` row, every seen category `proposed`: "All asked · no more evidence to use" (demo: "Both asked · …"), disabled (D2-03);
 * - no `ready` row otherwise: "Not enough evidence yet", disabled (D2-03b).
 * While `busy` it reads "Asking Bee6…" and is disabled (D2-03d). The server stays the authority: a tap only
 * sends the request; whatever it answers is what the parent shows. The button is decided by the SERVER's rows only.
 *
 * `demo` (a demo sandbox principal): the two script problems always have a row ("Not seen yet" until seen, R14) and, when
 * exactly the egg-tart row is ready and nothing is proposed yet, the board's "One proposal can be made now" note shows.
 * The pilot draws the server's rows and nothing else.
 *
 * The count never reads above the need ("seen on 2 of 2 days needed": the floor is met, QA UI-115).
 */

const STATE_KEY: Record<WatchDisplayRow["state"], DictKey> = {
  ready: "C-propw-ready",
  needs_more: "C-propw-needs",
  proposed: "C-propw-proposed",
  not_seen: "C-propw-notseen",
};

const STATE_TONE: Record<WatchDisplayRow["state"], "teal" | "amber" | "green" | "neutral"> = {
  ready: "teal",
  needs_more: "amber",
  proposed: "green",
  not_seen: "neutral",
};

export interface WatchPanelProps {
  lang: Lang;
  watch: ProposalsWatch;
  /** A proposal with content already exists (open or decided): the next ask is "another". */
  hasProposal: boolean;
  /** The generate call is in flight (or another one is, per a 409): the button is locked. */
  busy: boolean;
  onAsk: (another: boolean) => void;
  /** A demo sandbox principal: the script's two problems always have a row, and the "one proposal" note may show. */
  demo?: boolean;
}

export function WatchPanel({ lang, watch, hasProposal, busy, onAsk, demo = false }: WatchPanelProps) {
  const serverRows: readonly WatchRow[] = watch.categories;
  const rows = watchDisplayRows(serverRows, demo);
  const ready = serverRows.some((r) => r.state === "ready");
  const allProposed = serverRows.length > 0 && serverRows.every((r) => r.state === "proposed");
  const another = ready && hasProposal;
  const buttonKey: DictKey = busy
    ? "C-propw-asking"
    : ready
      ? another
        ? "C-propw-ask-another"
        : "C-propw-ask"
      : allProposed
        ? demo
          ? "C-propw-all-asked-demo"
          : "C-propw-all-asked"
        : "C-propw-none";
  const disabled = busy || !ready;
  const readyRows = serverRows.filter((r) => r.state === "ready");
  const showOneNote =
    demo && !hasProposal && readyRows.length === 1 && readyRows[0]!.category === DEMO_WATCH_PLACEHOLDERS[0]!.category && serverRows.some((r) => r.state === "needs_more");

  return (
    <>
      <Card as="section" aria-labelledby="prop-watch-kicker" className={styles.watch}>
        <div className={styles.watchHead}>
          <div className={styles.watchTitle}>
            <span id="prop-watch-kicker" className="b6-kick">
              {t(lang, "C-propw-kicker")}
            </span>
            <span className={styles.watchNote}>{t(lang, "C-propw-note")}</span>
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
              // Never above the need: a category seen on 3 days still reads "2 of 2" (the floor is met).
              const seen = Math.min(row.dates, row.need_dates);
              return (
                <li key={row.category} className={styles.watchRow}>
                  <div className={styles.watchRowMain}>
                    <span className={styles.watchLabel}>
                      <Chip>{t(lang, CATEGORY_KEY[row.category])}</Chip>
                    </span>
                    <span className={styles.watchSeen}>{t(lang, "C-propw-seen", { dates: seen, need: row.need_dates })}</span>
                  </div>
                  <span className={styles.watchState}>
                    <span className={styles.dots} role="img" aria-label={`${t(lang, "C-propw-days")}: ${seen}/${row.need_dates}`}>
                      {Array.from({ length: row.need_dates }, (_, i) => (
                        <span key={i} className={cx(styles.dot, i < seen && styles.dotOn)} />
                      ))}
                    </span>
                    <Pill tone={STATE_TONE[row.state]}>{t(lang, STATE_KEY[row.state], { n: Math.max(1, row.need_dates - row.dates) })}</Pill>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {showOneNote && (
        <Glass as="section" aria-labelledby="prop-one-h" className={styles.noteCard}>
          <h2 id="prop-one-h" className={styles.noteCardTitle}>
            {t(lang, "C-propw-one-h")}
          </h2>
          <p className={styles.noteCardBody}>{t(lang, "C-propw-one-p")}</p>
        </Glass>
      )}
    </>
  );
}
