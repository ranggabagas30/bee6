import { createElement, type HTMLAttributes } from "react";
import { cx } from "@/app/ui/cx";

export type SurfaceTag = "div" | "section" | "article" | "aside" | "li";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. A `section` is only a landmark when it also has an accessible name. */
  as?: SurfaceTag;
}

/** The white raised surface (18px radius, soft shadow). Padding is the caller's: this is a shell. */
export function Card({ as = "div", className, ...rest }: SurfaceProps) {
  return createElement(as, { ...rest, className: cx("b6-card", className) });
}

/** The translucent surface with a hairline (16px radius), for panels that sit on the mist. */
export function Glass({ as = "div", className, ...rest }: SurfaceProps) {
  return createElement(as, { ...rest, className: cx("b6-glass", className) });
}
