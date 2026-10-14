import { createElement, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "@/app/ui/cx";

export type StepStatus = "done" | "now" | "todo";

const GLYPH: Record<StepStatus, string> = { done: "✓", now: "•", todo: "" };

export interface StepTickProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  status: StepStatus;
  /** The status in words ("done", "current step", "not yet"), read by screen readers. The glyph is decoration. */
  statusLabel: string;
  /** `li` when used inside a list. */
  as?: "div" | "li";
  children: ReactNode;
}

/** One row of a step list: a round tick plus the step text. */
export function StepTick({ status, statusLabel, as = "div", className, children, ...rest }: StepTickProps) {
  return createElement(
    as,
    {
      ...rest,
      className: cx("b6-step", `b6-step--${status}`, className),
      "aria-current": status === "now" ? "step" : undefined,
    },
    <span className={`b6-tick b6-tick--${status}`} aria-hidden="true">
      {GLYPH[status]}
    </span>,
    <span className="b6-sr-only">{statusLabel}</span>,
    <span>{children}</span>,
  );
}
