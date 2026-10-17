import type { ReactNode } from "react";
import { cx } from "@/app/ui/cx";

export interface DialogSheetProps {
  /** Id of the element that names the dialog (its title). Required: a dialog without a name is not announced. */
  labelledBy: string;
  /** Id of the element that describes it (the body paragraph), when there is one. */
  describedBy?: string;
  children: ReactNode;
  className?: string;
  /** Show the centred 460px card at every width. By default it is a bottom sheet under 900px and a centred card from 900px. */
  centred?: boolean;
}

/**
 * Modal dialog shell: dim backdrop plus the sheet (`role="dialog"`, `aria-modal`). Markup and looks only.
 * The caller owns what makes a dialog work: moving focus in, trapping Tab, Escape, restoring focus, and any live region.
 * Use `.b6-dsheet__title` on the heading and `.b6-dsheet__body` on the paragraph.
 */
export function DialogSheet({ labelledBy, describedBy, children, className, centred = false }: DialogSheetProps) {
  return (
    <div className="b6-dsheet-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cx("b6-dsheet", centred && "b6-dsheet--centred", className)}
      >
        <span className="b6-dsheet__grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
