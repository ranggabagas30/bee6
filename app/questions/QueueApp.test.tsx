// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { ReviewQueueResponse } from "@/lib/day/contract";
import { QueueApp } from "@/app/questions/QueueApp";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
const ROUTER = { replace };
vi.mock("next/navigation", () => ({
  useRouter: () => ROUTER,
}));

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({
  useAuthUser: () => authUserState,
}));

const authedGetJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const FAKE_USER = { uid: "u1" };

function makeData(overrides: Partial<ReviewQueueResponse> = {}): ReviewQueueResponse {
  return { view: "supervisor_queue", items: [], truncated: false, ...overrides };
}

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <LangProvider initial="en">
      <QueueApp config={CONFIG} />
    </LangProvider>,
  );
}

describe("QueueApp", () => {
  it("signed_out replaces to /sign-in", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("ok fetches /api/v1/questions and renders the queue view", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData() });
    renderApp();
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(1));
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/questions", expect.anything());
    await waitFor(() => expect(screen.getByText("Waiting for review")).not.toBeNull());
    expect(screen.getByText("Nothing is waiting for review.")).not.toBeNull();
  });

  it("forbidden shows a message and a link back to /day (not a redirect)", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderApp();
    await waitFor(() => expect(screen.getByText("This account cannot see the day record.")).not.toBeNull());
    const link = screen.getByRole("link", { name: "Day record" });
    expect(link.getAttribute("href")).toBe("/day");
    expect(replace).not.toHaveBeenCalled();
  });

  it("error shows a retry button that refetches", async () => {
    authedGetJson.mockResolvedValueOnce({ kind: "error" });
    renderApp();
    await waitFor(() => expect(screen.getByText("Could not load the notes.")).not.toBeNull());

    authedGetJson.mockResolvedValueOnce({ kind: "ok", data: makeData() });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
  });

  it("a 401 that survives the client's own retry (signed_out) signs out and replaces to /sign-in", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    renderApp();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("no config shows the sign-in-not-configured message, not a crash", () => {
    render(
      <LangProvider initial="en">
        <QueueApp config={null} />
      </LangProvider>,
    );
    expect(screen.getByText("Sign-in is not set up on this server.")).not.toBeNull();
  });
});
