// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import {
  FastForwardResponseSchema,
  ListReviewsResponseSchema,
  type ListReviewsResponse,
  type ReviewView,
} from "@/lib/reviews/contract";
import { reviewView } from "@/app/reviews/review-fixtures";
import { ReviewsApp } from "@/app/reviews/ReviewsApp";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

const authedGetJson = vi.fn();
const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const getIdTokenResult = vi.fn();
const FAKE_USER = { uid: "u1", getIdTokenResult };

const list = (o: Partial<ListReviewsResponse> = {}): ListReviewsResponse => ({
  fast_forward_available: false,
  open: [],
  decided: [],
  ...o,
});
const ok = (data: ListReviewsResponse) => ({ kind: "ok", data });

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
  authedGetJson.mockResolvedValue(ok(list({ open: [reviewView()] })));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <LangProvider initial="en">
      <ReviewsApp config={CONFIG} />
    </LangProvider>,
  );
}

const FORBIDDEN = "Only the owner or a supervisor can see reviews.";

describe("ReviewsApp: loading and gating", () => {
  it("makes exactly one GET to /api/v1/reviews on mount", async () => {
    renderApp();
    await screen.findByText("Check the display more often");
    expect(authedGetJson).toHaveBeenCalledTimes(1);
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/reviews", ListReviewsResponseSchema);
  });

  it("shows the loading line, then the heading", async () => {
    renderApp();
    expect(screen.getByText("Loading…")).not.toBeNull();
    await screen.findByRole("heading", { level: 1, name: "Reviews" });
  });

  it("a staff role sees the forbidden text and makes no request", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "staff" } });
    renderApp();
    await screen.findByText(FORBIDDEN);
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("a claims read failure fails closed with no request", async () => {
    getIdTokenResult.mockRejectedValue(new Error("boom"));
    renderApp();
    await screen.findByText(FORBIDDEN);
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("a forbidden answer shows the forbidden text", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderApp();
    await screen.findByText(FORBIDDEN);
  });

  it("signed_out signs out and redirects", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    renderApp();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("an error result shows the generic text", async () => {
    authedGetJson.mockResolvedValue({ kind: "error" });
    renderApp();
    await screen.findByText("Something went wrong. Try again.");
  });

  it("a signed-out user is sent to /sign-in without any request", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("no config shows the sign-in-not-configured message", () => {
    render(
      <LangProvider initial="en">
        <ReviewsApp config={null} />
      </LangProvider>,
    );
    screen.getByText("Sign-in is not set up on this server.");
  });
});

describe("ReviewsApp: lists", () => {
  it("shows the empty state when both lists are empty, and no decided heading", async () => {
    authedGetJson.mockResolvedValue(ok(list()));
    renderApp();
    await screen.findByText("No reviews yet. A review starts on the review date of each SOP change.");
    expect(screen.queryByRole("heading", { name: "Decided" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Waiting for a verdict" })).toBeNull();
  });

  it("lists open reviews with verdict buttons for the supervisor on an awaiting_supervisor review", async () => {
    renderApp();
    await screen.findByRole("heading", { level: 2, name: "Waiting for a verdict" });
    screen.getByRole("button", { name: "Worked" });
  });

  it("the owner sees the same card but no buttons while the supervisor has not decided", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    renderApp();
    await screen.findByText("Check the display more often");
    expect(screen.queryByRole("button", { name: "Worked" })).toBeNull();
    screen.getByText(/^Waiting for the supervisor's verdict by/);
  });

  it("the owner gets the buttons once the review awaits the owner", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    authedGetJson.mockResolvedValue(
      ok(
        list({
          open: [
            reviewView({
              status: "awaiting_owner",
              supervisor: { verdict: "revise", reason: "Few busy days", decided_date: "2026-10-24" },
            }),
          ],
        }),
      ),
    );
    renderApp();
    await screen.findByRole("button", { name: "Worked" });
    screen.getByText("Few busy days"); // the owner sees the supervisor's reason, by design
  });

  it("decided reviews render under their own heading without a panel", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    const decided: ReviewView = reviewView({
      version: 3,
      change_title: "Decided change",
      status: "confirmed",
      supervisor: { verdict: "worked", reason: null, decided_date: "2026-10-24" },
      owner: { verdict: "worked", reason: null, decided_date: "2026-10-25" },
    });
    authedGetJson.mockResolvedValue(ok(list({ decided: [decided] })));
    renderApp();
    await screen.findByRole("heading", { level: 2, name: "Decided" });
    screen.getByText("Decided change");
    screen.getByText("Confirmed. Remembered as: Worked");
    expect(screen.queryByRole("button", { name: "Worked" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Waiting for a verdict" })).toBeNull();
    expect(screen.queryByText(/^No reviews yet/)).toBeNull();
  });
});

describe("ReviewsApp: fast-forward (demo only)", () => {
  it("shows no fast-forward button unless the list reports it available", async () => {
    renderApp();
    await screen.findByText("Check the display more often");
    expect(screen.queryByRole("button", { name: /Fast-forward/ })).toBeNull();
  });

  it("shows a 48px fast-forward button with a visible simulated label when available", async () => {
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    renderApp();
    const button = await screen.findByRole("button", { name: "Fast-forward to the review date (simulated)" });
    expect(button.style.minHeight).toBe("48px");
    screen.getByText("Simulated time (demo)");
  });

  it("one tap posts once with an empty body, shows the banner, reloads, and puts focus on the banner", async () => {
    authedGetJson
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true })))
      .mockResolvedValueOnce(ok(list({ open: [reviewView({ simulated: true })] })));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { version: 2 } });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Fast-forward/ }));
    const banner = await screen.findByText("Simulated review created.");
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      "/api/v1/reviews/fast-forward",
      {},
      FastForwardResponseSchema,
    );
    await screen.findByRole("heading", { level: 3, name: "SOP version 2: review on Fri 23 Oct" });
    expect(authedGetJson).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /Fast-forward/ })).toBeNull();
    expect(document.activeElement).toBe(banner);
    screen.getByText("Simulated time (demo)"); // the card's own label, as the button is gone
  });

  it("a double tap while the request is in flight posts once", async () => {
    let resolve!: (v: unknown) => void;
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderApp();
    const button = await screen.findByRole("button", { name: /Fast-forward/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ kind: "error" }));
  });

  it("NOTHING_TO_REVIEW shows the none banner and reloads the list", async () => {
    authedGetJson
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true })))
      .mockResolvedValueOnce(ok(list()));
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "NOTHING_TO_REVIEW" });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Fast-forward/ }));
    await screen.findByText("No SOP change left to review.");
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Fast-forward/ })).toBeNull());
  });

  it("any other failure shows the generic banner and keeps the button", async () => {
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockResolvedValue({ kind: "error" });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Fast-forward/ }));
    await screen.findByText("Something went wrong. Try again.");
    expect((screen.getByRole("button", { name: /Fast-forward/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(authedGetJson).toHaveBeenCalledTimes(1);
  });

  it("signed_out on fast-forward signs out and redirects", async () => {
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockResolvedValue({ kind: "signed_out" });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Fast-forward/ }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });
});

describe("ReviewsApp: deciding", () => {
  it("a verdict shows the banner, reloads the list, focuses the banner, and the settled panel recovers on a still-open review", async () => {
    authedGetJson.mockImplementation(async () => ok(list({ open: [reviewView()] })));
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "ALREADY_DECIDED" });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Revise" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const banner = await screen.findByText("A verdict was already recorded. The list is updated.");
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(banner);
    // The reload returned the review still open: its buttons are back.
    await screen.findByRole("button", { name: "Revise" });
  });

  it("a recorded supervisor verdict moves the review on: the reload shows it awaiting the owner, without buttons", async () => {
    authedGetJson
      .mockResolvedValueOnce(ok(list({ open: [reviewView()] })))
      .mockResolvedValueOnce(
        ok(
          list({
            open: [
              reviewView({
                status: "awaiting_owner",
                supervisor: { verdict: "revise", reason: null, decided_date: "2026-10-24" },
              }),
            ],
          }),
        ),
      );
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Revise" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await screen.findByText("Verdict saved.");
    await screen.findByText("Waiting for the owner's verdict by Fri 30 Oct");
    expect(screen.queryByRole("button", { name: "Revise" })).toBeNull();
  });

  it("keeps the old list on screen while a reload is in flight", async () => {
    let resolve!: (v: unknown) => void;
    authedGetJson
      .mockResolvedValueOnce(ok(list({ open: [reviewView()] })))
      .mockReturnValueOnce(new Promise((r) => (resolve = r)));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Revise" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await screen.findByText("Verdict saved.");
    expect(screen.getByText("Check the display more often")).not.toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
    await act(async () => resolve(ok(list())));
  });

  it("a stale reload response never overwrites a newer one", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    authedGetJson
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true })))
      .mockImplementation(() => new Promise((r) => resolvers.push(r)));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { version: 2 } });
    renderApp();
    const tapFastForward = async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Fast-forward/ }));
      await screen.findByText("Simulated review created.");
    };
    await tapFastForward(); // reload #2 pending
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => {});
    await tapFastForward(); // reload #3 pending
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[1]!(ok(list({ open: [reviewView({ change_title: "Newest" })] }))));
    await screen.findByText("Newest");
    await act(async () => resolvers[0]!(ok(list({ open: [reviewView({ change_title: "Stale" })] }))));
    expect(screen.queryByText("Stale")).toBeNull();
    screen.getByText("Newest");
  });
});
