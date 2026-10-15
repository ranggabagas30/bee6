"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { HomeResponseSchema, type HomeResponse } from "@/lib/home/contract";
import { Button, Mist } from "@/app/ui";
import { WebTopBar } from "@/app/web/WebTopBar";
import { ResetDemoButton, ResetNotice } from "@/app/demo/ResetDemoButton";
import { HomeView } from "@/app/home/HomeView";
import styles from "@/app/home/home.module.css";

/**
 * /home (R-06 Task 14a; R-19 PR-8 plan 9.2 = page-1 W4). Fetches `GET /api/v1/home` through the shared authed
 * client, same auth-gate shape as `DayRecordApp` — except `forbidden` sends a non-owner straight to `/day` (a
 * supervisor's start page), since this screen is owner-only and the server, not the client, decides that.
 *
 * One tree for every state (the top bar and nav never remount): the mist ground, the top bar, PR-7's `ResetNotice`
 * ("Demo reset to day 1" after `/home?demo_reset=1`), the state's body, and — in the settled states only — the reset
 * area with PR-7's `ResetDemoButton` (it renders nothing unless the signed-in user is a demo owner, so the pilot never
 * sees it). While loading the reset area is not in the tree: a destructive control must not flash under "Loading…" at
 * the top of the first viewport and then jump to the page bottom when the cards land (QA on PR-8: a layout shift of
 * 0.06 at 360 px). Appearing fresh below the settled cards contributes no layout shift. A retry from the error state
 * goes back through loading for the same reason (`reload()`), so error -> "Try again" -> ok is shift-free too.
 * Both PR-7 pieces read the Firebase app this component already initialised, so they are mounted after it.
 */

type ViewState =
  | { kind: "loading" }
  | { kind: "ok"; data: HomeResponse }
  | { kind: "error" };

export function HomeApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);

  const uid = authUser.status === "signed_in" ? authUser.user.uid : null;

  // A signed-out user (no prior session, or one that never had claims) is
  // sent to /sign-in — this screen never shows a sign-in form itself.
  useEffect(() => {
    if (authUser.status === "signed_out") router.replace("/sign-in");
  }, [authUser.status, router]);

  useEffect(() => {
    if (!auth || uid === null) return;
    let active = true;

    void (async () => {
      const result = await authedGetJson(auth, "/api/v1/home", HomeResponseSchema);
      if (!active) return;

      if (result.kind === "ok") {
        setState({ kind: "ok", data: result.data });
        return;
      }
      if (result.kind === "signed_out") {
        await signOut(auth);
        router.replace("/sign-in");
        return;
      }
      if (result.kind === "forbidden") {
        // A supervisor's start page is the day record, not an error here.
        router.replace("/day");
        return;
      }
      setState({ kind: "error" });
    })();

    return () => {
      active = false;
    };
  }, [auth, uid, reloadTick, router]);

  function reload() {
    // Back through the loading state (not only a refetch): "Try again" shows "Loading…" and the reset area leaves
    // the tree until the data settles, so a retry contributes no layout shift either (QA on PR-8, second pass).
    setState({ kind: "loading" });
    setReloadTick((n) => n + 1);
  }

  const settled = state.kind !== "loading";

  let body: ReactNode;
  if (!config || !auth) {
    body = (
      <p role="status" aria-live="polite" className={styles.status}>
        {t(lang, "C-signin-config")}
      </p>
    );
  } else if (state.kind === "loading") {
    body = (
      <p role="status" aria-live="polite" className={styles.status}>
        {t(lang, "C-day-loading")}
      </p>
    );
  } else if (state.kind === "error") {
    body = (
      <>
        <p role="status" aria-live="polite" className={styles.status}>
          {t(lang, "C-day-err")}
        </p>
        <Button variant="secondary" className={styles.retry} onClick={reload}>
          {t(lang, "C-day-retry")}
        </Button>
      </>
    );
  } else {
    body = <HomeView data={state.data} />;
  }

  return (
    <div className={styles.page}>
      <Mist />
      <main className={styles.main}>
        <WebTopBar auth={auth} showSignOut={auth !== null} current="home" />
        {auth ? <ResetNotice lang={lang} /> : null}
        {body}
        {auth && settled ? (
          <div className={styles.reset} data-testid="reset-area">
            <ResetDemoButton lang={lang} />
          </div>
        ) : null}
      </main>
    </div>
  );
}
