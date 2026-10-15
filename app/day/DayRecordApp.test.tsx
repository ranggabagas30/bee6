// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { DayRecordResponse } from "@/lib/day/contract";
import { DayRecordApp } from "@/app/day/DayRecordApp";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
const push = vi.fn();
const ROUTER = { replace, push };
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

// A thin pass-through wrapper around the real DayRecordView: it captures
// `onReload` so a test can call it directly (Task 7 ships no UI control that
// calls it yet — that is Task 10's `ThreadActions` "onDone" — but the wiring
// itself, and that a reload keeps DayRecordView's own filter state, is this
// PR's contract to get right).
let capturedOnReload: (() => void) | undefined;
vi.mock("@/app/day/DayRecordView", async () => {
  const actual =
    await vi.importActual<typeof import("@/app/day/DayRecordView")>("@/app/day/DayRecordView");
  return {
    DayRecordView: (props: ComponentProps<typeof actual.DayRecordView>) => {
      capturedOnReload = props.onReload;
      return <actual.DayRecordView {...props} />;
    },
  };
});

const FAKE_AUTH = { kind: "fake-auth" };
const FAKE_USER = { uid: "u1" };

function baseHeader(overrides: Partial<DayRecordResponse["day"]> = {}) {
  return {
    date: "2026-10-08",
    today: "2026-10-09",
    day_status: "on" as const,
    sessions_cancelled: 0,
    capture_mode: "room" as const,
    fact_count: 0,
    truncated: false,
    ...overrides,
  };
}

function makeData(overrides: Partial<DayRecordResponse> = {}): DayRecordResponse {
  return {
    view: "owner",
    day: baseHeader(),
    threads: [],
    ...overrides,
  } as DayRecordResponse;
}

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  capturedOnReload = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp(dateParam = "today") {
  return render(
    <LangProvider initial="en">
      <DayRecordApp config={CONFIG} dateParam={dateParam} />
    </LangProvider>,
  );
}

describe("DayRecordApp", () => {
  it("signed_out replaces to /sign-in", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("dateParam='today' success replaces the URL to /day/<date> with exactly one fetch", async () => {
    const data = makeData();
    authedGetJson.mockResolvedValue({ kind: "ok", data });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    renderApp("today");
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(1));
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/day/today", expect.anything());
    await waitFor(() =>
      expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/day/2026-10-08"),
    );
    replaceStateSpy.mockRestore();
  });

  it("invalid shows C-day-invalid with a link to /day", async () => {
    authedGetJson.mockResolvedValue({ kind: "invalid" });
    renderApp("bad-date");
    await waitFor(() =>
      expect(screen.getByText("This date is not available.")).not.toBeNull(),
    );
    const link = screen.getByRole("link", { name: "Go to today" });
    expect(link.getAttribute("href")).toBe("/day");
  });

  it("error shows a retry button that refetches", async () => {
    authedGetJson.mockResolvedValueOnce({ kind: "error" });
    renderApp();
    await waitFor(() => expect(screen.getByText("Could not load the notes.")).not.toBeNull());

    authedGetJson.mockResolvedValueOnce({ kind: "ok", data: makeData() });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
  });

  it("next is disabled when date === today; prev pushes /day/<date - 1>", async () => {
    const data = makeData({ day: baseHeader({ date: "2026-10-09", today: "2026-10-09" }) });
    authedGetJson.mockResolvedValue({ kind: "ok", data });
    renderApp("2026-10-09");
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(push).toHaveBeenCalledWith("/day/2026-10-08");
  });

  it("a 401 that survives the client's own retry (signed_out) signs out and replaces to /sign-in", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    renderApp();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("forbidden shows C-day-forbidden", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderApp();
    await waitFor(() =>
      expect(screen.getByText("This account cannot see the day record.")).not.toBeNull(),
    );
  });

  it("reload() refetches the same dateParam and DayRecordView's filter selection survives it", async () => {
    const data = makeData({
      day: baseHeader({ fact_count: 2 }),
      threads: [
        {
          row: 0,
          category: "ROUTINE_OPS",
          start_hm: "10:00",
          end_hm: "10:05",
          summary: "R1",
          confidence_pct: 90,
          display_status: "fact",
        },
        {
          row: 1,
          category: "COMPLAINT",
          start_hm: "11:00",
          end_hm: "11:05",
          summary: "C1",
          confidence_pct: 90,
          display_status: "fact",
        },
      ],
    });
    authedGetJson.mockResolvedValue({ kind: "ok", data });
    renderApp();
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Customer complaint (1)" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);

    act(() => {
      capturedOnReload?.();
    });

    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
    expect(authedGetJson).toHaveBeenNthCalledWith(2, FAKE_AUTH, "/api/v1/day/today", expect.anything());
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("switching language after load never refetches the day record", async () => {
    function LangToggle() {
      const { setLang } = useLang();
      return (
        <button type="button" onClick={() => setLang("id")}>
          toggle-lang
        </button>
      );
    }
    const data = makeData({ day: baseHeader({ fact_count: 0 }) });
    authedGetJson.mockResolvedValue({ kind: "ok", data });
    render(
      <LangProvider initial="en">
        <LangToggle />
        <DayRecordApp config={CONFIG} dateParam="today" />
      </LangProvider>,
    );
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "toggle-lang" }));

    // Flush any pending microtasks/effects before asserting the negative, so
    // a bug that triggers a second async fetch on toggle would show up here
    // rather than racing past this assertion.
    await act(async () => {
      await Promise.resolve();
    });

    // The language switch re-renders DayRecordView with new labels from the
    // already-fetched data; it is not a reason to call the day-record API
    // again.
    expect(authedGetJson).toHaveBeenCalledTimes(1);
  });
  it("keeps the same top bar and nav nodes across the loading -> ok transition (no remount, no layout jump)", async () => {
    authUserState = {
      status: "signed_in",
      user: { uid: "u1", getIdTokenResult: () => Promise.resolve({ claims: { role: "owner", outlet_id: "o1" } }) },
    } as unknown as AuthUserState;
    let resolveFetch: (v: unknown) => void = () => {};
    authedGetJson.mockReturnValue(new Promise((r) => (resolveFetch = r)));
    renderApp();
    const nav = await screen.findByRole("navigation");
    const bar = () => screen.getByText("bee6").closest("header") as HTMLElement;
    const banner = bar();
    resolveFetch({ kind: "ok", data: makeData() });
    await waitFor(() => expect(authedGetJson).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(banner.isConnected).toBe(true);
    expect(nav.isConnected).toBe(true);
    expect(bar()).toBe(banner);
    expect(screen.getByRole("navigation")).toBe(nav);
  });
});
