"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { SopOverviewSchema, type SopOverview } from "@/lib/sop/contract";
import { WebTopBar } from "@/app/web/WebTopBar";
import { ROLE_KEY, SopChangeCard } from "@/app/sop/SopChangeCard";

/**
 * /sop (R-10 Task 5.3). Owner and supervisor see the SOP header, the plain
 * before/after list of approved changes (newest first) and the latest steps.
 * The role read here is UI-only; the server (`sop:diff` + outlet) is the
 * boundary and still answers 403 for anyone else.
 */

type Role = "owner" | "supervisor" | "other";

type Outcome =
  | { kind: "loading" }
  | { kind: "ok"; data: SopOverview }
  | { kind: "forbidden" }
  | { kind: "error" };

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const LINE_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const LIST_STYLE: CSSProperties = { margin: "0 0 8px 0", paddingLeft: 20, overflowWrap: "anywhere" };
const ITEM_STYLE: CSSProperties = { marginBottom: 12, overflowWrap: "anywhere" };

export function SopApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [role, setRole] = useState<Role | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });

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
      const result = await authedGetJson(auth, "/api/v1/sop", SopOverviewSchema);
      if (!active) return;
      if (result.kind === "ok") {
        setOutcome({ kind: "ok", data: result.data });
      } else if (result.kind === "forbidden") {
        setOutcome({ kind: "forbidden" });
      } else if (result.kind === "signed_out") {
        await signOut(auth);
        router.replace("/sign-in");
      } else {
        setOutcome({ kind: "error" });
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per signed-in user
  }, [uid, allowed]);

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
        <WebTopBar auth={auth} showSignOut current="sop" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === "other" || outcome.kind === "forbidden") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <h1>{t(lang, "C-sop-title")}</h1>
        <p role="status" aria-live="polite">
          {t(lang, "C-sop-err-forbidden")}
        </p>
      </main>
    );
  }

  if (outcome.kind === "loading" || outcome.kind === "error") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <h1>{t(lang, "C-sop-title")}</h1>
        <p role="status" aria-live="polite">
          {outcome.kind === "loading" ? t(lang, "C-day-loading") : t(lang, "C-srv-generic")}
        </p>
      </main>
    );
  }

  const { latest, in_force_version, changes } = outcome.data;
  if (latest === null) {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <h1>{t(lang, "C-sop-title")}</h1>
        <p>{t(lang, "C-sop-empty")}</p>
      </main>
    );
  }

  let header: string;
  if (latest.effective_from_date === null) {
    header = t(lang, "C-sop-version-seed", { version: latest.version });
  } else if (in_force_version === latest.version) {
    header = t(lang, "C-sop-version-in-force", {
      version: latest.version,
      date: dayLabel(latest.effective_from_date, lang),
    });
  } else {
    header = t(lang, "C-sop-version-pending", {
      version: latest.version,
      date: dayLabel(latest.effective_from_date, lang),
      current: in_force_version ?? latest.version - 1,
    });
  }

  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={auth} showSignOut current="sop" />
      <h1>{t(lang, "C-sop-title")}</h1>
      <p style={LINE_STYLE}>{header}</p>

      <section>
        <h2>{t(lang, "C-sop-changes")}</h2>
        {changes.length === 0 ? (
          <p style={LINE_STYLE}>{t(lang, "C-sop-changes-empty")}</p>
        ) : (
          changes.map((change) => <SopChangeCard key={change.version} change={change} lang={lang} />)
        )}
      </section>

      <section>
        <h2>{t(lang, "C-sop-steps", { version: latest.version })}</h2>
        <ol style={LIST_STYLE}>
          {latest.steps.map((step) => (
            <li key={step.step_id} style={ITEM_STYLE}>
              <strong>{step.title}</strong>
              <p style={LINE_STYLE}>{step.text}</p>
              <p style={LINE_STYLE}>{t(lang, "C-sop-step-role", { role: t(lang, ROLE_KEY[step.role]) })}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
