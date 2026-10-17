import type { ReactNode } from "react";
import styles from "@/app/web/shell.module.css";

/** The page title of a web screen (G0's `.b6-h1-web`, then a `.b6-sub` line). The one `h1` of the page; `sub` is optional. */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.pageHead}>
      <h1 className="b6-h1-web">{title}</h1>
      {sub ? <p className="b6-sub">{sub}</p> : null}
      {children}
    </div>
  );
}
