"use client";

import { useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { WebTopBar } from "@/app/web/WebTopBar";
import { EmptyState } from "@/app/web/EmptyState";

/**
 * /devices placeholder (R-19 PR-6 §8.2): the nav item exists from this PR; PR-10 (§9.3) replaces this screen with the
 * real one (generate + copy a pairing code; no device ids, no QR, no unpair). Same auth gate as the other web screens:
 * a signed-out visitor goes to /sign-in; nothing is fetched here.
 */

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };

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
      <main style={PAGE_STYLE}>
        <WebTopBar auth={null} showSignOut={false} />
        <p role="status" aria-live="polite">
          {t(lang, "C-signin-config")}
        </p>
      </main>
    );
  }

  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={auth} showSignOut current="devices" />
      <h1>{t(lang, "C-web-nav-devices")}</h1>
      <p>{t(lang, "C-web-devices-placeholder")}</p>
      <EmptyState title={t(lang, "C-web-empty-devices")} />
    </main>
  );
}
