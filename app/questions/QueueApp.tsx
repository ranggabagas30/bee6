"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { ReviewQueueResponseSchema, type ReviewQueueResponse } from "@/lib/day/contract";
import { WebTopBar } from "@/app/web/WebTopBar";
import { QueueView } from "@/app/questions/QueueView";

/**
 * /questions (R-06 Task 13.6). Fetches `GET /api/v1/questions` through the
 * shared authed client — same auth-gate shape as `DayRecordApp`/`HomeApp` —
 * except `forbidden` shows a message with a link back to `/day` rather than
 * redirecting (an owner who types this URL directly is told why, not just
 * bounced; the server, not this screen, decided they may not see it).
 */

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const RETRY_STYLE: CSSProperties = { minHeight: 48, padding: "0 16px", fontSize: 16, cursor: "pointer" };
const LINK_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 48 };

type ViewState =
  | { kind: "loading" }
  | { kind: "ok"; data: ReviewQueueResponse }
  | { kind: "forbidden" }
  | { kind: "error" };

export function QueueApp({ config }: { config: FirebaseWebConfig | null }) {
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
      const result = await authedGetJson(auth, "/api/v1/questions", ReviewQueueResponseSchema);
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
        setState({ kind: "forbidden" });
        return;
      }
      setState({ kind: "error" });
    })();

    return () => {
      active = false;
    };
  }, [auth, uid, reloadTick, router]);

  function reload() {
    setReloadTick((n) => n + 1);
  }

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

  if (state.kind === "loading") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-forbidden")}
        </p>
        <Link href="/day" style={LINK_STYLE}>
          {t(lang, "C-queue-to-day")}
        </Link>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-err")}
        </p>
        <button type="button" style={RETRY_STYLE} onClick={reload}>
          {t(lang, "C-day-retry")}
        </button>
      </main>
    );
  }

  const { data } = state;
  return (
    <main>
      <div style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
      </div>
      <QueueView data={data} auth={auth} onReload={reload} />
    </main>
  );
}
