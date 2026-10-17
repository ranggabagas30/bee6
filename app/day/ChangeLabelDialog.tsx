"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Chip, Pill } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { WorkCategorySchema, type WorkCategory } from "@/lib/pipeline/categories";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { CATEGORY_CODE } from "@/app/day/summary";
import styles from "@/app/day/change-label.module.css";

/**
 * The supervisor's change-label dialog (R-19 PR-12a, plan 9.5; board D2-02b; R-25 T9): every work category as a radio
 * row (code chip + `C-cat-*` name), Bee6's pick first and checked, the runner-up second when it is a work category,
 * Save label / Cancel. The body names the moment by its summary and confidence, as on the card behind it.
 * Presentation only: `ThreadActions` opens it and runs the same `override` action as before. No name or device
 * appears here (hard rule #7): the summary is the redacted work-note summary the day record already shows.
 *
 * Modal for real (WCAG 2.4.3 / 2.1.2, same pattern as `app/capture/SignOutDialog.tsx`): initial focus on the
 * checked radio, Tab and Shift+Tab cycle inside, Escape cancels unless a save is in flight, and focus goes back
 * to the opener when it unmounts. Rendered in a portal so a card's own stacking never clips it.
 */
export interface ChangeLabelDialogProps {
  lang: Lang;
  current: WorkCategory;
  runnerUp: WorkCategory | null;
  /** The moment's summary and Bee6's confidence, for the body line. Without a summary the body names the category only. */
  summary?: string;
  confidencePct?: number;
  busy: boolean;
  /** The page's own copy key for a failed save (GATE_BLOCKED, generic); never server text. */
  errorKey: DictKey | null;
  onSave: (category: WorkCategory) => void;
  onCancel: () => void;
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled])';

const SUMMARY_MARK = "\u0001";

export function ChangeLabelDialog({ lang, current, runnerUp, summary, confidencePct, busy, errorKey, onSave, onCancel }: ChangeLabelDialogProps) {
  const [selected, setSelected] = useState<WorkCategory>(current);
  const ids = useId();
  const titleId = `${ids}-title`;
  const legendId = `${ids}-legend`;
  const rootRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ busy, onCancel });
  useEffect(() => {
    latest.current = { busy, onCancel };
  });

  // Initial focus on the checked radio; focus back to the opener (the Change category button) on unmount.
  useEffect(() => {
    const opener = document.activeElement;
    currentRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Escape + focus trap, on the document so it holds wherever focus is while the dialog is open.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.key === "Escape") {
        if (!latest.current.busy) {
          e.preventDefault();
          latest.current.onCancel();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      // A radio group is one tab stop: only the checked radio (or the first) counts.
      const radios = focusables.filter((el) => el instanceof HTMLInputElement && el.type === "radio");
      const checked = radios.find((el) => (el as HTMLInputElement).checked) ?? radios[0];
      const stops = focusables.filter((el) => !radios.includes(el) || el === checked);
      const active = document.activeElement;
      if (stops.length === 0) {
        e.preventDefault();
        root.querySelector<HTMLElement>('[role="dialog"]')?.focus();
        return;
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const inside = active instanceof HTMLElement && root.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || radios.includes(active as HTMLElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Bee6's pick first, the runner-up second, then the rest in schema order (board D2-02b).
  const ordered = [
    current,
    ...(runnerUp && runnerUp !== current ? [runnerUp] : []),
    ...WorkCategorySchema.options.filter((c) => c !== current && c !== runnerUp),
  ];

  // The summary is bold on the board; split the translated line around a mark so the word order stays the translator's.
  const trimmedSummary = summary?.trim() ?? "";
  const bodyParts =
    trimmedSummary !== "" && confidencePct !== undefined
      ? t(lang, "C-day2-lbl-body", { summary: SUMMARY_MARK, category: t(lang, CATEGORY_KEY[current]), pct: confidencePct }).split(SUMMARY_MARK)
      : null;

  const dialog = (
    <div ref={rootRef} className={styles.overlay}>
      <Card as="section" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={styles.panel}>
        <h2 id={titleId} className={styles.title}>
          {t(lang, "C-lbl-title")}
        </h2>
        <p className={styles.body}>
          {bodyParts ? (
            <>
              {bodyParts[0]}
              <strong className={styles.moment}>{trimmedSummary}</strong>
              {bodyParts[1]}
            </>
          ) : (
            t(lang, "C-lbl-body", { category: t(lang, CATEGORY_KEY[current]) })
          )}
        </p>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && selected !== current) onSave(selected);
          }}
        >
          <fieldset className={styles.group} role="radiogroup" aria-labelledby={legendId}>
            <legend id={legendId} className={styles.legend}>
              {t(lang, "C-lbl-group")}
            </legend>
            {ordered.map((category) => (
              <label key={category} className={styles.option}>
                <input
                  ref={category === current ? currentRef : undefined}
                  type="radio"
                  name={`${ids}-label`}
                  value={category}
                  checked={selected === category}
                  disabled={busy}
                  onChange={() => setSelected(category)}
                />
                <Chip className={styles.code} aria-hidden="true">
                  {CATEGORY_CODE[category]}
                </Chip>
                <span className={styles.optionLabel}>{t(lang, CATEGORY_KEY[category])}</span>
                {category === current ? (
                  <Pill tone="amber">{t(lang, "C-lbl-current")}</Pill>
                ) : category === runnerUp ? (
                  <Pill tone="neutral">{t(lang, "C-lbl-runner-up")}</Pill>
                ) : null}
              </label>
            ))}
          </fieldset>
          {errorKey ? (
            <p role="alert" className={styles.alert}>
              {t(lang, errorKey)}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="lg" block disabled={busy || selected === current}>
              {busy ? t(lang, "C-act-busy") : t(lang, "C-lbl-save")}
            </Button>
            <Button variant="secondary" block disabled={busy} onClick={onCancel}>
              {t(lang, "C-act-cancel")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );

  return createPortal(dialog, document.body);
}
