// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import { SignInScreen } from "@/app/sign-in/SignInScreen";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
// A stable object, like the real next/navigation useRouter() — not a new
// object per call — so the redirect effect's `router` dependency doesn't
// spuriously change across re-renders in these tests.
const ROUTER = { replace };
vi.mock("next/navigation", () => ({
  useRouter: () => ROUTER,
}));

const getClientAuth = vi.fn();
const signInWithEmailAndPassword = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => signOut(...args),
  signInWithCustomToken: vi.fn(),
}));

const postAuthSession = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  postAuthSession: (...args: unknown[]) => postAuthSession(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({
  useAuthUser: () => authUserState,
}));

const FAKE_AUTH = { kind: "fake-auth" };
const getIdTokenResult = vi.fn();
const FAKE_USER = { uid: "u1", getIdTokenResult };

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  authUserState = { status: "signed_out" };
  getClientAuth.mockReturnValue(FAKE_AUTH);
  // Supervisor by default: existing tests below assert the non-owner
  // redirect target ("/day") unless a test overrides this for the owner case.
  getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
  consoleSpies = ["log", "info", "warn", "error"].map((method) =>
    vi.spyOn(console, method as "log").mockImplementation(() => {}),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockClear();
  signInWithEmailAndPassword.mockReset();
  signOut.mockReset();
  postAuthSession.mockReset();
  getClientAuth.mockReset();
  getIdTokenResult.mockReset();
});

function renderScreen(initial: "en" | "id" = "en") {
  return render(
    <LangProvider initial={initial}>
      <SignInScreen config={CONFIG} initialRole="supervisor" />
    </LangProvider>,
  );
}

function LangToggle() {
  const { setLang } = useLang();
  return (
    <button type="button" onClick={() => setLang("id")}>
      toggle-lang
    </button>
  );
}

describe("SignInScreen", () => {
  it("authUser.status === 'loading' shows no form (avoids the sign-in flash on reload)", () => {
    authUserState = { status: "loading" };
    renderScreen();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("authUser.status === 'signed_in' and not busy shows no form (closes the second flash window, tech-lead finding 2)", () => {
    authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
    renderScreen();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("authUser.status === 'signed_in' during an active submit (busy) keeps showing the form's busy state", async () => {
    let resolveSignIn: (value: unknown) => void = () => {};
    signInWithEmailAndPassword.mockImplementation(
      () => new Promise((resolve) => (resolveSignIn = resolve)),
    );
    const { rerender } = renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Simulate the real onAuthStateChanged listener firing "signed_in"
    // before signInWithEmailAndPassword (and postAuthSession) have resolved
    // — the same race the "postAuthSession race" describe below covers.
    authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
    rerender(
      <LangProvider initial="en">
        <SignInScreen config={CONFIG} initialRole="supervisor" />
      </LangProvider>,
    );

    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Signing in…" })).not.toBeNull();

    await act(async () => {
      resolveSignIn({ user: FAKE_USER });
      await Promise.resolve();
    });
  });

  it("authUser.status transitioning loading -> signed_out shows the form", () => {
    authUserState = { status: "loading" };
    const { rerender } = renderScreen();
    expect(screen.queryByLabelText("Email")).toBeNull();

    authUserState = { status: "signed_out" };
    rerender(
      <LangProvider initial="en">
        <SignInScreen config={CONFIG} initialRole="supervisor" />
      </LangProvider>,
    );
    expect(screen.getByLabelText("Email")).not.toBeNull();
  });

  it("config null shows C-signin-config and no form", () => {
    render(
      <LangProvider initial="en">
        <SignInScreen config={null} initialRole="supervisor" />
      </LangProvider>,
    );
    expect(document.body.textContent).toContain("Sign-in is not set up on this server.");
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("both fields have accessible labels; the password input has type=password", () => {
    renderScreen();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.type).toBe("password");
  });

  it("empty email or password shows C-signin-empty and does not call sign-in", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(document.body.textContent).toContain("Enter your email and password.");
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("submits with the trimmed email; the button disables while pending (one call)", async () => {
    let resolveSignIn: (value: unknown) => void = () => {};
    signInWithEmailAndPassword.mockImplementation(
      () => new Promise((resolve) => (resolveSignIn = resolve)),
    );
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  a@b.c  " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    const button = screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button); // double submit

    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(FAKE_AUTH, "a@b.c", "pw");
    expect(button.disabled).toBe(true);

    await act(async () => {
      resolveSignIn({ user: FAKE_USER });
      await Promise.resolve();
    });
  });

  it("auth/invalid-credential shows C-signin-bad, clears the password, keeps the email", async () => {
    signInWithEmailAndPassword.mockRejectedValue({ code: "auth/invalid-credential" });
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(document.body.textContent).toContain("Email or password is wrong."));
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("a@b.c");
  });

  it("auth/too-many-requests shows C-signin-many", async () => {
    signInWithEmailAndPassword.mockRejectedValue({ code: "auth/too-many-requests" });
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(document.body.textContent).toContain("Too many tries. Wait a few minutes."),
    );
  });

  it.each([
    ["denied", "This account has no access to bee6."],
    ["network", "No connection. Try again when the signal is stable."],
    ["error", "Something went wrong. Try again."],
  ] as const)("postAuthSession -> %s shows the matching message and signs out", async (result, message) => {
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    postAuthSession.mockResolvedValue(result);
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(document.body.textContent).toContain(message));
    expect(signOut).toHaveBeenCalledWith(FAKE_AUTH);
  });

  it("postAuthSession -> ok navigates to /day (supervisor claims)", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    postAuthSession.mockResolvedValue("ok");
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
    expect(signOut).not.toHaveBeenCalled();
  });

  it("postAuthSession -> ok navigates to /home for owner claims (R-06 Task 14a)", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    postAuthSession.mockResolvedValue("ok");
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
  });

  it("postAuthSession -> ok falls back to /day when getIdTokenResult rejects", async () => {
    getIdTokenResult.mockRejectedValue(new Error("boom"));
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    postAuthSession.mockResolvedValue("ok");
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
  });

  it("an already signed-in user on mount replaces to /day without posting a session (supervisor claims)", async () => {
    authUserState = {
      status: "signed_in",
      user: FAKE_USER,
    } as unknown as AuthUserState;
    renderScreen();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
    expect(postAuthSession).not.toHaveBeenCalled();
  });

  it("an already signed-in owner on mount replaces to /home", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    authUserState = {
      status: "signed_in",
      user: FAKE_USER,
    } as unknown as AuthUserState;
    renderScreen();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
    expect(postAuthSession).not.toHaveBeenCalled();
  });

  it("never logs the password or a token string", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    postAuthSession.mockResolvedValue("ok");
    renderScreen();
    const secretPassword = "super-secret-pw-value";
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: secretPassword } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secretPassword);
      }
    }
  });

  describe("postAuthSession race (tech-lead finding 1)", () => {
    // signInWithEmailAndPassword resolving flips the mocked hook's signed_in
    // status *before* postAuthSession has returned — exactly like Firebase's
    // real onAuthStateChanged listener firing early. These tests force a
    // rerender right after that flip (simulating the listener-driven
    // re-render) while postAuthSession is still pending, then resolve it
    // under our control.
    function controlledPostAuth() {
      let resolvePostAuth: (value: string) => void = () => {};
      const promise = new Promise<string>((resolve) => {
        resolvePostAuth = resolve;
      });
      postAuthSession.mockReturnValue(promise);
      return (value: string) => resolvePostAuth(value);
    }

    async function signInAndGoStale(rerender: (node: ReactElement) => void) {
      signInWithEmailAndPassword.mockImplementation(async () => {
        authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
        return { user: FAKE_USER };
      });
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

      await act(async () => {
        await Promise.resolve();
      });

      // The real onAuthStateChanged listener would drive this re-render; we
      // force it here since the mock hook isn't itself reactive.
      rerender(
        <LangProvider initial="en">
          <SignInScreen config={CONFIG} initialRole="supervisor" />
        </LangProvider>,
      );
    }

    it("denied: does not redirect while postAuthSession is pending, then signs out and shows the denied message without ever redirecting", async () => {
      const resolvePostAuth = controlledPostAuth();
      const { rerender } = renderScreen();

      await signInAndGoStale(rerender);

      expect(replace).not.toHaveBeenCalled();

      await act(async () => {
        resolvePostAuth("denied");
        await Promise.resolve();
      });

      // setBusy(false) above can run slightly before Firebase's real
      // onAuthStateChanged listener would report the sign-out (tech-lead:
      // known-acceptable placeholder flash — see SignInScreen.tsx). This
      // mocked hook isn't reactive to the signOut() call, so simulate the
      // listener's eventual catch-up the same way signInAndGoStale simulates
      // its earlier "signed_in" flip, before asserting the settled message.
      authUserState = { status: "signed_out" };
      rerender(
        <LangProvider initial="en">
          <SignInScreen config={CONFIG} initialRole="supervisor" />
        </LangProvider>,
      );

      await waitFor(() =>
        expect(document.body.textContent).toContain("This account has no access to bee6."),
      );
      expect(signOut).toHaveBeenCalledWith(FAKE_AUTH);
      expect(replace).not.toHaveBeenCalled();
    });

    it("ok: does not redirect while postAuthSession is pending, then redirects exactly once", async () => {
      const resolvePostAuth = controlledPostAuth();
      const { rerender } = renderScreen();

      await signInAndGoStale(rerender);

      expect(replace).not.toHaveBeenCalled();

      await act(async () => {
        resolvePostAuth("ok");
        await Promise.resolve();
      });

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(replace).toHaveBeenCalledWith("/day");
    });
  });

  it("toggling EN -> ID re-renders a shown message in ID", () => {
    render(
      <LangProvider initial="en">
        <LangToggle />
        <SignInScreen config={CONFIG} initialRole="supervisor" />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(document.body.textContent).toContain("Enter your email and password.");
    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));
    expect(document.body.textContent).toContain("Isi email dan kata sandi.");
  });
});

describe("SignInScreen shell and the demo deployment (R-12 Task 8.5, R-18 P1)", () => {
  const DEMO_KEY = "A".repeat(43);

  function renderDemo(demo: boolean | undefined) {
    return render(
      <LangProvider initial="en">
        <SignInScreen config={CONFIG} demo={demo} initialRole={demo ? "supervisor" : null} />
      </LangProvider>,
    );
  }

  beforeEach(() => void vi.stubGlobal("localStorage", createMemoryStorage()));
  afterEach(() => void vi.unstubAllGlobals());

  it("is the one page: a main landmark with the Sign in heading and the role choice, no Try-as buttons, no old restart link", async () => {
    renderDemo(true);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    await screen.findByText("Demo access");
    expect(screen.queryByRole("link", { name: "Start a new demo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Try/ })).toBeNull();
  });

  it("shows no demo text or box on the pilot (no demo prop, or false)", () => {
    renderDemo(undefined);
    expect(screen.queryByText("Demo access")).toBeNull();
    expect(screen.queryByText("Your demo session has ended.")).toBeNull();
    cleanup();
    renderDemo(false);
    expect(screen.queryByText("Demo access")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/demo|000000|judge|example\.com/i);
  });

  it("says the session ended when this browser's demo sandbox is past its expiry", async () => {
    window.localStorage.setItem("bee6.demo", JSON.stringify({ sandbox_key: DEMO_KEY, expires_at_ms: 1000, role: "owner" }));
    renderDemo(true);
    expect(await screen.findByText("Your demo session has ended.")).toBeTruthy();
  });

  it("does not claim the session ended while the sandbox is still live", async () => {
    window.localStorage.setItem("bee6.demo", JSON.stringify({ sandbox_key: DEMO_KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" }));
    renderDemo(true);
    await screen.findByText("Demo access");
    expect(screen.queryByText("Your demo session has ended.")).toBeNull();
  });

  it("in demo mode, an ended demo also removes the judge phone's device keys; a live one and the pilot do not", () => {
    const seedKeys = () => {
      window.localStorage.setItem("bee6.device_token", "t");
      window.localStorage.setItem("bee6.device_id", "d");
    };
    const gone = () => window.localStorage.getItem("bee6.device_token") === null && window.localStorage.getItem("bee6.device_id") === null;

    seedKeys();
    window.localStorage.setItem("bee6.demo", JSON.stringify({ sandbox_key: DEMO_KEY, expires_at_ms: Date.now() + 3_600_000, role: "staff" }));
    renderDemo(true);
    expect(gone()).toBe(false);
    cleanup();

    window.localStorage.setItem("bee6.demo", JSON.stringify({ sandbox_key: DEMO_KEY, expires_at_ms: 1000, role: "staff" }));
    renderDemo(false); // the pilot never touches demo state
    expect(gone()).toBe(false);
    cleanup();

    renderDemo(true);
    expect(gone()).toBe(true);
  });

  it("an ended demo's device keys vanish after mount: the Staff panel drops the connected line and shows the ended line", async () => {
    window.localStorage.setItem("bee6.device_token", "t");
    window.localStorage.setItem("bee6.device_id", "d");
    window.localStorage.setItem("bee6.demo", JSON.stringify({ sandbox_key: DEMO_KEY, expires_at_ms: 1000, role: "staff" }));
    render(
      <LangProvider initial="en">
        <SignInScreen config={CONFIG} demo initialRole="staff" />
      </LangProvider>,
    );
    expect(await screen.findByText("Your demo session has ended.")).toBeTruthy();
    expect(screen.queryByText(/already connected/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Open capture|listening/i })).toBeNull();
  });

  it("keeps the sign-in form usable beside the demo box", async () => {
    renderDemo(true);
    await screen.findByText("Demo access");
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("the home variant: children (the intro) above the sign-in, an h2 for Sign in, and a signed-in visitor is not redirected", async () => {
    authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
    render(
      <LangProvider initial="en">
        <SignInScreen config={CONFIG} demo variant="home" initialRole="staff">
          <h1>Intro title</h1>
        </SignInScreen>
      </LangProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Intro title" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeTruthy();
    await screen.findByText("Demo access");
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
  });
});
