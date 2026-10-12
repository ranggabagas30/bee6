"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { fetchCaptureConfig, type DeviceAuth } from "@/lib/capture/browser/client";
import { businessDateOf, mulaiWindowFor } from "@/lib/capture/calendar";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import { PAIR_BUTTON_STYLE } from "@/app/pair/PairForm";

/**
 * What a freshly paired phone shows (UX-03 section 5.1): the four-step checklist and the button to the listening page.
 * Shared by `/pair` and the Staff panel of the role sign-in.
 */

/**
 * Today's Mulai window end as HH:MM in the outlet zone (R-P1, decision (a)): the
 * window of the current business date (§4.10), from its weekly hours. undefined on
 * a closed day, so step 3 is hidden.
 */
function untilHmFor(config: CaptureConfigResponse, now: Date): string | undefined {
  const tz = config.timezone;
  const window = mulaiWindowFor(businessDateOf(now.getTime(), tz), config.weekly_hours, tz);
  if (!window) return undefined;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(window.end_ms));
}

const LIST_STYLE: CSSProperties = { paddingLeft: 20, lineHeight: 1.5 };

export function PairedChecklist({ outletId, auth, headingLevel = 1 }: { outletId: string; auth: DeviceAuth; headingLevel?: 1 | 2 }) {
  const { lang } = useLang();
  const router = useRouter();
  // untilHm: today's Mulai window end once the outlet config has loaded. Until then, on a closed day, and if the config
  // never loads, the checklist omits step 3. A config failure must not turn a successful pairing into an error.
  const [untilHm, setUntilHm] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchCaptureConfig(auth).then(
      (config) => {
        if (!cancelled) setUntilHm(untilHmFor(config, new Date()));
      },
      () => {
        // Step 3 stays hidden; the button still leads to /capture.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <>
      <Heading>{t(lang, "C-pair-ok-h")}</Heading>
      <p>{t(lang, "C-pair-ok-line", { outlet_id: outletId })}</p>
      <ol style={LIST_STYLE}>
        <li>{t(lang, "C-pair-step-1")}</li>
        <li>{t(lang, "C-pair-step-2")}</li>
        {untilHm ? <li>{t(lang, "C-pair-step-3", { until: untilHm })}</li> : null}
        <li>{t(lang, "C-pair-step-4")}</li>
      </ol>
      <button type="button" onClick={() => router.push("/capture")} style={{ ...PAIR_BUTTON_STYLE, marginTop: 16 }}>
        {t(lang, "C-b-buka-mendengarkan")}
      </button>
    </>
  );
}
