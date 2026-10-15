"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedGetJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { dayLabel } from "@/lib/i18n/format";
import { SopOverviewSchema, type SopOverview } from "@/lib/sop/contract";
import { Pill, Segmented } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { WebTopBar } from "@/app/web/WebTopBar";
import { EmptyState } from "@/app/web/EmptyState";
import { SopChangeCard } from "@/app/sop/SopChangeCard";
import { SopBookSpread } from "@/app/sop/SopBookSpread";
import { SopTable } from "@/app/sop/SopTable";
import { buildVersions, shortDate, type SopVersionView } from "@/app/sop/versions";
import styles from "@/app/sop/sop.module.css";

/**
 * /sop (R-10 Task 5.3; SOP book in R-19 PR-9a + PR-9b §9.1). Owner and supervisor see the same read-only screen:
 * the version switch by date (dd/mm/yy, newest "· current"), the Book/Table toggle, the selected version's steps
 * (Book: a two-page spread by chapter; Table: one row per step) with the improved badge on the step that version
 * changed, the plain before/after list of approved changes (newest first) and the read-only footer.
 * No Add SOP, Download or Open in Sheets control (V7). The role read here is UI-only; the server (`sop:diff` +
 * outlet) is the boundary and still answers 403 for anyone else.
 */

type Role = "owner" | "supervisor" | "other";

type Outcome =
  | { kind: "loading" }
  | { kind: "ok"; data: SopOverview }
  | { kind: "forbidden" }
  | { kind: "error" };

/**
 * "dd/mm/yy" or "dd/mm/yy · current" (the seed is dated by first_version_date). "First version" is the fallback only
 * when the seed's date is not known.
 */
function versionLabel(v: SopVersionView, newest: boolean, lang: Lang): string {
  if (v.effective_from_date === null) return t(lang, newest ? "C-sop-book-first-current" : "C-sop-book-first");
  const date = shortDate(v.effective_from_date);
  return newest ? t(lang, "C-sop-book-current", { date }) : date;
}

/**
 * The R-10 header line. The pending sentence ("Version 2 starts on ... Until then, version 1 applies.") is shown only
 * when there is no version switch: the switch already carries the date, and the board marks the newest "· current"
 * (board-literal, option (a)).
 */
function headerLine(data: SopOverview, hasSwitch: boolean, lang: Lang): string | null {
  const { latest, in_force_version } = data;
  if (latest === null) return null;
  if (latest.effective_from_date === null) return t(lang, "C-sop-version-seed", { version: latest.version });
  if (in_force_version === latest.version) {
    return t(lang, "C-sop-version-in-force", { version: latest.version, date: dayLabel(latest.effective_from_date, lang) });
  }
  if (hasSwitch) return null;
  return t(lang, "C-sop-version-pending", {
    version: latest.version,
    date: dayLabel(latest.effective_from_date, lang),
    current: in_force_version ?? latest.version - 1,
  });
}

type ViewMode = "book" | "table";

function SopBook({ data, lang }: { data: SopOverview; lang: Lang }) {
  // Oldest first, as the board reads left to right; the newest is selected until the reader picks another.
  const versions = useMemo(() => buildVersions(data).reverse(), [data]);
  const newest = versions[versions.length - 1]!;
  const [selected, setSelected] = useState<number>(newest.version);
  // PR-9b: Book (the spread) or Table; the choice outlives a version switch.
  const [mode, setMode] = useState<ViewMode>("book");
  const view = versions.find((v) => v.version === selected) ?? newest;
  const options = versions.map((v) => ({ value: String(v.version), label: versionLabel(v, v === newest, lang) }));
  const header = headerLine(data, versions.length > 1, lang);
  const modeOptions = [
    { value: "book" as const, label: t(lang, "C-sop-book-view-book") },
    { value: "table" as const, label: t(lang, "C-sop-book-view-table") },
  ];

  return (
    <>
      {header !== null && <p className={styles.line}>{header}</p>}
      <div className={styles.switchRow}>
        {versions.length > 1 ? (
          <Segmented
            label={t(lang, "C-sop-book-switch")}
            variant="plain"
            options={options}
            value={String(view.version)}
            onChange={(value) => setSelected(Number(value))}
            className={styles.switch}
          />
        ) : (
          <Pill tone="teal">{options[0]!.label}</Pill>
        )}
        <Segmented label={t(lang, "C-sop-book-view")} variant="plain" options={modeOptions} value={mode} onChange={setMode} />
      </div>

      <section aria-labelledby="sop-steps-heading">
        <h2 id="sop-steps-heading" className={styles.sectionTitle}>
          {t(lang, "C-sop-steps", { version: view.version })}
        </h2>
        {mode === "book" ? <SopBookSpread view={view} versions={versions} lang={lang} /> : <SopTable view={view} versions={versions} lang={lang} />}
      </section>
    </>
  );
}

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
      <main className={styles.page}>
        <WebTopBar auth={null} showSignOut={false} />
        <p role="status" aria-live="polite">
          {t(lang, "C-signin-config")}
        </p>
      </main>
    );
  }

  if (authUser.status === "loading" || authUser.status === "signed_out" || role === null) {
    return (
      <main className={styles.page}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === "other" || outcome.kind === "forbidden") {
    return (
      <main className={styles.page}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <h1 className={styles.title}>{t(lang, "C-sop-title")}</h1>
        <p role="status" aria-live="polite">
          {t(lang, "C-sop-err-forbidden")}
        </p>
      </main>
    );
  }

  if (outcome.kind === "loading" || outcome.kind === "error") {
    return (
      <main className={styles.page}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <h1 className={styles.title}>{t(lang, "C-sop-title")}</h1>
        <p role="status" aria-live="polite">
          {outcome.kind === "loading" ? t(lang, "C-day-loading") : t(lang, "C-srv-generic")}
        </p>
      </main>
    );
  }

  const { latest, changes } = outcome.data;
  if (latest === null) {
    return (
      <main className={styles.page}>
        <WebTopBar auth={auth} showSignOut current="sop" />
        <h1 className={styles.title}>{t(lang, "C-sop-title")}</h1>
        <EmptyState title={t(lang, "C-web-empty-sop-h")} detail={role === "owner" ? t(lang, "C-web-empty-sop-owner") : undefined} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <WebTopBar auth={auth} showSignOut current="sop" />
      <h1 className={styles.title}>{t(lang, "C-sop-title")}</h1>

      <SopBook data={outcome.data} lang={lang} />

      <section aria-labelledby="sop-changes-heading">
        <h2 id="sop-changes-heading" className={styles.sectionTitle}>
          {t(lang, "C-sop-changes")}
        </h2>
        {changes.length === 0 ? (
          <p className={styles.line}>{t(lang, "C-sop-changes-empty")}</p>
        ) : (
          changes.map((change) => <SopChangeCard key={change.version} change={change} lang={lang} />)
        )}
      </section>

      <p className={cx(styles.line, styles.footer)}>{t(lang, "C-sop-book-readonly")}</p>
    </main>
  );
}
