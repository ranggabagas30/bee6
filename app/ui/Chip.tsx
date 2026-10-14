import type { HTMLAttributes } from "react";
import { cx } from "@/app/ui/cx";

export type ChipVariant = "default" | "line" | "teal" | "amber";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
}

/** Small mono tag ("DEMO DATA", "STAGE 2 OF 5"). Static: not a control. */
export function Chip({ variant = "default", className, ...rest }: ChipProps) {
  return <span {...rest} className={cx("b6-chip", variant !== "default" && `b6-chip--${variant}`, className)} />;
}

export type PillTone = "neutral" | "teal" | "amber" | "red" | "green";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** Status pill. The tone only tints; the words carry the meaning. */
export function Pill({ tone = "neutral", className, ...rest }: PillProps) {
  return <span {...rest} className={cx("b6-pill", `b6-pill--${tone}`, className)} />;
}
