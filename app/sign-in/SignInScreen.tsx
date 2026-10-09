"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import {
  getClientAuth,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "@/lib/auth/client/firebase-client";
import { postAuthSession } from "@/lib/auth/client/api";
import { useAuthUser } from "@/lib/auth/client/use-auth-user";
import { signInErrorKey } from "@/lib/auth/client/sign-in-errors";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { WebTopBar } from "@/app/web/WebTopBar";

/**
 * /sign-in — owner/supervisor email + password sign-in (R-06 Task 4.6).
 *
 * `postAuthSession` runs on every successful Firebase sign-in: it links the
 * uid to the seeded `users` doc and sets claims. On anything other than `ok`
 * the Firebase user is signed back out immediately — otherwise it would stay
 * signed in with no claims, and the next visit here would skip the form (an
 * already-"signed_in" user) only to bounce straight back with no message
 * (CLAUDE.md hard rule #6: every read/write is server-checked, so a claims-less
 * session can never do anything useful here).
 *
 * Owner start page (R-06 Task 14a, Rangga v4 Q-G): `/home`; every other role
 * lands on `/day`. `redirectTarget` reads the fresh ID token's own `role`
 * claim — navigation only, since every route still enforces role + outlet on
 * the server — and falls back to `/day` if the token result cannot be read.
 */

async function redirectTarget(user: User): Promise<"/home" | "/day"> {
  try {
    const r = await user.getIdTokenResult();
    return r.claims.role === "owner" ? "/home" : "/day";
  } catch {
    return "/day";
  }
}

const PAGE_STYLE: CSSProperties = { maxWidth: 360, margin: "0 auto", padding: 24 };
const INPUT_STYLE: CSSProperties = {
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  minHeight: 48,
  fontSize: 16,
  padding: 8,
  marginTop: 4,
  marginBottom: 16,
};
const BUTTON_STYLE: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 48,
  fontSize: 16,
  padding: 12,
};

export function SignInScreen({ config }: { config: FirebaseWebConfig | null }) {
  const { lang } = useLang();
  const router = useRouter();
  const auth = config ? getClientAuth(config) : null;
  const authUser = useAuthUser(auth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [messageKey, setMessageKey] = useState<DictKey | undefined>(undefined);
  // signInWithEmailAndPassword resolves internally and fires
  // onAuthStateChanged with "signed_in" *before* postAuthSession has
  // returned. The redirect effect below would otherwise race ahead of the
  // denied/network/error handling in handleSubmit and redirect to /day
  // before an error message ever shows. A ref (not `busy` state) guards
  // this: clearing `busy` could re-run the effect while authUser.status
  // still reads "signed_in", since Firebase's listener delivery is async —
  // the ref lets handleSubmit own exactly when the effect is allowed to act
  // on a "signed_in" status it did not itself just confirm.
  const signingInRef = useRef(false);

  // An already signed-in Firebase user (e.g. a previous visit) skips the
  // form and goes straight to its role's start page — no POST, since the
  // session was already linked.
  useEffect(() => {
    if (authUser.status === "signed_in" && !signingInRef.current) {
      void redirectTarget(authUser.user).then((target) => router.replace(target));
    }
  }, [authUser, router]);

  if (!config) {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={null} showSignOut={false} />
        <p role="status" aria-live="polite">
          {t(lang, "C-signin-config")}
        </p>
      </main>
    );
  }

  // Firebase's auth-state restore has not resolved yet (`loading`), OR the
  // user is already signed in and the redirect effect above is about to
  // navigate away (`signed_in` and not actively submitting via the form
  // below). Both windows show the identical symptom — an empty, disabled
  // form the user can't use before it's replaced by /home or /day — and the
  // signed_in window can be the longer of the two on a cold Cloud Run start,
  // since /home and /day are dynamic pages with no loading.tsx. `!busy`
  // (not the signingInRef guard above, which only exists to stop the
  // redirect effect from firing — reading a ref during render would trip the
  // react-hooks refs lint rule) keeps this placeholder from hiding the
  // form's own "Signing in…" busy state during an active submit, where
  // status can flip to signed_in before postAuthSession has resolved.
  if (authUser.status === "loading" || (authUser.status === "signed_in" && !busy)) {
    return (
      <main style={PAGE_STYLE}>
        <WebTopBar auth={null} showSignOut={false} />
        <p role="status" aria-live="polite">
          {t(lang, "C-day-loading")}
        </p>
      </main>
    );
  }

  const disabled = authUser.status !== "signed_out" || busy;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || disabled) return;

    const trimmedEmail = email.trim();
    if (trimmedEmail === "" || password === "") {
      setMessageKey("C-signin-empty");
      return;
    }

    setBusy(true);
    setMessageKey(undefined);
    signingInRef.current = true;

    let credUser: Awaited<ReturnType<typeof signInWithEmailAndPassword>>["user"];
    try {
      const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      credUser = cred.user;
    } catch (error) {
      signingInRef.current = false;
      setPassword("");
      setMessageKey(signInErrorKey(error));
      setBusy(false);
      return;
    }

    const result = await postAuthSession(credUser);
    if (result === "ok") {
      // signingInRef.current stays true: this is the only redirect for this
      // sign-in, so the stale-effect guard must keep blocking the effect.
      router.replace(await redirectTarget(credUser));
      return;
    }

    await signOut(auth);
    signingInRef.current = false;
    setBusy(false);
    setMessageKey(
      result === "denied"
        ? "C-signin-denied"
        : result === "network"
          ? "C-signin-net"
          : "C-srv-generic",
    );
  }

  return (
    <main style={PAGE_STYLE}>
      <WebTopBar auth={null} showSignOut={false} />
      <h1>{t(lang, "C-signin-title")}</h1>
      <p>{t(lang, "C-signin-help")}</p>
      <form noValidate onSubmit={handleSubmit}>
        <label htmlFor="signin-email">{t(lang, "C-signin-email")}</label>
        <input
          id="signin-email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={disabled}
          style={INPUT_STYLE}
        />
        <label htmlFor="signin-password">{t(lang, "C-signin-password")}</label>
        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={disabled}
          style={INPUT_STYLE}
        />
        <button type="submit" disabled={disabled} style={BUTTON_STYLE}>
          {busy ? t(lang, "C-signin-busy") : t(lang, "C-signin-submit")}
        </button>
        <p role="status" aria-live="polite">
          {messageKey ? t(lang, messageKey) : ""}
        </p>
      </form>
    </main>
  );
}
