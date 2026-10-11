// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { EmailSignInForm, useEmailFields } from "@/app/sign-in/EmailSignInForm";

const replace = vi.fn();
const ROUTER = { replace };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));

const signInWithEmailAndPassword = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signInWithEmailAndPassword: (...a: unknown[]) => signInWithEmailAndPassword(...a),
  signOut: (...a: unknown[]) => signOut(...a),
}));
const postAuthSession = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({ postAuthSession: (...a: unknown[]) => postAuthSession(...a) }));

const AUTH = { kind: "fake-auth" } as never;
const USER = { uid: "u1", getIdTokenResult: async () => ({ claims: { role: "owner" } }) };

/** The same wiring RoleSignIn gives the form: the parent owns `busy` and the stale-redirect ref. */
function Harness(props: { demoIntercept?: (email: string, password: string) => Promise<boolean>; initialEmail?: string; initialPassword?: string; signingInRef?: { current: boolean } }) {
  const [busy, setBusy] = useState(false);
  const ownRef = useRef(false);
  const signingInRef = props.signingInRef ?? ownRef;
  const fields = useEmailFields({ email: props.initialEmail, password: props.initialPassword });
  return (
    <LangProvider initial="en">
      <EmailSignInForm
        auth={AUTH}
        disabled={busy}
        busy={busy}
        onBusy={setBusy}
        signingInRef={signingInRef}
        demoIntercept={props.demoIntercept}
        fields={fields}
      />
    </LangProvider>
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  signInWithEmailAndPassword.mockResolvedValue({ user: USER });
  postAuthSession.mockResolvedValue("ok");
  signOut.mockResolvedValue(undefined);
  for (const m of ["log", "info", "warn", "error"]) vi.spyOn(console, m as "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
  signInWithEmailAndPassword.mockReset();
  postAuthSession.mockReset();
  signOut.mockReset();
});

describe("EmailSignInForm", () => {
  it("signs in through Firebase and the session route, then lands by the role in the claims", async () => {
    render(<Harness />);
    fillAndSubmit(" a@b.c ", "pw");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(AUTH, "a@b.c", "pw");
    expect(postAuthSession).toHaveBeenCalledWith(USER);
  });

  it("starts with initial values when given them", () => {
    render(<Harness initialEmail="x@y.z" initialPassword="secret" />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("x@y.z");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  });

  describe("demoIntercept (R-18 P1)", () => {
    it("is asked first with the trimmed email and the password; when it handles them Firebase is never called", async () => {
      const demoIntercept = vi.fn(async () => true);
      render(<Harness demoIntercept={demoIntercept} />);
      fillAndSubmit(" Owner.Judge@example.com ", "bee6-demo");
      await waitFor(() => expect(demoIntercept).toHaveBeenCalledWith("Owner.Judge@example.com", "bee6-demo"));
      await act(async () => {});
      expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
      expect(postAuthSession).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      // The form is usable again and holds no password.
      expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    });

    it("takes the real Firebase path when it does not handle the input", async () => {
      const demoIntercept = vi.fn(async () => false);
      render(<Harness demoIntercept={demoIntercept} />);
      fillAndSubmit("a@b.c", "pw");
      await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));
      expect(demoIntercept).toHaveBeenCalledTimes(1);
    });

    it("an intercept that throws takes the real path rather than wedging the form", async () => {
      render(<Harness demoIntercept={async () => Promise.reject(new Error("boom"))} />);
      fillAndSubmit("a@b.c", "pw");
      await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1));
    });

    it("holds the stale-redirect guard while the intercept runs and releases it after", async () => {
      let release!: (v: boolean) => void;
      const signingInRef = { current: false };
      render(<Harness signingInRef={signingInRef} demoIntercept={() => new Promise<boolean>((r) => (release = r))} />);
      fillAndSubmit("owner.judge@example.com", "bee6-demo");
      expect(signingInRef.current).toBe(true); // a redirect effect must not act on the demo sign-in's auth-state change
      expect(screen.getByRole("button", { name: "Signing in…" })).toBeTruthy();
      await act(async () => release(true));
      expect(signingInRef.current).toBe(false);
    });

    it("an empty field never reaches the intercept", () => {
      const demoIntercept = vi.fn(async () => true);
      render(<Harness demoIntercept={demoIntercept} />);
      fillAndSubmit("owner.judge@example.com", "");
      expect(demoIntercept).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Enter your email and password.");
    });
  });
});
