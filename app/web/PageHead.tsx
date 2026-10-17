import type { ReactNode } from "react";
import { cx } from "@/app/ui/cx";
import styles from "@/app/web/shell.module.css";

/**
 * The page title of a web screen (board: `h1` 38px/300 and a 15px muted line under it). The one `h1` of the page;
 * `sub` is optional. Stands in for G0's `.b6-h1-web` + `.b6-sub` until they merge (the class names are already on the
 * elements).
 */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.pageHead}>
      <h1 className={cx("b6-h1-web", styles.h1)}>{title}</h1>
      {sub ? <p className={cx("b6-sub", styles.sub)}>{sub}</p> : null}
      {children}
    </div>
  );
}
