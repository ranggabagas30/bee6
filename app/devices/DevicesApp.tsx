"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { Card } from "@/app/ui";
import { WebShell } from "@/app/web/WebShell";
import { PageHead } from "@/app/web/PageHead";
import styles from "@/app/web/shell.module.css";

/**
 * /devices placeholder (R-19 PR-6 §8.2; R-25 R11 / D2-05 OUT): a tidy "coming soon" page in the page-2 look. The code
 * generation of board D2-05 is not built, so there is no device row, no device id and no pairing code on this supervisor
 * screen (CLAUDE.md hard rule 7). Same auth gate as the other web screens: a signed-out visitor goes to /sign-in;
 * nothing is fetched here.
 */

export function DevicesApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);

  useEffect(() => {
    if (authUser.status === "signed_out") router.replace("/sign-in");
  }, [authUser.status, router]);

  if (!config || !auth) {
    return (
      <WebShell auth={null}>
        <p role="status" aria-live="polite">
          {t(lang, "C-signin-config")}
        </p>
      </WebShell>
    );
  }

  return (
    <WebShell auth={auth} current="devices">
      <PageHead title={t(lang, "C-web-nav-devices")} sub={t(lang, "C-web-devices-sub")} />
      <Card className={styles.softCard}>
        <span className="b6-kick">{t(lang, "C-web-devices-soon-kick")}</span>
        <p className={styles.cardLine}>{t(lang, "C-web-devices-soon-p")}</p>
      </Card>
    </WebShell>
  );
}
