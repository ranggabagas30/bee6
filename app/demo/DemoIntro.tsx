"use client";

import type { CSSProperties } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";

/**
 * The text of "/" on a demo deployment (R-12 Task 8.3, reworked in R-18 P1): one paragraph on the product, the suggested
 * judge path and the fictional-data line. The three Try-as buttons are gone; the sign-in below it (the same role
 * sign-in as `/sign-in`, with the demo access box) is the way in. Server-rendered with the page, no controls of its own.
 */

const PARAGRAPH_STYLE: CSSProperties = { margin: "0 0 16px 0", overflowWrap: "anywhere", lineHeight: 1.5 };

export function DemoIntro() {
  const { lang } = useLang();
  return (
    <>
      <h1>{t(lang, "C-demo-title")}</h1>
      <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-intro")}</p>
      <p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-path")}</p>
      <p style={{ ...PARAGRAPH_STYLE, fontWeight: 700 }}>{t(lang, "C-demo-fictional")}</p>
    </>
  );
}
