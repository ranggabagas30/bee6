"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { authedPostJson } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { addDays } from "@/lib/capture/calendar";
import { GenerateResponseSchema, type GenerateResponse } from "@/lib/proposals/contract";
import { WebTopBar } from "@/app/web/WebTopBar";
import { ProposalCard } from "@/app/proposals/ProposalCard";
import { ConstraintsPanel } from "@/app/proposals/ConstraintsPanel";
import { ProposalList } from "@/app/proposals/ProposalList";

/**
 * /proposals (R-08 Task 7.3). Owner AND supervisor land on the same page,
 * the same Generate panel, the same read-only result card (v2, Q-10) — no
 * owner-only variant, no role-specific route. The server is still the only
 * authority: a role read here is UI-only (two details — the owner note, and
 * Task 8's constraint-form visibility, not built in this PR), never the
 * security boundary. A forged/stale role still gets a server 403, which maps
 * to the same `forbidden` outcome as the client-side gate below.
 */

type Role = "owner" | "supervisor" | "other";

type GenerateOutcome =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; data: GenerateResponse }
  | { kind: "conflict"; code: string }
  | { kind: "invalid" }
  | { kind: "forbidden" }
  | { kind: "error" };

type Banner = { key: DictKey; range?: { from_date: string; to_date: string } };

const CONFLICT_KEY: Record<string, DictKey> = {
  GENERATION_IN_PROGRESS: "C-prop-err-progress",
  LIBRARY_NOT_READY: "C-prop-err-library",
  NO_SOP: "C-prop-err-sop",
};

const PAGE_STYLE: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const LABEL_STYLE: CSSProperties = { display: "block", fontSize: 16, marginBottom: 4 };
const DATE_ROW_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 };
const DATE_FIELD_STYLE: CSSProperties = { minWidth: 0 };
const INPUT_STYLE: CSSProperties = { minHeight: 48, fontSize: 16, padding: 8, boxSizing: "border-box", width: "100%", maxWidth: 220 };
const BUTTON_STYLE: CSSProperties = { minHeight: 48, width: "100%", fontSize: 16, padding: "0 16px", boxSizing: "border-box" };
const STATUS_STYLE: CSSProperties = { margin: "0 0 16px 0", overflowWrap: "anywhere" };
const BANNER_STYLE: CSSProperties = { margin: "16px 0 8px 0", overflowWrap: "anywhere" };
const BANNER_EMPTY_STYLE: CSSProperties = { margin: 0 };

/** The browser's own local date, "YYYY-MM-DD" — a form default only; the
 * server is the sole authority on "today" and on the accepted range. */
function todayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ProposalsApp({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth: Auth | null = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [role, setRole] = useState<Role | null>(null);
  const [outcome, setOutcome] = useState<GenerateOutcome>({ kind: "idle" });
  const [toDate, setToDate] = useState<string>(() => todayLocalDate());
  const [fromDate, setFromDate] = useState<string>(() => addDays(todayLocalDate(), -6));
  const [listKey, setListKey] = useState(0);
  const [constraintsKey, setConstraintsKey] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const generateButtonRef = useRef<HTMLButtonElement>(null);

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

  async function post() {
    if (!auth) return;
    const result = await authedPostJson(
      auth,
      "/api/v1/proposals/generate",
      { from_date: fromDate, to_date: toDate },
      GenerateResponseSchema,
    );

    if (result.kind === "ok") {
      setOutcome({ kind: "ok", data: result.data });
      setListKey((k) => k + 1);
      return;
    }
    if (result.kind === "signed_out") {
      await signOut(auth);
      router.replace("/sign-in");
      return;
    }
    if (result.kind === "forbidden") {
      setOutcome({ kind: "forbidden" });
      return;
    }
    if (result.kind === "invalid") {
      setOutcome({ kind: "invalid" });
      return;
    }
    if (result.kind === "conflict") {
      setOutcome({ kind: "conflict", code: result.code });
      return;
    }
    setOutcome({ kind: "error" });
  }

  /** A decision on a listed proposal got an answer: show it, reload the list, and after a rejection the constraints too. */
  function handleSettled(settled: { messageKey: DictKey; range?: { from_date: string; to_date: string } }) {
    setBanner({ key: settled.messageKey, range: settled.range });
    setListKey((k) => k + 1);
    if (settled.messageKey === "C-prop-done-rejected-sup" || settled.messageKey === "C-prop-done-rejected-owner") {
      setConstraintsKey((k) => k + 1);
    }
  }

  /** Fills the date inputs only. It never calls Generate: a paid model call needs an explicit tap. */
  function applyBannerDates(range: { from_date: string; to_date: string }) {
    setFromDate(range.from_date);
    setToDate(range.to_date);
    generateButtonRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || outcome.kind === "busy") return;
    setOutcome({ kind: "busy" });
    void post();
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

  if (authUser.status === "loading" || authUser.status === "signed_out") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === null) {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  if (role === "other") {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={auth} showSignOut />
        <h1>{t(lang, "C-prop-title")}</h1>
        <p role="status" aria-live="polite">
          {t(lang, "C-prop-err-forbidden")}
        </p>
      </main>
    );
  }

  const busy = outcome.kind === "busy";
  const bannerRange = banner?.range;
  const statusMessage: string | null =
    outcome.kind === "busy"
      ? t(lang, "C-prop-busy")
      : outcome.kind === "conflict"
        ? t(lang, CONFLICT_KEY[outcome.code] ?? "C-srv-generic")
        : outcome.kind === "invalid"
          ? t(lang, "C-prop-err-range")
          : outcome.kind === "forbidden"
            ? t(lang, "C-prop-err-forbidden")
            : outcome.kind === "error"
              ? t(lang, "C-srv-generic")
              : null;

  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={auth} showSignOut />
      <h1>{t(lang, "C-prop-title")}</h1>
      <p>{t(lang, "C-prop-help")}</p>
      {role === "owner" && <p>{t(lang, "C-prop-owner-note")}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <div style={DATE_ROW_STYLE}>
          <div style={DATE_FIELD_STYLE}>
            <label style={LABEL_STYLE} htmlFor="prop-from">
              {t(lang, "C-prop-from")}
            </label>
            <input
              id="prop-from"
              type="date"
              value={fromDate}
              disabled={busy}
              onChange={(event) => setFromDate(event.target.value)}
              style={INPUT_STYLE}
            />
          </div>
          <div style={DATE_FIELD_STYLE}>
            <label style={LABEL_STYLE} htmlFor="prop-to">
              {t(lang, "C-prop-to")}
            </label>
            <input
              id="prop-to"
              type="date"
              value={toDate}
              disabled={busy}
              onChange={(event) => setToDate(event.target.value)}
              style={INPUT_STYLE}
            />
          </div>
        </div>
        <button ref={generateButtonRef} type="submit" disabled={busy} style={BUTTON_STYLE}>
          {t(lang, "C-prop-generate")}
        </button>
      </form>

      <p role="status" aria-live="polite" style={STATUS_STYLE}>
        {statusMessage ?? ""}
      </p>

      {outcome.kind === "ok" && (
        <>
          {outcome.data.reused && <p>{t(lang, "C-prop-reused")}</p>}
          <ProposalCard proposal={outcome.data.proposal} lang={lang} />
        </>
      )}

      <p role="status" aria-live="polite" style={banner ? BANNER_STYLE : BANNER_EMPTY_STYLE}>
        {banner ? t(lang, banner.key) : ""}
      </p>
      {bannerRange && (
        <button type="button" onClick={() => applyBannerDates(bannerRange)} style={BUTTON_STYLE}>
          {t(lang, "C-prop-use-dates")}
        </button>
      )}

      <ProposalList auth={auth} role={role} lang={lang} reloadKey={listKey} onSettled={handleSettled} />

      <ConstraintsPanel auth={auth} role={role} lang={lang} reloadKey={constraintsKey} />
    </main>
  );
}
