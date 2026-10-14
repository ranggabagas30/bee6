"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { fetchCaptureConfig, type DeviceAuth } from "@/lib/capture/browser/client";
import { businessDateOf, mulaiWindowFor } from "@/lib/capture/calendar";
import type { CaptureConfigResponse } from "@/lib/capture/contract";
import { buttonClassName } from "@/app/ui";
import styles from "@/app/pair/pair.module.css";

/**
 * What a freshly paired phone shows (UX-03 section 5.1; "Device set up", R-19 PR-6 §8.1): the four-step list and the
 * link to the listening page. Shared by `/pair` and the Staff panel of the role sign-in.
 *
 * Pilot (`demo` off): heading "Phone set up", the outlet line and the pilot steps `C-pair-step-1..4` (step 3 needs the
 * outlet config: hidden until it loads, on a closed day, or if it never loads). Demo (`demo` on, after a sandbox
 * pairing): heading "Device set up" and the four demo steps; no outlet line (the sandbox never tells the phone an
 * outlet name) and no config fetch. The demo code is never shown here (W8).
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

export interface PairedChecklistProps {
  outletId?: string;
  auth?: DeviceAuth;
  headingLevel?: 1 | 2;
  demo?: boolean;
}

export function PairedChecklist({ outletId, auth, headingLevel = 1, demo = false }: PairedChecklistProps) {
  const { lang } = useLang();
  // untilHm: today's Mulai window end once the outlet config has loaded. A config failure must not turn a successful
  // pairing into an error: step 3 simply stays hidden.
  const [untilHm, setUntilHm] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (demo || !auth) return;
    let cancelled = false;
    fetchCaptureConfig(auth).then(
      (config) => {
        if (!cancelled) setUntilHm(untilHmFor(config, new Date()));
      },
      () => {
        // Step 3 stays hidden; the link still leads to /capture.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth, demo]);

  const Heading = headingLevel === 1 ? "h1" : "h2";
  const steps = demo
    ? [t(lang, "C-web-pair-demo-step-1"), t(lang, "C-web-pair-demo-step-2"), t(lang, "C-web-pair-demo-step-3"), t(lang, "C-web-pair-demo-step-4")]
    : [t(lang, "C-pair-step-1"), t(lang, "C-pair-step-2"), ...(untilHm ? [t(lang, "C-pair-step-3", { until: untilHm })] : []), t(lang, "C-pair-step-4")];

  return (
    <>
      <Heading className={styles.h1}>{t(lang, demo ? "C-web-pair-done-h" : "C-pair-ok-h")}</Heading>
      {!demo && outletId !== undefined && <p className={styles.outlet}>{t(lang, "C-pair-ok-line", { outlet_id: outletId })}</p>}
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step} className={styles.step}>
            {step}
          </li>
        ))}
      </ol>
      <Link href="/capture" className={buttonClassName({ variant: "primary", size: "lg", block: true })}>
        {t(lang, "C-b-buka-mendengarkan")}
      </Link>
    </>
  );
}
