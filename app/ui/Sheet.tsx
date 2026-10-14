"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/app/ui/cx";

export interface SheetProps {
  /** Accessible name of the region. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the handle does when collapsed, as an action ("Open the guide"). Read by screen readers before the handle content. */
  openLabel: string;
  /** What the handle does when open ("Close the guide"). */
  closeLabel: string;
  /** Content of the always-visible handle row (summary, chips). */
  handle: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Phone bottom sheet shell. Collapsed it is only the handle row; open, the body shows above it (max 70vh, scrolls).
 * Controlled and non-modal: no dialog role, no focus trap, the page behind stays usable. Escape closes it.
 * It holds no copy of its own: every string comes from the caller.
 */
export function Sheet({ label, open, onOpenChange, openLabel, closeLabel, handle, children, className }: SheetProps) {
  const bodyId = useId();
  const handleRef = useRef<HTMLButtonElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !open) return;
    onOpenChange(false);
    handleRef.current?.focus();
  };

  return (
    <section aria-label={label} className={cx("b6-sheet", className)} onKeyDown={onKeyDown}>
      <button
        ref={handleRef}
        type="button"
        className="b6-handle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onOpenChange(!open)}
      >
        <span className="b6-sheet__grip" aria-hidden="true" />
        <span className="b6-sheet__row">
          <span className="b6-sr-only">{open ? closeLabel : openLabel}</span>
          <span className="b6-sheet__handle-content">{handle}</span>
          <span className="b6-sheet__chev" aria-hidden="true">
            {open ? "⌄" : "⌃"}
          </span>
        </span>
      </button>
      <div id={bodyId} className="b6-sheet__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
