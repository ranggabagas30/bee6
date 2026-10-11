"use client";

import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-18 (sandbox only): "Check for new questions". Rendered by a caller only when the device has the demo
 * profile, so a pilot screen never shows it. A native 48 px button; it is disabled and relabelled while the
 * request is in flight.
 */
export function CheckNewButton({ lang, onCheck, checking }: { lang: Lang; onCheck: () => void; checking: boolean }) {
  return (
    <button
      type="button"
      style={{ marginTop: 12, width: "100%", minHeight: 48, padding: "8px 16px", fontSize: 16 }}
      disabled={checking}
      onClick={onCheck}
    >
      {checking ? t(lang, "C-script-checking") : t(lang, "C-script-check-new")}
    </button>
  );
}
