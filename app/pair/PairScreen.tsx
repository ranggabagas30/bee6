"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { Card, Mist } from "@/app/ui";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { PairForm, type PairedInfo } from "@/app/pair/PairForm";
import { PairedChecklist } from "@/app/pair/PairedChecklist";
import type { DemoAccessProps } from "@/app/sign-in/panel-hooks";
import { DemoHooksConsumer } from "@/app/sign-in/demo-hooks";
import styles from "@/app/pair/pair.module.css";

/**
 * /pair (web spec §3, §4.1; "Set up this device" → "Device set up", R-19 PR-6 §8.1). Both deployments render the same
 * screen with the pilot copy. On a demo deployment (`demo`, read from DEMO_MODE by the server page) the form sits inside
 * the lazily loaded demo box, which turns the demo code into a private sandbox (R-18 P1) and, through `onStarted`,
 * hands this screen the Device set up step with the demo steps; its link goes straight to /capture (Q6: no
 * before-opening stage). The pilot never loads the demo code (next/dynamic, same pattern as `RoleSignIn`).
 */

const DemoAccess = dynamic<DemoAccessProps>(() => import("@/app/demo/DemoAccess").then((m) => m.DemoAccess));

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
      <main className={styles.column}>
        <ShopTopBar />
        <Card as="section" className={styles.card} aria-labelledby="pair-h1">
          {paired ? (
            paired.kind === "demo" ? (
              <PairedChecklist demo headingId="pair-h1" />
            ) : (
              <PairedChecklist outletId={paired.info.outletId} auth={paired.info.auth} headingId="pair-h1" />
            )
          ) : (
            <>
              <h1 id="pair-h1" className={styles.h1}>
                {t(lang, "C-pair-title")}
              </h1>
              <p className={styles.help}>{t(lang, "C-pair-help")}</p>
              {demo ? (
                <DemoAccess config={config} role="staff" onFill={() => {}} onStarted={() => setPaired({ kind: "demo" })} barShowsEnded>
                  {form}
                </DemoAccess>
              ) : (
                form
              )}
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
