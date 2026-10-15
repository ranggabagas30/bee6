"use client";

import { Suspense, useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, type Auth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { ProposalIdSchema } from "@/lib/proposals/review-contract";
import { WebTopBar } from "@/app/web/WebTopBar";
import { ApprovalsReview } from "@/app/proposals/ApprovalsReview";
import { SupervisorProposals } from "@/app/proposals/SupervisorProposals";

/**
 * /proposals (R-08 Task 7.3; R-19 PR-12a/PR-12b split the roles). One route, two screens by the ID token's role
 * claim: the supervisor gets `SupervisorProposals` (watch panel, ask, detail, feasible / reject; plan 9.5), the
 * owner gets `ApprovalsReview` (page-1 W8 "Review in order": one proposal at a time, approve / inline reject; the nav
 * calls it Approvals and so does the page). The server is still the only authority: the role read here is UI-only,
 * never the security boundary. A forged/stale role still gets a server 403, which maps to the same `forbidden`
 * outcome as the client-side gate.
 */

type Role = "owner" | "supervisor" | "other";

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };

/**
 * The owner's screen with `?id=<proposal_id>` honoured (PR-8's Home links each waiting row to `/proposals?id=…`).
 * `useSearchParams` makes the subtree client-rendered up to the nearest Suspense boundary on a prerendered route, so
 * it lives in this small child under its own `<Suspense>` (Next docs, "useSearchParams → Prerendering"). The id is
 * validated as a UUID; anything else is ignored and the screen opens on the recommended order.
 */
function OwnerApprovals({ auth, lang }: { auth: Auth; lang: Lang }) {
  const params = useSearchParams();
  const parsed = ProposalIdSchema.safeParse(params.get("id"));
  return <ApprovalsReview auth={auth} lang={lang} initialId={parsed.success ? parsed.data : null} />;
}

export function ProposalsApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [role, setRole] = useState<Role | null>(null);

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

  if (authUser.status === "loading" || authUser.status === "signed_out") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="proposals" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === null) {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="proposals" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === "other") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="proposals" />
        <h1>{t(lang, "C-prop-title")}</h1>
        <p role="status" aria-live="polite">
          {t(lang, "C-prop-err-forbidden")}
        </p>
      </main>
    );
  }

  if (role === "supervisor") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="proposals" />
        <SupervisorProposals auth={auth} lang={lang} />
      </main>
    );
  }

  // Owner: page-1 W8 "Review in order" (PR-12b). `onBridge` stays unwired here, as the supervisor's does: the judge
  // guide (PR-5) subscribes to it when it mounts the screen.
  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={auth} showSignOut current="proposals" />
      <Suspense fallback={null}>
        <OwnerApprovals auth={auth} lang={lang} />
      </Suspense>
    </main>
  );
}
