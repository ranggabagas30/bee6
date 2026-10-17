"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/app/ui/cx";

export interface SidePanelProps {
  /** Accessible name of the panel (a complementary landmark). */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Action text for the collapsed pill ("Open the guide"), read before the pill content. */
  openLabel: string;
  /** Accessible name of the icon-only close button. */
  closeLabel: string;
  /** Content of the collapsed pill. */
  pill: ReactNode;
  /** Content of the panel's header row, next to the close button. */
  header: ReactNode;
  children: ReactNode;
  /** Id of the element that names the scrolling body (a card heading). Without it the body is named by `label`. */
  bodyLabelledBy?: string;
  className?: string;
}

/**
 * Laptop side panel shell: a fixed 360px panel on the right, collapsed to a pill at the top right.
 * Controlled and non-modal (no dialog role, no focus trap). Focus moves to the close button on open and back
 * to the pill on close, so the keyboard never lands on a removed element. Escape closes it.
 * It holds no copy of its own: every string comes from the caller.
 */
export function SidePanel({ label, open, onOpenChange, openLabel, closeLabel, pill, header, children, bodyLabelledBy, className }: SidePanelProps) {
  const bodyId = useId();
  const pillRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) closeRef.current?.focus();
    if (!open && wasOpen.current) pillRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // While open the panel covers the right 360 px: tell the page (CSS on <html>) to keep its content left of it.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("b6-panel-open");
    return () => root.classList.remove("b6-panel-open");
  }, [open]);

  // While collapsed the pill sits fixed at the top right of the header band: tell each .b6-pill-room header to keep its controls left of it (see globals.css).
  useEffect(() => {
    if (open) return;
    const root = document.documentElement;
    root.classList.add("b6-panel-collapsed");
    return () => root.classList.remove("b6-panel-collapsed");
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !open) return;
    // React synthetic events climb the React tree, so a keydown inside a child's portal (a modal dialog on
    // document.body) lands here too. Only a key pressed inside the panel's own DOM closes it: the portal owns its Escape.
    if (!e.currentTarget.contains(e.target as Node)) return;
    onOpenChange(false);
  };

  if (!open) {
    return (
      <button
        ref={pillRef}
        type="button"
        className="b6-handle b6-panel-pill"
        aria-expanded={false}
        aria-controls={bodyId}
        onClick={() => onOpenChange(true)}
      >
        <span className="b6-sr-only">{openLabel}</span>
        {pill}
        <span aria-hidden="true">⌄</span>
      </button>
    );
  }

  return (
    <aside id={bodyId} aria-label={label} className={cx("b6-panel", className)} onKeyDown={onKeyDown}>
      <div className="b6-panel__head">
        <div className="b6-panel__title">{header}</div>
        <button ref={closeRef} type="button" className="b6-panel__close" aria-label={closeLabel} onClick={() => onOpenChange(false)}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className="b6-panel__body"
        role="region"
        tabIndex={0}
        aria-labelledby={bodyLabelledBy}
        aria-label={bodyLabelledBy ? undefined : label}
      >
        {children}
      </div>
    </aside>
  );
}
