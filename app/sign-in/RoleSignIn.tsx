"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth } from "@/lib/auth/client/firebase-client";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { PairForm, type PairedInfo } from "@/app/pair/PairForm";
import { PairedChecklist } from "@/app/pair/PairedChecklist";
import { EmailSignInForm, useEmailFields } from "@/app/sign-in/EmailSignInForm";
import { redirectTarget } from "@/app/sign-in/redirect-target";
import type { DemoAccessProps, DemoFill, DemoPanelHooks } from "@/app/sign-in/panel-hooks";
import { DemoHooksConsumer } from "@/app/sign-in/demo-hooks";
import { SIGN_IN_ROLES, type SignInRole } from "@/app/sign-in/roles";

/**
 * The official sign-in (R-18 P1): a native radio group for Staff / Supervisor / Owner and the matching panel.
 *
 * - Staff = the pairing form (the real staff entry in MVP 1; no staff sign-in exists). Supervisor and Owner = the email +
 *   password form. Role truth stays in the claims: the user lands by the role in their token, not by the panel picked.
 * - The pilot renders no demo text and loads no demo code. On a demo deployment (`demo`, read from DEMO_MODE by the
 *   server page) the panels sit inside `DemoAccess`, loaded lazily through `next/dynamic`, which shows the published demo
 *   credentials and supplies the intercepts that turn them into a private sandbox. This module imports nothing from
 *   `app/demo/**` except through that dynamic import (checked by app/demo/import-boundaries.test.ts).
 * - `redirectSignedIn` (default on): a signed-in Firebase user is sent to their start page. The demo home page turns it
 *   off so a judge already in a demo can still switch role or start a fresh demo there.
 */

const DemoAccess = dynamic<DemoAccessProps>(() => import("@/app/demo/DemoAccess").then((m) => m.DemoAccess));

const ROLE_KEY: Record<SignInRole, DictKey> = {
  staff: "C-signin-role-staff",
  supervisor: "C-signin-role-supervisor",
  owner: "C-signin-role-owner",
};

const FIELDSET_STYLE: CSSProperties = { border: 0, margin: "0 0 16px 0", padding: 0, minWidth: 0 };
const LEGEND_STYLE: CSSProperties = { padding: 0, marginBottom: 8, fontWeight: 700 };
const RADIOS_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const LINK_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 48, padding: "0 4px", fontSize: 16 };

function radioLabelStyle(selected: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxSizing: "border-box",
    flex: "1 1 96px",
    minHeight: 48,
    padding: "0 12px",
    border: selected ? "3px solid currentColor" : "1px solid currentColor",
    borderRadius: 8,
    fontWeight: selected ? 700 : 400,
    cursor: "pointer",
  };
}

const DEVICE_TOKEN_KEY = "bee6.device_token";

/** Whether this browser already holds a device token (a paired phone). Presence only: the value is never read onward. */
function hasDeviceToken(): boolean {
  try {
    const value = window.localStorage.getItem(DEVICE_TOKEN_KEY);
    return typeof value === "string" && value.length > 0;
  } catch {
    return false;
  }
}
const noopSubscribe = () => () => {};

export interface RoleSignInProps {
  config: FirebaseWebConfig | null;
  demo: boolean;
  initialRole: SignInRole | null;
  /** 2 when another heading (the demo home page's title) is the page's h1. */
  headingLevel?: 1 | 2;
  redirectSignedIn?: boolean;
}

export function RoleSignIn({ config, demo, initialRole, headingLevel = 1, redirectSignedIn = true }: RoleSignInProps) {
  const { lang } = useLang();
  const router = useRouter();
  const [role, setRole] = useState<SignInRole | null>(initialRole);
  const [paired, setPaired] = useState<PairedInfo | null>(null);
  const emailFields = useEmailFields();
  // "Fill in" on the demo box: the code goes to the pairing form through its initial value (re-keyed by the nonce); the
  // email and password go straight into the email form's values.
  const [codeFill, setCodeFill] = useState<{ nonce: number; code: string }>({ nonce: 0, code: "" });
  const panelRef = useRef<HTMLDivElement>(null);
  // Armed by a pointer press (tap or click) on a role radio only. A native radio group also fires change on arrow keys, and
  // moving focus into the panel then would trap a keyboard or screen-reader user before they reach Owner (WCAG 3.2.2), so
  // keyboard changes, first render and URL-driven renders never steal focus. Not onClick: browsers fire a synthetic click
  // on arrow-key radio changes too.
  const pointerChange = useRef(false);
  const focusPanel = useRef(false);

  const auth = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [busy, setBusy] = useState(false);
  // See EmailSignInForm: stops the redirect effect below from acting on the "signed_in" a form submit itself causes.
  const signingInRef = useRef(false);
  const phonePaired = useSyncExternalStore(noopSubscribe, hasDeviceToken, () => false);

  // An already signed-in Firebase user (e.g. a previous visit) skips the form and goes straight to its role's start page —
  // no POST, since the session was already linked.
  useEffect(() => {
    if (redirectSignedIn && authUser.status === "signed_in" && !signingInRef.current) {
      void redirectTarget(authUser.user).then((target) => router.replace(target));
    }
  }, [authUser, router, redirectSignedIn]);

  useEffect(() => {
    if (!focusPanel.current) return;
    focusPanel.current = false;
    panelRef.current?.querySelector<HTMLElement>("input:not([disabled])")?.focus();
  }, [role]);

  function chooseRole(next: SignInRole) {
    const byPointer = pointerChange.current;
    pointerChange.current = false;
    if (next === role) return;
    focusPanel.current = byPointer;
    setRole(next);
    router.replace(`?as=${next}`, { scroll: false });
  }

  function fill(values: DemoFill) {
    if (values.code !== undefined) setCodeFill((c) => ({ nonce: c.nonce + 1, code: values.code ?? "" }));
    if (values.email !== undefined) emailFields.setEmail(values.email);
    if (values.password !== undefined) emailFields.setPassword(values.password);
    emailFields.setMessageKey(undefined);
  }

  function emailPanel(hooks: DemoPanelHooks) {
    if (!config) {
      return (
        <p role="status" aria-live="polite">
          {t(lang, "C-signin-config")}
        </p>
      );
    }
    // Firebase's auth-state restore has not resolved yet (`loading`), OR the user is already signed in and the redirect
    // effect above is about to navigate away. Both windows would show an empty, disabled form the user can't use before
    // it is replaced by /home or /day. `!busy` keeps this placeholder from hiding the form's own "Signing in…" state during
    // an active submit, where status can flip to signed_in before postAuthSession has resolved.
    if (authUser.status === "loading" || (redirectSignedIn && authUser.status === "signed_in" && !busy)) {
      return (
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      );
    }
    return (
      <>
        <p>{t(lang, "C-signin-help")}</p>
        <EmailSignInForm
          auth={auth}
          disabled={busy}
          busy={busy}
          onBusy={setBusy}
          signingInRef={signingInRef}
          demoIntercept={hooks.interceptEmail}
          fields={emailFields}
        />
      </>
    );
  }

  function staffPanel(hooks: DemoPanelHooks) {
    return (
      <>
        {phonePaired && (
          <p>
            {t(lang, "C-signin-staff-connected")}{" "}
            <Link href="/capture" style={LINK_STYLE}>
              {t(lang, "C-b-buka-mendengarkan")}
            </Link>
          </p>
        )}
        <p>{t(lang, "C-signin-staff-help")}</p>
        <PairForm key={codeFill.nonce} onPaired={setPaired} demoIntercept={hooks.interceptCode} initialCode={codeFill.code} />
      </>
    );
  }

  function renderPanel(hooks: DemoPanelHooks) {
    if (role === "staff") return staffPanel(hooks);
    if (role === "supervisor" || role === "owner") return emailPanel(hooks);
    return <p>{t(lang, "C-signin-choose")}</p>;
  }

  if (paired) {
    return <PairedChecklist outletId={paired.outletId} auth={paired.auth} headingLevel={headingLevel} />;
  }

  const panel = <DemoHooksConsumer>{renderPanel}</DemoHooksConsumer>;
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section>
      <Heading>{t(lang, "C-signin-title")}</Heading>
      <fieldset style={FIELDSET_STYLE}>
        <legend style={LEGEND_STYLE}>{t(lang, "C-signin-as")}</legend>
        <div style={RADIOS_STYLE}>
          {SIGN_IN_ROLES.map((r) => (
            <label key={r} style={radioLabelStyle(role === r)} onPointerDown={() => (pointerChange.current = true)}>
              <input
                type="radio"
                name="signin-role"
                value={r}
                checked={role === r}
                onChange={() => chooseRole(r)}
                // A key press ends any pointer press that changed nothing (the already-selected radio), so it cannot leak.
                onKeyDown={() => (pointerChange.current = false)}
              />
              <span>{t(lang, ROLE_KEY[r])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div ref={panelRef}>
        {demo && role !== null ? (
          <DemoAccess config={config} role={role} onFill={fill}>
            {panel}
          </DemoAccess>
        ) : (
          panel
        )}
      </div>
    </section>
  );
}
