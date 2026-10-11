// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DebriefFlow } from "@/app/capture/debrief/DebriefFlow";
import { LangProvider, useLang } from "@/lib/i18n/context";
import { ANSWER_CACHE_KEY, readCache } from "@/lib/debrief/answer-cache";

/**
 * DebriefFlow container (R-07 Task 7.5): owns the reducer, the GET-on-OPEN
 * fetch, the phone answer cache and the exact Lanjut commit order. Mocked
 * fetch + a Map-backed storage fake so every rule is proven without a real
 * server or browser (technical spec section 8.10/8.11).
 *
 * `Date` is frozen every test (fake timers, Date only — real `setInterval`
 * still fires). Without this, DebriefFlow's own 1s "while a question is on
 * screen" tick reads the real wall clock, which instantly dwarfs any small
 * test `endsAtMs` and times every scenario out before it can run.
 */

const HOUR_MS = 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
});

type Call =
  | { op: "setItem"; key: string; value: string }
  | { op: "getItem"; key: string }
  | { op: "removeItem"; key: string };

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  calls: Call[] = [];
  setItemShouldThrow = false;
  [name: string]: unknown;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    this.calls.push({ op: "getItem", key });
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.calls.push({ op: "setItem", key, value });
    if (this.setItemShouldThrow) throw new Error("quota exceeded");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.calls.push({ op: "removeItem", key });
    this.map.delete(key);
  }
}

const AUTH = { deviceToken: "t", deviceId: "d1" };

function q(id: string, overrides: Record<string, unknown> = {}) {
  return { question_id: id, kind: "gate", category: "ROUTINE_OPS", start_hm: "15:00", end_hm: "15:10", ...overrides };
}

function listResponse(questions: unknown[], business_date = "2026-10-07", ends_at_ms = 10_000) {
  return { data: { debrief: { business_date, ends_at_ms }, questions } };
}

/** A fetch mock routed by method + path: GET list, POST answer. */
function makeFetch(opts: {
  list: () => { status: number; body?: unknown };
  answer?: (id: string) => { status: number } | "network";
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/v1/questions" && method === "GET") {
      const { status, body } = opts.list();
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
      } as Response;
    }
    const match = /\/api\/v1\/questions\/([^/]+)\/answer$/.exec(url);
    if (match && method === "POST" && opts.answer) {
      const outcome = opts.answer(decodeURIComponent(match[1] as string));
      if (outcome === "network") throw new Error("network down");
      return { ok: outcome.status >= 200 && outcome.status < 300, status: outcome.status, json: async () => ({}) } as Response;
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  return { fn, calls };
}

function Harness({
  fetchFn,
  storage,
  endsAtMs,
  nowMs,
  headline,
  primary,
  refresh,
}: {
  refresh?: boolean;
  fetchFn?: typeof fetch;
  storage: Storage;
  endsAtMs?: number;
  nowMs?: number;
  /** Tech-lead finding 3: proves these are only shown for `closed`/`timed_out`. */
  headline?: ReactNode;
  primary?: ReactNode;
}) {
  // Date is frozen per-test (see the file-level beforeEach), so these
  // Date.now()-relative defaults are stable across this render and every
  // re-render — a realistic future epoch, never a tiny relative number.
  // Lazy useState initializers (not a bare render-body call) keep this pure.
  const [resolvedEndsAtMs] = useState(() => endsAtMs ?? Date.now() + HOUR_MS);
  const [now, setNow] = useState(() => nowMs ?? Date.now());
  return (
    <LangProvider initial="en">
      <button type="button" data-testid="advance-now" onClick={() => setNow(resolvedEndsAtMs)}>
        advance
      </button>
      <DebriefFlow
        auth={AUTH}
        endsAtMs={resolvedEndsAtMs}
        nowMs={now}
        tz="Asia/Jakarta"
        nextMulaiText={null}
        fetchFn={fetchFn}
        storage={storage}
        headline={headline}
        primary={primary}
        refresh={refresh}
      />
    </LangProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openCard() {
  fireEvent.click(screen.getByRole("button", { name: "Answer questions" }));
  await waitFor(() => expect(screen.queryByText("Loading questions…")).toBeNull());
}

describe("DebriefFlow: list loading", () => {
  it("renders the load_error view with retry when debrief is null", async () => {
    const fn = vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => ({ data: { debrief: null, questions: [] } }) }) as Response,
    );
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    expect(screen.getByText("Questions could not load yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});

describe("DebriefFlow: headline/primary slots (tech-lead finding 3)", () => {
  it("the headline and the Mulai section show on the entry card but not while a question is open", async () => {
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")]) }) });
    const storage = new FakeStorage();
    render(
      <Harness
        fetchFn={fn}
        storage={storage}
        headline={<p>Headline</p>}
        primary={<button type="button">Start</button>}
      />,
    );
    expect(screen.getByText("Headline")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    await openCard();
    expect(screen.queryByText("Headline")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("the headline and the Mulai section show again on the timeout screen", async () => {
    const endsAtMs = Date.now() + 5_000;
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")], "2026-10-07", endsAtMs) }) });
    const storage = new FakeStorage();
    render(
      <Harness
        fetchFn={fn}
        storage={storage}
        endsAtMs={endsAtMs}
        nowMs={Date.now()}
        headline={<p>Headline</p>}
        primary={<button type="button">Start</button>}
      />,
    );
    await openCard();
    expect(screen.queryByText("Headline")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByText(/The debrief time ran out/)).toBeTruthy());
    expect(screen.getByText("Headline")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });
});

describe("DebriefFlow: Lewati never writes or sends", () => {
  it("choose Ya, type, Lewati: no setItem, only the GET fetch happened", async () => {
    const { fn, calls } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1"), q("q2")]) }) });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah dicek" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
    expect(storage.calls.filter((c) => c.op === "setItem")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("DebriefFlow: the global fetch (no test seam)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a real browser fetch (strict `this`) reaches the network: the answer is POSTed and the cache entry cleared", async () => {
    const posted: string[] = [];
    // Behaves like window.fetch: "Illegal invocation" unless called with undefined/globalThis as `this`.
    const strict = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      const url = String(input);
      if (init?.method === "POST") {
        posted.push(url);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => listResponse([q("q1")]),
      } as Response);
    };
    vi.stubGlobal("fetch", strict);
    const storage = new FakeStorage();
    render(<Harness storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(posted).toEqual(["/api/v1/questions/q1/answer"]));
    await waitFor(() => expect(readCache(storage)).toEqual([]));
  });
});

describe("DebriefFlow: Lanjut commit order and persistence", () => {
  it("writes the cache before the POST fetch (call order)", async () => {
    const order: string[] = [];
    const { fn } = makeFetch({
      list: () => ({ status: 200, body: listResponse([q("q1")]) }),
      answer: () => ({ status: 200 }),
    });
    const storage = new FakeStorage();
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      order.push("setItem");
      originalSetItem(key, value);
    };
    const wrappedFetch = vi.fn((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") order.push("fetch:POST");
      return fn(url, init);
    }) as unknown as typeof fetch;

    render(<Harness fetchFn={wrappedFetch} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(order).toContain("fetch:POST"));
    expect(order.indexOf("setItem")).toBeLessThan(order.indexOf("fetch:POST"));
  });

  it("a successful answer reaches the done screen with no stats for a single fully-answered question", async () => {
    const { fn } = makeFetch({
      list: () => ({ status: 200, body: listResponse([q("q1")]) }),
      answer: () => ({ status: 200 }),
    });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
  });

  it("setItem throwing shows C-d-save-fail, keeps the typed text, and never calls fetch for the answer", async () => {
    const { fn, calls } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")]) }) });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    storage.setItemShouldThrow = true;
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "lupa restock" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("lupa restock");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  describe("the typed reason never leaks into any storage write", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("writes it only under the answer cache key, and only after Lanjut", async () => {
      const { fn } = makeFetch({
        list: () => ({ status: 200, body: listResponse([q("q1")]) }),
        answer: () => ({ status: 200 }),
      });
      // tech-lead finding 6: `vi.spyOn(Storage.prototype, "setItem")` is the
      // prescribed way to scan every write regardless of which storage
      // object/key receives it. It does not work in this repo's jsdom test
      // environment, verified directly: `window.localStorage` is undefined
      // here (jsdom needs `--localstorage-file`, which this project does not
      // configure) and `window.sessionStorage`'s setItem is implemented via a
      // jsdom-internal Proxy that ignores a prototype- or instance-level
      // `vi.spyOn` override entirely (ask Rangga/tech-lead to confirm this is
      // accepted; see the handback report). `vi.spyOn` on the plain
      // FakeStorage instance itself does work, uses real spy/mock
      // assertions (not the ad hoc `calls` array), and is still the exact
      // object `effectiveStorage` resolves to, so it still catches every
      // write this component makes under any key.
      const storage = new FakeStorage();
      const setItemSpy = vi.spyOn(storage, "setItem");
      render(<Harness fetchFn={fn} storage={storage} />);
      await openCard();
      fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "rahasia dapur" } });
      // Nothing written to any storage key yet, choice and reason typed but Lanjut not tapped.
      expect(setItemSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());

      const writesWithReason = setItemSpy.mock.calls.filter(
        ([, value]) => typeof value === "string" && value.includes("rahasia dapur"),
      );
      expect(writesWithReason.length).toBeGreaterThan(0);
      for (const [key] of writesWithReason) {
        expect(key).toBe(ANSWER_CACHE_KEY);
      }
    });
  });
});

describe("DebriefFlow: done-screen unsent count stays live (tech-lead finding 2)", () => {
  it("answering the last question online (POST 200) ends with no unsent-answers line", async () => {
    const { fn } = makeFetch({
      list: () => ({ status: 200, body: listResponse([q("q1")]) }),
      answer: () => ({ status: 200 }),
    });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText(/not sent yet/)).toBeNull());
  });

  it("answering with a network error ends showing exactly one unsent answer", async () => {
    const { fn } = makeFetch({
      list: () => ({ status: 200, body: listResponse([q("q1")]) }),
      answer: () => "network",
    });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("1 answer is not sent yet.")).toBeTruthy());
  });
});

describe("DebriefFlow: timeout", () => {
  it("timing out mid-question shows C-d-timeout and caches nothing typed", async () => {
    const endsAtMs = Date.now() + 5_000;
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")], "2026-10-07", endsAtMs) }) });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} endsAtMs={endsAtMs} nowMs={Date.now()} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sedang diketik" } });
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByText(/The debrief time ran out/)).toBeTruthy());
    expect(storage.calls.filter((c) => c.op === "setItem")).toHaveLength(0);
  });

  it("tapping Lanjut after the clock has already passed ends_at_ms times out instead of committing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(0));
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")], "2026-10-07", 1_000) }) });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} endsAtMs={1_000} nowMs={0} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    vi.setSystemTime(new Date(2_000));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText(/The debrief time ran out/)).toBeTruthy());
    expect(storage.calls.filter((c) => c.op === "setItem")).toHaveLength(0);
  });
});

describe("DebriefFlow: reopening inside the hour", () => {
  it("a skipped question shows again, fresh (no choice, no reason)", async () => {
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")]) }) });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openCard();
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) expect(radio.getAttribute("aria-checked")).toBe("false");
  });

  it("a cached (uploaded but not yet acked) answer is filtered out of the reopened list", async () => {
    const { fn } = makeFetch({
      list: () => ({ status: 200, body: listResponse([q("q1"), q("q2")]) }),
      answer: () => "network",
    });
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Still the same fixed two-item list this debrief loaded; filtering only
    // happens once, at LOADED, not on every question transition.
    await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah juga" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openCard();
    // q1's cached (unsent) answer is filtered; only q2 (skipped, never cached) reappears.
    expect(screen.getByText("Question 1 of 1")).toBeTruthy();
  });
});

function LangSwitchButton() {
  const { setLang } = useLang();
  return (
    <button type="button" onClick={() => setLang("id")} data-testid="switch-lang">
      switch
    </button>
  );
}

describe("DebriefFlow: language toggle mid-question", () => {
  it("keeps the choice, the reason and focus on the toggle when the language actually changes", async () => {
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")]) }) });
    const storage = new FakeStorage();

    render(
      <LangProvider initial="en">
        <LangSwitchButton />
        <DebriefFlow
          auth={AUTH}
          // Date is frozen at 2026-10-07 (file-level beforeEach); a relative
          // offset here, not the fixed literal `60 * 60_000` (1970-01-01
          // 01:00), so `nowMs` (also relative to the frozen `Date.now()`)
          // never accidentally starts past `endsAtMs`.
          endsAtMs={Date.now() + HOUR_MS}
          nowMs={0}
          tz="Asia/Jakarta"
          nextMulaiText={null}
          fetchFn={fn}
          storage={storage}
        />
      </LangProvider>,
    );
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "masih sama" } });
    const switchBtn = screen.getByTestId("switch-lang");
    switchBtn.focus();
    fireEvent.click(switchBtn);
    // The label is now Bahasa ("Ya"), but the choice and the typed text survive.
    await waitFor(() => expect(screen.getByRole("radio", { name: "Ya" })).toBeTruthy());
    expect(screen.getByRole("radio", { name: "Ya" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("masih sama");
    // The plan requires the language toggle to keep its own focus — nothing
    // in QuestionScreen's two focus effects (heading on a new index, the
    // alert on save_error) fires on a lang change, so this proves neither
    // one steals it.
    expect(document.activeElement).toBe(switchBtn);
  });
});

describe("DebriefFlow: R-18 refresh (sandbox only)", () => {
  const CHECK = { name: "Check for new questions" };
  const gets = (calls: Array<{ url: string; method: string }>) => calls.filter((c) => c.method === "GET").length;
  /** A list that the test mutates between fetches. */
  function growing(initial: unknown[]) {
    const state = { questions: initial };
    const f = makeFetch({ list: () => ({ status: 200, body: listResponse(state.questions) }), answer: () => ({ status: 200 }) });
    return { ...f, state };
  }
  function pollClock() {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
  }

  it("pilot (no flag): no Check button on the question, empty or done screens", async () => {
    const { fn } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} />);
    await openCard();
    expect(screen.queryByRole("button", CHECK)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    expect(screen.queryByRole("button", CHECK)).toBeNull();
  });

  it("pilot (no flag): the list is fetched once and never again, however long the screen stays open", async () => {
    pollClock();
    const { fn, calls } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} />);
    await openCard();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(gets(calls)).toBe(1);
  });

  it("empty -> the Check button finds a new question and shows it", async () => {
    const { fn, state } = growing([]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await openCard();
    expect(screen.getByText("There are no questions today.")).toBeTruthy();
    state.questions = [q("q9")];
    fireEvent.click(screen.getByRole("button", CHECK));
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
  });

  it("question -> Check appends new ids after the current ones and keeps what was typed", async () => {
    const { fn, state } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah dicek" } });
    state.questions = [q("q1"), q("q2")];
    fireEvent.click(screen.getByRole("button", CHECK));
    await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("sudah dicek");
  });

  it("done -> Check shows only the new question; a skipped one is not offered again", async () => {
    const { fn, state } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await openCard();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", CHECK));
    await waitFor(() => expect(screen.getByRole("button", CHECK)).toBeTruthy());
    expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy(); // nothing new: stays done
    state.questions = [q("q1"), q("q2")];
    fireEvent.click(screen.getByRole("button", CHECK));
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
  });

  it("an answered question already in the phone cache is never offered again", async () => {
    const { fn, state } = growing([q("q1")]);
    const storage = new FakeStorage();
    render(<Harness fetchFn={fn} storage={storage} refresh />);
    await openCard();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
    storage.setItemShouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    state.questions = [q("q1")]; // the server still lists it until the upload lands
    fireEvent.click(screen.getByRole("button", CHECK));
    await waitFor(() => expect(screen.getByRole("button", CHECK)).toBeTruthy());
    expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy();
  });

  it("a failed check keeps the current screen (no load_error replaces a question being answered)", async () => {
    let fail = false;
    const { fn } = makeFetch({
      list: () => (fail ? { status: 500 } : { status: 200, body: listResponse([q("q1")]) }),
    });
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await openCard();
    fail = true;
    fireEvent.click(screen.getByRole("button", CHECK));
    await waitFor(() => expect(screen.getByRole("button", CHECK)).toBeTruthy());
    expect(screen.getByText("Question 1 of 1")).toBeTruthy();
    expect(screen.queryByText("Questions could not load yet.")).toBeNull();
  });

  it("polls every 20 s while the list is on screen and appends what arrived", async () => {
    pollClock();
    const { fn, calls, state } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await openCard();
    expect(gets(calls)).toBe(1);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(gets(calls)).toBe(1);
    state.questions = [q("q1"), q("q2")];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(gets(calls)).toBe(2);
    await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
  });

  it("does not poll before the judge has opened the debrief", async () => {
    pollClock();
    const { fn, calls } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(gets(calls)).toBe(0);
  });

  it("stops polling at the debrief's end", async () => {
    pollClock();
    const endsAtMs = Date.now() + 50_000;
    const { fn, calls } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} refresh />);
    await openCard();
    await vi.advanceTimersByTimeAsync(41_000);
    const during = gets(calls);
    expect(during).toBe(3); // open + 20 s + 40 s
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(gets(calls)).toBe(during);
  });

  it("stops polling 10 minutes after it began", async () => {
    pollClock();
    const { fn, calls } = growing([q("q1")]);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} refresh />);
    await openCard();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    const at = gets(calls);
    expect(at).toBeLessThanOrEqual(31);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(gets(calls)).toBe(at);
  });
});

