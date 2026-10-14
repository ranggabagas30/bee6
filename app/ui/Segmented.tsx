"use client";

import type { ReactNode } from "react";
import { cx } from "@/app/ui/cx";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Language of the label, for options such as "ID" / "EN". */
  lang?: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  /** Accessible name of the group ("Language", "View"). Required: there is no visible heading. */
  label: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** `mono` is the compact EN/ID toggle; `plain` is the view switch (Week / Month / All). */
  variant?: "mono" | "plain";
  className?: string;
}

/**
 * Single-choice segmented control: a labelled group of toggle buttons (`aria-pressed`). Controlled.
 * Native buttons, so Tab and Enter/Space work without extra key handling.
 */
export function Segmented<V extends string>({ label, options, value, onChange, variant = "mono", className }: SegmentedProps<V>) {
  return (
    <div role="group" aria-label={label} className={cx("b6-seg", variant === "mono" && "b6-seg--mono", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.lang}
          disabled={o.disabled}
          aria-pressed={o.value === value}
          className="b6-seg__item"
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
