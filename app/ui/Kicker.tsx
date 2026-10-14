import type { HTMLAttributes } from "react";
import { cx } from "@/app/ui/cx";

/** Mono caps label ("YOUR JOURNEY", "WORK NOTES"). Pass the text already upper-cased. */
export function Kicker({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={cx("b6-kicker", className)} />;
}
