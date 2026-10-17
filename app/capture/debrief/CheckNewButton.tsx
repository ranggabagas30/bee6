"use client";

import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { Button } from "@/app/ui";

/**
 * R-18 (sandbox only): "Check for new questions". Rendered by a caller only when the device has the demo
 * profile, so a pilot screen never shows it. A full-width secondary button; it is disabled and relabelled while
 * the request is in flight.
 */
export function CheckNewButton({ lang, onCheck, checking }: { lang: Lang; onCheck: () => void; checking: boolean }) {
  return (
    <Button variant="secondary" block disabled={checking} onClick={onCheck}>
      {checking ? t(lang, "C-script-checking") : t(lang, "C-script-check-new")}
    </Button>
  );
}
