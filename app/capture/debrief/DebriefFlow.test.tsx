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
  demo,
  onSignOut,
  dayNumber,
  expiredFallback,
  note,
}: {
  /** R-19: a sandbox judge device (auto-open, preparing, waiting-more, terminal done). */
  demo?: boolean;
  fetchFn?: typeof fetch;
  storage: Storage;
  endsAtMs?: number;
  nowMs?: number;
  /** Tech-lead finding 3: proves these are only shown for `closed`/`timed_out`. */
  headline?: ReactNode;
  primary?: ReactNode;
  onSignOut?: () => void;
  dayNumber?: number | null;
  /** R-25 idle fix: pass-throughs for the sandbox expired-never-opened fallback and the page's privacy note. */
  expiredFallback?: ReactNode;
  note?: ReactNode;
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
        demo={demo}
        onSignOut={onSignOut}
        dayNumber={dayNumber}
        expiredFallback={expiredFallback}
        note={note}
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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

      fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
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


/**
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3/§6.6), sandbox judge devices only (`demo`). The sandbox
 * labels the judge's moments 2-4 min after End, so: the debrief opens itself, shows "Preparing your
 * questions" while the server says `preparing`, polls every 10 s, never ends on a Yes, and its done screen
 * is terminal (no Back, survives a reload through the completion flag). No pilot screen changes.
 */
describe("DebriefFlow: R-19 demo debrief (sandbox only)", () => {
  const gets = (calls: Array<{ url: string; method: string }>) => calls.filter((c) => c.method === "GET").length;
  /** A list response the test mutates between polls; `preparing` is the server's flag. */
  function server(initial: unknown[], preparing: boolean) {
    const state = { questions: initial, preparing };
    const f = makeFetch({
      list: () => ({
        status: 200,
        body: { data: { debrief: { business_date: "2026-10-07", ends_at_ms: Date.now() + HOUR_MS }, questions: state.questions, preparing: state.preparing } },
      }),
      answer: () => ({ status: 200 }),
    });
    return { ...f, state };
  }
  function pollClock() {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
  }
  async function answerYes(reason = "ok") {
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: reason } });
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  }

  it("a sandbox list carrying a valid question_text shows it as the question heading (the phone's strict parse accepts the key)", async () => {
    const text = "Around 15:00, was the oven checked before opening?";
    const { fn } = server([q("q1", { question_text: text })], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(text));
  });

  it.each([
    ["19 code points", "x".repeat(19)],
    ["141 code points", "x".repeat(141)],
    ["a non-string", 42],
  ])("a list whose question_text is %s fails the phone's strict parse: the load error shows, no question", async (_name, bad) => {
    const { fn } = server([q("q1", { question_text: bad })], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Questions could not load yet.")).toBeTruthy());
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("auto-opens on mount: no 'Answer questions' card, the list is fetched at once", async () => {
    const { fn, calls } = server([q("q1")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    expect(screen.queryByRole("button", { name: "Answer questions" })).toBeNull();
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    expect(gets(calls)).toBe(1);
  });

  it("pilot (no demo): the entry card still shows and nothing is fetched until it is tapped", async () => {
    const { fn, calls } = server([q("q1")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} />);
    expect(screen.getByRole("button", { name: "Answer questions" })).toBeTruthy();
    expect(gets(calls)).toBe(0);
  });

  it("no questions yet and preparing: the Preparing screen (keep the page open), no Back, no Check button", async () => {
    const { fn } = server([], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1, name: "Preparing your questions" })).toBeTruthy();
    // One amber live region carries the keep-the-page-open warning.
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Please keep this page open and the screen on.");
    expect(status.textContent).toContain("If you close the page they will wait for you, but the 60-minute debrief clock keeps running.");
    expect(screen.getByText("Bee6 is reading today's notes and writing your questions. This can take a little longer.")).toBeTruthy();
    expect(screen.getByText("Debrief window 60 min")).toBeTruthy();
    const locked = screen.getByRole("button", { name: "Start is locked until the debrief is done" }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("Preparing shows 'Day n' on the mono line when the page passes the day", async () => {
    const { fn } = server([], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo dayNumber={2} />);
    await waitFor(() => expect(screen.getByText("Day 2 · debrief window 60 min")).toBeTruthy());
  });

  it("the question screen shows the minutes left from the page's clock, rounded up", async () => {
    const endsAtMs = Date.now() + 47 * 60_000 - 20_000;
    const { fn } = server([q("q1")], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} demo />);
    await waitFor(() => expect(screen.getByText("47 min left")).toBeTruthy());
  });

  it("a sandbox debrief has exactly one h1 on every screen (the page keeps none of its own)", async () => {
    const { fn } = server([q("q1")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await answerYes();
    await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("the pilot question screen adds no page h1 of its own (the pilot page has its own)", async () => {
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")]) }) });
    render(<Harness fetchFn={fn} storage={new FakeStorage()} />);
    await openCard();
    expect(screen.getByText("Question 1 of 1")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("polls every 10 s while preparing and shows the question that arrived", async () => {
    pollClock();
    const { fn, calls, state } = server([], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    expect(gets(calls)).toBe(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(gets(calls)).toBe(1);
    state.questions = [q("q1")];
    await vi.advanceTimersByTimeAsync(1_500);
    expect(gets(calls)).toBe(2);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
  });

  it("D0 end to end: Yes on the only question while preparing -> 'Checking for more questions…', never 'Debrief complete'", async () => {
    const { fn } = server([q("q1")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
    expect(screen.getByText(/Answering does not end the debrief/)).toBeTruthy();
    expect(screen.queryByText(/Debrief complete/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("waiting_more -> a new question from the poll is shown; once the server stops preparing with nothing new, done", async () => {
    pollClock();
    const storage = new FakeStorage();
    const { fn, state } = server([q("q1")], true);
    render(<Harness fetchFn={fn} storage={storage} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
    state.questions = [q("q1"), q("q2")];
    await vi.advanceTimersByTimeAsync(10_500);
    // The new list restarts at its first item, but the heading counts over the whole debrief: q1 is already answered.
    await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
    await answerYes("also ok");
    await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
    state.preparing = false;
    await vi.advanceTimersByTimeAsync(10_500);
    await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
    expect(screen.getByText("Thank you. All 2 questions are answered and today is closed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("done with a skipped question: '{k} of {n} were not answered and are recorded as unverified.'", async () => {
    const { fn } = server([q("q1"), q("q2")], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
    expect(screen.getByText("1 of 2 were not answered and are recorded as unverified.")).toBeTruthy();
  });

  it("a single answered question reads 'Today's only question is answered'", async () => {
    const { fn } = server([q("q1")], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
    expect(screen.getByText("Thank you. Today's only question is answered and today is closed.")).toBeTruthy();
  });

  it("no questions and the server is not preparing: terminal 'There are no questions today.' with no Back", async () => {
    const { fn } = server([], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("There are no questions today.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("entering done writes the completion flag bee6.debrief.done = String(endsAtMs)", async () => {
    const storage = new FakeStorage();
    const endsAtMs = Date.now() + HOUR_MS;
    const { fn } = server([q("q1")], false);
    render(<Harness fetchFn={fn} storage={storage} endsAtMs={endsAtMs} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    expect(storage.getItem("bee6.debrief.done")).toBeNull();
    await answerYes();
    await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
    expect(storage.getItem("bee6.debrief.done")).toBe(String(endsAtMs));
  });

  it("the sandbox done screen puts the page's `primary` slot in its footer (the lock line or hint) and never the entry card", async () => {
    const { fn } = server([], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo primary={<p>Start unlocks tomorrow</p>} />);
    await waitFor(() => expect(screen.getByText("There are no questions today.")).toBeTruthy());
    expect(screen.getByText("Start unlocks tomorrow")).toBeTruthy();
    // The page's slot replaces the screen's own button, so there is never a second Start line.
    expect(screen.queryByRole("button", { name: "Start unlocks tomorrow from 01:00" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Answer questions" })).toBeNull();
  });

  it("without a `primary` slot the sandbox done screen draws its own really-disabled Start button", async () => {
    const { fn } = server([], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("There are no questions today.")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Start unlocks tomorrow from 01:00" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the sandbox done screen: stage heading, the next business date, and a Sign out link only when the page passes onSignOut", async () => {
    const { fn } = server([], false);
    const first = render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Debrief complete" })).toBeTruthy());
    expect(screen.getByText(/^Next Start · .+ from 01:00$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    first.unmount();
    const onSignOut = vi.fn();
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo onSignOut={onSignOut} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("the flag survives a remount: the done summary shows again, nothing is fetched, no entry card", async () => {
    const storage = new FakeStorage();
    const endsAtMs = Date.now() + HOUR_MS;
    const { fn, calls } = server([q("q1")], false);
    const first = render(<Harness fetchFn={fn} storage={storage} endsAtMs={endsAtMs} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
    first.unmount();
    const before = gets(calls);
    render(<Harness fetchFn={fn} storage={storage} endsAtMs={endsAtMs} demo primary={<p>Start unlocks tomorrow</p>} />);
    expect(screen.getByText("Debrief complete")).toBeTruthy();
    expect(screen.getByText("Thank you. Today's only question is answered and today is closed.")).toBeTruthy();
    expect(screen.getByText("Start unlocks tomorrow")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Answer questions" })).toBeNull();
    expect(screen.queryByText("Preparing your questions")).toBeNull();
    expect(gets(calls)).toBe(before);
  });

  it("a flag from another debrief (different endsAtMs) is ignored: the new debrief auto-opens", async () => {
    const storage = new FakeStorage();
    storage.setItem("bee6.debrief.done", String(Date.now() - HOUR_MS));
    const { fn, calls } = server([], true);
    render(<Harness fetchFn={fn} storage={storage} demo />);
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    expect(gets(calls)).toBe(1);
  });

  it("the poll stops at the debrief's end", async () => {
    pollClock();
    const endsAtMs = Date.now() + 35_000;
    const { fn, calls } = server([], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} demo />);
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(31_000);
    const during = gets(calls);
    expect(during).toBe(4); // open + 10 s + 20 s + 30 s
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(gets(calls)).toBe(during);
  });

  it("timed out mid-question (demo): 'Debrief closed' with how many were not answered, unverified in bold, Start disabled", async () => {
    const endsAtMs = Date.now() + 5_000;
    const { fn } = server([q("q1"), q("q2")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Debrief closed" })).toBeTruthy());
    const sub = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "The 60 minutes are over. 2 of 2 questions were not answered and are recorded as unverified.");
    expect(sub.querySelector("strong")?.textContent).toBe("unverified");
    expect((screen.getByRole("button", { name: "Start unlocks tomorrow from 01:00" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/The debrief time ran out/)).toBeNull();
  });

  it("timed out (demo): the page's `primary` slot is the footer, its `headline` is not shown", async () => {
    const endsAtMs = Date.now() + 5_000;
    const { fn } = server([q("q1")], true);
    render(
      <Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} demo headline={<p>PAGE HEADLINE</p>} primary={<p>Start unlocks tomorrow</p>} />,
    );
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Debrief closed" })).toBeTruthy());
    expect(screen.getByText("Start unlocks tomorrow")).toBeTruthy();
    expect(screen.queryByText("PAGE HEADLINE")).toBeNull();
  });

  it("timed out with one answered and one left (demo): '1 of 2 questions were not answered'", async () => {
    const endsAtMs = Date.now() + 60_000;
    const { fn } = server([q("q1"), q("q2")], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Debrief closed" })).toBeTruthy());
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "The 60 minutes are over. 1 of 2 questions were not answered and are recorded as unverified.")).toBeTruthy();
  });

  it("timed out before any question was shown (demo): the plain unverified sentence", async () => {
    const endsAtMs = Date.now() + 5_000;
    const { fn } = server([], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} demo />);
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Debrief closed" })).toBeTruthy());
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "The 60 minutes are over. Questions left unanswered are recorded as unverified.")).toBeTruthy();
  });

  it("pilot timeout has no unverified line", async () => {
    const endsAtMs = Date.now() + 5_000;
    const { fn } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")], "2026-10-07", endsAtMs) }) });
    render(<Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} />);
    await openCard();
    fireEvent.click(screen.getByTestId("advance-now"));
    await waitFor(() => expect(screen.getByText(/The debrief time ran out/)).toBeTruthy());
    expect(screen.queryByText("Questions left unanswered are recorded as unverified.")).toBeNull();
  });

  it("pilot (no demo): the list is fetched once and never polled, however long the screen stays open", async () => {
    pollClock();
    const { fn, calls } = makeFetch({ list: () => ({ status: 200, body: listResponse([q("q1")]) }) });
    render(<Harness fetchFn={fn} storage={new FakeStorage()} />);
    await openCard();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(gets(calls)).toBe(1);
  });

  it("a failed poll keeps the current screen (no load_error replaces a question being answered)", async () => {
    pollClock();
    let fail = false;
    const fn = vi.fn(async () =>
      fail
        ? ({ ok: false, status: 503, json: async () => ({}) } as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ data: { debrief: { business_date: "2026-10-07", ends_at_ms: Date.now() + HOUR_MS }, questions: [q("q1")], preparing: true } }),
          } as Response),
    ) as unknown as typeof fetch;
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    fail = true;
    await vi.advanceTimersByTimeAsync(10_500);
    expect(screen.getByText("Question 1 of 1")).toBeTruthy();
    expect(screen.queryByText("Questions could not load yet.")).toBeNull();
  });

  // ── Tech-lead fixes (R-19 PR-3 review) ──────────────────────────────────────────────────────────────────

  it("no polling once the server stops preparing: a question on screen with preparing:false makes no further GETs", async () => {
    pollClock();
    const { fn, calls } = server([q("q1"), q("q2")], false);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
    expect(gets(calls)).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(gets(calls)).toBe(1);
  });

  it("a question on screen keeps polling while the server says preparing, and stops once a poll says it stopped", async () => {
    pollClock();
    const { fn, calls, state } = server([q("q1")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(10_500);
    expect(gets(calls)).toBe(2);
    state.preparing = false;
    await vi.advanceTimersByTimeAsync(10_000); // this poll learns preparing is over
    expect(gets(calls)).toBe(3);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(gets(calls)).toBe(3);
  });

  it("the cap is spent while the server still prepares: the fifth answer ends at the done summary, not at 'Checking for more'", async () => {
    const { fn } = server([q("q1"), q("q2"), q("q3"), q("q4"), q("q5")], true);
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 5")).toBeTruthy());
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Question 5 of 5")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
    expect(screen.queryByText("Checking for more questions…")).toBeNull();
  });

  it("the Preparing and Waiting screens are not aria-busy (a busy region hides updates from a screen reader)", async () => {
    const { fn } = server([], true);
    const first = render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    expect(first.container.querySelector("[aria-busy]")).toBeNull();
    first.unmount();
    const w = server([q("q1")], true);
    const second = render(<Harness fetchFn={w.fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
    await answerYes();
    await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
    expect(second.container.querySelector("[aria-busy]")).toBeNull();
  });

  it("the short Loading placeholder before the auto-open keeps aria-busy", () => {
    const { fn } = server([q("q1")], true);
    const r = render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    expect(r.container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  describe("a reload mid-debrief keeps the counts (progress record)", () => {
    it("reload after 3 answers during waiting_more: the final summary says all 3 answered, never 'no questions today'", async () => {
      pollClock();
      const storage = new FakeStorage();
      const endsAtMs = Date.now() + HOUR_MS;
      const s1 = server([q("q1"), q("q2"), q("q3")], true);
      const first = render(<Harness fetchFn={s1.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Question 1 of 3")).toBeTruthy());
      await answerYes("one");
      await waitFor(() => expect(screen.getByText("Question 2 of 3")).toBeTruthy());
      await answerYes("two");
      await waitFor(() => expect(screen.getByText("Question 3 of 3")).toBeTruthy());
      await answerYes("three");
      await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
      first.unmount();

      // Reload: the server no longer lists the three answered questions; it is still preparing.
      const s2 = server([], true);
      render(<Harness fetchFn={s2.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
      expect(screen.queryByText("Preparing your questions")).toBeNull();
      s2.state.preparing = false;
      await vi.advanceTimersByTimeAsync(10_500);
      await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
      expect(screen.getByText("Thank you. All 3 questions are answered and today is closed.")).toBeTruthy();
      expect(screen.queryByText("There are no questions today.")).toBeNull();
    });

    it("reload after answers when the server has stopped preparing: straight to the done summary with the counts", async () => {
      const storage = new FakeStorage();
      const endsAtMs = Date.now() + HOUR_MS;
      const s1 = server([q("q1"), q("q2")], true);
      const first = render(<Harness fetchFn={s1.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Question 1 of 2")).toBeTruthy());
      await answerYes("one");
      await waitFor(() => expect(screen.getByText("Question 2 of 2")).toBeTruthy());
      await answerYes("two");
      await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
      first.unmount();
      const s2 = server([], false);
      render(<Harness fetchFn={s2.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
      expect(screen.getByText("Thank you. All 2 questions are answered and today is closed.")).toBeTruthy();
    });

    it("the progress record never restores a terminal done on its own: a reload before done auto-opens again", async () => {
      const storage = new FakeStorage();
      const endsAtMs = Date.now() + HOUR_MS;
      const s1 = server([q("q1")], true);
      const first = render(<Harness fetchFn={s1.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
      await answerYes();
      await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
      expect(storage.getItem("bee6.debrief.done")).toBeNull();
      first.unmount();
      const s2 = server([], true);
      render(<Harness fetchFn={s2.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(gets(s2.calls)).toBe(1));
    });

    it("reload after skipping q1 with the server still listing q1: q1 is not offered again and skipped stays 1", async () => {
      pollClock();
      const storage = new FakeStorage();
      const endsAtMs = Date.now() + HOUR_MS;
      const s1 = server([q("q1")], true);
      const first = render(<Harness fetchFn={s1.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
      await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
      first.unmount();

      const s2 = server([q("q1")], true);
      render(<Harness fetchFn={s2.fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Checking for more questions…")).toBeTruthy());
      expect(screen.queryByText("Question 1 of 1")).toBeNull();
      s2.state.preparing = false;
      await vi.advanceTimersByTimeAsync(10_500);
      await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
      expect(screen.getByText("1 of 1 were not answered and are recorded as unverified.")).toBeTruthy();
    });

    it("an older progress record without seen is read as empty, the counts still resume", async () => {
      const storage = new FakeStorage();
      const endsAtMs = Date.now() + HOUR_MS;
      storage.setItem("bee6.debrief.progress", JSON.stringify({ ends_at_ms: endsAtMs, answered: 2, skipped: 0 }));
      const { fn } = server([], false);
      render(<Harness fetchFn={fn} storage={storage} endsAtMs={endsAtMs} demo />);
      await waitFor(() => expect(screen.getByText("Debrief complete")).toBeTruthy());
      expect(screen.getByText("Thank you. All 2 questions are answered and today is closed.")).toBeTruthy();
    });

    it("a progress record of another debrief is ignored", async () => {
      const storage = new FakeStorage();
      storage.setItem("bee6.debrief.progress", JSON.stringify({ ends_at_ms: 1, answered: 4, skipped: 0 }));
      const { fn } = server([], false);
      render(<Harness fetchFn={fn} storage={storage} demo />);
      await waitFor(() => expect(screen.getByText("There are no questions today.")).toBeTruthy());
    });
  });
  // R-25 idle fix (QA R25-001): a fresh sandbox clone carries yesterday's expired `last_ended`, so the flow mounts
  // already past its hour and never opened. The page's idle stage arrives as `expiredFallback`; `note` is the
  // privacy block rendered after every other screen.
  describe("expired and never opened: the page's idle fallback (R-25 idle fix)", () => {
    it("shows the fallback and nothing else (no note, headline or primary), and fetches nothing", async () => {
      const { fn, calls } = server([q("q1")], false);
      render(
        <Harness
          fetchFn={fn}
          storage={new FakeStorage()}
          endsAtMs={Date.now() - 1}
          demo
          expiredFallback={<p>FALLBACK</p>}
          note={<p>NOTE</p>}
          headline={<p>PAGE HEADLINE</p>}
          primary={<p>PRIMARY</p>}
        />,
      );
      expect(screen.getByText("FALLBACK")).toBeTruthy();
      expect(screen.queryByText("NOTE")).toBeNull();
      expect(screen.queryByText("PAGE HEADLINE")).toBeNull();
      expect(screen.queryByText("PRIMARY")).toBeNull();
      expect(gets(calls)).toBe(0);
    });

    it("a done flag for this debrief wins: the done summary shows with the note, not the fallback", async () => {
      const storage = new FakeStorage();
      const endsAtMs = Date.now() - 1;
      storage.setItem("bee6.debrief.done", String(endsAtMs));
      const { fn } = server([q("q1")], false);
      render(<Harness fetchFn={fn} storage={storage} endsAtMs={endsAtMs} demo expiredFallback={<p>FALLBACK</p>} note={<p>NOTE</p>} />);
      expect(screen.getByRole("heading", { level: 1, name: "Debrief complete" })).toBeTruthy();
      expect(screen.getByText("NOTE")).toBeTruthy();
      expect(screen.queryByText("FALLBACK")).toBeNull();
    });

    it("a flow open when the hour ends keeps the Timeout screen (fallback never takes over), note under it", async () => {
      const endsAtMs = Date.now() + 5_000;
      const { fn } = server([q("q1")], true);
      render(
        <Harness fetchFn={fn} storage={new FakeStorage()} endsAtMs={endsAtMs} nowMs={Date.now()} demo expiredFallback={<p>FALLBACK</p>} note={<p>NOTE</p>} />,
      );
      await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
      expect(screen.getByText("NOTE")).toBeTruthy();
      expect(screen.queryByText("FALLBACK")).toBeNull();
      fireEvent.click(screen.getByTestId("advance-now"));
      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Debrief closed" })).toBeTruthy());
      expect(screen.getByText("NOTE")).toBeTruthy();
      expect(screen.queryByText("FALLBACK")).toBeNull();
    });

    it("pilot (no demo): the fallback is ignored, the old closed arm (headline + primary) renders", async () => {
      const { fn } = server([q("q1")], false);
      render(
        <Harness
          fetchFn={fn}
          storage={new FakeStorage()}
          endsAtMs={Date.now() - 1}
          expiredFallback={<p>FALLBACK</p>}
          note={<p>NOTE</p>}
          headline={<p>PAGE HEADLINE</p>}
          primary={<p>PRIMARY</p>}
        />,
      );
      expect(screen.getByText("PAGE HEADLINE")).toBeTruthy();
      expect(screen.getByText("PRIMARY")).toBeTruthy();
      expect(screen.queryByText("FALLBACK")).toBeNull();
      // `note` is harmless here (the page never passes it on the pilot); only `demo` gates the fallback.
      expect(screen.getByText("NOTE")).toBeTruthy();
    });
  });
});

describe("DebriefFlow: quoted lines (demo-feedback-2 item 10, sandbox only)", () => {
  const LINE_A = "Pelanggan tanya roti tawar habis.";
  const LINE_B = "Kami bilang besok pagi ada lagi.";

  /** Records every request body; the list response carries `lines` on q1. */
  function linesFetch() {
    const bodies: string[] = [];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/questions" && method === "GET") {
        const body = listResponse([q("q1", { lines: [LINE_A, LINE_B] })]);
        return { ok: true, status: 200, json: async () => body } as Response;
      }
      if (/\/answer$/.test(url) && method === "POST") {
        bodies.push(String(init?.body ?? ""));
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    });
    return { fn: fn as unknown as typeof fetch, bodies };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the list response's lines through to the question screen as quoted text", async () => {
    const { fn } = linesFetch();
    render(<Harness fetchFn={fn} storage={new FakeStorage()} />);
    await openCard();
    expect(screen.getByText("Bee6 heard:")).toBeTruthy();
    expect(screen.getByText(`“${LINE_A}”`)).toBeTruthy();
    expect(screen.getByText(`“${LINE_B}”`)).toBeTruthy();
  });

  it("never reaches the storage, IndexedDB, or the answer upload body", async () => {
    const { fn, bodies } = linesFetch();
    const storage = new FakeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");
    let idbTouched = 0;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        idbTouched += 1;
        return undefined;
      },
    });
    try {
      render(<Harness fetchFn={fn} storage={storage} />);
      await openCard();
      fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "sudah" } });
      fireEvent.click(screen.getByRole("button", { name: "Next question" }));
      await waitFor(() => expect(screen.getByText("Debrief complete. Thank you.")).toBeTruthy());
    } finally {
      delete (globalThis as Record<string, unknown>).indexedDB;
    }

    expect(setItemSpy).toHaveBeenCalled();
    for (const [key, value] of setItemSpy.mock.calls) {
      expect(String(key)).not.toContain("Pelanggan");
      expect(String(value)).not.toContain("Pelanggan");
      expect(String(value)).not.toContain("roti");
      expect(String(value)).not.toContain("lines");
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain("Pelanggan");
    expect(bodies[0]).not.toContain("lines");
    expect(Object.keys(JSON.parse(bodies[0]!)).sort()).toEqual(
      ["answer", "answered_at_ms", "debrief_business_date", "question_id", "reason"].sort(),
    );
    // The phone cache holds the strict five-key entry and nothing else.
    for (const entry of readCache(storage)) {
      expect(Object.keys(entry).sort()).toEqual(["answer", "answered_at_ms", "debrief_business_date", "question_id", "reason"]);
    }
    expect(idbTouched).toBe(0);
  });

  it("the sandbox (demo) flow shows the lines too", async () => {
    const { fn } = linesFetch();
    render(<Harness fetchFn={fn} storage={new FakeStorage()} demo />);
    await waitFor(() => expect(screen.getByText(`“${LINE_A}”`)).toBeTruthy());
  });
});
