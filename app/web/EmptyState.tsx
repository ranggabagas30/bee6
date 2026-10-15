import type { HTMLAttributes, ReactNode } from "react";
import { Glass } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import styles from "@/app/web/empty-state.module.css";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The one-line state, e.g. "No proposal yet". */
  title: ReactNode;
  /** What makes it fill, e.g. "Bee6 needs the same problem on at least 2 days." */
  detail?: ReactNode;
}

/**
 * An empty screen or section (R-19 PR-6 §8.3): a quiet glass surface with the state on one line and, under it, what
 * makes it fill. Static text only: no control, no live region (the surrounding screen announces its own loads).
 */
export function EmptyState({ title, detail, className, ...rest }: EmptyStateProps) {
  return (
    <Glass {...rest} className={cx(styles.empty, className)}>
      <p className={styles.title}>{title}</p>
      {detail ? <p className={styles.detail}>{detail}</p> : null}
    </Glass>
  );
}
