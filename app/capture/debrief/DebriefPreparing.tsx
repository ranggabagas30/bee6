"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";

/**
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3), sandbox judge devices only: the two "server is still
 * labelling" screens. Neither has a Back button or a manual check: the container polls the list every
 * REFRESH_POLL_MS_DEMO and moves on by itself. A pilot phone never renders either (the reducer only reaches
 * these views with `demo: true`).
 */

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

const HEADING_STYLE: React.CSSProperties = { fontSize: 18, margin: 0, outline: "none" };

/** P2-08: no question yet; W7 tells the judge to keep the page open and the screen on. */
export function DebriefPreparing() {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section aria-busy="true">
      <h2 ref={headingRef} tabIndex={-1} style={HEADING_STYLE}>
        {t(lang, "C-d2-prep-h")}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d2-prep-1")}</p>
      <p style={{ margin: "12px 0 0", fontWeight: 600 }}>{t(lang, "C-d2-prep-2")}</p>
      <p style={{ margin: "12px 0 0", fontSize: 14, color: "#555" }}>{t(lang, "C-d2-prep-3")}</p>
    </section>
  );
}

/** Every offered question is answered or skipped, but the server may still add more. */
export function DebriefWaitingMore() {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section aria-busy="true">
      <h2 ref={headingRef} tabIndex={-1} style={HEADING_STYLE}>
        {t(lang, "C-d2-wait-h")}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d2-wait-1")}</p>
    </section>
  );
}
