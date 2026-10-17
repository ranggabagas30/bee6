"use client";

import { useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { postAuthSession } from "@/lib/auth/client/api";
import { signInErrorKey } from "@/lib/auth/client/sign-in-errors";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { redirectTarget } from "@/app/sign-in/redirect-target";
import { Button } from "@/app/ui";
import styles from "@/app/sign-in/sign-in.module.css";

/**
 * The owner/supervisor email + password form (R-06 Task 4.6), shared by the Supervisor and Owner panels of the role sign-in.
 *
 * `postAuthSession` runs on every successful Firebase sign-in: it links the
 * uid to the seeded `users` doc and sets claims. On anything other than `ok`
 * the Firebase user is signed back out immediately — otherwise it would stay
 * signed in with no claims, and the next visit here would skip the form (an
 * already-"signed_in" user) only to bounce straight back with no message
 * (CLAUDE.md hard rule #6: every read/write is server-checked, so a claims-less
 * session can never do anything useful here).
 *
 * The parent owns `busy` (it hides its loading placeholder while a submit is running) and `signingInRef`.
 * signInWithEmailAndPassword resolves internally and fires onAuthStateChanged with "signed_in" *before*
 * postAuthSession has returned, so the parent's redirect effect would otherwise race ahead of the
 * denied/network/error handling here. `signingInRef` (a ref, not `busy` state) lets this form own exactly when that
 * effect may act on a "signed_in" status it did not itself just confirm.
 */

export interface EmailFields {
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  messageKey: DictKey | undefined;
  setMessageKey: (key: DictKey | undefined) => void;
}

/**
 * The form's values and its message live in the parent, not in the form: while Firebase's auth state catches up after a
 * refused sign-in, the parent briefly swaps the form for its loading placeholder. The form unmounts then, and the email the
 * visitor typed and the "no access" message must survive that swap.
 */
export function useEmailFields(initial: { email?: string; password?: string } = {}): EmailFields {
  const [email, setEmail] = useState(initial.email ?? "");
  const [password, setPassword] = useState(initial.password ?? "");
  const [messageKey, setMessageKey] = useState<DictKey | undefined>(undefined);
  return { email, setEmail, password, setPassword, messageKey, setMessageKey };
}

export interface EmailSignInFormProps {
  auth: Auth | null;
  disabled: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  signingInRef: MutableRefObject<boolean>;
  /**
   * Demo deployments only (R-18 P1): asked first with the trimmed email and the password. `true` = handled (a demo was
   * started), so Firebase is not called. `false`, or a throw, takes the real path. Only the lazily loaded demo code supplies it.
   */
  demoIntercept?: (email: string, password: string) => Promise<boolean>;
  fields: EmailFields;
}

export function EmailSignInForm({
  auth,
  disabled,
  busy,
  onBusy,
  signingInRef,
  demoIntercept,
  fields,
}: EmailSignInFormProps) {
  const { lang } = useLang();
  const router = useRouter();
  const { email, setEmail, password, setPassword, messageKey, setMessageKey } = fields;

  // Double-submit guard: a ref, so a second Enter in the same tick cannot slip past `disabled` (state, not yet re-rendered).
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || disabled || inFlight.current) return;
    inFlight.current = true;
    try {
      await submit(auth);
    } finally {
      inFlight.current = false;
    }
  }

  async function submit(auth: Auth) {

    const trimmedEmail = email.trim();
    if (trimmedEmail === "" || password === "") {
      setMessageKey("C-signin-empty");
      return;
    }

    onBusy(true);
    setMessageKey(undefined);
    signingInRef.current = true;

    if (demoIntercept) {
      let handled = false;
      try {
        handled = await demoIntercept(trimmedEmail, password);
      } catch {
        handled = false; // a failing demo branch must never block the real sign-in
      }
      if (handled) {
        // The demo box reports its own progress and refusals; this form just becomes usable again, with no password kept.
        signingInRef.current = false;
        setPassword("");
        onBusy(false);
        return;
      }
    }

    let credUser: Awaited<ReturnType<typeof signInWithEmailAndPassword>>["user"];
    try {
      const cred = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      credUser = cred.user;
    } catch (error) {
      signingInRef.current = false;
      setPassword("");
      setMessageKey(signInErrorKey(error));
      onBusy(false);
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
    onBusy(false);
    setMessageKey(
      result === "denied" ? "C-signin-denied" : result === "network" ? "C-signin-net" : "C-srv-generic",
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="signin-email" className={styles.label}>
          {t(lang, "C-signin-email")}
        </label>
        <input
          id="signin-email"
          className={styles.input}
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={disabled}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="signin-password" className={styles.label}>
          {t(lang, "C-signin-password")}
        </label>
        <input
          id="signin-password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={disabled}
        />
      </div>
      <Button type="submit" size="lg" block disabled={disabled}>
        {busy ? t(lang, "C-signin-busy") : t(lang, "C-signin-submit")}
      </Button>
      <p role="status" aria-live="polite" className={styles.message}>
        {messageKey ? t(lang, messageKey) : ""}
      </p>
    </form>
  );
}
