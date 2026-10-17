"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { Mist } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { StaffTopBar } from "@/app/shop/StaffTopBar";
import { PairForm, type PairedInfo } from "@/app/pair/PairForm";
import { PairedChecklist } from "@/app/pair/PairedChecklist";
import type { DemoAccessProps } from "@/app/sign-in/panel-hooks";
import { DemoHooksConsumer } from "@/app/sign-in/demo-hooks";
import styles from "@/app/pair/pair.module.css";

/**
 * /pair (web spec §3, §4.1; "Set up this device" → "Device set up", R-19 PR-6 §8.1; page-2 boards P2-02 / P2-03, R-25
 * T4). Both deployments render the same screen. On a demo deployment (`demo`, read from DEMO_MODE by the server page) the
 * form sits inside the lazily loaded demo wrapper in its `bare` form (R5: no "Demo access" box on /pair), which turns the
 * demo code into a private sandbox (R-18 P1) and, through `onStarted`, hands this screen the Device set up step with the
 * demo steps; its link goes straight to /capture (Q6: no before-opening stage). The pilot never loads the demo code
 * (next/dynamic, same pattern as `RoleSignIn`).
 */

const DemoAccess = dynamic<DemoAccessProps & { bare?: boolean }>(() => import("@/app/demo/DemoAccess").then((m) => m.DemoAccess));

type Paired = { kind: "pilot"; info: PairedInfo } | { kind: "demo" };

export function PairScreen({ demo, config }: { demo: boolean; config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const [paired, setPaired] = useState<Paired | null>(null);
  const form = (
    <DemoHooksConsumer>
      {(hooks) => (
        <PairForm
          demoIntercept={hooks.interceptCode}
          onPaired={(info) => setPaired({ kind: "pilot", info })}
        />
      )}
    </DemoHooksConsumer>
  );

  return (
    <div className={styles.page}>
      <Mist />
      <StaffTopBar demo={demo} outletLine />
      <main className={styles.column}>
        <section aria-labelledby="pair-h1">
          {paired ? (
            paired.kind === "demo" ? (
              <PairedChecklist demo headingId="pair-h1" />
            ) : (
              <PairedChecklist outletId={paired.info.outletId} auth={paired.info.auth} headingId="pair-h1" />
            )
          ) : (
            <div className={styles.content}>
              <div className={styles.head}>
                <h1 id="pair-h1" className={cx("b6-h1-display", styles.h1)}>
                  {t(lang, "C-pair-title")}
                </h1>
                <p className={styles.help}>{t(lang, "C-pair-help")}</p>
              </div>
              {demo ? (
                <DemoAccess config={config} role="staff" onStarted={() => setPaired({ kind: "demo" })} suppressEnded bare>
                  {form}
                </DemoAccess>
              ) : (
                form
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
