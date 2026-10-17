/**
 * The two-bar mark and the "Bee6" wordmark (board `.logo`). Stands in for G0's `Logo` primitive (R-25 §9.2,
 * `app/ui/Logo.tsx`) until that merges; on rebase swap this file's body for `<Logo size="md" />` and delete the
 * `.logo*` rules from shell.module.css. Decorative mark, the wordmark carries the name.
 */
import styles from "@/app/web/shell.module.css";

export function BrandMark() {
  return (
    <span className={styles.logo}>
      <svg className={styles.logoMark} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <rect x="8.15" y="6" width="31.7" height="16.1" rx="4.5" fill="currentColor" />
        <rect x="6.875" y="24.5" width="34.25" height="17.5" rx="4.8" fill="currentColor" />
      </svg>
      <span className={styles.logoWord}>Bee6</span>
    </span>
  );
}
