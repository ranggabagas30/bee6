// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { StartDemoResult } from "@/app/demo/demo-client";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { axeViolations } from "@/lib/testing/axe";
import { RoleSignIn } from "@/app/sign-in/RoleSignIn";
import type { SignInRole } from "@/app/sign-in/roles";

const CONFIG: FirebaseWebConfig = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };

const replace = vi.fn();
const push = vi.fn();
const ROUTER = { replace, push };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));

const FAKE_AUTH = { kind: "fake-auth" };
const getClientAuth = vi.fn();
const signInWithEmailAndPassword = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...a: unknown[]) => getClientAuth(...a),
  signInWithEmailAndPassword: (...a: unknown[]) => signInWithEmailAndPassword(...a),
  signOut: (...a: unknown[]) => signOut(...a),
  signInWithCustomToken: vi.fn(),
}));
const postAuthSession = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({ postAuthSession: (...a: unknown[]) => postAuthSession(...a) }));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

const startOrSwitch = vi.fn<(role: string, options: Record<string, unknown>) => Promise<StartDemoResult>>();
vi.mock("@/app/demo/demo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/demo/demo-client")>()),
  startOrSwitch: (role: string, options: Record<string, unknown>) => startOrSwitch(role, options),
}));

const FAKE_USER = { uid: "u1", getIdTokenResult: async () => ({ claims: { role: "supervisor" } }) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function renderSignIn(opts: { demo?: boolean; initialRole?: SignInRole | null; lang?: "en" | "id"; config?: FirebaseWebConfig | null; redirectSignedIn?: boolean; headingLevel?: 1 | 2 } = {}) {
  return render(
    <LangProvider initial={opts.lang ?? "en"}>
      <RoleSignIn
        config={opts.config === undefined ? CONFIG : opts.config}
        demo={opts.demo ?? false}
        initialRole={opts.initialRole ?? null}
        redirectSignedIn={opts.redirectSignedIn}
        headingLevel={opts.headingLevel}
      />
    </LangProvider>,
  );
}
const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const codeInput = () => screen.getByLabelText("6-digit code") as HTMLInputElement;
const submitCode = (code: string) => {
  fireEvent.change(codeInput(), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Set up" }));
};
const submitEmail = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  authUserState = { status: "signed_out" };
  getClientAuth.mockReturnValue(FAKE_AUTH);
  signInWithEmailAndPassword.mockRejectedValue({ code: "auth/invalid-credential" });
  signOut.mockResolvedValue(undefined);
  postAuthSession.mockResolvedValue("ok");
  for (const m of ["log", "info", "warn", "error"]) vi.spyOn(console, m as "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const f of [replace, push, getClientAuth, signInWithEmailAndPassword, signOut, postAuthSession, startOrSwitch]) f.mockReset();
});

describe("RoleSignIn on the pilot (demo=false)", () => {
  it("13.T1: shows no demo text, hint, credential or example address anywhere in the page, whichever role is chosen", () => {
    for (const role of [null, "staff", "supervisor", "owner"] as const) {
      renderSignIn({ initialRole: role });
      expect(document.body.innerHTML, String(role)).not.toMatch(/demo|000000|judge|example\.com/i);
      cleanup();
    }
  });

  it("looks like a normal product sign-in: a Sign in heading, a Sign in as group with Staff, Supervisor and Owner, nothing chosen yet", () => {
    renderSignIn();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    const group = screen.getByRole("group", { name: "Sign in as" });
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual(["Staff", "Supervisor", "Owner"]);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(screen.getByText("Choose who you are to continue.")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  it("pilot + initialRole supervisor or owner still renders the three radios (solo mode is demo-only)", () => {
    for (const role of ["supervisor", "owner"] as const) {
      renderSignIn({ initialRole: role });
      expect(screen.getAllByRole("radio")).toHaveLength(3);
      expect(screen.queryByText(/^Sign in as (Supervisor|Owner)$/)).toBeNull();
      cleanup();
    }
  });

  it("the three radios are one native group (arrow keys move between them) with 48 px tall labels", () => {
    renderSignIn();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios[0]!.name).not.toBe("");
    for (const r of radios) {
      expect(r.type).toBe("radio");
      expect(parseInt(r.closest("label")!.style.minHeight, 10)).toBeGreaterThanOrEqual(48);
    }
  });

  it("can render as an h2 under another page's h1", () => {
    renderSignIn({ headingLevel: 2 });
    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("choosing Staff shows the pairing form with the supervisor-code help; Supervisor and Owner show the email form", () => {
    renderSignIn();
    fireEvent.click(radio("Staff"));
    expect(screen.getByText("Enter the 6-digit code from your supervisor to connect this phone.")).toBeTruthy();
    expect(codeInput()).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    fireEvent.click(radio("Supervisor"));
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    fireEvent.click(radio("Owner"));
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("starts on the role from the URL (initialRole) and keeps the URL in step with the choice without adding history", () => {
    renderSignIn({ initialRole: "owner" });
    expect(radio("Owner").checked).toBe(true);
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled(); // nothing to write on first render
    fireEvent.click(radio("Staff"));
    expect(replace).toHaveBeenCalledWith("?as=staff", { scroll: false });
    expect(push).not.toHaveBeenCalled();
  });

  // A tap or click: the pointer goes down on the label, then the browser fires the click that checks the radio.
  const pointerChoose = (name: string) => {
    fireEvent.pointerDown(screen.getByText(name));
    fireEvent.click(radio(name));
  };
  // What a browser does on an arrow key inside a native radio group: keydown, focus moves to the next radio, which is
  // checked by a synthetic click (and so a change event) with NO pointer event before it.
  const arrowTo = (from: string, to: string) => {
    fireEvent.keyDown(radio(from), { key: "ArrowRight" });
    radio(to).focus();
    fireEvent.click(radio(to));
  };

  it("moves focus to the panel's first input after a pointer role change, and not on first render", () => {
    renderSignIn({ initialRole: "supervisor" });
    expect(document.activeElement).not.toBe(screen.getByLabelText("Email"));
    pointerChoose("Staff");
    expect(document.activeElement).toBe(codeInput());
    pointerChoose("Owner");
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
  });

  it("13.T8: arrow keys walk Staff -> Supervisor -> Owner with focus staying on the radios", () => {
    renderSignIn({ initialRole: "staff" });
    radio("Staff").focus();
    arrowTo("Staff", "Supervisor");
    expect(radio("Supervisor").checked).toBe(true);
    expect(document.activeElement).toBe(radio("Supervisor"));
    arrowTo("Supervisor", "Owner");
    expect(radio("Owner").checked).toBe(true);
    expect(document.activeElement).toBe(radio("Owner"));
    expect(screen.getByLabelText("Email")).toBeTruthy(); // the panel still follows the choice
  });

  it("a pointer press that changes nothing does not make a later arrow key steal focus", () => {
    renderSignIn({ initialRole: "staff" });
    fireEvent.pointerDown(screen.getByText("Staff")); // already selected: no change event follows
    radio("Staff").focus();
    arrowTo("Staff", "Supervisor");
    expect(document.activeElement).toBe(radio("Supervisor"));
  });

  it("E1/13.T4: the staff panel posts any code, 000000 included, to the real pair route; no demo request exists", async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ error: { code: "UNAUTHORIZED" } }, 401));
    vi.stubGlobal("fetch", fetchMock);
    renderSignIn({ initialRole: "staff" });
    submitCode("000000");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Code not recognized"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/devices/pair");
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("E2: a demo email with the demo password goes to Firebase and fails like any unknown user", async () => {
    renderSignIn({ initialRole: "supervisor" });
    submitEmail("owner.judge@example.com", "bee6-demo");
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledWith(FAKE_AUTH, "owner.judge@example.com", "bee6-demo"));
    await waitFor(() => expect(document.body.textContent).toContain("Email or password is wrong."));
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("a successful email sign-in lands by the role in the claims, not by the panel chosen", async () => {
    signInWithEmailAndPassword.mockResolvedValue({ user: FAKE_USER });
    renderSignIn({ initialRole: "owner" });
    submitEmail("sup@shop.test", "pw");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day")); // a supervisor on the Owner panel lands on /day
    expect(replace).not.toHaveBeenCalledWith("/home");
  });

  it("a successful pairing shows the checklist and the button to the listening page in place of the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/v1/devices/pair" ? json({ data: { device_token: "t", device_id: "d", outlet_id: "outlet-7" } }) : json({}, 500))),
    );
    renderSignIn({ initialRole: "staff" });
    submitCode("123456");
    expect(await screen.findByText("For outlet outlet-7")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the listening page" }).getAttribute("href")).toBe("/capture");
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  describe("E22: a phone that is already paired", () => {
    it("offers a link to the listening page above the form", () => {
      window.localStorage.setItem("bee6.device_token", "tok");
      renderSignIn({ initialRole: "staff" });
      expect(screen.getByText("This phone is already connected.")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open the listening page" }).getAttribute("href")).toBe("/capture");
      expect(codeInput()).toBeTruthy();
    });

    it("says nothing without a token, and an empty or unreadable value counts as no token", () => {
      renderSignIn({ initialRole: "staff" });
      expect(screen.queryByText("This phone is already connected.")).toBeNull();
      cleanup();
      window.localStorage.setItem("bee6.device_token", "");
      renderSignIn({ initialRole: "staff" });
      expect(screen.queryByText("This phone is already connected.")).toBeNull();
      cleanup();
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
      });
      renderSignIn({ initialRole: "staff" });
      expect(screen.queryByText("This phone is already connected.")).toBeNull();
    });
  });

  describe("the email panel's Firebase gating (moved from SignInScreen, R-06)", () => {
    it("shows no form while auth is loading or a signed-in user is about to be redirected", () => {
      authUserState = { status: "loading" };
      renderSignIn({ initialRole: "supervisor" });
      expect(screen.queryByLabelText("Email")).toBeNull();
      cleanup();
      authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
      renderSignIn({ initialRole: "supervisor" });
      expect(screen.queryByLabelText("Email")).toBeNull();
    });

    it("redirects an already signed-in user to their start page by role", async () => {
      authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
      renderSignIn({ initialRole: "supervisor" });
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
    });

    it("with redirectSignedIn off (the demo home page) a signed-in visitor keeps a usable form and is not redirected", async () => {
      authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
      renderSignIn({ initialRole: "supervisor", redirectSignedIn: false });
      await act(async () => {});
      expect(replace).not.toHaveBeenCalled();
      expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(false);
    });

    it("without Firebase config the email panel says sign-in is not set up, but the Staff panel still works", () => {
      renderSignIn({ initialRole: "supervisor", config: null });
      expect(document.body.textContent).toContain("Sign-in is not set up on this server.");
      expect(screen.queryByLabelText("Email")).toBeNull();
      fireEvent.click(radio("Staff"));
      expect(codeInput()).toBeTruthy();
    });
  });

  it("is in Bahasa when the language says so", () => {
    renderSignIn({ lang: "id" });
    expect(screen.getByRole("heading", { level: 1, name: "Masuk" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Masuk sebagai" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Staf", "Supervisor", "Pemilik"]);
    expect(screen.getByText("Pilih peran Anda untuk melanjutkan.")).toBeTruthy();
  });

  describe("13.T8 accessibility at 360 px", () => {
    it.each([null, "staff", "supervisor", "owner"] as const)("axe finds no violation with role %s", async (role) => {
      const { container } = renderSignIn({ initialRole: role });
      expect(await axeViolations(container)).toEqual([]);
    });
  });
});

describe("RoleSignIn on a demo deployment (demo=true)", () => {
  async function renderDemo(role: SignInRole | null = "staff", extra: { lang?: "en" | "id" } = {}) {
    const view = renderSignIn({ demo: true, initialRole: role, ...extra });
    if (role) await screen.findByTestId("demo-status"); // the demo box loads lazily
    return view;
  }

  it("the box never prints a credential and has no Fill in; it points at the Judge Guide", async () => {
    for (const role of ["staff", "supervisor", "owner"] as const) {
      await renderDemo(role);
      expect(screen.getByText("Demo access"), role).toBeTruthy();
      expect(screen.queryByText(/judge@example\.com/), role).toBeNull();
      expect(screen.queryByText("bee6-demo"), role).toBeNull();
      expect(screen.queryByText("000000"), role).toBeNull();
      expect(screen.queryByRole("button", { name: /Fill in/ }), role).toBeNull();
      expect(document.body.textContent, role).toContain("in the Judge Guide");
      expect(screen.getByText(/Each sign-in opens your own private copy of a fictional shop for 2 hours/), role).toBeTruthy();
      cleanup();
    }
  });

  it("demo + initialRole supervisor: no radio group, the kicker says Sign in as Supervisor, the email form is there", async () => {
    await renderDemo("supervisor");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Sign in as" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Sign in as Supervisor")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("demo + initialRole owner: same, Sign in as Owner", async () => {
    await renderDemo("owner");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Sign in as Owner")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("demo + initialRole staff and demo + no role keep the three radios", async () => {
    await renderDemo("staff");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    cleanup();
    renderSignIn({ demo: true, initialRole: null });
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("solo supervisor: the typed demo credential still opens the demo (startOrSwitch once, role from the credential), and a real account still goes to Firebase", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    await renderDemo("supervisor");
    await act(async () => {
      submitEmail("supervisor.judge@example.com", "bee6-demo");
    });
    await waitFor(() => expect(startOrSwitch).toHaveBeenCalledTimes(1));
    expect(startOrSwitch.mock.calls[0]![0]).toBe("supervisor");
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
    cleanup();
    startOrSwitch.mockClear();
    await renderDemo("supervisor");
    await act(async () => {
      submitEmail("qa-supervisor@shop.test", "pw");
    });
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledWith(FAKE_AUTH, "qa-supervisor@shop.test", "pw"));
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("13.T3: the staff demo code opens a Staff demo and never calls the pair route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    startOrSwitch.mockResolvedValue({ kind: "started" });
    await renderDemo("staff");
    await act(async () => {
      submitCode("000000");
    });
    await waitFor(() => expect(startOrSwitch).toHaveBeenCalledTimes(1));
    expect(startOrSwitch.mock.calls[0]![0]).toBe("staff");
    expect(startOrSwitch.mock.calls[0]![1].auth).toBe(FAKE_AUTH);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("13.T4: any other code takes the real pair route and starts no demo", async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ error: { code: "UNAUTHORIZED" } }, 401));
    vi.stubGlobal("fetch", fetchMock);
    await renderDemo("staff");
    await act(async () => {
      submitCode("123456");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/devices/pair");
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("13.T5/E4: the credential decides the role: the owner credential typed on the Supervisor panel opens an Owner demo", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    await renderDemo("supervisor");
    await act(async () => {
      submitEmail(" OWNER.JUDGE@example.com ", "bee6-demo");
    });
    await waitFor(() => expect(startOrSwitch).toHaveBeenCalledTimes(1));
    expect(startOrSwitch.mock.calls[0]![0]).toBe("owner");
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("13.T5/E3: a demo email with a wrong password takes the real Firebase path (no oracle)", async () => {
    await renderDemo("supervisor");
    await act(async () => {
      submitEmail("owner.judge@example.com", "wrong");
    });
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledWith(FAKE_AUTH, "owner.judge@example.com", "wrong"));
    expect(startOrSwitch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.body.textContent).toContain("Email or password is wrong."));
  });

  it("anything else typed on a demo deployment signs in for real (internal QA accounts keep working)", async () => {
    await renderDemo("owner");
    await act(async () => {
      submitEmail("demo-owner@example.com", "pw");
    });
    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalledWith(FAKE_AUTH, "demo-owner@example.com", "pw"));
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("the Staff panel still pairs with a typed demo code (the judge guide fills it, PR-5); nothing on the panel shows it", async () => {
    await renderDemo("staff");
    expect(document.body.textContent).not.toContain("000000");
    expect(codeInput().value).toBe("");
  });

  it("a refusal is explained in the demo box and the forms are usable again", async () => {
    startOrSwitch.mockResolvedValue({ kind: "daily_cap", retryAfterSeconds: 7200 });
    await renderDemo("staff");
    await act(async () => {
      submitCode("000000");
    });
    await waitFor(() => expect(screen.getByTestId("demo-status").textContent).toContain("The demo has reached today's limit."));
    expect(screen.getByTestId("demo-status").textContent).toContain("Try again in about 2 h.");
    expect(document.activeElement).toBe(screen.getByTestId("demo-status"));
    expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("13.T8: axe finds no violation in any role panel with the demo box", async () => {
    for (const role of ["staff", "supervisor", "owner"] as const) {
      const { container } = await renderDemo(role);
      expect(await axeViolations(container), role).toEqual([]);
      cleanup();
    }
  });

  it("the demo box is in Bahasa too", async () => {
    await renderDemo("owner", { lang: "id" });
    expect(screen.getByText("Akses demo")).toBeTruthy();
    expect(document.body.textContent).toContain("Panduan Juri");
    expect(screen.queryByRole("button", { name: "Isi otomatis" })).toBeNull();
    expect(screen.getByText("Masuk sebagai Pemilik")).toBeTruthy();
  });
});
