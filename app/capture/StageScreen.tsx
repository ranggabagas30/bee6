import type { ReactNode } from "react";
import css from "@/app/capture/capture.module.css";
import { cx } from "@/app/ui/cx";
import { Stage, type StageTone } from "@/app/ui";

/**
 * The page-2 staff screen body (boards P2-04 / P2-05 / P2-06 and their laptop twins): stage, h1, one sub line,
 * the mono day line, then the footer with the one primary action and the quiet ones. Presentation only; the
 * page owns every handler and decides what goes in the footer.
 */
export function StageScreen({
  tone,
  orbLabel,
  title,
  sub,
  mono,
  children,
}: {
  tone: StageTone;
  orbLabel?: string;
  title: string;
  /** Already a block element (`<p className="b6-sub">`) so a caller can swap it for an alert box. */
  sub?: ReactNode;
  mono?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <Stage tone={tone} label={orbLabel} />
      <div className="b6-head">
        <h1 className="b6-h1-display">{title}</h1>
        {sub}
        {mono ? <p className="b6-mono">{mono}</p> : null}
      </div>
      <div className={cx("b6-foot", css.foot)}>{children}</div>
    </>
  );
}
