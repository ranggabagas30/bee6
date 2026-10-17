// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { DebriefFlow } from "@/app/capture/debrief/DebriefFlow";
import { FRESH_DEMO_SESSION, type DemoSessionProfile } from "@/lib/capture/contract";
import { DEBRIEF_VIEW_EVENT, REFRESH_POLL_MS_DEMO } from "@/lib/debrief/constants";
import { publishDebriefView } from "@/lib/debrief/view-signal";
import { LangProvider } from "@/lib/i18n/context";
import { capturePhaseFor, useDebriefView } from "@/app/demo/guide-bridge";

/**
 * R-19 PR-5 round-4 D2: the guide card lagged the page's question screen by up to one config re-poll (10 s)
 * when the debrief's questions poll and the guide's config poll were out of phase, because the bridge's phase
 * came from the config's `next_day.reason` alone. Now the debrief publishes its view kind the moment it changes
 * and the bridge follows it: the card flips in the same render as the page, with the config untouched.
 */

class MemStorage implements Storage {
  private map = new Map<string, string>();
  [name: string]: unknown;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

afterEach(() => {
  cleanup();
  publishDebriefView(null);
  vi.useRealTimers();
});

describe("useDebriefView", () => {
  it("is null until the debrief publishes, then follows every change at once (no timer, no poll)", () => {
    const { result } = renderHook(() => useDebriefView());
    expect(result.current).toBeNull();
    act(() => publishDebriefView("preparing"));
    expect(result.current).toBe("preparing");
    act(() => publishDebriefView("question"));
    expect(result.current).toBe("question");
    act(() => publishDebriefView(null));
    expect(result.current).toBeNull();
  });

  it("stops listening on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useDebriefView());
    expect(add.mock.calls.some((c) => c[0] === DEBRIEF_VIEW_EVENT)).toBe(true);
    unmount();
    expect(remove.mock.calls.some((c) => c[0] === DEBRIEF_VIEW_EVENT)).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });
});

// ── the de-phased case, end to end on the real DebriefFlow ───────────────────────────────────────────────────

const AUTH = { deviceToken: "t", deviceId: "d1" };
const T0 = Date.parse("2026-10-15T10:00:00Z");
const ENDS_AT = T0 + 3_600_000;
/** The config as the guide would hold it between re-polls: still "preparing", never refetched in this test. */
const STALE_PROFILE: DemoSessionProfile = { ...FRESH_DEMO_SESSION, next_day: { allowed: false, reason: "preparing" } };

/** What the capture page publishes: the phase from the stale config plus the debrief's own screen. */
function Probe() {
  const debriefView = useDebriefView();
  const phase = capturePhaseFor({
    profile: STALE_PROFILE,
    session: null,
    lastEnded: { end_reason: "selesai", debrief_ends_at_ms: ENDS_AT },
    nowMs: T0,
    debriefDoneFlag: null,
    debriefView,
    startOffered: false,
  });
  return <output data-testid="phase">{phase}</output>;
}

function makeFetch(state: { ready: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "/api/v1/questions" || (init?.method ?? "GET") !== "GET") throw new Error(`unexpected fetch ${String(input)}`);
    const body = {
      data: {
        debrief: { business_date: "2026-10-15", ends_at_ms: ENDS_AT },
        questions: state.ready ? [{ question_id: "q1", kind: "gate", category: "PHONE_CALL", start_hm: "10:05", end_hm: "10:10" }] : [],
        preparing: !state.ready,
      },
    };
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

const flush = () => act(async () => {});
const phase = () => screen.getByTestId("phase").textContent;

describe("the guide phase follows the debrief's own screen (de-phased polls)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
  });

  it("preparing -> question flips the phase in the same render as the page's question screen, with no config refetch", async () => {
    const server = { ready: false };
    const fetchFn = makeFetch(server);
    render(
      <LangProvider initial="en">
        <DebriefFlow auth={AUTH} endsAtMs={ENDS_AT} nowMs={T0} tz="Asia/Jakarta" nextMulaiText={null} demo fetchFn={fetchFn} storage={new MemStorage()} />
        <Probe />
      </LangProvider>,
    );
    await flush(); // the sandbox debrief opens itself and loads: preparing
    expect(screen.getByText("Preparing your questions")).toBeTruthy();
    expect(phase()).toBe("debrief_preparing");

    // The questions arrive on the server between the two polls; the config (the guide's poll) is never re-read.
    server.ready = true;
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_POLL_MS_DEMO);
    });
    await flush();
    // The page shows the question (its heading; the card now also carries a category chip name and an explanation
    // line that mention a phone call, so the bare text is no longer unique)...
    expect(screen.getByRole("heading", { level: 2, name: /phone call/i })).toBeTruthy();
    expect(phase()).toBe("debrief_question"); // ...and the bridge's phase is already the question's, no 10 s lag
  });

  it("clears the signal when the debrief unmounts, so the phase falls back to the config rule", async () => {
    const fetchFn = makeFetch({ ready: true });
    const { unmount } = render(
      <LangProvider initial="en">
        <DebriefFlow auth={AUTH} endsAtMs={ENDS_AT} nowMs={T0} tz="Asia/Jakarta" nextMulaiText={null} demo fetchFn={fetchFn} storage={new MemStorage()} />
      </LangProvider>,
    );
    await flush();
    const { result } = renderHook(() => useDebriefView());
    expect(result.current).toBe("question");
    unmount();
    expect(result.current).toBeNull();
  });

  it("a pilot debrief (no `demo`) publishes nothing: the guide never exists there", async () => {
    const fetchFn = makeFetch({ ready: true });
    render(
      <LangProvider initial="en">
        <DebriefFlow auth={AUTH} endsAtMs={ENDS_AT} nowMs={T0} tz="Asia/Jakarta" nextMulaiText={null} fetchFn={fetchFn} storage={new MemStorage()} />
      </LangProvider>,
    );
    await flush();
    const { result } = renderHook(() => useDebriefView());
    expect(result.current).toBeNull();
  });
});
