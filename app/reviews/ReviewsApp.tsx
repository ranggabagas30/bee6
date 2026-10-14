"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson, authedPostJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import {
  FastForwardResponseSchema,
  ListReviewsResponseSchema,
  type ListReviewsResponse,
} from "@/lib/reviews/contract";
import { WebTopBar } from "@/app/web/WebTopBar";
import { ReviewCard } from "@/app/reviews/ReviewCard";
import { VerdictPanel } from "@/app/reviews/VerdictPanel";

/**
 * /reviews (R-11 Task 6.3). Owner and supervisor see the same list: reviews
 * waiting for a verdict (with the verdict panel for whoever is up) and the
 * recently decided ones. The role read here is UI-only; the server
 * (`reviews:read` + `reviews:verdict` + outlet) is the boundary and still
 * answers 403 for anyone else.
 *
 * The fast-forward button (demo only) shows only when the list says it is
 * available; the server decides that from `DEMO_MODE` and the outlet kind,
 * this screen never guesses it.
 *
 * Reloads whenever `listKey` changes (a verdict or a fast-forward). The
 * previous list stays on screen while the new one loads, so a card being read
 * never flashes away, and a stale response never overwrites a newer one.
 */

type Role = "owner" | "supervisor" | "other";

type View =
  | { kind: "loading" }
  | { kind: "ok"; data: ListReviewsResponse }
  | { kind: "forbidden" }
  | { kind: "error" };

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const LINE_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const SECTION_STYLE: CSSProperties = { marginTop: 24, overflowWrap: "anywhere" };
const BANNER_STYLE: CSSProperties = { margin: "16px 0 8px 0", overflowWrap: "anywhere" };
const BANNER_EMPTY_STYLE: CSSProperties = { margin: 0 };
const BUTTON_STYLE: CSSProperties = { minHeight: 48, width: "100%", fontSize: 16, padding: "0 16px", boxSizing: "border-box" };
const SIMULATED_LABEL_STYLE: CSSProperties = { margin: "8px 0 0 0", fontWeight: 700, overflowWrap: "anywhere" };

export function ReviewsApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [role, setRole] = useState<Role | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [listKey, setListKey] = useState(0);
  const [banner, setBanner] = useState<DictKey | null>(null);
  const [ffBusy, setFfBusy] = useState(false);
  const ffInFlight = useRef(false);
  const bannerRef = useRef<HTMLParagraphElement>(null);

  const uid = authUser.status === "signed_in" ? authUser.user.uid : null;

  useEffect(() => {
    if (authUser.status === "signed_out") router.replace("/sign-in");
  }, [authUser.status, router]);

  // Role from the fresh ID token's claims: UI-only, never the security
  // boundary. A claim that cannot be read fails closed ("other").
  useEffect(() => {
    if (authUser.status !== "signed_in" || uid === null) return;
    let active = true;
    const user = authUser.user;
    void user.getIdTokenResult().then(
      (result) => {
        if (!active) return;
        const claimed = result.claims.role;
        setRole(claimed === "owner" || claimed === "supervisor" ? claimed : "other");
      },
      () => {
        if (active) setRole("other");
      },
    );
    return () => {
      active = false;
    };
  }, [authUser, uid]);

  const allowed = role === "owner" || role === "supervisor";

  useEffect(() => {
    if (!auth || uid === null || !allowed) return;
    let active = true;
    void (async () => {
      const result = await authedGetJson(auth, "/api/v1/reviews", ListReviewsResponseSchema);
      if (!active) return;
      if (result.kind === "ok") {
        setView({ kind: "ok", data: result.data });
      } else if (result.kind === "forbidden") {
        setView({ kind: "forbidden" });
      } else if (result.kind === "signed_out") {
        await signOut(auth);
        router.replace("/sign-in");
      } else {
        setView({ kind: "error" });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per signed-in user and per listKey
  }, [uid, allowed, listKey]);

  /** A verdict got an answer: show it, reload the list, and keep keyboard focus on the answer (the tapped button is about to unmount). */
  function handleSettled(messageKey: DictKey) {
    setBanner(messageKey);
    setListKey((k) => k + 1);
    bannerRef.current?.focus();
  }

  /** "Try again" after a failed list load: back to loading, then the effect re-fetches (and drops any older response). */
  function retry() {
    if (view.kind !== "error") return; // double-tap guard: only the first tap leaves the error state
    setView({ kind: "loading" });
    setListKey((k) => k + 1);
  }

  async function fastForward() {
    if (!auth || ffInFlight.current) return; // double-tap guard
    ffInFlight.current = true;
    setFfBusy(true);
    setBanner(null);
    const result = await authedPostJson(auth, "/api/v1/reviews/fast-forward", {}, FastForwardResponseSchema);
    ffInFlight.current = false;
    setFfBusy(false);

    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    if (result.kind === "ok") {
      handleSettled("C-rev-ff-done");
      return;
    }
    if (result.kind === "conflict" && result.code === "NOTHING_TO_REVIEW") {
      handleSettled("C-rev-ff-none"); // the list reload also drops the button
      return;
    }
    setBanner("C-srv-generic");
    bannerRef.current?.focus();
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

  if (authUser.status === "loading" || authUser.status === "signed_out" || role === null) {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="reviews" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === "other" || view.kind === "forbidden") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="reviews" />
        <h1>{t(lang, "C-rev-title")}</h1>
        <p role="status" aria-live="polite">
          {t(lang, "C-rev-err-forbidden")}
        </p>
      </main>
    );
  }

  // One tree for loading, error and ok: the banner stays the same DOM node, so
  // its focus and live region survive a failed reload, and the body swaps.
  const open = view.kind === "ok" ? view.data.open : [];
  const decided = view.kind === "ok" ? view.data.decided : [];
  const fastForwardAvailable = view.kind === "ok" && view.data.fast_forward_available;

  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={auth} showSignOut current="reviews" />
      <h1>{t(lang, "C-rev-title")}</h1>

      <p
        ref={bannerRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        style={banner ? BANNER_STYLE : BANNER_EMPTY_STYLE}
      >
        {banner ? t(lang, banner) : ""}
      </p>

      {view.kind === "loading" && (
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      )}

      {view.kind === "error" && (
        <div>
          <p role="status" aria-live="polite" style={LINE_STYLE}>
            {t(lang, "C-srv-generic")}
          </p>
          <button type="button" onClick={retry} style={BUTTON_STYLE}>
            {t(lang, "C-rev-retry")}
          </button>
        </div>
      )}

      {fastForwardAvailable && (
        <div>
          <button type="button" disabled={ffBusy} onClick={() => void fastForward()} style={BUTTON_STYLE}>
            {t(lang, "C-rev-ff")}
          </button>
          <p style={SIMULATED_LABEL_STYLE}>{t(lang, "C-rev-simulated")}</p>
        </div>
      )}

      {view.kind === "ok" && open.length === 0 && decided.length === 0 && <p style={{ ...LINE_STYLE, marginTop: 16 }}>{t(lang, "C-rev-empty")}</p>}

      {open.length > 0 && (
        <section style={SECTION_STYLE} aria-labelledby="rev-list-open">
          <h2 id="rev-list-open">{t(lang, "C-rev-open")}</h2>
          {open.map((review) => (
            <ReviewCard key={review.version} review={review} lang={lang}>
              <VerdictPanel auth={auth} role={role} review={review} lang={lang} onSettled={handleSettled} />
            </ReviewCard>
          ))}
        </section>
      )}

      {decided.length > 0 && (
        <section style={SECTION_STYLE} aria-labelledby="rev-list-decided">
          <h2 id="rev-list-decided">{t(lang, "C-rev-decided")}</h2>
          {decided.map((review) => (
            <ReviewCard key={review.version} review={review} lang={lang} />
          ))}
        </section>
      )}
    </main>
  );
}
