"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
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
  /** Id of the element that names the scrolling body (a card heading). Without it the body is named by the handle's action text ("Close the guide"), so it never repeats the sheet's own name. */
  bodyLabelledBy?: string;
  className?: string;
  /** Phone only: a pointerdown outside the sheet collapses it. The event is not stopped, so the tap still lands on its target. */
  collapseOnOutsidePointerDown?: boolean;
}

/**
 * Phone bottom sheet shell. Collapsed it is only the handle row; open, the body shows above it (max 70vh, scrolls).
 * Controlled and non-modal: no dialog role, no focus trap, the page behind stays usable. Escape closes it.
 * It holds no copy of its own: every string comes from the caller.
 */
export function Sheet({ label, open, onOpenChange, openLabel, closeLabel, handle, children, bodyLabelledBy, className, collapseOnOutsidePointerDown }: SheetProps) {
  const bodyId = useId();
  const handleRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // R-21 F-2 / D7: the open sheet covers the page's next button (End confirm, Set up). Capture phase, never stopped:
  // the tap that collapses the sheet still reaches its target. The handle is inside the section, so the opening tap
  // never closes it. Not attached while collapsed.
  useEffect(() => {
    if (!open || !collapseOnOutsidePointerDown) return;
    const onDown = (e: PointerEvent) => {
      const el = sectionRef.current;
      if (!el || !(e.target instanceof Element)) return;
      // Ignore pointerdowns inside a modal dialog (portaled, aria-modal="true").
      if (e.target.closest('[aria-modal="true"]')) return;
      // Collapse if the tap is outside the sheet.
      if (!el.contains(e.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, collapseOnOutsidePointerDown, onOpenChange]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !open) return;
    // React synthetic events climb the React tree, so a keydown inside a child's portal (a modal dialog on
    // document.body) lands here too. Only a key pressed inside the sheet's own DOM closes it: the portal owns its Escape.
    if (!e.currentTarget.contains(e.target as Node)) return;
    onOpenChange(false);
    handleRef.current?.focus();
  };

  return (
    <section ref={sectionRef} aria-label={label} className={cx("b6-sheet", className)} onKeyDown={onKeyDown}>
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
          <span id={`${bodyId}-action`} className="b6-sr-only">
            {open ? closeLabel : openLabel}
          </span>
          <span className="b6-sheet__handle-content">{handle}</span>
          <span className="b6-sheet__chev" aria-hidden="true">
            {open ? "⌄" : "⌃"}
          </span>
        </span>
      </button>
      {/* The body scrolls, so it is a tab stop with a name (axe scrollable-region-focusable): a keyboard user can scroll it
          even when nothing inside is focusable. */}
      <div
        id={bodyId}
        className="b6-sheet__body"
        hidden={!open}
        role="region"
        tabIndex={0}
        aria-labelledby={bodyLabelledBy ?? `${bodyId}-action`}
      >
        {children}
      </div>
    </section>
  );
}
