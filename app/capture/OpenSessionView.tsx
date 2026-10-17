"use client";

import type { ReactNode } from "react";
import { StageScreen } from "@/app/capture/StageScreen";
import { Button } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-19 PR-4b (plan 5.7a; boards P2-07c / L2-06c): the sandbox device's still-open server session, found again on
 * return. The phone never resumes listening into it (the R-P1 rule): it can only be ended or cancelled.
 * - closing reached: "End today" (the page runs the existing end route, then the debrief).
 * - not reached (reload or closed tab before closing): "Cancel today" (the existing discard route; Start is offered again).
 * It replaces the idle Start whenever `open_session` exists. Page-2 look (R-25 T5): the stage, an h1, one sub line, the
 * day line, then the one action. Presentation only; no ids, no timestamps on screen.
 */
export interface OpenSessionViewProps {
  lang: Lang;
  closingReached: boolean;
  busy: boolean;
  /** The page's own copy key for a failed End or Cancel; never server text. */
  errorKey: DictKey | null;
  onEnd: () => void;
  onCancel: () => void;
  /** "Day n of 3 · date", when the page has it. */
  dayLine?: string | null;
  /** The quiet controls under the action (the privacy note, the sign-out link): the page owns them. */
  footer?: ReactNode;
}

export function OpenSessionView({ lang, closingReached, busy, errorKey, onEnd, onCancel, dayLine = null, footer }: OpenSessionViewProps) {
  return (
    <StageScreen
      tone={closingReached ? "listening" : "idle"}
      title={t(lang, closingReached ? "C-sess-open-reached-h" : "C-sess-open-interrupted-h")}
      sub={<p className="b6-sub">{t(lang, closingReached ? "C-sess-open-reached-b" : "C-sess-open-interrupted-b")}</p>}
      mono={dayLine}
    >
      {errorKey ? (
        <p role="alert" className="b6-alert b6-alert--red">
          {t(lang, errorKey)}
        </p>
      ) : null}
      <Button variant="primary" size="lg" block onClick={closingReached ? onEnd : onCancel} disabled={busy}>
        {t(lang, closingReached ? "C-sess-end-today" : "C-sess-open-cancel")}
      </Button>
      {closingReached ? <p className="b6-note">{t(lang, "C-sess-open-note")}</p> : null}
      {footer}
    </StageScreen>
  );
}
