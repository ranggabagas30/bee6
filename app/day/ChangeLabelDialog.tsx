"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Pill } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { WorkCategorySchema, type WorkCategory } from "@/lib/pipeline/categories";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import styles from "@/app/day/change-label.module.css";

/**
 * The supervisor's change-label dialog (R-19 PR-12a, plan 9.5; board D2-02b): every work category as a radio
 * row by its `C-cat-*` label, the current one checked and marked "Bee6 pick", the runner-up marked when it is a
 * work category, Save label / Cancel. Presentation only: `ThreadActions` opens it and runs the same `override`
 * action as before. No thread text, name or device appears here (hard rule #7): the body names the category only.
 *
 * Modal for real (WCAG 2.4.3 / 2.1.2, same pattern as `app/capture/SignOutDialog.tsx`): initial focus on the
 * checked radio, Tab and Shift+Tab cycle inside, Escape cancels unless a save is in flight, and focus goes back
 * to the opener when it unmounts. Rendered in a portal so a card's own stacking never clips it.
 */
export interface ChangeLabelDialogProps {
  lang: Lang;
  current: WorkCategory;
  runnerUp: WorkCategory | null;
  busy: boolean;
  /** The page's own copy key for a failed save (GATE_BLOCKED, generic); never server text. */
  errorKey: DictKey | null;
  onSave: (category: WorkCategory) => void;
  onCancel: () => void;
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled])';

export function ChangeLabelDialog({ lang, current, runnerUp, busy, errorKey, onSave, onCancel }: ChangeLabelDialogProps) {
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

  const dialog = (
    <div ref={rootRef} className={styles.overlay}>
      <Card as="section" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={styles.panel}>
        <h2 id={titleId} className={styles.title}>
          {t(lang, "C-lbl-title")}
        </h2>
        <p className={styles.body}>{t(lang, "C-lbl-body", { category: t(lang, CATEGORY_KEY[current]) })}</p>
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
            {WorkCategorySchema.options.map((category) => (
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
