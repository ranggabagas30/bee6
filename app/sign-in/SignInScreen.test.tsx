// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import { SignInScreen } from "@/app/sign-in/SignInScreen";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const getClientAuth = vi.fn();
const signInWithEmailAndPassword = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => signOut(...args),
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
const FAKE_USER = { uid: "u1" };

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  authUserState = { status: "signed_out" };
  getClientAuth.mockReturnValue(FAKE_AUTH);
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
});

function renderScreen(initial: "en" | "id" = "en") {
  return render(
    <LangProvider initial={initial}>
      <SignInScreen config={CONFIG} />
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
  it("config null shows C-signin-config and no form", () => {
    render(
      <LangProvider initial="en">
        <SignInScreen config={null} />
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

  it("postAuthSession -> ok navigates to /day", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    postAuthSession.mockResolvedValue("ok");
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.c" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
    expect(signOut).not.toHaveBeenCalled();
  });

  it("an already signed-in user on mount replaces to /day without posting a session", async () => {
    authUserState = {
      status: "signed_in",
      user: FAKE_USER,
    } as unknown as AuthUserState;
    renderScreen();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
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

  it("toggling EN -> ID re-renders a shown message in ID", () => {
    render(
      <LangProvider initial="en">
        <LangToggle />
        <SignInScreen config={CONFIG} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(document.body.textContent).toContain("Enter your email and password.");
    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));
    expect(document.body.textContent).toContain("Isi email dan kata sandi.");
  });
});
