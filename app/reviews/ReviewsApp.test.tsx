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
import { axeViolations } from "@/lib/testing/axe";

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

function renderApp(reviewAgentEstimate?: { min_s: number; max_s: number; cap_s: number } | null, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <ReviewsApp config={CONFIG} {...(reviewAgentEstimate !== undefined ? { reviewAgentEstimate } : {})} />
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
    await screen.findByText("Nothing to review yet");
    // D2-06: both sentences, the second says where the date comes from
    expect(
      screen.getByText(
        "When an approved change reaches its review date, it appears here. Review dates are set when the owner approves a proposal.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Reviews" })).not.toBeNull();
    expect(screen.getByText("Did an approved change work?")).not.toBeNull();
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
    expect(screen.queryByText(/^Nothing to review yet/)).toBeNull();
  });
});

describe("ReviewsApp: fast-forward (demo only)", () => {
  it("shows no fast-forward button unless the list reports it available", async () => {
    renderApp();
    await screen.findByText("Check the display more often");
    expect(screen.queryByRole("button", { name: /Fast-forward/ })).toBeNull();
  });

  it("shows a secondary fast-forward button under a visible simulated kick when available", async () => {
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    renderApp();
    const button = await screen.findByRole("button", { name: "Fast-forward to the review date (simulated)" });
    expect(button.className).toContain("b6-btn--secondary");
    expect(screen.getByText("Simulated time (demo)").className).toContain("b6-kick");
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
    await screen.findByRole("heading", { level: 3, name: "Check the display more often" });
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

describe("ReviewsApp: fast-forward while the ReviewAgent runs (plan 5.12)", () => {
  const FF = { name: "Fast-forward to the review date (simulated)" };
  const EST = { min_s: 5, max_s: 15, cap_s: 20 };

  it("without an estimate the busy button keeps today's label and no estimate line appears", async () => {
    let resolve!: (v: unknown) => void;
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderApp(null);
    fireEvent.click(await screen.findByRole("button", FF));
    expect((screen.getByRole("button", FF) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Bee6 is reviewing/)).toBeNull();
    expect(screen.queryByText(/Usually/)).toBeNull();
    await act(async () => resolve({ kind: "error" }));
  });

  it("with an estimate the busy button reads 'Bee6 is reviewing...' and a line gives the range", async () => {
    let resolve!: (v: unknown) => void;
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderApp(EST);
    const idle = await screen.findByRole("button", FF);
    expect(screen.queryByText(/Usually/)).toBeNull(); // idle: the status slot is there but empty
    fireEvent.click(idle);
    const busy = screen.getByRole("button", { name: "Bee6 is reviewing…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    const line = screen.getByText("Bee6 reads the change and the notes from before and after. Usually 5 to 15 seconds.");
    // one polite live region carries the estimate, mounted before the tap so the change is announced
    expect(line.closest("[role='status']")).not.toBeNull();
    await act(async () => resolve({ kind: "error" }));
    await screen.findByRole("button", FF);
    expect(screen.queryByText(/Usually/)).toBeNull();
  });

  it("switches once to 'Taking longer than usual' after max_s and names the cap, and the next run starts the clock again", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    renderApp({ min_s: 0, max_s: 0.05, cap_s: 20 });
    fireEvent.click(await screen.findByRole("button", FF));
    await screen.findByText(
      "Taking longer than usual. If it takes more than about 20 seconds, the result appears without the explanation.",
    );
    await act(async () => resolvers[0]!({ kind: "error" }));
    await screen.findByRole("button", FF);
    expect(screen.queryByText(/Taking longer/)).toBeNull();
    fireEvent.click(screen.getByRole("button", FF));
    screen.getByText(/Usually 0 to 0\.05 seconds/); // fresh run: the estimate again, not the stale overrun line
    await act(async () => resolvers[1]!({ kind: "error" }));
  });

  it("the busy copy is Bahasa on a Bahasa screen", async () => {
    let resolve!: (v: unknown) => void;
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true })));
    authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderApp(EST, "id");
    fireEvent.click(await screen.findByRole("button", { name: "Lompat ke tanggal tinjauan (simulasi)" }));
    expect((screen.getByRole("button", { name: "Bee6 sedang meninjau…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ kind: "error" }));
  });

  it("has no axe violations while busy with the estimate line, in English and Bahasa", async () => {
    for (const lang of ["en", "id"] as const) {
      let resolve!: (v: unknown) => void;
      authedGetJson.mockResolvedValue(
        ok(
          list({
            fast_forward_available: true,
            open: [reviewView({ agent: { narrative_en: "Sold-out requests fell; read it with care.", caveats: ["short_window"] } })],
          }),
        ),
      );
      authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
      const { container } = renderApp(EST, lang);
      fireEvent.click(await screen.findByRole("button", { name: lang === "en" ? FF.name : "Lompat ke tanggal tinjauan (simulasi)" }));
      expect(await axeViolations(container)).toEqual([]);
      await act(async () => resolve({ kind: "error" }));
      cleanup();
    }
  });

  it("shows the explanation panel on the owner's card as well as the supervisor's", async () => {
    const withAgent = reviewView({
      agent: { narrative_en: "Sold-out requests fell after the change; read it with care.", caveats: ["short_window"] },
    });
    for (const role of ["supervisor", "owner"] as const) {
      getIdTokenResult.mockResolvedValue({ claims: { role } });
      authedGetJson.mockResolvedValue(ok(list({ open: [withAgent] })));
      renderApp();
      await screen.findByText("Sold-out requests fell after the change; read it with care.");
      screen.getByText("Bee6 explains");
      cleanup();
    }
  });
});

describe("ReviewsApp: a fast-forward result without an explanation", () => {
  const FF = { name: "Fast-forward to the review date (simulated)" };
  const EST = { min_s: 5, max_s: 15, cap_s: 20 };
  const MISSING =
    "Bee6 could not write an explanation this time (it took too long). The verdict and the numbers above are not affected.";
  const MISSING_ID = "Bee6 tidak dapat menulis penjelasan kali ini (terlalu lama). Keputusan dan angka di atas tidak terpengaruh.";
  const old = reviewView({ version: 2, change_title: "Older change" });
  const created = (agent?: ReviewView["agent"]) =>
    reviewView({ version: 3, change_title: "Fresh change", simulated: true, ...(agent ? { agent } : {}) });
  const AGENT = { narrative_en: "Sold-out requests fell after the change; read it with care.", caveats: [] };

  /** First list: button + one older review. After the tap the server returns `version`, and the reload lists `after`. */
  function arrange(version: number, after: ReviewView[]) {
    authedGetJson
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true, open: [old] })))
      .mockResolvedValue(ok(list({ fast_forward_available: true, open: after })));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { version } });
  }
  async function tap(lang: "en" | "id" = "en") {
    fireEvent.click(await screen.findByRole("button", { name: lang === "en" ? FF.name : "Lompat ke tanggal tinjauan (simulasi)" }));
  }

  it("flag on and the new review has no explanation: one notice, on that review only, as a status", async () => {
    arrange(3, [created(), old]);
    renderApp(EST);
    await tap();
    const notice = await screen.findByText(MISSING);
    expect(screen.getAllByText(MISSING)).toHaveLength(1);
    expect(notice.getAttribute("role")).toBe("status");
    const card = notice.closest("article")!;
    expect(card.textContent).toContain("Fresh change");
    expect(screen.getByText("Older change").closest("article")!.textContent).not.toContain("could not write");
  });

  it("is fixed Bahasa copy on a Bahasa screen", async () => {
    arrange(3, [created(), old]);
    renderApp(EST, "id");
    await tap("id");
    await screen.findByText(MISSING_ID);
  });

  it("flag on and the new review has an explanation: no notice", async () => {
    arrange(3, [created(AGENT), old]);
    renderApp(EST);
    await tap();
    await screen.findByText(AGENT.narrative_en);
    expect(screen.queryByText(/could not write an explanation/)).toBeNull();
  });

  it("flag off: no notice and nothing else changes (null and absent estimate)", async () => {
    for (const estimate of [null, undefined]) {
      arrange(3, [created(), old]);
      const { container } = renderApp(estimate);
      await tap();
      await screen.findByText("Fresh change");
      expect(screen.queryByText(/could not write an explanation/)).toBeNull();
      expect(container.querySelectorAll("[role='status']").length).toBeGreaterThan(0); // the banner and the like stay as today
      expect(screen.queryByText(/Bee6 is reviewing/)).toBeNull();
      cleanup();
      vi.clearAllMocks();
      getClientAuth.mockReturnValue(FAKE_AUTH);
      getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
    }
  });

  it("flag off renders the same markup as before the notice existed (no explanation block, no extra status)", async () => {
    arrange(3, [created(), old]);
    const { container } = renderApp(null);
    await tap();
    await screen.findByText("Fresh change");
    expect(container.textContent).not.toContain("Bee6 could not write");
    expect(container.querySelectorAll("article [role='status']")).toHaveLength(0);
  });

  it("a review that already existed before the tap gets no notice", async () => {
    arrange(2, [old]); // the server answers a version the list already had
    renderApp(EST);
    await tap();
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2)); // the list reloaded after the tap
    await waitFor(() => expect(screen.queryByText(/Bee6 is reviewing/)).toBeNull());
    expect(screen.queryByText(/could not write an explanation/)).toBeNull();
  });

  it("does not show a notice for a failed or empty fast-forward", async () => {
    for (const result of [{ kind: "error" }, { kind: "conflict", code: "NOTHING_TO_REVIEW" }]) {
      authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true, open: [old] })));
      authedPostJson.mockResolvedValue(result);
      renderApp(EST);
      await tap();
      await waitFor(() => expect(screen.queryByText(/Bee6 is reviewing/)).toBeNull());
      expect(screen.queryByText(/could not write an explanation/)).toBeNull();
      cleanup();
    }
  });

  it("is per run: a page reload (a fresh mount) shows no notice, and a later run with an explanation clears it", async () => {
    arrange(3, [created(), old]);
    const first = renderApp(EST);
    await tap();
    await screen.findByText(MISSING);
    first.unmount();
    authedGetJson.mockResolvedValue(ok(list({ fast_forward_available: true, open: [created(), old] })));
    renderApp(EST);
    await screen.findByText("Fresh change");
    expect(screen.queryByText(/could not write an explanation/)).toBeNull();
  });

  it("a second run that explains clears the first run's notice", async () => {
    const second = reviewView({ version: 4, change_title: "Newest change", agent: AGENT });
    authedGetJson
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true, open: [old] })))
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true, open: [created(), old] })))
      .mockResolvedValue(ok(list({ fast_forward_available: true, open: [second, created(), old] })));
    authedPostJson
      .mockResolvedValueOnce({ kind: "ok", data: { version: 3 } })
      .mockResolvedValueOnce({ kind: "ok", data: { version: 4 } });
    renderApp(EST);
    await tap();
    await screen.findByText(MISSING);
    await tap();
    await screen.findByText(AGENT.narrative_en);
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it("has no axe violations with the notice on the page, in English and Bahasa", async () => {
    for (const lang of ["en", "id"] as const) {
      arrange(3, [created(), old]);
      const { container } = renderApp(EST, lang);
      await tap(lang);
      await screen.findByText(lang === "en" ? MISSING : MISSING_ID);
      expect(await axeViolations(container)).toEqual([]);
      cleanup();
      vi.clearAllMocks();
      getClientAuth.mockReturnValue(FAKE_AUTH);
      getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
    }
  });

  it("says the same to the owner as to the supervisor", async () => {
    for (const role of ["owner", "supervisor"] as const) {
      getIdTokenResult.mockResolvedValue({ claims: { role } });
      arrange(3, [created(), old]);
      renderApp(EST);
      await tap();
      await screen.findByText(MISSING);
      cleanup();
      authedGetJson.mockReset();
      authedPostJson.mockReset();
    }
  });
});

describe("ReviewsApp: a failed list reload", () => {
  const settleVerdict = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Revise" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  };

  it("keeps the success banner, focuses it, and offers a secondary retry when the reload after a verdict fails", async () => {
    authedGetJson.mockResolvedValueOnce(ok(list({ open: [reviewView()] }))).mockResolvedValueOnce({ kind: "error" });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderApp();
    await settleVerdict();
    const banner = await screen.findByText("Verdict saved.");
    await screen.findByText("Something went wrong. Try again.");
    expect(screen.getByText("Verdict saved.")).toBe(banner); // same node: focus and live region survive
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(banner);
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.className).toContain("b6-btn--secondary");
  });

  it("keeps the fast-forward banner too when its reload fails", async () => {
    authedGetJson
      .mockResolvedValueOnce(ok(list({ fast_forward_available: true })))
      .mockResolvedValueOnce({ kind: "error" });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { version: 2 } });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Fast-forward/ }));
    await screen.findByText("Simulated review created.");
    await screen.findByRole("button", { name: "Try again" });
    screen.getByText("Simulated review created.");
  });

  it("retry re-fetches the list and restores it, keeping the banner", async () => {
    authedGetJson
      .mockResolvedValueOnce(ok(list({ open: [reviewView()] })))
      .mockResolvedValueOnce({ kind: "error" })
      .mockResolvedValueOnce(ok(list({ open: [reviewView({ change_title: "After retry" })] })));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderApp();
    await settleVerdict();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("After retry");
    expect(authedGetJson).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    screen.getByText("Verdict saved.");
  });

  it("a failed first load also offers retry, and a double tap fetches once", async () => {
    authedGetJson.mockResolvedValueOnce({ kind: "error" });
    let resolve!: (v: unknown) => void;
    authedGetJson.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderApp();
    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(authedGetJson).toHaveBeenCalledTimes(2);
    await act(async () => resolve(ok(list({ open: [reviewView({ change_title: "Back" })] }))));
    await screen.findByText("Back");
  });

  it("a retry that fails again shows the retry again", async () => {
    authedGetJson.mockResolvedValue({ kind: "error" });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
    await screen.findByRole("button", { name: "Try again" });
  });

  it("a forbidden reload shows the forbidden text with no retry", async () => {
    authedGetJson.mockResolvedValueOnce(ok(list({ open: [reviewView()] }))).mockResolvedValueOnce({ kind: "forbidden" });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderApp();
    await settleVerdict();
    await screen.findByText(FORBIDDEN);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a signed_out reload still signs out and redirects", async () => {
    authedGetJson.mockResolvedValueOnce(ok(list({ open: [reviewView()] }))).mockResolvedValueOnce({ kind: "signed_out" });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "recorded", status: "awaiting_owner" } });
    renderApp();
    await settleVerdict();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
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
