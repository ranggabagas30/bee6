"use client";

import { useEffect, useId, useRef } from "react";
import { CaptureDialogSheet } from "@/app/capture/CaptureDialogSheet";
import css from "@/app/capture/capture.module.css";
import { Button } from "@/app/ui";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * R-25 ruling R2 (board P2-06 to P2-08): the End confirm on a sandbox, as the page-2 bottom sheet. The confirm step
 * stays (technical spec section 8: the close instant is "Yes, end" tapped here). Presentation only: the page owns what
 * "Not yet" and "Yes, end" do, exactly as the inline panel did.
 *
 * Modal for real: focus moves to the safe choice ("Not yet, keep going"), Tab cycles inside the sheet, Escape is
 * "Not yet", and focus goes back to whatever opened it (End today) when the sheet goes away.
 */
export interface EndConfirmSheetProps {
  lang: Lang;
  /** The sandbox body (`C-script-end-b`): there is no restart date on a sandbox. */
  body: string;
  /** The End request is in flight (or the auto-stop is ending the session): "Yes, end" is disabled. */
  busy: boolean;
  /** The page's own copy key for a failed End; never server text. */
  errorKey: DictKey | null;
  onKeep: () => void;
  onEnd: () => void;
}

export function EndConfirmSheet({ lang, body, busy, errorKey, onKeep, onEnd }: EndConfirmSheetProps) {
  const titleId = useId();
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(onKeep);
  useEffect(() => {
    latest.current = onKeep;
  });

  useEffect(() => {
    const opener = document.activeElement;
    keepRef.current?.focus();
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && root.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <CaptureDialogSheet labelledBy={titleId} describedBy={bodyId}>
      <div ref={rootRef} tabIndex={-1} className={css.dfocus}>
        <h2 id={titleId} className={css.dtitle}>
          {t(lang, "C-c-selesai-h")}
        </h2>
        <p id={bodyId} className={css.dbody}>
          {body}
        </p>
        <Button ref={keepRef} variant="secondary" block className={css.dsecond} onClick={onKeep}>
          {t(lang, "C-b-belum-lanjut")}
        </Button>
        <Button variant="primary" size="lg" block onClick={onEnd} disabled={busy}>
          {t(lang, "C-b-ya-selesai")}
        </Button>
        {errorKey ? (
          <p role="alert" className={css.alert}>
            {t(lang, errorKey)}
          </p>
        ) : null}
      </div>
    </CaptureDialogSheet>
  );
}
