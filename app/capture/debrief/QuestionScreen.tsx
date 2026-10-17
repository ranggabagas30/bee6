"use client";

import { useEffect, useId, useRef } from "react";
import { canCommit, type DebriefView } from "@/lib/debrief/flow";
import { reasonLength } from "@/lib/debrief/reason";
import { REASON_MAX_CHARS } from "@/lib/debrief/constants";
import { questionCategoryChip, questionLines, questionText, questionWhy } from "@/lib/i18n/category-labels";
import { t } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { Lang } from "@/lib/i18n/lang";
import { Button, Card, Chip } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { CheckNewButton } from "@/app/capture/debrief/CheckNewButton";
import css from "@/app/capture/debrief/debrief.module.css";

/**
 * One debrief question at a time (R-07 Task 7.2, UX-03 section 4.2/5.8; page-2 look from R-25 T7, boards P2-09 /
 * L2-08). Purely presentational and controlled: the caller (`DebriefFlow`) owns the reducer state and the
 * Next/Skip side effects (the phone cache write, the POST, the gate). Nothing here ever reads a server-supplied
 * thread line, a name or a role: only `questionText()`'s enum-mapped template, the category code and the fixed
 * `questionWhy()` sentence. The answer is Yes or No plus a required reason, as the route accepts (the board's
 * "Not sure" is not offered: R-25 ruling R9).
 */

export type QuestionView = Extract<DebriefView, { kind: "question" }>;

export interface QuestionScreenProps {
  view: QuestionView;
  lang: Lang;
  /** The uploader's last disposition for THIS screen's own flush, or null to show nothing. */
  uploadNote: "offline" | "refused" | null;
  onChoose: (answer: "yes" | "no") => void;
  onTypeReason: (reason: string) => void;
  onLanjut: () => void;
  onLewati: () => void;
  /** R-18, sandbox only: omitted on the pilot, so no "Check for new questions" button renders there. */
  onCheck?: () => void;
  checking?: boolean;
  /** The debrief's own business date: the chip shows only for a question from a day strictly before it. */
  debriefDate?: string | null;
  /**
   * Whole minutes left in the debrief hour, for the amber chip. Passive (no live region): the container passes it
   * from the page's ticked clock. Omitted: no chip.
   */
  minutesLeft?: number | null;
}

export function QuestionScreen({
  view,
  lang,
  uploadNote,
  onChoose,
  onTypeReason,
  onLanjut,
  onLewati,
  onCheck,
  checking = false,
  debriefDate = null,
  minutesLeft = null,
}: QuestionScreenProps) {
  const question = view.list[view.index];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const textareaId = useId();
  const counterId = useId();
  const helpId = useId();

  // A fresh question (new index) moves focus to its heading (UX-03 section 4.2: "each new question moves focus
  // to its heading").
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.index]);

  // A refused Next moves focus to the first error (UX-03 section 4.2).
  useEffect(() => {
    if (view.save_error) alertRef.current?.focus();
  }, [view.save_error]);

  if (!question) return null;

  const qText = questionText(lang, question);
  const qLines = questionLines(lang, question);
  const chip = questionCategoryChip(lang, question);
  const n = reasonLength(view.reason);
  const over = n > REASON_MAX_CHARS ? n - REASON_MAX_CHARS : 0;
  const disabled = !canCommit(view);

  // Position over the whole debrief, not the current list: the counts already include every question this
  // device answered or skipped (a reload restores them), so "2 of 5" stays 2 of 5 after a refresh or a reload.
  const position = view.answered + view.skipped + 1;
  const total = position - 1 + (view.list.length - view.index);

  const earlierDay = Boolean(question.business_date && (debriefDate === null || question.business_date < debriefDate));

  function handleGroupKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onChoose(e.key === "ArrowLeft" ? "yes" : "no");
  }

  function counterNode() {
    if (over > 0) {
      return t(lang, over === 1 ? "C-d-over-one" : "C-d-over", { N: over });
    }
    if (n >= 450) return t(lang, "C-d-count-warn", { N: n, M: REASON_MAX_CHARS - n });
    return t(lang, "C-d-count", { N: n });
  }

  function disabledHelp(): string | null {
    if (!disabled) return null;
    if (over > 0) return t(lang, over === 1 ? "C-d-over-one" : "C-d-over", { N: over });
    return t(lang, "C-d-help-dis");
  }

  const reasonLabelLines: string[] =
    view.choice === "yes"
      ? [t(lang, "C-d-r-yes"), t(lang, "C-d-r-yes-2")]
      : view.choice === "no"
        ? [t(lang, "C-d-r-no"), t(lang, "C-d-r-no-2")]
        : [t(lang, "C-d2-q-reason")];

  const help = disabledHelp();

  return (
    <section className={css.question}>
      <div className={css.topRow}>
        <span className="b6-kick">{t(lang, "C-d-prog", { N: position, M: total })}</span>
        {minutesLeft !== null ? <Chip variant="amber">{t(lang, "C-d2-q-left", { k: minutesLeft })}</Chip> : null}
      </div>
      <ul className={css.bars} aria-label={t(lang, "C-d2-q-progress")}>
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={cx(css.bar, i < position && css.barDone)}
            aria-current={i === position - 1 ? "step" : undefined}
          />
        ))}
      </ul>

      <Card as="div" className={css.card}>
        <div className={css.tags}>
          {chip ? (
            <Chip>
              <span aria-hidden="true">{chip.code}</span>
              <span className="b6-sr-only">{chip.name}</span>
            </Chip>
          ) : null}
          {earlierDay && question.business_date ? (
            <Chip variant="amber">{t(lang, "C-script-earlier-day", { date: dayLabel(question.business_date, lang) })}</Chip>
          ) : null}
          <span className="b6-mono">
            {earlierDay ? question.start_hm : t(lang, "C-d2-q-when", { hm: question.start_hm })}
          </span>
        </div>
        <h2 ref={headingRef} tabIndex={-1} className={css.heading}>
          {qLines.map((line, i) => (
            <span key={i} className={css.headingLine}>
              {line}
            </span>
          ))}
        </h2>
        <p className={css.why}>{questionWhy(lang, question)}</p>
      </Card>

      <div role="radiogroup" aria-label={qText} className={css.choices} onKeyDown={handleGroupKeyDown}>
        <button
          type="button"
          role="radio"
          aria-checked={view.choice === "yes"}
          className={cx(css.choice, view.choice === "yes" && css.choiceOn)}
          onClick={() => onChoose("yes")}
        >
          {view.choice === "yes" ? <span aria-hidden="true">✓ </span> : null}
          {t(lang, "C-d-yes")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view.choice === "no"}
          className={cx(css.choice, view.choice === "no" && css.choiceOn)}
          onClick={() => onChoose("no")}
        >
          {view.choice === "no" ? <span aria-hidden="true">✓ </span> : null}
          {t(lang, "C-d-no")}
        </button>
      </div>

      <div className={css.reasonBlock}>
        <label htmlFor={textareaId} className={css.reasonLabel}>
          {reasonLabelLines.map((line, i) => (
            <span key={i}>
              {i > 0 ? " " : ""}
              {line}
            </span>
          ))}
        </label>
        <textarea
          id={textareaId}
          rows={3}
          autoComplete="off"
          aria-required="true"
          aria-describedby={counterId}
          className={cx("b6-field", css.reason)}
          placeholder={t(lang, "C-d2-q-ph")}
          value={view.reason}
          onChange={(e) => onTypeReason(e.target.value)}
        />
        <p id={counterId} className={cx(css.counter, (over > 0 || n >= 450) && css.counterWarn)}>
          {counterNode()}
        </p>
      </div>

      {view.save_error ? (
        <div ref={alertRef} role="alert" tabIndex={-1} className="b6-alert b6-alert--red">
          <span className="b6-alert__lead">{t(lang, "C-d-save-fail")}</span>
          <span>{t(lang, "C-d-save-fail-2")}</span>
          <span>{t(lang, "C-d-save-fail-3")}</span>
        </div>
      ) : null}

      {uploadNote ? (
        <div role="status" aria-live="polite" className="b6-alert b6-alert--amber">
          {t(lang, uploadNote === "offline" ? "C-d-offline" : "C-d-refused")}
        </div>
      ) : null}

      <Button size="lg" block onClick={onLanjut} disabled={disabled} aria-describedby={help ? helpId : undefined}>
        {t(lang, "C-d2-next")}
      </Button>
      {help ? (
        <p id={helpId} className="b6-note">
          {help}
        </p>
      ) : null}
      <Button variant="text" block onClick={onLewati}>
        {t(lang, "C-b-lewati")}
      </Button>
      {onCheck ? <CheckNewButton lang={lang} onCheck={onCheck} checking={checking} /> : null}

      <div className={css.notes}>
        <p className="b6-note">{t(lang, "C-d2-wait-1")}</p>
        {view.index === 0 ? <p className="b6-note">{t(lang, "C-d-locked")}</p> : null}
      </div>
    </section>
  );
}
