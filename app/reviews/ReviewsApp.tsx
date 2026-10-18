"use client";

import { useEffect, useRef, useState } from "react";
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
import { WebShell } from "@/app/web/WebShell";
import { PageHead } from "@/app/web/PageHead";
import { ReviewCard } from "@/app/reviews/ReviewCard";
import { VerdictPanel } from "@/app/reviews/VerdictPanel";
import { EmptyState } from "@/app/web/EmptyState";
import { Button } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import styles from "@/app/reviews/reviews.module.css";

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

/** The ReviewAgent's expected wait in whole seconds (`readReviewAgentEstimate`, set by the page only while the flag is on). */
export type ReviewAgentEstimate = { min_s: number; max_s: number };

export function ReviewsApp({
  config,
  reviewAgentEstimate = null,
}: {
  config: FirebaseWebConfig | null;
  /**
   * ReviewAgent plan 5.12: present only while `REVIEW_AGENT` is on for this deployment. While the fast-forward runs
   * the button then reads "Bee6 is reviewing…" and one polite line gives the range, and says "taking longer than
   * usual" once after `max_s`. Absent or `null`: today's button, no extra line. The flag is the server's: this
   * screen never guesses it, and the estimate carries no verdict.
   */
  reviewAgentEstimate?: ReviewAgentEstimate | null;
}) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [role, setRole] = useState<Role | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [listKey, setListKey] = useState(0);
  const [banner, setBanner] = useState<DictKey | null>(null);
  const [ffBusy, setFfBusy] = useState(false);
  // Which fast-forward run has gone past `max_s`: "longer" is derived (run === overRun), so a new run never shows a stale line.
  const [ffRun, setFfRun] = useState(0);
  const [ffOverRun, setFfOverRun] = useState<number | null>(null);
  // The review this run's tap created (flag on only). The notice is derived from it plus the reloaded list, so a
  // stale list never shows it early; a new run, or a page reload, starts from null.
  const [ffCreated, setFfCreated] = useState<number | null>(null);
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

  const estimateMaxS = reviewAgentEstimate ? reviewAgentEstimate.max_s : null;
  useEffect(() => {
    if (!ffBusy || estimateMaxS === null) return;
    const run = ffRun;
    const timer = setTimeout(() => setFfOverRun(run), estimateMaxS * 1000);
    return () => clearTimeout(timer);
  }, [ffBusy, ffRun, estimateMaxS]);

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
    setFfRun((n) => n + 1);
    setFfBusy(true);
    setBanner(null);
    setFfCreated(null);
    const knownBefore = view.kind === "ok" ? new Set([...view.data.open, ...view.data.decided].map((r) => r.version)) : null;
    const result = await authedPostJson(auth, "/api/v1/reviews/fast-forward", {}, FastForwardResponseSchema);
    ffInFlight.current = false;
    setFfBusy(false);

    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    if (result.kind === "ok") {
      // Only a review that is new because of this tap can be "without an explanation because of this tap".
      if (reviewAgentEstimate && knownBefore && !knownBefore.has(result.data.version)) setFfCreated(result.data.version);
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
      <WebShell auth={null}>
        <p role="status" aria-live="polite" className="b6-alert b6-alert--red">
          {t(lang, "C-signin-config")}
        </p>
      </WebShell>
    );
  }

  if (authUser.status === "loading" || authUser.status === "signed_out" || role === null) {
    return (
      <WebShell auth={auth} current="reviews">
        <p role="status" aria-live="polite" className="b6-sub">
          {t(lang, "C-day-loading")}
        </p>
      </WebShell>
    );
  }

  if (role === "other" || view.kind === "forbidden") {
    return (
      <WebShell auth={auth} current="reviews">
        <PageHead title={t(lang, "C-rev-title")} />
        <p role="status" aria-live="polite" className="b6-alert b6-alert--amber">
          {t(lang, "C-rev-err-forbidden")}
        </p>
      </WebShell>
    );
  }

  // One tree for loading, error and ok: the banner stays the same DOM node, so
  // its focus and live region survive a failed reload, and the body swaps.
  const open = view.kind === "ok" ? view.data.open : [];
  const decided = view.kind === "ok" ? view.data.decided : [];
  const missingFor = (review: { version: number; agent?: unknown }) =>
    reviewAgentEstimate !== null && ffCreated === review.version && !review.agent;
  const fastForwardAvailable = view.kind === "ok" && view.data.fast_forward_available;

  return (
    <WebShell auth={auth} current="reviews">
      <PageHead title={t(lang, "C-rev-title")} sub={t(lang, "C-web-reviews-sub")} />

      <div className={styles.page}>
        <p
          ref={bannerRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className={banner ? styles.banner : styles.bannerEmpty}
        >
          {banner ? t(lang, banner) : ""}
        </p>

        {view.kind === "loading" && (
          <p role="status" aria-live="polite" className="b6-sub">
            {t(lang, "C-day-loading")}
          </p>
        )}

        {view.kind === "error" && (
          <div className={styles.stateBox}>
            <p role="status" aria-live="polite" className="b6-alert b6-alert--red">
              {t(lang, "C-srv-generic")}
            </p>
            <Button variant="secondary" onClick={retry}>
              {t(lang, "C-rev-retry")}
            </Button>
          </div>
        )}

        {fastForwardAvailable && (
          <div className={styles.ff}>
            <p className="b6-kick">{t(lang, "C-rev-simulated")}</p>
            <Button variant="secondary" disabled={ffBusy} onClick={() => void fastForward()}>
              {t(lang, ffBusy && reviewAgentEstimate ? "C-rev-ff-busy" : "C-rev-ff")}
            </Button>
            {/* Mounted before the tap so its text change is announced once; empty (zero height) until a run is on. */}
            {reviewAgentEstimate && (
              <p role="status" aria-live="polite" className={styles.ffWait}>
                {ffBusy
                  ? ffOverRun === ffRun
                    ? t(lang, "C-rev-ff-longer", { max: reviewAgentEstimate.max_s })
                    : t(lang, "C-rev-ff-estimate", { min: reviewAgentEstimate.min_s, max: reviewAgentEstimate.max_s })
                  : ""}
              </p>
            )}
          </div>
        )}

        {view.kind === "ok" && open.length === 0 && decided.length === 0 && (
          <EmptyState title={t(lang, "C-web-empty-rev-h")} detail={t(lang, "C-web-empty-rev-p")} />
        )}

        {open.length > 0 && (
          <section className={styles.section} aria-labelledby="rev-list-open">
            <h2 id="rev-list-open" className={cx("b6-kick", styles.sectionHead)}>
              {t(lang, "C-rev-open")}
            </h2>
            {open.map((review) => (
              <ReviewCard key={review.version} review={review} lang={lang} agentMissing={missingFor(review)}>
                <VerdictPanel auth={auth} role={role} review={review} lang={lang} onSettled={handleSettled} />
              </ReviewCard>
            ))}
          </section>
        )}

        {decided.length > 0 && (
          <section className={styles.section} aria-labelledby="rev-list-decided">
            <h2 id="rev-list-decided" className={cx("b6-kick", styles.sectionHead)}>
              {t(lang, "C-rev-decided")}
            </h2>
            {decided.map((review) => (
              <ReviewCard key={review.version} review={review} lang={lang} agentMissing={missingFor(review)} />
            ))}
          </section>
        )}
      </div>
    </WebShell>
  );
}
