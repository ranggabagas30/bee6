"use client";

import { useState, type CSSProperties } from "react";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { PairForm, type PairedInfo } from "@/app/pair/PairForm";
import { PairedChecklist } from "@/app/pair/PairedChecklist";

/**
 * /pair — the shop phone's pairing entry (web spec §3, §4.1). Minimal by design:
 * type the 6-digit code from the seed script (the form), then the checklist. The form and the checklist are shared
 * with the Staff panel of the role sign-in (R-18 P1). The by-role capture/staff screens arrive in R-03/R-07.
 */

const PAGE_STYLE: CSSProperties = { maxWidth: 360, margin: "0 auto", padding: 24 };

export default function PairPage() {
  const { lang } = useLang();
  const [paired, setPaired] = useState<PairedInfo | null>(null);

  if (paired) {
    return (
      <main style={PAGE_STYLE}>
        <ShopTopBar />
        <PairedChecklist outletId={paired.outletId} auth={paired.auth} />
      </main>
    );
  }

  return (
    <main style={PAGE_STYLE}>
      <ShopTopBar />
      <h1>{t(lang, "C-pair-title")}</h1>
      <p>{t(lang, "C-pair-help")}</p>
      <PairForm onPaired={setPaired} />
    </main>
  );
}
