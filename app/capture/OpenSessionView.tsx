"use client";

import { Button, Card } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-19 PR-4b (plan 5.7a; boards P2-07c / L2-06c): the sandbox device's still-open server session, found again on
 * return. The phone never resumes listening into it (the R-P1 rule): it can only be ended or cancelled.
 * - closing reached: "End today" (the page runs the existing end route, then the debrief).
 * - not reached (reload or closed tab before closing): "Cancel today" (the existing discard route; Start is offered again).
 * It replaces the idle Start whenever `open_session` exists. Presentation only; no ids, no timestamps on screen.
 */
export interface OpenSessionViewProps {
  lang: Lang;
  closingReached: boolean;
  busy: boolean;
  /** The page's own copy key for a failed End or Cancel; never server text. */
  errorKey: DictKey | null;
  onEnd: () => void;
  onCancel: () => void;
}

export function OpenSessionView({ lang, closingReached, busy, errorKey, onEnd, onCancel }: OpenSessionViewProps) {
  return (
    <Card as="section" aria-labelledby="open-session-h" style={{ marginTop: 16, padding: 20 }}>
      <h2 id="open-session-h" style={{ fontSize: 20, margin: "0 0 8px" }}>
        {t(lang, closingReached ? "C-sess-open-reached-h" : "C-sess-open-interrupted-h")}
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 16, lineHeight: 1.45 }}>
        {t(lang, closingReached ? "C-sess-open-reached-b" : "C-sess-open-interrupted-b")}
      </p>
      {errorKey ? (
        <p role="alert" style={{ margin: "0 0 12px", fontSize: 14, color: "#b00020" }}>
          {t(lang, errorKey)}
        </p>
      ) : null}
      <Button variant="primary" size="lg" block onClick={closingReached ? onEnd : onCancel} disabled={busy}>
        {t(lang, closingReached ? "C-sess-end-today" : "C-sess-open-cancel")}
      </Button>
    </Card>
  );
}
