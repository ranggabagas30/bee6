import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/app/ui/cx";
import { Kicker } from "@/app/ui/Kicker";

export interface TileProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  /** `amber` marks something that needs a check; the label text still says so, colour is never the only cue. */
  tone?: "default" | "amber";
  surface?: "card" | "glass";
}

/** One stat: kicker label, big light-weight value, optional detail line. */
export function Tile({ label, value, detail, tone = "default", surface = "card", className, ...rest }: TileProps) {
  return (
    <div
      {...rest}
      className={cx(surface === "glass" ? "b6-glass" : "b6-card", "b6-tile", tone === "amber" && "b6-tile--amber", className)}
    >
      <Kicker>{label}</Kicker>
      <span className="b6-tile__value">{value}</span>
      {detail ? <span className="b6-tile__detail">{detail}</span> : null}
    </div>
  );
}
