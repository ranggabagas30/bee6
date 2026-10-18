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
import { Chip, Segmented } from "@/app/ui";
import { WebShell } from "@/app/web/WebShell";
import { PageHead } from "@/app/web/PageHead";
import { useRoleClaim } from "@/app/web/useRoleClaim";
import { EmptyState } from "@/app/web/EmptyState";
import { SopBookSpread } from "@/app/sop/SopBookSpread";
import { SopTable } from "@/app/sop/SopTable";
import { buildVersions, shortDate, tabNumberOf, tabVersions, type SopVersionView } from "@/app/sop/versions";
import { cx } from "@/app/ui/cx";
import styles from "@/app/sop/sop.module.css";

/**
 * /sop (R-10 Task 5.3; SOP book in R-19 PR-9a + PR-9b §9.1). Owner and supervisor see the same read-only screen:
 * the version switch by date (dd/mm/yy, newest "· current"), the Book/Table toggle, the selected version's steps
 * (Book: a two-page spread by chapter; Table: one row per step) with the improved badge on the step that version
 * changed (its "why" link opens the approved change inline) and the read-only footer. R-25 T12: page-2 look on
 * `WebShell` (D2-04 boards); the separate "Changes" list is gone, the same card now sits under the improved step.
 * No Add SOP, Download or Open in Sheets control (V7). The role read here is UI-only; the server (`sop:diff` +
 * outlet) is the boundary and still answers 403 for anyone else.
 */

type Outcome =
  | { kind: "loading" }
  | { kind: "ok"; data: SopOverview }
  | { kind: "forbidden" }
  | { kind: "error" };

/**
 * "dd/mm/yy" or with a state suffix (R-21 O-5). The seed is dated by first_version_date.
 * "First version" is the fallback only when the seed's date is not known.
 * State: the version's `version === in_force_version ? "current" : "past"` (item 16: "upcoming" removed, pending sentence re-enabled).
 */
function versionLabel(v: SopVersionView, inForceVersion: number | null | undefined, newestVersion: number, lang: Lang): string {
  const inForce = inForceVersion ?? newestVersion; // Fallback when no version is in force yet: the newest reads as current
  const state = v.version === inForce ? "current" : "past";

  if (v.effective_from_date === null) {
    return state === "current" ? t(lang, "C-sop-book-first-current") : t(lang, "C-sop-book-first");
  }

  const date = shortDate(v.effective_from_date);
  if (state === "current") return t(lang, "C-sop-book-current", { date });
  return date;
}

/**
 * The R-10 header line. The pending sentence ("Version 2 starts on ... Until then, version 1 applies.") shows
 * when the latest version is not in force (item 16, option B: re-enabled after removing "upcoming" label).
 */
function headerLine(data: SopOverview, _hasSwitch: boolean, lang: Lang): string | null {
  const { latest, in_force_version } = data;
  if (latest === null) return null;
  if (latest.effective_from_date === null) return t(lang, "C-sop-version-seed", { version: latest.version });
  if (in_force_version === latest.version) {
    return t(lang, "C-sop-version-in-force", { version: latest.version, date: dayLabel(latest.effective_from_date, lang) });
  }
  return t(lang, "C-sop-version-pending", {
    version: latest.version,
    date: dayLabel(latest.effective_from_date, lang),
    current: in_force_version ?? latest.version - 1,
  });
}

type ViewMode = "book" | "table";

function SopBook({ data, lang, demo }: { data: SopOverview; lang: Lang; demo: boolean }) {
  // Oldest first, as the board reads left to right; the newest is selected until the reader picks another.
  // `versions` is every version the data can show (the step origins and the table read it whole); `tabs` is what the
  // switch lists: versions sharing an effective date (two proposals approved the same day) fold into the latest one.
  const versions = useMemo(() => buildVersions(data).reverse(), [data]);
  const tabs = useMemo(() => tabVersions(versions), [versions]);
  const newest = tabs[tabs.length - 1]!;
  const [selected, setSelected] = useState<number>(newest.version);
  // PR-9b: Book (the spread) or Table; the choice outlives a version switch. The open chapter lives here too, so a
  // Book -> Table -> Book round trip reopens the same page (the spread unmounts in Table view).
  const [mode, setMode] = useState<ViewMode>("book");
  const [chapter, setChapter] = useState(0);
  const view = tabs.find((v) => v.version === selected) ?? newest;
  const inForceTab = data.in_force_version === null ? null : tabNumberOf(versions, data.in_force_version);
  const options = tabs.map((v) => ({ value: String(v.version), label: versionLabel(v, inForceTab, newest.version, lang) }));
  const header = headerLine(data, tabs.length > 1, lang);
  const modeOptions = [
    { value: "book" as const, label: t(lang, "C-sop-book-view-book") },
    { value: "table" as const, label: t(lang, "C-sop-book-view-table") },
  ];

  return (
    <>
      <div className={styles.controls}>
        <div className={styles.versionGroup}>
          <span className={cx("b6-kick", styles.versionKick)} aria-hidden="true">
            {t(lang, "C-sop-book-version-kick")}
          </span>
          {tabs.length > 1 ? (
            <Segmented
              label={t(lang, "C-sop-book-switch")}
              variant="plain"
              options={options}
              value={String(view.version)}
              onChange={(value) => setSelected(Number(value))}
              className={styles.switch}
            />
          ) : (
            <Chip variant="teal">{options[0]!.label}</Chip>
          )}
          {header !== null && <span className={styles.versionNote}>{header}</span>}
        </div>
        <Segmented label={t(lang, "C-sop-book-view")} variant="plain" options={modeOptions} value={mode} onChange={setMode} />
      </div>

      <section aria-labelledby="sop-steps-heading">
        {/* The board has no "Steps in version n" heading; it stays for screen readers so the page keeps its outline. */}
        <h2 id="sop-steps-heading" className="b6-sr-only">
          {t(lang, "C-sop-steps", { version: view.version })}
        </h2>
        {mode === "book" ? (
          <SopBookSpread
            view={view}
            versions={versions}
            lang={lang}
            chapter={chapter}
            onChapterChange={setChapter}
            outletLine={demo ? t(lang, "C-web-outlet-demo") : null}
          />
        ) : (
          <SopTable view={view} versions={versions} lang={lang} />
        )}
      </section>
    </>
  );
}

export function SopApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  // Role and demo flag from the fresh ID token's claims: UI-only, never the security boundary. A claim that cannot be
  // read fails closed ("other").
  const { role, demo } = useRoleClaim(auth);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });

  const uid = authUser.status === "signed_in" ? authUser.user.uid : null;

  useEffect(() => {
    if (authUser.status === "signed_out") router.replace("/sign-in");
  }, [authUser.status, router]);

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
      <WebShell auth={null}>
        <p role="status" aria-live="polite">
          {t(lang, "C-signin-config")}
        </p>
      </WebShell>
    );
  }

  if (authUser.status === "loading" || authUser.status === "signed_out" || role === null) {
    return (
      <WebShell auth={auth} current="sop">
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </WebShell>
    );
  }

  if (role === "other" || outcome.kind === "forbidden") {
    return (
      <WebShell auth={auth} current="sop">
        <PageHead title={t(lang, "C-sop-book-title")} />
        <p role="status" aria-live="polite">
          {t(lang, "C-sop-err-forbidden")}
        </p>
      </WebShell>
    );
  }

  if (outcome.kind === "loading" || outcome.kind === "error") {
    return (
      <WebShell auth={auth} current="sop">
        <PageHead title={t(lang, "C-sop-book-title")} sub={t(lang, "C-sop-book-sub")} />
        <p role="status" aria-live="polite">
          {outcome.kind === "loading" ? t(lang, "C-day-loading") : t(lang, "C-srv-generic")}
        </p>
      </WebShell>
    );
  }

  const { latest } = outcome.data;
  if (latest === null) {
    return (
      <WebShell auth={auth} current="sop">
        <PageHead title={t(lang, "C-sop-book-title")} sub={t(lang, "C-sop-book-sub")} />
        <EmptyState title={t(lang, "C-web-empty-sop-h")} detail={role === "owner" ? t(lang, "C-web-empty-sop-owner") : undefined} />
      </WebShell>
    );
  }

  return (
    <WebShell auth={auth} current="sop">
      <PageHead title={t(lang, "C-sop-book-title")} sub={t(lang, "C-sop-book-sub")} />
      <SopBook data={outcome.data} lang={lang} demo={demo} />
      <p className={styles.footer}>{t(lang, "C-sop-book-readonly")}</p>
    </WebShell>
  );
}
