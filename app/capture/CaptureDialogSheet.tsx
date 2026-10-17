import type { ReactNode } from "react";
import css from "@/app/capture/capture.module.css";

/**
 * The page-2 dialog surface (boards P2-06 End confirm, P2-07a/b sign-out; L2-06a/b on a laptop): a dim, then a bottom
 * sheet under 900 px and a centred card from 900 px. `role="dialog"`, modal, labelled by the caller's heading.
 *
 * Presentation only. Focus (move in, trap, restore) and Escape stay with the caller, as the G0 `DialogSheet` does it.
 *
 * TEMPORARY (R-25 T5): same props as the G0 `DialogSheet` primitive (R-25 T1, docs/tasks/R-25-ui-fidelity.md
 * section 9.2); on rebase this file is replaced by that import and the dialog block of `capture.module.css` goes.
 */
export function CaptureDialogSheet({
  labelledBy,
  describedBy,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <div className={css.dim}>
      <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} className={css.dsheet}>
        <div className={css.grip} aria-hidden="true" />
        {children}
      </section>
    </div>
  );
}
