"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { addDays } from "@/lib/capture/calendar";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { DayRecordResponseSchema, type DayRecordResponse } from "@/lib/day/contract";
import { WebTopBar } from "@/app/web/WebTopBar";
import { DayRecordView } from "@/app/day/DayRecordView";

/**
 * /day and /day/{date} (R-06 Task 7.3). Fetches `GET /api/v1/day/{date}`
 * through the shared authed client and renders the owner/supervisor shape
 * `getDayRecord` returns — this component never decides the view itself.
 *
 * The fetch effect is keyed on the signed-in user's uid, `dateParam` and a
 * `reloadTick` counter (not on the `AuthedResult` type, which is not stable
 * across renders) so a stale response from a superseded request is ignored
 * (the `active` flag), and so `reload()` re-fetches without ever clearing
 * the currently-shown data first (no loading flash on a decision refetch).
 */

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const RETRY_STYLE: CSSProperties = { minHeight: 48, padding: "0 16px", fontSize: 16, cursor: "pointer" };

type ViewState =
  | { kind: "loading" }
  | { kind: "ok"; data: DayRecordResponse }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "error" };

export function DayRecordApp({
  config,
  dateParam,
}: {
  config: FirebaseWebConfig | null;
  dateParam: string;
}) {
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
      const result = await authedGetJson(
        auth,
        `/api/v1/day/${encodeURIComponent(dateParam)}`,
        DayRecordResponseSchema,
      );
      if (!active) return;

      if (result.kind === "ok") {
        setState({ kind: "ok", data: result.data });
        if (dateParam === "today") {
          window.history.replaceState(null, "", `/day/${result.data.day.date}`);
        }
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
      if (result.kind === "invalid") {
        setState({ kind: "invalid" });
        return;
      }
      setState({ kind: "error" });
    })();

    return () => {
      active = false;
    };
  }, [auth, uid, dateParam, reloadTick, router]);

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

  function goTo(nextDate: string) {
    router.push(`/day/${nextDate}`);
  }

  if (state.kind === "loading") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="day" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="day" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-forbidden")}
        </p>
      </main>
    );
  }

  if (state.kind === "invalid") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="day" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-invalid")}
        </p>
        <Link href="/day">{t(lang, "C-day-to-today")}</Link>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="day" />
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
        <WebTopBar auth={auth} showSignOut current="day" />
      </div>
      <DayRecordView
        data={data}
        auth={auth}
        onPrev={() => goTo(addDays(data.day.date, -1))}
        onNext={() => goTo(addDays(data.day.date, 1))}
        onReload={reload}
      />
    </main>
  );
}
