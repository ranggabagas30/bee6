import type { HTMLAttributes } from "react";
import { cx } from "@/app/ui/cx";

/** The two-bar mark. Fills with `currentColor`; decorative, so it is hidden from assistive tech. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="8.15" y="6" width="31.7" height="16.1" rx="4.5" fill="currentColor" />
      <rect x="6.875" y="24.5" width="34.25" height="17.5" rx="4.8" fill="currentColor" />
    </svg>
  );
}

export interface LogoProps extends HTMLAttributes<HTMLSpanElement> {
  /** `md` is the board size (26px mark, 18px word); `sm` is for tight bars. */
  size?: "sm" | "md";
}

/** Brand lockup: the teal mark (hidden from assistive tech) plus the wordmark, which is always the text "Bee6". */
export function Logo({ size = "md", className, ...rest }: LogoProps) {
  return (
    <span {...rest} className={cx("b6-logo", size === "sm" && "b6-logo--sm", className)}>
      <LogoMark className="b6-logo__mark" />
      <span className="b6-logo__word">Bee6</span>
    </span>
  );
}
