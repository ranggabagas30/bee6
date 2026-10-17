"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, type Auth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { publishProposalsProgress, publishProposalsScreen } from "@/lib/demo/proposals-signal";
import { ProposalIdSchema } from "@/lib/proposals/review-contract";
import type { AskEstimate } from "@/lib/proposals/v4/flag";
import { WebShell } from "@/app/web/WebShell";
import { PageHead } from "@/app/web/PageHead";
import { ApprovalsReview, type ApprovalsBridgeEvent } from "@/app/proposals/ApprovalsReview";
import { SupervisorProposals, type ProposalsBridgeEvent } from "@/app/proposals/SupervisorProposals";

/**
 * /proposals (R-08 Task 7.3; R-19 PR-12a/PR-12b split the roles). One route, two screens by the ID token's role
 * claim: the supervisor gets `SupervisorProposals` (watch panel, ask, detail, feasible / reject; plan 9.5), the
 * owner gets `ApprovalsReview` (page-1 W8 "Review in order": one proposal at a time, approve / inline reject; the nav
 * calls it Approvals and so does the page). The server is still the only authority: the role read here is UI-only,
 * never the security boundary. A forged/stale role still gets a server 403, which maps to the same `forbidden`
 * outcome as the client-side gate.
 *
 * Judge guide (after-merge wiring): on a demo sandbox principal only (the token carries `demo_exp_ms`), each screen's
 * `onBridge` is forwarded to lib/demo/proposals-signal (a screen kind and a progress counter, nothing else), so the
 * guide's card follows the screen and its progress is re-read right after an ask, a feasible mark, a rejection or an
 * approval. A pilot principal has no such claim: nothing is published there, and the signal is cleared on unmount.
 */

type Role = "owner" | "supervisor" | "other";

/** The page's bridge events, mapped onto the signal; the same function for both screens (their shapes coincide). */
function publishBridgeEvent(event: ProposalsBridgeEvent | ApprovalsBridgeEvent): void {
  if (event.type === "screen") publishProposalsScreen(event.screen);
  else publishProposalsProgress();
}

/**
 * The owner's screen with `?id=<proposal_id>` honoured (PR-8's Home links each waiting row to `/proposals?id=…`).
 * `useSearchParams` makes the subtree client-rendered up to the nearest Suspense boundary on a prerendered route, so
 * it lives in this small child under its own `<Suspense>` (Next docs, "useSearchParams → Prerendering"). The id is
 * validated as a UUID; anything else is ignored and the screen opens on the recommended order.
 */
function OwnerApprovals({ auth, lang, onBridge }: { auth: Auth; lang: Lang; onBridge?: (event: ApprovalsBridgeEvent) => void }) {
  const params = useSearchParams();
  const parsed = ProposalIdSchema.safeParse(params.get("id"));
  return <ApprovalsReview auth={auth} lang={lang} initialId={parsed.success ? parsed.data : null} onBridge={onBridge} />;
}

export function ProposalsApp({
  config,
  askEstimate = null,
}: {
  config: FirebaseWebConfig | null;
  /** R-24 D11: the Ask's estimated wait (v4 flag on), or `null`. Only the supervisor screen uses it. */
  askEstimate?: AskEstimate | null;
}) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [claim, setClaim] = useState<{ role: Role; demo: boolean } | null>(null);
  const role = claim?.role ?? null;
  // The judge guide's signal is fed only on a demo sandbox principal (`demo_exp_ms`); the pilot publishes nothing.
  const onBridge = claim?.demo ? publishBridgeEvent : undefined;

  const uid = authUser.status === "signed_in" ? authUser.user.uid : null;

  useEffect(() => {
    if (authUser.status === "signed_out") router.replace("/sign-in");
  }, [authUser.status, router]);

  // Reads the role from the fresh ID token's own claims (R-06 PR-1 pattern,
  // `app/sign-in/SignInScreen.tsx`'s `redirectTarget`) — UI-only, never the
  // security boundary. A claim that cannot be read fails closed (`"other"`),
  // never leaves the form rendered for an unverified role.
  useEffect(() => {
    if (authUser.status !== "signed_in" || uid === null) return;
    let active = true;
    const user = authUser.user;
    void user.getIdTokenResult().then(
      (result) => {
        if (!active) return;
        const claimed = result.claims.role;
        setClaim({ role: claimed === "owner" || claimed === "supervisor" ? claimed : "other", demo: typeof result.claims.demo_exp_ms === "number" });
      },
      () => {
        if (active) setClaim({ role: "other", demo: false });
      },
    );
    return () => {
      active = false;
    };
  }, [authUser, uid]);

  // Leaving the page (a route change, a sign-out) leaves no stale screen behind for the guide.
  useEffect(() => () => publishProposalsScreen(null), []);

  if (!config || !auth) {
    return (
      <WebShell auth={null}>
        <p role="status" aria-live="polite" className="b6-sub">
          {t(lang, "C-signin-config")}
        </p>
      </WebShell>
    );
  }

  if (authUser.status === "loading" || authUser.status === "signed_out" || role === null) {
    return (
      <WebShell auth={auth} current="proposals">
        <p role="status" aria-live="polite" className="b6-sub">
          {t(lang, "C-day-loading")}
        </p>
      </WebShell>
    );
  }

  if (role === "other") {
    return (
      <WebShell auth={auth} current="proposals">
        <PageHead title={t(lang, "C-prop-title")} />
        <p role="status" aria-live="polite" className="b6-sub">
          {t(lang, "C-prop-err-forbidden")}
        </p>
      </WebShell>
    );
  }

  if (role === "supervisor") {
    return (
      <WebShell auth={auth} current="proposals">
        <SupervisorProposals auth={auth} lang={lang} onBridge={onBridge} askEstimate={askEstimate} demo={claim?.demo === true} />
      </WebShell>
    );
  }

  // Owner: page-1 W8 "Review in order" (PR-12b), page-2 layout in R-25 T11: the screen fills the shell's `main`.
  return (
    <WebShell auth={auth} current="proposals">
      <Suspense fallback={null}>
        <OwnerApprovals auth={auth} lang={lang} onBridge={onBridge} />
      </Suspense>
    </WebShell>
  );
}
