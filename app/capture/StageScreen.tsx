import type { ReactNode } from "react";
import { CaptureStage, type StageTone } from "@/app/capture/CaptureStage";
import css from "@/app/capture/capture.module.css";

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
  /** Already a block element (`<p className=...>`) so a caller can swap it for an alert box. */
  sub?: ReactNode;
  mono?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <CaptureStage tone={tone} label={orbLabel} />
      <div className={css.head}>
        <h1 className={css.h1}>{title}</h1>
        {sub}
        {mono ? <p className={css.mono}>{mono}</p> : null}
      </div>
      <div className={css.foot}>{children}</div>
    </>
  );
}
